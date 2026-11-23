import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
let running = 0;
const waiting = [];
async function deriveBounded(password, salt) {
    if (running >= 2) {
        if (waiting.length >= 8) throw Object.assign(new Error('Authentication busy'), { code: 'AUTH_BUSY' });
        await new Promise(resolve => waiting.push(resolve));
    } else running++;
    try { return await derive(password, salt, 64, options); }
    finally {
        if (waiting.length) waiting.shift()();
        else running--;
    }
}

export async function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 15 || password.length > 128) {
        throw new Error('Use a password between 15 and 128 characters.');
    }
    const salt = randomBytes(32).toString('hex');
    const key = await deriveBounded(password, salt);
    return `scrypt$${salt}$${key.toString('hex')}`;
}
// A real derivation is performed for unknown users as well.
const dummy = `scrypt$${'0'.repeat(64)}$${'0'.repeat(128)}`;
export async function verifyPassword(password, encoded = dummy) {
    if (typeof password !== 'string' || password.length > 128) return false;
    const [scheme, salt, hex] = encoded.split('$');
    if (scheme !== 'scrypt' || !/^[a-f0-9]{64}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) return false;
    const key = await deriveBounded(password, salt);
    return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
