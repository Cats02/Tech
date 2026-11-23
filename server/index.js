import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createRepository, MySQLSessionStore } from './store.js';
import { createApp } from './app.js';

const config = loadConfig();
const pool = createPool();
try {
    await pool.query('SELECT id FROM admin_users LIMIT 0');
    await pool.query('SELECT id FROM sessions LIMIT 0');
    await pool.query('SELECT bucket FROM rate_limits LIMIT 0');
} catch {
    console.error('Database unavailable or migrations missing. Run the migration command before starting.');
    await pool.end(); process.exit(1);
}
const app = createApp({ config, repository: createRepository(pool, config.secret), sessionStore: new MySQLSessionStore(pool) });
const server = app.listen(config.port, '0.0.0.0', () => console.log('Everbright application started.'));
const cleanup = setInterval(async () => {
    try {
        await pool.execute('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]);
        await pool.execute('DELETE FROM rate_limits WHERE expires_at <= ?', [Date.now()]);
    } catch { console.error('Expired record cleanup failed.'); }
}, 15 * 60 * 1000);
cleanup.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    clearInterval(cleanup);
    server.close(async () => { await pool.end(); process.exit(0); });
});
