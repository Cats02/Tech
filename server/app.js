import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyPassword } from './passwords.js';
import { loginPage, dashboardPage, layout } from './views.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicPages = ['index.html', 'about.html', 'privacy.html', 'cad-3d-printing.html', 'website-development.html'];
const analyticsHashes = [...new Set(publicPages.flatMap(page =>
    [...readFileSync(`${root}${page}`, 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .filter(match => match[1].trim()).map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`)
))];
export function createApp({ config, repository, sessionStore }) {
    if (!sessionStore) throw new Error('A persistent session store is required.');
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.proxyHops || false);
    app.use(helmet({
        // Preserve same-origin form metadata. no-referrer can make browsers send
        // Origin: null on form POSTs, which our CSRF origin check correctly rejects.
        referrerPolicy: { policy: 'same-origin' },
        contentSecurityPolicy: { directives: {
            defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://www.googletagmanager.com', ...analyticsHashes],
            styleSrc: ["'self'"], styleSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https://*.google-analytics.com', 'https://*.googletagmanager.com'],
            connectSrc: ["'self'", 'https://formspree.io', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'],
            formAction: ["'self'", 'https://formspree.io'], objectSrc: ["'none'"], frameAncestors: ["'none'"],
            upgradeInsecureRequests: config.production ? [] : null
        } },
        strictTransportSecurity: config.production ? undefined : false
    }));
    app.get('/health', (req, res) => res.json({ status: 'ok' }));
    app.use('/assets', express.static(`${root}assets`, { dotfiles: 'deny', index: false }));
    for (const asset of ['style.css', 'script.js', 'admin.css']) app.get(`/${asset}`, (req, res) => res.sendFile(`${root}${asset}`));
    app.get('/', (req, res) => res.sendFile(`${root}index.html`));
    for (const page of publicPages) app.get(`/${page}`, (req, res) => res.sendFile(`${root}${page}`));

    app.use('/admin', helmet.contentSecurityPolicy({ directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        // Existing text-size controls set a style attribute; external stylesheet/script sources remain restricted.
        styleSrcAttr: ["'unsafe-inline'"], imgSrc: ["'self'"], connectSrc: ["'self'"],
        formAction: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"],
        baseUri: ["'none'"], upgradeInsecureRequests: config.production ? [] : null
    } }));
    app.use('/admin', (req, res, next) => {
        res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow');
        if (config.production && !req.secure) return res.status(400).send('HTTPS is required.');
        next();
    });
    app.use('/admin', express.urlencoded({ extended: false, limit: '12kb', parameterLimit: 10 }));
    const cookieName = config.production ? '__Host-everbright.sid' : 'everbright.sid';
    app.use('/admin', session({
        name: cookieName, secret: config.secret, store: sessionStore,
        resave: false, saveUninitialized: false,
        cookie: { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/', maxAge: 4 * 60 * 60 * 1000 }
    }));
    app.use('/admin', (req, res, next) => {
        req.session.csrf ||= randomBytes(32).toString('hex');
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        const token = req.body?._csrf;
        const origin = req.get('origin');
        if ((origin && origin !== config.origin) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))) {
            return res.status(403).send(layout('Request rejected', '<p>Reload the form and try again.</p>'));
        }
        next();
    });
    app.get('/admin/login', (req, res) => res.send(loginPage(req.session.csrf)));
    app.post('/admin/login', async (req, res) => {
        const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = req.body.password;
        const ipAllowed = await repository.consumeRateLimit(`login-ip:${req.ip}`, 20, 15 * 60 * 1000);
        const accountAllowed = await repository.consumeRateLimit(`login-account:${email.slice(0, 254)}`, 10, 15 * 60 * 1000);
        if (!ipAllowed || !accountAllowed) {
            res.set('Retry-After', '900');
            return res.status(429).send(loginPage(req.session.csrf, 'Too many login attempts. Try again in 15 minutes.'));
        }
        const validInput = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 && typeof password === 'string' && password.length <= 128;
        const admin = validInput ? await repository.findAdmin(email) : null;
        const validPassword = await verifyPassword(typeof password === 'string' ? password.slice(0, 128) : '', admin?.password_hash);
        if (!validInput || !admin || !validPassword) return res.status(401).send(loginPage(req.session.csrf, 'Email or password is incorrect.'));
        await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
        req.session.adminId = admin.id;
        req.session.csrf = randomBytes(32).toString('hex');
        await repository.recordLogin(admin.id);
        await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        res.redirect(303, '/admin');
    });
    // Every route added under /admin after this middleware requires an active administrator.
    app.use('/admin', async (req, res, next) => {
        const admin = req.session.adminId ? await repository.getAdmin(req.session.adminId) : null;
        if (!admin) return res.redirect(303, '/admin/login');
        req.admin = admin; next();
    });
    app.post('/admin/logout', async (req, res) => {
        await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
        res.clearCookie(cookieName, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.production });
        res.redirect(303, '/admin/login');
    });
    app.get('/admin', (req, res) => res.send(dashboardPage(req.admin, req.session.csrf)));
    app.use((req, res) => res.status(404).send('Page not found.'));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        // Never log submitted credentials, session data, SQL parameters or database errors.
        console.error('Request failed', { code: error.type === 'entity.too.large' ? 'BODY_LIMIT' : 'INTERNAL_ERROR' });
        res.status(error.code === 'AUTH_BUSY' ? 503 : error.type === 'entity.too.large' ? 413 : 500).send('Unable to process this request. Please try again.');
    });
    return app;
}
