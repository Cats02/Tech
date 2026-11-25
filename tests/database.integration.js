// Run explicitly with npm run test:database against an EMPTY, DISPOSABLE test database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createRepository, MySQLSessionStore } from '../server/store.js';
import { createServiceRepository, validateService } from '../server/services.js';
import { createBookingRepository, validateBooking } from '../server/bookings.js';
import { adelaideLocal } from '../server/booking-time.js';
import { createReviewRepository } from '../server/booking-review.js';
import {createSchedulingRepository} from '../server/scheduling.js';

test('MySQL migrations, persistent sessions and atomic rate limits', async () => {
    if (process.env.ALLOW_TEST_DATABASE !== 'true' || !process.env.DB_NAME?.endsWith('_test')) {
        throw new Error('Use a disposable DB_NAME ending in _test and set ALLOW_TEST_DATABASE=true.');
    }
    const pool = createPool();
    const sid = `test-${Date.now()}`;
    try {
        await migrate(pool); await migrate(pool);
        await pool.query("UPDATE business_availability SET enabled=TRUE,opens='00:00:00',closes='23:59:00'");
        const store = new MySQLSessionStore(pool);
        const value = { cookie: { expires: new Date(Date.now() + 60000) }, adminId: 123 };
        await new Promise((resolve, reject) => store.set(sid, value, e => e ? reject(e) : resolve()));
        const restored = await new Promise((resolve, reject) => store.get(sid, (e, v) => e ? reject(e) : resolve(v)));
        assert.equal(restored.adminId, 123);
        await new Promise((resolve, reject) => store.destroy(sid, e => e ? reject(e) : resolve()));
        assert.equal(await new Promise((resolve, reject) => store.get(sid, (e, v) => e ? reject(e) : resolve(v))), null);
        const repository = createRepository(pool, 'integration-test-secret');
        const results = await Promise.all(Array.from({ length: 10 }, () => repository.consumeRateLimit(sid, 3, 60000)));
        assert.equal(results.filter(Boolean).length, 3);
        assert.equal(await repository.findAdmin("' OR 1=1 --"), undefined);
        const services = createServiceRepository(pool);
        assert.ok((await services.list()).length >= 17);
        const email = `${sid}@example.test`;
        const [insert] = await pool.execute('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)', [email, 'TEST-ONLY-NOT-A-LOGIN-HASH']);
        let serviceId,customerId;
        try {
            const validated = validateService({name:`Integration ${sid}`,short_description:"Customer's <script> text",full_description:'',home_note:'',
                category:'support',price_type:'from',billing_unit:'item',amount:'45.00',duration_minutes:'60',sort_order:'999',version:'0'});
            assert.deepEqual(validated.errors,[]);
            serviceId = await services.save(null, validated.value, insert.insertId);
            const first = await services.get(serviceId);
            await services.save(serviceId,{...validated.value,amount_cents:5500,version:first.version},insert.insertId);
            const history = await services.history(serviceId);
            assert.equal(history.length,1);
            assert.equal(history[0].old_amount_cents,4500);
            assert.equal(history[0].new_amount_cents,5500);
            await assert.rejects(services.save(serviceId,{...validated.value,version:first.version},insert.insertId),{status:409});
            assert.equal((await services.get(serviceId)).amount_cents,5500);
            assert.equal((await services.history(serviceId)).length,1);
            const current=await services.get(serviceId);
            const attempts=await Promise.allSettled([
                services.save(serviceId,{...validated.value,amount_cents:6000,version:current.version},insert.insertId),
                services.save(serviceId,{...validated.value,amount_cents:6500,version:current.version},insert.insertId)
            ]);
            assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
            assert.equal(attempts.filter(a=>a.status==='rejected' && a.reason.status===409).length,1);
            const latest=await services.get(serviceId);
            await services.save(serviceId,{...validated.value,amount_cents:5500,visible:true,online_booking:true,appointment_types:'Remote',version:latest.version},insert.insertId);
            const available=await services.get(serviceId);
            const local=adelaideLocal(new Date(Date.now()+2*86400000)).slice(0,10)+'T10:00';
            const checked=validateBooking({name:'Booking integration',email,phone:'0412345678',appointment_type:'Remote',description:'Test request',
                preferred_date:local.slice(0,10),preferred_time:local.slice(11),terms:'1'},available);
            assert.deepEqual(checked.errors,[]);
            const bookings=createBookingRepository(pool);
            const key=`${sid}-booking`.padEnd(64,'0');
            const bookingId=await bookings.submit(serviceId,checked.value,key);
            assert.equal(await bookings.submit(serviceId,checked.value,key),bookingId);
            const booking=await bookings.get(bookingId);customerId=booking.customer_id;
            assert.equal(booking.status,'PENDING');assert.equal(booking.amount_cents,5500);
            await services.save(serviceId,{...validated.value,amount_cents:9900,visible:true,online_booking:true,appointment_types:'Remote',version:available.version},insert.insertId);
            const second=await bookings.submit(serviceId,checked.value,`${sid}-second`.padEnd(64,'0'));
            const secondBooking=await bookings.get(second);
            assert.equal(secondBooking.customer_id,customerId);assert.equal(secondBooking.amount_cents,9900);
            assert.equal((await bookings.get(bookingId)).amount_cents,5500);
            const review=createReviewRepository(pool);
            const data=await review.details(bookingId);
            assert.ok(data.conflicts.some(c=>c.id===second));
            const approvals=await Promise.allSettled([
                review.act(bookingId,{action:'accept',slot:'preferred',version:'0'},insert.insertId),
                review.act(second,{action:'accept',slot:'preferred',version:'0'},insert.insertId)
            ]);
            assert.equal(approvals.filter(a=>a.status==='fulfilled').length,1);
            assert.equal(approvals.filter(a=>a.status==='rejected'&&a.reason.status===409).length,1);
            const confirmedId=approvals[0].status==='fulfilled'?bookingId:second;
            const schedule=createSchedulingRepository(pool),settings=await schedule.settings();
            const day=local.slice(0,10);
            await assert.rejects(schedule.addBlock({version:String(settings.version),label:'Conflicting test block',start_date:day,end_date:day,start_time:'10:00',end_time:'11:00'}),{status:409});
            const closed={version:String(settings.version)};
            for(let d=0;d<7;d++){closed[`open_${d}`]='09:00';closed[`close_${d}`]='17:00';}
            await assert.rejects(schedule.saveHours(closed),{status:409});
            await schedule.addBlock({version:String(settings.version),label:'Test block',start_date:day,end_date:day,start_time:'13:00',end_time:'14:00'});
            const blockedChoices=await schedule.slots(await services.get(serviceId),day);
            assert.ok(!blockedChoices.includes('12:15'));assert.ok(blockedChoices.includes('14:00'));
            const afterBlock=await schedule.settings();const testBlock=afterBlock.blocks.find(b=>b.label==='Test block');
            await schedule.removeBlock(testBlock.id,String(afterBlock.version));
            const confirmedReview=await review.details(confirmedId);
            await review.act(confirmedId,{action:'cancel',version:String(confirmedReview.row.review_version),note:'Test cancellation'},insert.insertId);
            const [[reservationCount]]=await pool.execute('SELECT COUNT(*) AS total FROM calendar_reservations WHERE booking_id=?',[confirmedId]);
            assert.equal(Number(reservationCount.total),0);
            assert.equal((await bookings.get(confirmedId)).status,'CANCELLED');
        } finally {
            if(serviceId){
                await pool.execute('DELETE FROM calendar_reservations WHERE booking_id IN (SELECT id FROM bookings WHERE service_id=?)',[serviceId]);
                await pool.execute('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM bookings WHERE service_id=?)',[serviceId]);
                await pool.execute('DELETE FROM booking_review WHERE booking_id IN (SELECT id FROM bookings WHERE service_id=?)',[serviceId]);
                await pool.execute('DELETE FROM bookings WHERE service_id = ?',[serviceId]);await pool.execute('DELETE FROM price_history WHERE service_id = ?',[serviceId]);await pool.execute('DELETE FROM services WHERE id = ?',[serviceId]);
            }
            if(customerId)await pool.execute('DELETE FROM customers WHERE id = ?',[customerId]);
            await pool.execute('DELETE FROM admin_users WHERE id = ?',[insert.insertId]);
        }
    } finally { await pool.end(); }
});
