import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createRepository, MySQLSessionStore } from './store.js';
import { createApp } from './app.js';
import { createServiceRepository } from './services.js';

// Hostinger's Passenger loader uses require(). Keep the entire import graph
// free of top-level await; asynchronous startup belongs inside this function.
async function start() {
    const config = loadConfig();
    const pool = createPool();
    try {
        await pool.query('SELECT id FROM admin_users LIMIT 0');
        await pool.query('SELECT id FROM sessions LIMIT 0');
        await pool.query('SELECT bucket FROM rate_limits LIMIT 0');
        await pool.query('SELECT id FROM services LIMIT 0');
        await pool.query('SELECT id FROM price_history LIMIT 0');
    } catch {
        console.error('Database unavailable or migrations missing. Run the migration command before starting.');
        await pool.end();
        process.exitCode = 1;
        return;
    }
    const app = createApp({ config, repository: createRepository(pool, config.secret), sessionStore: new MySQLSessionStore(pool), serviceRepository: createServiceRepository(pool) });
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
}

start().catch(() => {
    console.error('Application startup failed. Check the required environment settings and database configuration.');
    process.exitCode = 1;
});
