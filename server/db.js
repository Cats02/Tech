import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

export function createPool(env = process.env) {
    const pool = mysql.createPool({
        host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
        user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
        connectionLimit: 5, timezone: 'Z', charset: 'utf8mb4',
        multipleStatements: false,
        ssl: env.DB_SSL === 'true' ? {
            rejectUnauthorized: true,
            ...(env.DB_SSL_CA_FILE ? { ca: readFileSync(env.DB_SSL_CA_FILE, 'utf8') } : {})
        } : undefined
    });
    // DATETIME defaults and audit timestamps must use the same UTC clock as
    // parameters encoded by mysql2's timezone: 'Z' setting.
    pool.on('connection', connection => {
        connection.query("SET time_zone = '+00:00'", error => { if (error) connection.destroy(); });
    });
    return pool;
}
