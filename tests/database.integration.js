// Run explicitly with npm run test:database against an EMPTY, DISPOSABLE test database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createRepository, MySQLSessionStore } from '../server/store.js';
import { createServiceRepository, validateService } from '../server/services.js';

test('MySQL migrations, persistent sessions and atomic rate limits', async () => {
    if (process.env.ALLOW_TEST_DATABASE !== 'true' || !process.env.DB_NAME?.endsWith('_test')) {
        throw new Error('Use a disposable DB_NAME ending in _test and set ALLOW_TEST_DATABASE=true.');
    }
    const pool = createPool();
    const sid = `test-${Date.now()}`;
    try {
        await migrate(pool); await migrate(pool);
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
        let serviceId;
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
        } finally {
            if(serviceId){await pool.execute('DELETE FROM price_history WHERE service_id = ?',[serviceId]);await pool.execute('DELETE FROM services WHERE id = ?',[serviceId]);}
            await pool.execute('DELETE FROM admin_users WHERE id = ?',[insert.insertId]);
        }
    } finally { await pool.end(); }
});
