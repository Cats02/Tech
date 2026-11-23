import session from 'express-session';
import { createHmac } from 'node:crypto';

export class MySQLSessionStore extends session.Store {
    constructor(pool) { super(); this.pool = pool; }
    get(id, callback) {
        this.pool.execute('SELECT data FROM sessions WHERE id = ? AND expires_at > ?', [id, Date.now()])
            .then(([[row]]) => callback(null, row ? JSON.parse(row.data) : null)).catch(callback);
    }
    set(id, value, callback = () => {}) {
        const expires = new Date(value.cookie.expires).getTime();
        this.pool.execute(`INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE data = VALUES(data), expires_at = VALUES(expires_at)`,
        [id, JSON.stringify(value), expires]).then(() => callback()).catch(callback);
    }
    destroy(id, callback = () => {}) {
        this.pool.execute('DELETE FROM sessions WHERE id = ?', [id]).then(() => callback()).catch(callback);
    }
}

export function createRepository(pool, secret) {
    return {
        async findAdmin(email) {
            const [[row]] = await pool.execute('SELECT id, email, password_hash FROM admin_users WHERE email = ? AND active = TRUE', [email]);
            return row;
        },
        async getAdmin(id) {
            const [[row]] = await pool.execute('SELECT id, email FROM admin_users WHERE id = ? AND active = TRUE', [id]);
            return row;
        },
        async recordLogin(id) { await pool.execute('UPDATE admin_users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?', [id]); },
        async consumeRateLimit(key, maximum, windowMs) {
            const bucket = createHmac('sha256', secret).update(key).digest('hex');
            const now = Date.now();
            const db = await pool.getConnection();
            try {
                await db.beginTransaction();
                await db.execute(`INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)
                    ON DUPLICATE KEY UPDATE hits = IF(expires_at <= ?, 1, hits + 1),
                    expires_at = IF(expires_at <= ?, VALUES(expires_at), expires_at)`, [bucket, now + windowMs, now, now]);
                const [[row]] = await db.execute('SELECT hits FROM rate_limits WHERE bucket = ? FOR UPDATE', [bucket]);
                await db.commit();
                return row.hits <= maximum;
            } catch (error) { await db.rollback(); throw error; }
            finally { db.release(); }
        }
    };
}
