import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPool } from './db.js';
import { loadConfig } from './config.js';

export async function migrate(pool) {
    const db = await pool.getConnection();
    try {
        const [[lock]] = await db.query("SELECT GET_LOCK('everbright-migrations', 30) AS acquired");
        if (lock.acquired !== 1) throw new Error('Migration lock unavailable.');
        await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL,
            applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
        const dir = new URL('./migrations/', import.meta.url);
        for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) {
            const sql = await readFile(new URL(name, dir), 'utf8');
            const checksum = createHash('sha256').update(sql).digest('hex');
            const [[existing]] = await db.execute('SELECT checksum FROM schema_migrations WHERE name = ?', [name]);
            if (existing) {
                if (existing.checksum !== checksum) throw new Error(`Applied migration modified: ${name}`);
                continue;
            }
            // Migrations contain simple DDL only. MySQL DDL auto-commits; tables are idempotent for interrupted setup.
            for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
            await db.execute('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [name, checksum]);
            console.log(`Applied ${name}`);
        }
    } finally {
        await db.query("SELECT RELEASE_LOCK('everbright-migrations')");
        db.release();
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    loadConfig();
    const pool = createPool();
    try { await migrate(pool); }
    catch { console.error('Migration failed. Check database access and migration state.'); process.exitCode = 1; }
    finally { await pool.end(); }
}
