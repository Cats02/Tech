import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import session from 'express-session';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/passwords.js';
import { reviewInput,createReviewRepository,reviewPanel } from '../server/booking-review.js';
import { adelaideLocal } from '../server/booking-time.js';

const start=new Date(Date.now()+2*86400000);start.setUTCSeconds(0,0);
const base={id:1,status:'PENDING',review_version:0,duration_minutes:60,preferred_start:start,alternative_start:new Date(start.getTime()+86400000),
    customer_name:'Test',customer_email:'test@example.test',customer_phone:'61412345678',service_name:'Diagnosis',amount_cents:4500,price_type:'from',billing_unit:'item',description:'Test',terms_accepted_at:new Date(),terms_version:'test',appointment_type:'Remote'};
test('review actions follow status rules, retain proposals as PENDING and use saved duration',()=>{
    const result=reviewInput(base,{action:'accept',slot:'preferred',version:'0',duration_minutes:'1'});
    assert.equal(result.status,'CONFIRMED');assert.equal(result.end-result.start,60*60000);
    const local=adelaideLocal(base.alternative_start);
    assert.equal(reviewInput(base,{action:'propose',version:'0',start_date:local.slice(0,10),start_time:local.slice(11)}).status,'PENDING');
    assert.equal(reviewInput(base,{action:'decline',version:'0',note:'Reason'}).status,'DECLINED');
    assert.equal(reviewInput(base,{action:'cancel',version:'0'}).status,'CANCELLED');
    for(const status of ['DECLINED','CANCELLED','COMPLETED'])assert.throws(()=>reviewInput({...base,status},{action:'accept',version:'0',slot:'preferred'}));
    assert.throws(()=>reviewInput(base,{action:'accept',version:'1',slot:'preferred'}),{status:409});
    assert.throws(()=>reviewInput(base,{action:'accept',version:'0',slot:'invalid'}),{status:422});
    assert.throws(()=>reviewInput(base,{action:'complete',version:'0'}),{status:409});
    assert.throws(()=>reviewInput({...base,status:'CONFIRMED',confirmed_end:start},{action:'complete',version:'0'}),{status:409});
    assert.equal(reviewInput({...base,status:'CONFIRMED',confirmed_end:new Date(Date.now()-1000)},{action:'complete',version:'0'}).status,'COMPLETED');
    assert.throws(()=>reviewInput(base,{action:'decline',version:'0',note:'x'.repeat(2001)}),{status:422});
});
function fakeDatabase(overlap=false,failedAudit=false) {
    const calls=[];let committed=false,rolledBack=false;
    const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},release:()=>{},
        query:async sql=>{calls.push(sql);return [[{id:1}]];},
        execute:async(sql,args)=>{
            assert.equal((sql.match(/\?/g)||[]).length,args.length);calls.push(sql);
            if(sql.startsWith('SELECT b.*'))return [[base]];
            if(sql.startsWith('SELECT id FROM calendar_reservations'))return [overlap?[{id:9}]:[]];
            if(sql.startsWith('SELECT id FROM bookings'))return [[]];
            if(sql.startsWith('INSERT INTO booking_events')&&failedAudit)throw new Error('audit failure');
            return [{affectedRows:1}];
        }};
    return {pool:{getConnection:async()=>db},calls,get committed(){return committed;},get rolledBack(){return rolledBack;}};
}
test('review locks scheduling before checking overlaps; failed actions roll back without approval',async()=>{
    const clear=fakeDatabase();await createReviewRepository(clear.pool).act(1,{action:'accept',slot:'preferred',version:'0'},1);
    assert.equal(clear.committed,true);assert.match(clear.calls[0],/calendar_lock.*FOR UPDATE/);
    assert.ok(clear.calls.find(c=>c.startsWith('INSERT INTO calendar_reservations')));
    for(const db of [fakeDatabase(true),fakeDatabase(false,true)]){
        await assert.rejects(createReviewRepository(db.pool).act(1,{action:'accept',slot:'preferred',version:'0'},1));
        assert.equal(db.committed,false);assert.equal(db.rolledBack,true);
    }
});
test('review UI explains proposals, shows conflict links and escapes private notes',()=>{
    const html=reviewPanel(base,[{action:'decline',previous_status:'PENDING',new_status:'DECLINED',created_at:new Date(),admin_email:'admin@example.test',note:'<script>x</script>'}],
        [{id:2,preferred_start:start}],'c'.repeat(64));
    assert.match(html,/Pending request conflict/);assert.match(html,/\/admin\/bookings\/2/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Suggest Different Time/);
});
const hash=await hashPassword('Review test admin password!');
test('review POST requires admin and CSRF; errors preserve protected review page',async()=>{
    let saved=0;
    const app=createApp({config:{production:false,origin:'http://localhost:3000',secret:'s'.repeat(64)},sessionStore:new session.MemoryStore(),serviceRepository:{list:async()=>[]},
        repository:{findAdmin:async()=>({id:1,password_hash:hash,email:'admin@example.test'}),getAdmin:async()=>({id:1,email:'admin@example.test'}),recordLogin:async()=>{},consumeRateLimit:async()=>true},
        bookingRepository:{pendingCount:async()=>1},reviewRepository:{details:async()=>({row:base,history:[],conflicts:[]}),act:async(id,body)=>{reviewInput(base,body);saved++;}}});
    const token=r=>r.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const agent=request.agent(app);
    assert.equal((await agent.post('/admin/bookings/1/review').type('form').send({action:'accept'})).status,403);
    const login=await agent.get('/admin/login');
    assert.equal((await agent.post('/admin/bookings/1/review').type('form').send({_csrf:token(login),action:'accept'})).status,303);assert.equal(saved,0);
    await agent.post('/admin/login').type('form').send({_csrf:token(login),email:'admin@example.test',password:'Review test admin password!'});
    const page=await agent.get('/admin/bookings/1');
    const body={_csrf:token(page),action:'accept',slot:'preferred',version:'0'};
    assert.equal((await agent.post('/admin/bookings/1/review').type('form').send({...body,_csrf:'bad'})).status,403);
    assert.equal((await agent.post('/admin/bookings/1/review').type('form').send({...body,version:'99'})).status,409);
    assert.equal((await agent.post('/admin/bookings/1/review').type('form').send(body)).status,303);assert.equal(saved,1);
});
