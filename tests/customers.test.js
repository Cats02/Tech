import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import session from 'express-session';
import {hashPassword} from '../server/passwords.js';
import {createApp} from '../server/app.js';
import {validateCustomer,createCustomerRepository,customerDetailPage,customerPageNumber} from '../server/customers.js';
const body={name:'Customer',email:'CUSTOMER@example.test',phone:'0412 345 678',address:'Adelaide',notes:'Private note',version:'0'};
test('customer validation normalises contact details and rejects invalid profile data',()=>{
    const result=validateCustomer(body);assert.deepEqual(result.errors,[]);assert.equal(result.value.email,'customer@example.test');assert.equal(result.value.phone,'61412345678');
    for(const change of [{name:''},{email:'bad'},{email:'<script>@example.test'},{phone:'invalid'},{notes:'x'.repeat(5001)},{address:'x'.repeat(501)},{version:'bad'},{name:['a']}])assert.ok(validateCustomer({...body,...change}).errors.length);
    assert.equal(customerPageNumber('-1'),1);assert.equal(customerPageNumber('2'),2);assert.equal(customerPageNumber('1; DROP TABLE customers'),1);
});
test('customer search binds literal wildcard characters, normalises Australian phone searches and paginates',async()=>{
    const calls=[];const pool={execute:async(sql,args)=>{calls.push({sql,args});return sql.includes('COUNT(*) AS total')?[[{total:0}]]:[[]];}};
    const repository=createCustomerRepository(pool);
    await repository.list("%_' OR 1=1",2);assert.match(calls[0].sql,/OFFSET 25/);assert.doesNotMatch(calls[0].sql,/OR 1=1/);assert.match(calls[0].args[0],/=%=_/);
    calls.length=0;await repository.list('0412345678');assert.equal(calls[0].args[2],'%61412345678%');
});
test('profile edits reject duplicates and stale versions, roll back safely and never update booking history',async()=>{
    const calls=[];let rollback=0;
    const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rollback++;},release:()=>{},execute:async(sql,args)=>{
        calls.push(sql);if(sql.startsWith('SELECT'))return [[{id:1,version:1}]];
        if(sql.startsWith('UPDATE customers'))throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});return [{affectedRows:1}];
    }};
    const repository=createCustomerRepository({getConnection:async()=>db});
    await assert.rejects(repository.save(1,validateCustomer(body).value),{status:409});
    await assert.rejects(repository.save(1,{...validateCustomer(body).value,version:1}),{status:409});assert.equal(rollback,2);
    assert.ok(calls.every(sql=>!sql.startsWith('UPDATE bookings')));
});
const customer={id:1,...validateCustomer(body).value};
const historical={id:7,status:'CANCELLED',service_name:'Diagnosis',preferred_start:new Date(),amount_cents:4500,price_type:'from',billing_unit:'item'};
test('customer rendering escapes profile notes and links to status-labelled historical bookings',()=>{
    const html=customerDetailPage({customer:{...customer,notes:'<script>private</script>'},upcoming:[],history:[historical],total:1,page:1},'x');
    assert.match(html,/&lt;script&gt;private/);assert.match(html,/\/admin\/bookings\/7/);assert.match(html,/CANCELLED/);assert.match(html,/From \$45/);
});
const hash=await hashPassword('Customer test admin password!');
test('customer routes require admin/CSRF and preserve the booking snapshot after profile edits',async()=>{
    let current={...customer};
    const data=()=>({customer:current,upcoming:[],history:[historical],total:1,page:1});
    const app=createApp({config:{production:false,origin:'http://localhost:3000',secret:'s'.repeat(64)},sessionStore:new session.MemoryStore(),serviceRepository:{list:async()=>[]},bookingRepository:{pendingCount:async()=>0},
        repository:{findAdmin:async()=>({id:1,email:'admin@example.test',password_hash:hash}),getAdmin:async()=>({id:1,email:'admin@example.test'}),recordLogin:async()=>{},consumeRateLimit:async()=>true},
        customerRepository:{list:async(search,page)=>({rows:[{...current,booking_count:1}],total:1,page,search}),detail:async id=>id==='1'?data():null,
            save:async(id,value)=>{if(value.version!==current.version)throw Object.assign(new Error('Reload before saving.'),{status:409});current={...current,...value,version:current.version+1};}}});
    const token=r=>r.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    for(const path of ['/admin/customers','/admin/customers/1'])assert.equal((await request(app).get(path)).status,303);
    for(const path of ['/customers','/customers/1','/api/customers'])assert.equal((await request(app).get(path)).status,404);
    const agent=request.agent(app),login=await agent.get('/admin/login');
    await agent.post('/admin/login').type('form').send({_csrf:token(login),email:'admin@example.test',password:'Customer test admin password!'});
    const profile=await agent.get('/admin/customers/1');assert.equal(profile.status,200);assert.equal(profile.headers['cache-control'],'no-store');
    assert.equal((await agent.post('/admin/customers/1').type('form').send({...body,_csrf:'bad'})).status,403);
    assert.equal((await agent.post('/admin/customers/1').type('form').send({...body,name:'Updated Customer',_csrf:token(profile)})).status,303);
    const saved=await agent.get('/admin/customers/1?saved=1');assert.match(saved.text,/Updated Customer/);assert.match(saved.text,/From \$45/);assert.match(saved.text,/profile saved/);
    assert.equal((await agent.post('/admin/customers/1').type('form').send({...body,_csrf:token(profile)})).status,409);
    assert.equal((await agent.get('/admin/customers/999')).status,404);
});
