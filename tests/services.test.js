import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import session from 'express-session';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/passwords.js';
import { formatPrice, validateService, renderPublicServices } from '../server/services.js';

const base = { name:'Computer Diagnosis', short_description:'Diagnosis', full_description:'', home_note:'', category:'support',
    price_type:'from', billing_unit:'item', amount:'45.00', duration_minutes:'60', appointment_types:['Remote','Drop-off'],
    online_booking:'1', visible:'1', show_home:'1', sort_order:'10', version:'1' };
test('service validation preserves exact cents and rejects invalid choices, durations and booking types', () => {
    assert.equal(validateService({...base, amount:'55.09'}).value.amount_cents,5509);
    assert.deepEqual(validateService(base).errors,[]);
    for (const change of [{amount:'-1'},{amount:'1.999'},{amount:'1e3'},{amount:'9999999'}, {price_type:'bad'}, {duration_minutes:'0'},
        {duration_minutes:'1.5'}, {duration_minutes:'1441'}, {category:'<script>'}, {name:' '}, {name:['injected']},
        {appointment_types:['unsupported']}, {appointment_types:[]}, {version:'invalid'}, {sort_order:'65536'}]) {
        assert.ok(validateService({...base,...change}).errors.length,JSON.stringify(change));
    }
    assert.equal(validateService({...base,price_type:'quote',amount:''}).value.amount_cents,null);
});
test('all price display types including From per hour and cents format correctly', () => {
    const row={amount_cents:4500,price_type:'from',billing_unit:'item'};
    assert.equal(formatPrice(row),'From $45');
    assert.equal(formatPrice({...row,amount_cents:5509}),'From $55.09');
    assert.equal(formatPrice({...row,price_type:'fixed'}),'$45');
    assert.equal(formatPrice({...row,billing_unit:'hour'}),'From $45 per hour');
    assert.equal(formatPrice({...row,price_type:'hour'},true),'$45/hour');
    assert.equal(formatPrice({...row,price_type:'quote',amount_cents:null}),'Request a Quote');
});
test('public rendering uses one record on every placement, escapes text and hides retired pricing', () => {
    const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    const web=readFileSync(new URL('../website-development.html',import.meta.url),'utf8');
    const row={...validateService(base).value, id:1, category:'web',name:'<script>alert(1)</script>',home_label:'<img src=x>',amount_cents:5500,short_description:'<b>plain text</b>'};
    const a=renderPublicServices(home,[row]);const b=renderPublicServices(web,[row]);
    assert.match(a,/From \$55/);assert.match(b,/From \$55/);
    assert.match(a,/&lt;img src=x&gt;/);assert.match(b,/&lt;script&gt;/);
    assert.doesNotMatch(a,/From \$45/);assert.doesNotMatch(b,/<script>alert/);
    assert.doesNotMatch(renderPublicServices(home,[{...row,visible:false}]),/From \$55/);
    assert.match(a,/formspree.io/);assert.match(a,/googletagmanager/);assert.match(a,/script.js/);
    assert.match(renderPublicServices(web,[{...row,full_description:'$& $` $\''}]),/\$&amp;/);
});

const hash=await hashPassword('Service testing password!');
function fixture() {
    const row={...validateService(base).value,id:1,slug:'diagnosis',home_label:'Computer Diagnosis'};
    const history=[];
    const services={
        list:async()=>[row], get:async id=>String(id)==='1'?{...row}:undefined, history:async()=>history,
        save:async(id,value,adminId)=>{
            if(value.version!==row.version)throw Object.assign(new Error('Service changed. Reload before saving.'),{status:409});
            if(value.amount_cents!==row.amount_cents)history.push({old_amount_cents:row.amount_cents,new_amount_cents:value.amount_cents,
                old_price_type:row.price_type,new_price_type:value.price_type,old_billing_unit:row.billing_unit,new_billing_unit:value.billing_unit,
                admin_email:'admin@example.test',changed_at:new Date()});
            Object.assign(row,value,{version:row.version+1});return 1;
        }
    };
    const admin={id:1,email:'admin@example.test',password_hash:hash};
    const app=createApp({config:{production:false,secret:'s'.repeat(64),origin:'http://localhost:3000',proxyHops:0},
        repository:{findAdmin:async()=>admin,getAdmin:async()=>admin,recordLogin:async()=>{},consumeRateLimit:async()=>true},
        sessionStore:new session.MemoryStore(),serviceRepository:services,bookingRepository:{pendingCount:async()=>0}});
    return {app,row,history};
}
const csrf=r=>r.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
async function login(agent){const form=await agent.get('/admin/login');await agent.post('/admin/login').type('form').send({_csrf:csrf(form),email:'admin@example.test',password:'Service testing password!'});}
test('service edits require login and CSRF, update public pricing and record history; stale forms conflict', async () => {
    const {app,row,history}=fixture();
    assert.equal((await request(app).get('/admin/services')).status,303);
    assert.equal((await request(app).post('/admin/services/1').type('form').send(base)).status,403);
    const agent=request.agent(app);await login(agent);
    const form=await agent.get('/admin/services/1');assert.equal(form.status,200);
    const bad=await agent.post('/admin/services/1').type('form').send({...base,_csrf:csrf(form),amount:'-99'});
    assert.equal(bad.status,422);assert.equal(row.amount_cents,4500);
    const saved=await agent.post('/admin/services/1').type('form').send({...base,_csrf:csrf(form),amount:'55'});
    assert.equal(saved.status,303);assert.equal(row.amount_cents,5500);assert.equal(history.length,1);
    assert.match((await request(app).get('/')).text,/From \$55/);
    const editor=await agent.get('/admin/services/1?saved=1');assert.match(editor.text,/Service saved/);assert.match(editor.text,/From \$45.*From \$55/);
    const stale=await agent.post('/admin/services/1').type('form').send({...base,_csrf:csrf(form),amount:'99'});
    assert.equal(stale.status,409);assert.equal(row.amount_cents,5500);
    assert.equal((await agent.get('/admin/services/not-an-id')).status,404);
});
test('price pages do not silently serve old HTML prices on database failure', async () => {
    const app=createApp({config:{production:false,secret:'s'.repeat(64),origin:'http://localhost:3000'},repository:{},sessionStore:new session.MemoryStore(),
        serviceRepository:{list:async()=>{throw new Error('database unavailable');}},bookingRepository:{pendingCount:async()=>0}});
    const response=await request(app).get('/');
    assert.equal(response.status,500);assert.doesNotMatch(response.text,/From \$45/);
    assert.equal((await request(app).get('/about.html')).status,200);
});
