import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import session from 'express-session';
import {generateSlots,fitsHours,assertAvailable,validateHours,calendarRange,calendarPage,settingsPage,createSchedulingRepository} from '../server/scheduling.js';
import {parseAdelaide} from '../server/booking-time.js';
import {createApp} from '../server/app.js';
const day='2027-02-01',now=new Date('2027-01-31T00:00:00Z');
const hours={weekday:1,enabled:1,opens:'09:00:00',closes:'17:00:00'};
test('slot choices fit full duration, exclude reservations/blocks and allow adjacent appointments',()=>{
    const busy=[{start_at:parseAdelaide(day,'13:00'),end_at:parseAdelaide(day,'15:00')}];
    const slots=generateSlots(day,60,hours,busy,now);
    assert.equal(slots[0],'09:00');assert.equal(slots.at(-1),'16:00');
    assert.ok(slots.includes('12:00'));assert.ok(slots.includes('15:00'));
    for(const time of ['12:15','13:00','14:45','16:15'])assert.ok(!slots.includes(time));
    assert.deepEqual(generateSlots(day,60,{...hours,enabled:0},[],now),[]);
    assert.deepEqual(generateSlots(day,600,hours,[],now),[]);
    assert.equal(fitsHours(parseAdelaide(day,'16:00'),parseAdelaide(day,'17:00'),hours),true);
    assert.equal(fitsHours(parseAdelaide(day,'16:15'),parseAdelaide(day,'17:15'),hours),false);
    assert.equal(fitsHours(parseAdelaide(day,'09:07'),parseAdelaide(day,'10:07'),hours,true),false);
});
test('hours and calendar date ranges validate and handle DST calendar weeks',()=>{
    const body={};for(let d=0;d<7;d++){body[`open_${d}`]='09:00';body[`close_${d}`]='17:00';}
    assert.equal(validateHours(body).length,7);
    assert.throws(()=>validateHours({...body,open_1:'18:00'}),{status:422});
    assert.throws(()=>validateHours({...body,open_1:['09:00']}),{status:422});
    const week=calendarRange('2027-10-03','week');assert.equal(week.first,'2027-09-27');assert.equal(week.days,7);
    const feb=calendarRange('2028-02-10','month');assert.equal(feb.days,29);assert.equal(feb.last,'2028-03-01');
    const html=calendarPage(week,{bookings:[{id:1,status:'PENDING',customer_name:'<script>',service_name:'Diagnosis',preferred_start:parseAdelaide('2027-10-03','10:00'),duration_minutes:60}],blocks:[]},'x');
    assert.match(html,/PENDING/);assert.match(html,/&lt;script&gt;/);assert.match(html,/\/admin\/bookings\/1/);
});
test('availability guard rejects outside hours and occupied intervals at write time',async()=>{
    let block=false;const db={execute:async sql=>sql.startsWith('SELECT *')?[[hours]]:sql.includes('calendar_reservations')?[block?[{id:1}]:[]]:[[]]};
    await assertAvailable(db,parseAdelaide(day,'10:00'),parseAdelaide(day,'11:00'));
    await assert.rejects(assertAvailable(db,parseAdelaide(day,'08:00'),parseAdelaide(day,'09:00')),{status:409});
    block=true;await assert.rejects(assertAvailable(db,parseAdelaide(day,'10:00'),parseAdelaide(day,'11:00')),{status:409});
});
test('settings prevent stale writes and conflicting blocks with transaction rollback',async()=>{
    let rollback=false,commit=false;
    const db={beginTransaction:async()=>{},commit:async()=>{commit=true;},rollback:async()=>{rollback=true;},release:()=>{},
        query:async sql=>sql.includes('calendar_lock')?[[{id:1}]]:sql.startsWith('SELECT version')?[[{version:2}]]:[[]],
        execute:async sql=>sql.startsWith('SELECT')?[[{id:9}]]:[{affectedRows:1}]};
    const repository=createSchedulingRepository({getConnection:async()=>db});
    const body={version:'1',label:'Unavailable',start_date:'2090-02-01',start_time:'13:00',end_date:'2090-02-01',end_time:'15:00'};
    await assert.rejects(repository.addBlock(body),{status:409});assert.equal(rollback,true);assert.equal(commit,false);
    rollback=false;await assert.rejects(repository.addBlock({...body,version:'2'}),{status:409});assert.equal(rollback,true);assert.equal(commit,false);
});
test('public form offers available times only; calendar/settings remain admin-only',async()=>{
    const selected={id:4,name:'Diagnosis',visible:1,online_booking:1,appointment_types:'Remote',duration_minutes:60,price_type:'from',billing_unit:'item',amount_cents:4500};
    const app=createApp({config:{production:false,origin:'http://localhost:3000',secret:'s'.repeat(64)},sessionStore:new session.MemoryStore(),repository:{consumeRateLimit:async()=>true},
        serviceRepository:{list:async()=>[selected]},bookingRepository:{},schedulingRepository:{slots:async()=>['09:00','10:00']}});
    for(const path of ['/book','/book?service=4']){
        const first=await request(app).get(path);assert.equal(first.status,200);assert.match(first.text,/Show Available Times/);assert.match(first.text,/name="date"/);assert.doesNotMatch(first.text,/id="booking-name"|id="booking-preferred_time"|Send Booking Request/);
    }
    const response=await request(app).get('/book?service=4&date=2027-02-01');
    assert.equal(response.status,200);assert.match(response.text,/<select id="booking-preferred_time"/);assert.match(response.text,/<option value="09:00"/);
    assert.doesNotMatch(response.text,/<input id="booking-preferred_time"/);assert.match(response.text,/Show Available Times/);
    for(const path of ['/admin/calendar','/admin/settings'])assert.equal((await request(app).get(path)).status,303);
    assert.equal((await request(app).post('/admin/settings/hours').type('form').send({})).status,403);
});
