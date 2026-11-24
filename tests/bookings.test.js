import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import session from 'express-session';
import { hashPassword } from '../server/passwords.js';
import { createApp } from '../server/app.js';
import { validateBooking, bookingNotice, bookingReceived, createBookingRepository } from '../server/bookings.js';
import { parseAdelaide, adelaideLocal } from '../server/booking-time.js';

const service={id:4,name:'Computer diagnosis',visible:1,online_booking:1,appointment_types:'Remote,On-site',
    amount_cents:4500,price_type:'from',billing_unit:'item',duration_minutes:60,category:'support',show_home:1,home_label:'Computer diagnosis'};
const tomorrow=adelaideLocal(new Date(Date.now()+2*86400000)).slice(0,10);
const valid={service_id:'4',name:'Test Customer',email:'CUSTOMER@example.test',phone:'0412 345 678',appointment_type:'Remote',address:'',
    preferred_date:tomorrow,preferred_time:'10:00',alternative_date:'',alternative_time:'',description:'Help with a computer',terms:'1',website:''};
test('Adelaide conversion handles winter, summer, invalid dates, DST gaps and repeated times',()=>{
    assert.equal(parseAdelaide('2027-06-10','10:00').toISOString(),'2027-06-10T00:30:00.000Z');
    assert.equal(parseAdelaide('2027-01-10','10:00').toISOString(),'2027-01-09T23:30:00.000Z');
    for(const [date,time] of [['2027-02-30','10:00'],['2027-10-03','02:30'],['2027-04-04','02:30'],['2027-01-10','24:00'],['bad','bad']])assert.equal(parseAdelaide(date,time),null);
});
test('booking validation checks service types, address, dates, consent and input lengths',()=>{
    const result=validateBooking(valid,service);
    assert.deepEqual(result.errors,[]);assert.equal(result.value.email,'customer@example.test');assert.equal(result.value.phone,'61412345678');
    assert.equal(validateBooking({...valid,phone:'+61 412 345 678'},service).value.phone,result.value.phone);
    for(const bad of [{name:''},{email:'not-an-email'},{phone:'bad'},{terms:'0'},{appointment_type:'Drop-off'},{appointment_type:'On-site',address:''},
        {preferred_date:'2000-01-01'},{preferred_time:'bad'},{alternative_date:tomorrow},{alternative_date:tomorrow,alternative_time:'10:00'},
        {description:'x'.repeat(5001)},{website:'spam'},{name:['injected']}])assert.ok(validateBooking({...valid,...bad},service).errors.length,JSON.stringify(bad));
    assert.ok(validateBooking(valid,{...service,online_booking:0}).errors.length);
    assert.ok(validateBooking(valid,{...service,visible:0}).errors.length);
    assert.deepEqual(validateBooking({...valid,appointment_type:'On-site',address:'123 Example St, Adelaide'},service).errors,[]);
});
const hash=await hashPassword('Booking test admin password!');
function fixture({limited=false,unavailable=false,failure=false}={}) {
    const records=new Map();
    const services=[{...service,online_booking:unavailable?0:1}];
    const admin={id:1,email:'admin@example.test',password_hash:hash};
    const repository={findAdmin:async()=>admin,getAdmin:async()=>admin,recordLogin:async()=>{},consumeRateLimit:async()=>!limited};
    const bookingRepository={
        pendingCount:async()=>records.size,list:async()=>[...records.values()],get:async id=>[...records.values()].find(r=>String(r.id)===id),
        submit:async(id,value,key)=>{
            if(failure)throw new Error('unavailable');
            if(!records.has(key))records.set(key,{id:records.size+1,status:'PENDING',customer_name:value.name,customer_email:value.email,customer_phone:value.phone,
                service_name:service.name,...value,amount_cents:service.amount_cents,price_type:service.price_type,billing_unit:service.billing_unit,duration_minutes:60,
                terms_version:'test-terms',terms_accepted_at:new Date()});
            return records.get(key).id;
        }
    };
    const app=createApp({config:{origin:'http://localhost:3000',secret:'s'.repeat(64),production:false},repository,sessionStore:new session.MemoryStore(),
        serviceRepository:{list:async()=>services},bookingRepository});
    return {app,records,services};
}
const hidden=(response,name)=>response.text.match(new RegExp(`name="${name}" value="([a-f0-9]+)"`))[1];
test('public requests are CSRF protected, PENDING only and safe to retry without exposing private records',async()=>{
    const {app,records}=fixture();const agent=request.agent(app);
    const form=await agent.get('/book?service=4');assert.equal(form.status,200);assert.match(form.text,/Your appointment is not confirmed/);
    assert.doesNotMatch(form.text,/<option value="Drop-off"/);
    const body={...valid,_csrf:hidden(form,'_csrf'),submission_key:hidden(form,'submission_key'),status:'CONFIRMED',amount_cents:'1'};
    assert.equal((await agent.post('/book').type('form').send({...body,_csrf:'bad'})).status,403);
    assert.equal((await agent.post('/book').type('form').send({...body,submission_key:'not-issued'})).status,403);
    assert.equal((await agent.post('/book').set('Origin','https://attacker.test').type('form').send(body)).status,403);
    assert.equal((await agent.post('/book').type('form').send(body)).status,303);
    assert.equal((await agent.post('/book').type('form').send(body)).status,303);
    assert.equal(records.size,1);assert.equal([...records.values()][0].status,'PENDING');assert.equal([...records.values()][0].amount_cents,4500);
    const received=await agent.get('/book/received');assert.match(received.text,new RegExp(bookingReceived.replaceAll('.','\\.')));assert.doesNotMatch(received.text,/customer@example.test/);
    assert.equal((await request(app).get('/book/received')).status,303);
    for(const path of ['/admin/bookings','/admin/bookings/1'])assert.equal((await request(app).get(path)).status,303);
    assert.equal((await request(app).get('/book/1')).status,404);
    const login=await agent.get('/admin/login');
    await agent.post('/admin/login').type('form').send({_csrf:hidden(login,'_csrf'),email:'admin@example.test',password:'Booking test admin password!'});
    const detail=await agent.get('/admin/bookings/1');assert.equal(detail.status,200);assert.match(detail.text,/Status/);assert.match(detail.text,/PENDING/);
    assert.match((await agent.get('/admin')).text,/1 PENDING/);
});
test('invalid requests retain safe values, do not save, and blocked services do not offer a form',async()=>{
    const {app,records}=fixture();const agent=request.agent(app);const form=await agent.get('/book?service=4');
    const result=await agent.post('/book').type('form').send({...valid,name:'<script>test</script>',terms:'0',_csrf:hidden(form,'_csrf'),submission_key:hidden(form,'submission_key')});
    assert.equal(result.status,422);assert.match(result.text,/&lt;script&gt;/);assert.equal(records.size,0);
    const disabled=await request(fixture({unavailable:true}).app).get('/book?service=4');assert.doesNotMatch(disabled.text,/Send Booking Request/);
    assert.equal((await request(fixture({limited:true}).app).get('/book')).status,429);
    const broken=request.agent(fixture({failure:true}).app);const fresh=await broken.get('/book?service=4');
    const failed=await broken.post('/book').type('form').send({...valid,_csrf:hidden(fresh,'_csrf'),submission_key:hidden(fresh,'submission_key')});
    assert.equal(failed.status,500);assert.doesNotMatch(failed.text,/Booking request received/);
});
test('database writes bind values, use server-side snapshots and roll back a failed booking',async()=>{
    let rolledBack=false,committed=false;const calls=[];
    const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},release:()=>{},
        execute:async(sql,args)=>{
            assert.equal((sql.match(/\?/g)||[]).length,args.length);calls.push({sql,args});
            if(sql.startsWith('SELECT * FROM services'))return [[service]];
            if(sql.startsWith('SELECT id FROM bookings'))return [[]];
            if(sql.startsWith('SELECT id FROM customers'))return [[{id:123}]];
            if(sql.startsWith('INSERT INTO bookings'))throw new Error('simulated database failure');
            return [{insertId:123}];
        }};
    const value=validateBooking({...valid,name:"Customer's name"},service).value;
    await assert.rejects(createBookingRepository({getConnection:async()=>db}).submit(4,value,'a'.repeat(64)));
    assert.equal(rolledBack,true);assert.equal(committed,false);
    const booking=calls.find(c=>c.sql.startsWith('INSERT INTO bookings'));
    assert.match(booking.sql,/'PENDING'/);assert.doesNotMatch(booking.sql,/Customer's/);assert.ok(booking.args.includes(4500));
});
