import {mailPage} from './mail.js';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyPassword } from './passwords.js';
import { loginPage, dashboardPage, layout } from './views.js';
import { renderPublicServices, serviceListPage, serviceEditPage, validateService } from './services.js';
import { bookable, validateBooking, bookingFormPage, receivedPage, bookingTermsPage, bookingListPage, bookingDetailPage } from './bookings.js';
import { reviewPanel } from './booking-review.js';
import {settingsPage,calendarPage,calendarRange,validDay} from './scheduling.js';
import {adelaideLocal,parseAdelaide} from './booking-time.js';
import {customerPageNumber,validateCustomer,customerListPage,customerDetailPage,customerDeletePage} from './customers.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicPages = ['index.html', 'about.html', 'privacy.html', 'cad-3d-printing.html', 'website-development.html'];
const analyticsHashes = [...new Set(publicPages.flatMap(page =>
    [...readFileSync(`${root}${page}`, 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .filter(match => match[1].trim()).map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`)
))];
export function createApp({ config, repository, sessionStore, serviceRepository, bookingRepository, reviewRepository, schedulingRepository, customerRepository, mailer }) {
    if (!sessionStore) throw new Error('A persistent session store is required.');
    if (!serviceRepository) throw new Error('A service database repository is required.');
    if (!bookingRepository) throw new Error('A booking database repository is required.');
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
    const sendPublicPage = page => async (req, res) => {
        const html = readFileSync(`${root}${page}`, 'utf8');
        if (!html.includes('<!-- services:')) return res.sendFile(`${root}${page}`);
        const rows = await serviceRepository.list(true);
        // Do not serve stale hard-coded prices if the database is unavailable.
        res.set('Cache-Control', 'no-store').type('html').send(renderPublicServices(html, rows));
    };
    app.get('/', sendPublicPage('index.html'));
    for (const page of publicPages) app.get(`/${page}`, sendPublicPage(page));
    app.get('/booking-terms', (req,res)=>res.send(bookingTermsPage()));

    app.use(['/admin','/book'], helmet.contentSecurityPolicy({ directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        // Existing text-size controls set a style attribute; external stylesheet/script sources remain restricted.
        styleSrcAttr: ["'unsafe-inline'"], imgSrc: ["'self'"], connectSrc: ["'self'"],
        formAction: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"],
        baseUri: ["'none'"], upgradeInsecureRequests: config.production ? [] : null
    } }));
    app.use(['/admin','/book'], (req, res, next) => {
        res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow');
        if (config.production && !req.secure) return res.status(400).send('HTTPS is required.');
        next();
    });
    app.use('/book', async (req,res,next)=>{
        const allowed=await repository.consumeRateLimit(`booking-${req.method}:${req.ip}`,req.method==='POST'?10:100,15*60*1000);
        if(!allowed){res.set('Retry-After','900');return res.status(429).send(layout('Please try again later','<p>Too many requests. Please wait 15 minutes or contact us directly.</p>'));}
        next();
    });
    app.use(['/admin','/book'], express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 60 }));
    const cookieName = config.production ? '__Host-everbright.sid' : 'everbright.sid';
    app.use(['/admin','/book'], session({
        name: cookieName, secret: config.secret, store: sessionStore,
        resave: false, saveUninitialized: false,
        cookie: { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/', maxAge: 4 * 60 * 60 * 1000 }
    }));
    app.use(['/admin','/book'], (req, res, next) => {
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
    function requestKey(req){
        const key=randomBytes(32).toString('hex');
        req.session.bookingKeys=[...(req.session.bookingKeys||[]).slice(-4),key];
        return key;
    }
    const bookingPage=async(req,services,selected,key,values={},errors=[])=>{
        const showDetails=!schedulingRepository||req.method==='POST'||validDay(req.query.date);
        let html=bookingFormPage(services,selected,req.session.csrf,key,values,errors,new Date(),showDetails);
        if(schedulingRepository){
            const day=validDay(req.body?.preferred_date)?req.body.preferred_date:validDay(req.query.date)?req.query.date:adelaideLocal(new Date()).slice(0,10);
            const second=validDay(req.body?.alternative_date)?req.body.alternative_date:validDay(req.query.date2)?req.query.date2:'';
            const slots=selected&&showDetails?await schedulingRepository.slots(selected,day):[],secondSlots=selected&&showDetails&&second?await schedulingRepository.slots(selected,second):[];
            const options=(times,chosen)=>times.map(t=>`<option value="${t}"${t===chosen?' selected':''}>${t}</option>`).join('');
            // Replace the original preference inputs with server-generated available choices.
            html=html.replace('<button class="button button-secondary" type="submit">Choose Service</button>',`<p>Choose your service and dates, then show available times to continue.</p><label for="slot-date">Date to check</label><input id="slot-date" name="date" type="date" value="${day}" required>
                <label for="slot-date2">Second date to check (optional)</label><input id="slot-date2" name="date2" type="date" value="${second}"><button class="button button-secondary" type="submit">Show Available Times</button>`);
            html=html.replace(/<input id="booking-preferred_date"[^>]*>/,`<input id="booking-preferred_date" name="preferred_date" type="date" value="${day}" readonly>`)
                .replace(/<input id="booking-preferred_time"[^>]*>/,`<select id="booking-preferred_time" name="preferred_time" required><option value="">${slots.length?'Select an available time':'No available times — choose another date above'}</option>${options(slots,values.preferred_time)}</select>`)
                .replace(/<input id="booking-alternative_date"[^>]*>/,`<input id="booking-alternative_date" name="alternative_date" type="date" value="${second}" readonly>`)
                .replace(/<input id="booking-alternative_time"[^>]*>/,`<select id="booking-alternative_time" name="alternative_time"${second?' required':''}><option value="">${second?'Select a second available time':'Choose a second date above if needed'}</option>${options(secondSlots,values.alternative_time)}</select>`);
        }
        return html;
    };
    app.get('/book',async(req,res)=>{
        const services=await serviceRepository.list(true);
        const selected=services.find(s=>String(s.id)===req.query.service&&bookable(s));
        res.send(await bookingPage(req,services,selected,selected?requestKey(req):''));
    });
    app.post('/book',async(req,res)=>{
        const services=await serviceRepository.list(true);
        const selected=services.find(s=>String(s.id)===req.body.service_id);
        const key=req.body.submission_key;
        if(typeof key!=='string'||!req.session.bookingKeys?.includes(key))return res.status(403).send(layout('Request rejected','<p>Reload the booking form and try again.</p>'));
        const result=validateBooking(req.body,selected);
        if(result.errors.length)return res.status(422).send(await bookingPage(req,services,bookable(selected)?selected:null,key,req.body,result.errors));
        if(!await repository.consumeRateLimit(`booking-contact:${result.value.email}:${result.value.phone}`,5,60*60*1000)){
            res.set('Retry-After','3600');return res.status(429).send(await bookingPage(req,services,selected,key,req.body,['Too many booking requests. Please wait an hour or contact us directly.']));
        }
        try{
            await bookingRepository.submit(selected.id,result.value,key);
            req.session.bookingReceived=true;
            await new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
            res.redirect(303,'/book/received');
        }catch(error){
            if(error.status!==409)throw error;
            res.status(409).send(await bookingPage(req,services,selected,key,req.body,[error.message]));
        }
    });
    app.get('/book/received',(req,res)=>req.session.bookingReceived?res.send(receivedPage()):res.redirect(303,'/book'));
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
    app.get('/admin/emails',async(req,res)=>mailer?res.send(mailPage(mailer,await mailer.list(),req.session.csrf)):res.status(404).send('Email unavailable.'));
    app.post('/admin/emails/:id/release',async(req,res)=>{
        if(!mailer||!/^\d+$/.test(req.params.id))return res.sendStatus(404);
        await mailer.release(req.params.id);res.redirect(303,'/admin/emails');
    });
    app.get('/admin', async (req, res) => {
        const summary=bookingRepository.summary?await bookingRepository.summary():await bookingRepository.pendingCount();
        res.send(dashboardPage(req.admin,req.session.csrf,summary));
    });
    app.get('/admin/bookings',async(req,res)=>res.send(bookingListPage(await bookingRepository.list(),req.session.csrf)));
    app.get('/admin/calendar',async(req,res)=>{
        if(!schedulingRepository)return res.status(404).send('Calendar unavailable.');
        const range=calendarRange(req.query.date,req.query.view);
        res.send(calendarPage(range,await schedulingRepository.calendar(parseAdelaide(range.first,'00:00'),parseAdelaide(range.last,'00:00')),req.session.csrf));
    });
    app.get('/admin/settings',async(req,res)=>{
        if(!schedulingRepository)return res.status(404).send('Settings unavailable.');
        res.send(settingsPage(await schedulingRepository.settings(),req.session.csrf,[],req.query.saved==='1'));
    });
    const changeSettings=work=>async(req,res)=>{
        if(!schedulingRepository)return res.status(404).send('Settings unavailable.');
        try{await work(req);res.redirect(303,'/admin/settings?saved=1');}
        catch(error){if(![404,409,422].includes(error.status))throw error;res.status(error.status).send(settingsPage(await schedulingRepository.settings(),req.session.csrf,[error.message]));}
    };
    app.post('/admin/settings/hours',changeSettings(req=>schedulingRepository.saveHours(req.body)));
    app.post('/admin/settings/blocks',changeSettings(req=>schedulingRepository.addBlock(req.body)));
    app.post('/admin/settings/blocks/:id/remove',changeSettings(req=>schedulingRepository.removeBlock(req.params.id,req.body.version)));
    app.get('/admin/bookings/:id',async(req,res)=>{
        if(!/^[1-9]\d{0,18}$/.test(req.params.id))return res.status(404).send('Booking not found.');
        if(reviewRepository){
            const data=await reviewRepository.details(req.params.id);
            if(!data)return res.status(404).send('Booking not found.');
            return res.send(bookingDetailPage(data.row,req.session.csrf,reviewPanel(data.row,data.history,data.conflicts,req.session.csrf,[],req.query.saved==='1')));
        }
        const row=await bookingRepository.get(req.params.id);
        if(!row)return res.status(404).send('Booking not found.');
        res.send(bookingDetailPage(row,req.session.csrf));
    });
    app.post('/admin/bookings/:id/review',async(req,res)=>{
        if(!reviewRepository||!/^[1-9]\d{0,18}$/.test(req.params.id))return res.status(404).send('Booking not found.');
        try{
            await reviewRepository.act(req.params.id,req.body,req.admin.id);
            res.redirect(303,`/admin/bookings/${req.params.id}?saved=1`);
        }catch(error){
            if(![404,409,422].includes(error.status))throw error;
            const data=await reviewRepository.details(req.params.id);
            if(!data)return res.status(404).send('Booking not found.');
            res.status(error.status).send(bookingDetailPage(data.row,req.session.csrf,reviewPanel(data.row,data.history,data.conflicts,req.session.csrf,[error.message])));
        }
    });
    app.get('/admin/services', async (req, res) => res.send(serviceListPage(await serviceRepository.list(), req.session.csrf)));
    app.get('/admin/customers',async(req,res)=>{
        if(!customerRepository)return res.status(404).send('Customers unavailable.');
        const search=typeof req.query.q==='string'?req.query.q.trim():'';
        if(search.length>100)return res.status(422).send(customerListPage({rows:[],total:0,page:1,search:''},req.session.csrf,['Search must be at most 100 characters.']));
        res.send(customerListPage(await customerRepository.list(search,customerPageNumber(req.query.page)),req.session.csrf,[],req.query.deleted==='1'));
    });
    app.get('/admin/customers/:id/delete',async(req,res)=>{
        if(!customerRepository||!/^\d{1,19}$/.test(req.params.id))return res.sendStatus(404);
        const data=await customerRepository.detail(req.params.id);if(!data)return res.sendStatus(404);
        res.send(customerDeletePage(data,req.session.csrf));
    });
    app.post('/admin/customers/:id/delete',async(req,res)=>{
        if(!customerRepository||!/^\d{1,19}$/.test(req.params.id))return res.sendStatus(404);
        const data=await customerRepository.detail(req.params.id);if(!data)return res.sendStatus(404);
        if(req.body.confirm!=='1')return res.status(422).send(customerDeletePage(data,req.session.csrf,['Confirm deletion to continue.']));
        try{await customerRepository.remove(req.params.id,req.body.version);res.redirect(303,'/admin/customers?deleted=1');}
        catch(error){if(![404,409].includes(error.status))throw error;res.status(error.status).send(customerDeletePage(data,req.session.csrf,[error.message]));}
    });
    app.get('/admin/customers/:id',async(req,res)=>{
        if(!customerRepository||!/^[1-9]\d{0,18}$/.test(req.params.id))return res.status(404).send('Customer not found.');
        const data=await customerRepository.detail(req.params.id,customerPageNumber(req.query.page));
        if(!data)return res.status(404).send('Customer not found.');
        res.send(customerDetailPage(data,req.session.csrf,[],req.query.saved==='1'));
    });
    app.post('/admin/customers/:id',async(req,res)=>{
        if(!customerRepository||!/^[1-9]\d{0,18}$/.test(req.params.id))return res.status(404).send('Customer not found.');
        const data=await customerRepository.detail(req.params.id);
        if(!data)return res.status(404).send('Customer not found.');
        const result=validateCustomer(req.body);
        if(result.errors.length)return res.status(422).send(customerDetailPage(data,req.session.csrf,result.errors,false,result.value));
        try{await customerRepository.save(req.params.id,result.value);res.redirect(303,`/admin/customers/${req.params.id}?saved=1`);}
        catch(error){
            if(![404,409].includes(error.status))throw error;
            const latest=await customerRepository.detail(req.params.id);if(!latest)return res.status(404).send('Customer not found.');
            res.status(error.status).send(customerDetailPage(latest,req.session.csrf,[error.message]));
        }
    });
    app.get('/admin/services/new', (req, res) => res.send(serviceEditPage(null, [], req.session.csrf)));
    app.get('/admin/services/:id', async (req, res) => {
        if (!/^[1-9]\d{0,18}$/.test(req.params.id)) return res.status(404).send('Service not found.');
        const row = await serviceRepository.get(req.params.id);
        if (!row) return res.status(404).send('Service not found.');
        res.send(serviceEditPage(row, await serviceRepository.history(row.id), req.session.csrf, [], req.query.saved === '1'));
    });
    app.post('/admin/services/:id', async (req, res) => {
        const isNew = req.params.id === 'new';
        if (!isNew && !/^[1-9]\d{0,18}$/.test(req.params.id)) return res.status(404).send('Service not found.');
        const result = validateService(req.body);
        const current = isNew ? null : await serviceRepository.get(req.params.id);
        if (!isNew && !current) return res.status(404).send('Service not found.');
        const history = current ? await serviceRepository.history(current.id) : [];
        if (result.errors.length) return res.status(422).send(serviceEditPage({ ...current, ...result.value }, history, req.session.csrf, result.errors));
        try {
            const id = await serviceRepository.save(isNew ? null : req.params.id, result.value, req.admin.id);
            res.redirect(303, `/admin/services/${id}?saved=1`);
        } catch (error) {
            if (![404,409].includes(error.status)) throw error;
            res.status(error.status).send(serviceEditPage({ ...current, ...result.value }, history, req.session.csrf, [error.message]));
        }
    });
    app.use((req, res) => res.status(404).send('Page not found.'));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        // Never log submitted credentials, session data, SQL parameters or database errors.
        console.error('Request failed', { code: error.type === 'entity.too.large' ? 'BODY_LIMIT' : 'INTERNAL_ERROR' });
        res.status(error.code === 'AUTH_BUSY' ? 503 : error.type === 'entity.too.large' ? 413 : 500).send('Unable to process this request. Please try again.');
    });
    return app;
}
