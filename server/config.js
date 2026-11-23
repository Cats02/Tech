export function loadConfig(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const origin = new URL(env.APP_ORIGIN || 'http://localhost:3000');
    if (origin.origin !== env.APP_ORIGIN || (production && origin.protocol !== 'https:')) {
        throw new Error('APP_ORIGIN must be an exact origin; production requires HTTPS.');
    }
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 48 || env.SESSION_SECRET.startsWith('REPLACE_')) {
        throw new Error('Set a randomly generated SESSION_SECRET of at least 48 characters.');
    }
    for (const key of ['DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
        if (!env[key] || env[key].startsWith('YOUR_')) throw new Error(`Configure ${key}.`);
    }
    const proxyHops = Number(env.TRUST_PROXY_HOPS || 0);
    if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error('Invalid proxy hop count.');
    return { production, origin: origin.origin, secret: env.SESSION_SECRET,
        proxyHops, port: Number(env.PORT || 3000) };
}
