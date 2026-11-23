import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import session from 'express-session';
import { createApp } from '../server/app.js';
import { hashPassword, verifyPassword } from '../server/passwords.js';
import { loadConfig } from '../server/config.js';

const config = { production: false, origin: 'http://localhost:3000', secret: 'a'.repeat(64), proxyHops: 0 };
const hash = await hashPassword('A long test password 452!');
function fixture({ limited = false, production = false } = {}) {
    const attempts = new Map();
    const admin = { id: 1, email: 'admin@example.test', password_hash: hash };
    const repository = {
        findAdmin: async email => email === admin.email ? admin : null,
        getAdmin: async id => id === 1 ? admin : null,
        recordLogin: async () => {},
        consumeRateLimit: async (key, max) => { attempts.set(key, (attempts.get(key) || 0) + 1); return !limited && attempts.get(key) <= max; }
    };
    // Memory storage is intentionally restricted to isolated test fixtures.
    return createApp({ config: { ...config, production, proxyHops: production ? 1 : 0 }, repository, sessionStore: new session.MemoryStore() });
}
function token(response) { return response.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1]; }
async function authenticate(agent) {
    const form = await agent.get('/admin/login');
    const response = await agent.post('/admin/login').type('form').send({ _csrf: token(form), email: 'admin@example.test', password: 'A long test password 452!' });
    assert.equal(response.status, 303);
    return { form, response };
}
test('passwords are salted, verified and bounded', async () => {
    assert.equal(await verifyPassword('A long test password 452!', hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
    assert.equal(await verifyPassword('wrong'), false);
    await assert.rejects(hashPassword('short'));
    assert.notEqual(await hashPassword('A long test password 452!'), hash);
});
test('all anonymous admin paths redirect; private files are never served', async () => {
    const app = fixture();
    for (const path of ['/admin', '/admin/bookings', '/admin/customers', '/admin/settings']) {
        const res = await request(app).get(path);
        assert.equal(res.status, 303); assert.equal(res.headers.location, '/admin/login');
    }
    for (const path of ['/.env', '/server/config.js', '/package.json', '/.git/config', '/tests/auth.test.js']) {
        assert.equal((await request(app).get(path)).status, 404);
    }
});
test('CSRF, malformed tokens and foreign origins are rejected', async () => {
    const agent = request.agent(fixture());
    const form = await agent.get('/admin/login');
    for (const value of [undefined, 'x', 'é'.repeat(64)]) {
        const res = await agent.post('/admin/login').type('form').send({ _csrf: value });
        assert.equal(res.status, 403);
    }
    assert.equal((await agent.post('/admin/login').set('Origin', 'https://attacker.test').type('form').send({ _csrf: token(form) })).status, 403);
});
test('login rotates session, dashboard is protected and logout invalidates it', async () => {
    const agent = request.agent(fixture());
    const { form, response } = await authenticate(agent);
    assert.notEqual(form.headers['set-cookie'][0].split(';')[0], response.headers['set-cookie'][0].split(';')[0]);
    assert.match(response.headers['set-cookie'][0], /HttpOnly/);
    assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
    const dashboard = await agent.get('/admin');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.headers['cache-control'], 'no-store');
    assert.match(dashboard.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.doesNotMatch(dashboard.text, /googletagmanager/);
    assert.equal((await agent.post('/admin/logout').type('form').send({ _csrf: token(form) })).status, 403);
    assert.equal((await agent.post('/admin/logout').type('form').send({ _csrf: token(dashboard) })).status, 303);
    assert.equal((await agent.get('/admin')).status, 303);
});
test('bad credentials are generic and login limits fail closed', async () => {
    const agent = request.agent(fixture());
    const form = await agent.get('/admin/login');
    for (const email of ['unknown@example.test', 'admin@example.test', "' OR 1=1 --"]) {
        const response = await agent.post('/admin/login').type('form').send({ _csrf: token(form), email, password: 'wrong' });
        assert.equal(response.status, 401); assert.match(response.text, /Email or password is incorrect/);
    }
    const limited = request.agent(fixture({ limited: true }));
    const limitedForm = await limited.get('/admin/login');
    assert.equal((await limited.post('/admin/login').type('form').send({ _csrf: token(limitedForm) })).status, 429);
});
test('production requires HTTPS and sets secure cookies', async () => {
    const app = fixture({ production: true });
    assert.equal((await request(app).get('/admin/login')).status, 400);
    const response = await request(app).get('/admin/login').set('X-Forwarded-Proto', 'https');
    assert.equal(response.status, 200);
    assert.match(response.headers['set-cookie'][0], /^__Host-everbright.sid=/);
    assert.match(response.headers['set-cookie'][0], /; Secure/);
});
test('all existing public pages and accessibility assets still work', async () => {
    const app = fixture();
    for (const path of ['/', '/index.html', '/about.html', '/privacy.html', '/cad-3d-printing.html', '/website-development.html']) {
        const response = await request(app).get(path);
        assert.equal(response.status, 200); assert.match(response.text, /script.js/);
    }
    const response = await request(app).get('/script.js');
    assert.match(response.text, /textSizes/); assert.match(response.text, /prefers-reduced-motion/);
});
test('production configuration refuses placeholders and unsafe origins', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_ORIGIN: 'http://example.test' }));
    assert.throws(() => loadConfig({ APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: 'REPLACE_' + 'a'.repeat(64) }));
});
