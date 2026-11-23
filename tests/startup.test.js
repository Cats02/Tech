import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Hostinger-style require loads the entry graph without top-level await', () => {
    const entry = fileURLToPath(new URL('../server/index.js', import.meta.url));
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)}); console.log('ENTRY_LOADED');`], {
        encoding: 'utf8', timeout: 15000,
        // Deliberately invalid configuration: no real database or credentials are used.
        env: { PATH: process.env.PATH, NODE_ENV: 'production', APP_ORIGIN: 'invalid' }
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /ENTRY_LOADED/);
    assert.match(result.stderr, /Application startup failed/);
    assert.doesNotMatch(result.stderr, /ERR_REQUIRE_ASYNC_MODULE|ERR_REQUIRE_ESM|UnhandledPromiseRejection/);
});
