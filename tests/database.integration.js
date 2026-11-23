// Run explicitly with npm run test:database against an EMPTY, DISPOSABLE test database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createRepository, MySQLSessionStore } from '../server/store.js';

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
    } finally { await pool.end(); }
});
