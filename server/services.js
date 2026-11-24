import { randomBytes } from 'node:crypto';
import { escape, layout } from './views.js';

export const appointmentTypes = ['Remote', 'On-site', 'Drop-off', 'Consultation'];
const types = ['fixed', 'from', 'hour', 'quote'];
export function validateService(body) {
    const errors = [];
    function field(key, maximum, required = false) {
        const value = typeof body[key] === 'string' ? body[key].trim() : '';
        if ((required && !value) || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) errors.push(`Check ${key.replaceAll('_', ' ')}.`);
        return value;
    }
    const name = field('name', 160, true);
    const short_description = field('short_description', 1000);
    const full_description = field('full_description', 3000);
    const home_note = field('home_note', 1000);
    const price_type = types.includes(body.price_type) ? body.price_type : null;
    if (!price_type) errors.push('Choose a valid price type.');
    const billing_unit = price_type === 'hour' ? 'hour' : body.billing_unit;
    if (!['item', 'hour'].includes(billing_unit)) errors.push('Choose a valid billing unit.');
    const amount = field('amount', 12);
    let amount_cents = null;
    if (price_type !== 'quote') {
        if (!/^\d{1,6}(\.\d{1,2})?$/.test(amount)) errors.push('Enter a price from 0 to 999999.99 with at most two decimal places.');
        else {
            const [whole, fraction = ''] = amount.split('.');
            amount_cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
        }
    }
    const duration = field('duration_minutes', 4, true);
    if (!/^\d+$/.test(duration) || Number(duration) < 15 || Number(duration) > 1440) errors.push('Duration must be between 15 and 1440 minutes.');
    const category = ['support', 'web', 'cad'].includes(body.category) ? body.category : null;
    if (!category) errors.push('Choose a valid public category.');
    const chosen = body.appointment_types === undefined ? [] : Array.isArray(body.appointment_types) ? body.appointment_types : [body.appointment_types];
    if (chosen.some(value => !appointmentTypes.includes(value))) errors.push('Choose valid appointment types.');
    const selected = [...new Set(chosen)].filter(value => appointmentTypes.includes(value));
    const online_booking = body.online_booking === '1';
    if (online_booking && !selected.length) errors.push('Online booking requires at least one appointment type.');
    const sort = field('sort_order', 5, true);
    if (!/^\d+$/.test(sort) || Number(sort) > 65535) errors.push('Display order must be between 0 and 65535.');
    if (!/^\d{1,10}$/.test(String(body.version || ''))) errors.push('Reload the editor before saving.');
    return { errors, value: { name, short_description, full_description, home_note, price_type, billing_unit,
        amount_cents, duration_minutes: Number(duration), category, appointment_types: selected.join(','), online_booking,
        visible: body.visible === '1', show_home: body.show_home === '1', sort_order: Number(sort), version: Number(body.version) } };
}

export function formatPrice(service, compact = false) {
    if (service.price_type === 'quote') return 'Request a Quote';
    const cents = Number(service.amount_cents);
    const amount = Math.floor(cents / 100).toLocaleString('en-AU') + (cents % 100 ? '.' + String(cents % 100).padStart(2, '0') : '');
    return `${service.price_type === 'from' ? 'From ' : ''}$${amount}${service.price_type === 'hour' || service.billing_unit === 'hour' ? (compact ? '/hour' : ' per hour') : ''}`;
}

export function createServiceRepository(pool) {
    return {
        async list(publicOnly = false) {
            const [rows] = await pool.query(`SELECT * FROM services ${publicOnly ? 'WHERE visible = TRUE' : ''} ORDER BY sort_order, id`);
            return rows;
        },
        async get(id) { const [[row]] = await pool.execute('SELECT * FROM services WHERE id = ?', [id]); return row; },
        async history(id) {
            const [rows] = await pool.execute(`SELECT h.*, a.email AS admin_email FROM price_history h
                JOIN admin_users a ON a.id = h.admin_id WHERE h.service_id = ? ORDER BY h.changed_at DESC, h.id DESC LIMIT 100`, [id]);
            return rows;
        },
        async save(id, value, adminId) {
            const db = await pool.getConnection();
            try {
                await db.beginTransaction();
                let existing;
                if (id) {
                    [[existing]] = await db.execute('SELECT * FROM services WHERE id = ? FOR UPDATE', [id]);
                    if (!existing) throw Object.assign(new Error('Service not found.'), { status: 404 });
                    if (Number(existing.version) !== value.version) throw Object.assign(new Error('This service was changed in another tab. Reload it before saving.'), { status: 409 });
                }
                const data = { ...value, home_label: existing && existing.name === value.name ? existing.home_label : value.name };
                delete data.version;
                const columns = Object.keys(data);
                const values = Object.values(data);
                if (id) {
                    await db.execute(`UPDATE services SET ${columns.map(key => `\`${key}\` = ?`).join(', ')}, version = version + 1 WHERE id = ?`, [...values, id]);
                    if (Number(existing.amount_cents) !== Number(value.amount_cents) || (existing.amount_cents === null) !== (value.amount_cents === null) || existing.price_type !== value.price_type || existing.billing_unit !== value.billing_unit) {
                        await db.execute(`INSERT INTO price_history (service_id, admin_id, old_amount_cents, new_amount_cents,
                            old_price_type, new_price_type, old_billing_unit, new_billing_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [id, adminId, existing.amount_cents, value.amount_cents, existing.price_type, value.price_type, existing.billing_unit, value.billing_unit]);
                    }
                } else {
                    const slug = `service-${randomBytes(12).toString('hex')}`;
                    const [result] = await db.execute(`INSERT INTO services (${columns.map(key => `\`${key}\``).join(', ')}, slug) VALUES (${columns.map(() => '?').join(', ')}, ?)`, [...values, slug]);
                    id = result.insertId;
                }
                await db.commit(); return id;
            } catch (error) { await db.rollback(); throw error; }
            finally { db.release(); }
        }
    };
}

export function adminNav(csrf) {
    return `<nav class="admin-nav" aria-label="Admin navigation"><a href="/admin">Dashboard</a><a href="/admin/services">Services &amp; Pricing</a>
        <form action="/admin/logout" method="post"><input type="hidden" name="_csrf" value="${escape(csrf)}"><button type="submit">Log Out</button></form></nav>`;
}
export function serviceListPage(rows, csrf) {
    return layout('Services & Pricing', `${adminNav(csrf)}<p class="admin-notice">Prices are in AUD. Online booking requests will be added in Phase 3.</p>
        <p><a class="button button-primary" href="/admin/services/new">Add Service</a></p>
        <div class="admin-service-list">${rows.map(row => `<article class="admin-card"><h2><a href="/admin/services/${row.id}">${escape(row.name)}</a></h2>
        <p>${escape(formatPrice(row))} · ${row.duration_minutes} minutes</p><p>${row.visible ? 'Visible' : 'Hidden'} · ${row.online_booking ? 'Booking enabled' : 'Booking disabled'}</p>
        <a href="/admin/services/${row.id}">Edit service and view price history</a></article>`).join('')}</div>`);
}
export function serviceEditPage(service, history, csrf, errors = [], saved = false) {
    const row = service || { name: '', short_description: '', full_description: '', home_note: '', price_type: 'from', billing_unit: 'item',
        amount_cents: null, duration_minutes: 60, category: 'support', appointment_types: '', online_booking: false, visible: true, show_home: true, sort_order: 100, version: 0 };
    const input = (key, label, attributes = '') => `<label for="service-${key}">${label}</label><input id="service-${key}" name="${key}" value="${escape(row[key] ?? '')}" ${attributes}>`;
    const area = (key, label, max) => `<label for="service-${key}">${label}</label><textarea id="service-${key}" name="${key}" rows="3" maxlength="${max}">${escape(row[key] || '')}</textarea>`;
    const select = (key, label, options) => `<label for="service-${key}">${label}</label><select id="service-${key}" name="${key}">${options.map(([value,label]) => `<option value="${value}"${row[key] === value ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
    const check = (key, label) => `<label class="admin-checkbox"><input type="checkbox" name="${key}" value="1"${row[key] ? ' checked' : ''}> ${label}</label>`;
    const historyRows = history.map(item => {
        const before = formatPrice({amount_cents:item.old_amount_cents,price_type:item.old_price_type,billing_unit:item.old_billing_unit});
        const after = formatPrice({amount_cents:item.new_amount_cents,price_type:item.new_price_type,billing_unit:item.new_billing_unit});
        const time = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.changed_at));
        return `<li>${escape(before)} → ${escape(after)} — ${escape(time)} (Adelaide), ${escape(item.admin_email)}</li>`;
    }).join('');
    return layout(service?.id ? 'Edit Service' : 'Add Service', `${adminNav(csrf)}
        ${saved ? '<p role="status" class="admin-notice">Service saved. Public pricing is updated.</p>' : ''}
        ${errors.length ? `<div role="alert" class="admin-notice"><h2>Please check the form</h2><ul>${errors.map(e=>`<li>${escape(e)}</li>`).join('')}</ul></div>` : ''}
        <form class="admin-card" method="post" action="/admin/services/${service?.id || 'new'}">
        <input type="hidden" name="_csrf" value="${escape(csrf)}"><input type="hidden" name="version" value="${row.version}">
        ${input('name','Service name','required maxlength="160"')}
        ${area('short_description','Short description',1000)}${area('full_description','Full description (plain text, optional)',3000)}
        ${area('home_note','Homepage pricing note (optional)',1000)}
        ${select('category','Public category',[['support','IT Support'],['web','Website Development'],['cad','CAD &amp; 3D Printing']])}
        ${select('price_type','Price type',[['fixed','Fixed price'],['from','From'],['hour','Per hour'],['quote','Request a Quote']])}
        <label for="service-amount">Price (AUD)</label><input id="service-amount" name="amount" inputmode="decimal" type="number" min="0" max="999999.99" step="0.01" value="${row.amount_cents === null ? '' : (row.amount_cents / 100).toFixed(2)}" aria-describedby="service-price-note">
        <p id="service-price-note">Not required for Request a Quote. Use the hourly unit with From for “From $70 per hour”.</p>
        ${select('billing_unit','Billing unit',[['item','Per service'],['hour','Per hour']])}
        ${input('duration_minutes','Booking duration (minutes)','type="number" min="15" max="1440" required')}
        <fieldset><legend>Available appointment types</legend>${appointmentTypes.map(type=>`<label class="admin-checkbox"><input type="checkbox" name="appointment_types" value="${type}"${(row.appointment_types || '').split(',').includes(type) ? ' checked' : ''}> ${type}</label>`).join('')}</fieldset>
        ${check('online_booking','Online booking available')}${check('visible','Visible in public pricing')}${check('show_home','Show in homepage pricing')}
        ${input('sort_order','Display order','type="number" min="0" max="65535" required')}
        <button type="submit" class="button button-primary">Save Service</button></form>
        <section class="admin-history" aria-labelledby="price-history-title"><h2 id="price-history-title">Price History</h2>
        ${history.length ? `<ul>${historyRows}</ul>` : '<p>No price changes recorded.</p>'}</section>`);
}

export function renderPublicServices(html, rows) {
    for (const category of ['home','web','cad']) {
        const pattern = new RegExp(`<!-- services:${category}:start -->[\\s\\S]*?<!-- services:${category}:end -->`);
        if (!pattern.test(html)) continue;
        const selected = rows.filter(row => row.visible && (category === 'home' ? row.show_home : row.category === category));
        const rendered = selected.map(row => category === 'home'
            ? `<div class="price-row"><span>${escape(row.home_label || row.name)}</span><strong>${escape(formatPrice(row))}</strong>${row.category === 'support' && row.short_description ? `<small>${escape(row.short_description)}</small>` : ''}${row.category === 'support' && row.full_description ? `<small class="service-full-description">${escape(row.full_description)}</small>` : ''}${row.home_note ? `<small>${escape(row.home_note)}</small>` : ''}</div>`
            : `<article class="cad-price-card"><div class="service-icon" aria-hidden="true">${escape(row.icon || '◇')}</div><h3>${escape(row.name)}</h3><strong>${escape(formatPrice(row, category === 'cad'))}</strong><p>${escape(row.short_description)}</p>${row.full_description ? `<p class="service-full-description">${escape(row.full_description)}</p>` : ''}</article>`
        ).join('\n');
        html = html.replace(pattern, () => rendered || '<p>Contact us for current services and pricing.</p>');
    }
    return html;
}
