import { escape, layout } from './views.js';
import { adminNav, formatPrice, appointmentTypes } from './services.js';
import { parseAdelaide, adelaideLocal, displayBookingTime } from './booking-time.js';
import {assertAvailable} from './scheduling.js';

export const TERMS_VERSION='booking-request-2026-11-v1';
export const bookingNotice='Your appointment is not confirmed until it has been reviewed and approved by Everbright Digital.';
export const bookingReceived='Booking request received. Your requested appointment has been sent to Everbright Digital for approval. Your appointment is not confirmed until you receive confirmation.';
export const bookable = service => Boolean(service?.visible && service?.online_booking && service?.appointment_types?.split(',').some(t=>appointmentTypes.includes(t)));
export function validateBooking(body, service, now=new Date()) {
    const errors=[];
    const field=(key,max,required=false)=>{
        const v=typeof body[key]==='string'?body[key].trim():'';
        if((required&&!v)||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))errors.push(`Check ${key.replaceAll('_',' ')}.`);
        return v;
    };
    const name=field('name',160,true),email=field('email',254,true).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))errors.push('Enter a valid email address.');
    const enteredPhone=field('phone',40,true);
    let phone=enteredPhone.replace(/[\s()+.-]/g,'');
    if(/^04\d{8}$/.test(phone))phone='61'+phone.slice(1);
    if(!/^\d{8,15}$/.test(phone))errors.push('Enter a valid mobile number, including country code for overseas numbers.');
    const appointment_type=field('appointment_type',20,true);
    if(!bookable(service))errors.push('This service is not currently available for online booking requests.');
    if(!appointmentTypes.includes(appointment_type)||!service?.appointment_types?.split(',').includes(appointment_type))errors.push('Choose an appointment type offered for this service.');
    const address=field('address',500,appointment_type==='On-site');
    const description=field('description',5000,true);
    const preferred_date=field('preferred_date',10,true),preferred_time=field('preferred_time',5,true);
    const alternative_date=field('alternative_date',10),alternative_time=field('alternative_time',5);
    const preferred_start=parseAdelaide(preferred_date,preferred_time);
    const alternative_start=alternative_date||alternative_time?parseAdelaide(alternative_date,alternative_time):null;
    const validFuture=d=>d&&d>now&&d.getTime()<=now.getTime()+366*86400000;
    if(!validFuture(preferred_start))errors.push('Choose a valid future preferred date/time within the next year. Times use Adelaide time; daylight-saving gaps or repeated times are not accepted.');
    if((alternative_date||alternative_time)&&!validFuture(alternative_start))errors.push('Enter both a valid second date and time within the next year, or leave both blank.');
    if(preferred_start&&alternative_start&&preferred_start.getTime()===alternative_start.getTime())errors.push('Choose a different time for the second preference.');
    if(body.terms!=='1')errors.push('Agree to the booking and privacy terms to send your request.');
    if(field('website',300))errors.push('Unable to accept this request. Please contact us directly.');
    return {errors,value:{name,email,phone,address,description,appointment_type,preferred_start,alternative_start}};
}

export function createBookingRepository(pool,{enforceAvailability=true,queueEmail=null}={}) {
    return {
        async submit(serviceId,value,key) {
            const db=await pool.getConnection();
            try {
                await db.beginTransaction();
                if(enforceAvailability){const [[lock]]=await db.query('SELECT id FROM calendar_lock WHERE id=1 FOR UPDATE');if(!lock)throw new Error('Calendar lock missing');}
                // Serialise service edits with request creation so the snapshot and allowed types are current.
                const [[service]]=await db.execute('SELECT * FROM services WHERE id = ? FOR UPDATE',[serviceId]);
                const [[existing]]=await db.execute('SELECT id FROM bookings WHERE submission_key = ?',[key]);
                if(existing){await db.commit();return existing.id;}
                const recheck=validateBooking({...value,preferred_date:adelaideLocal(value.preferred_start).slice(0,10),preferred_time:adelaideLocal(value.preferred_start).slice(11),
                    alternative_date:value.alternative_start?adelaideLocal(value.alternative_start).slice(0,10):'',alternative_time:value.alternative_start?adelaideLocal(value.alternative_start).slice(11):'',terms:'1'},service);
                if(recheck.errors.length)throw Object.assign(new Error('The service or request details have changed. Review the form and try again.'),{status:409});
                if(enforceAvailability){
                    for(const start of [value.preferred_start,value.alternative_start].filter(Boolean))await assertAvailable(db,start,new Date(start.getTime()+Number(service.duration_minutes)*60000),{grid:true});
                }
                await db.execute(`INSERT INTO customers (name,email,phone,address,notes) VALUES (?,?,?,?, '')
                    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,[value.name,value.email,value.phone,value.address]);
                const [[customer]]=await db.execute('SELECT id FROM customers WHERE email = ? AND phone = ?',[value.email,value.phone]);
                const [result]=await db.execute(`INSERT INTO bookings (submission_key,customer_id,service_id,status,customer_name,customer_email,customer_phone,
                    service_name,amount_cents,price_type,billing_unit,duration_minutes,appointment_type,address,preferred_start,alternative_start,description,terms_version)
                    VALUES (?,?,?,'PENDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[key,customer.id,service.id,value.name,value.email,value.phone,
                    service.name,service.amount_cents,service.price_type,service.billing_unit,service.duration_minutes,value.appointment_type,value.address,
                    value.preferred_start,value.alternative_start,value.description,TERMS_VERSION]);
                if(queueEmail)await queueEmail(db,{id:result.insertId,key:`booking:${result.insertId}:received`,type:'received',version:0,email:value.email,name:value.name,service:service.name});
                await db.commit();return result.insertId;
            }catch(error){await db.rollback();throw error;}finally{db.release();}
        },
        async list() {const [rows]=await pool.query('SELECT id,status,customer_name,service_name,preferred_start,confirmed_start,created_at FROM bookings ORDER BY created_at DESC LIMIT 200');return rows;},
        async get(id) {const [[row]]=await pool.execute('SELECT * FROM bookings WHERE id = ?',[id]);return row;},
        async pendingCount() {const [[row]]=await pool.query("SELECT COUNT(*) AS total FROM bookings WHERE status = 'PENDING'");return Number(row.total);},
        async summary() {
            const now=new Date(),date=adelaideLocal(now).slice(0,10);
            const nextDate=new Date(`${date}T00:00:00Z`);nextDate.setUTCDate(nextDate.getUTCDate()+1);
            const today=parseAdelaide(date,'00:00'),tomorrow=parseAdelaide(nextDate.toISOString().slice(0,10),'00:00');
            const [[row]]=await pool.execute(`SELECT
                SUM(status='PENDING') AS pending,
                SUM(status='CONFIRMED' AND confirmed_start>=?) AS upcoming,
                SUM(status='CONFIRMED' AND confirmed_start>=? AND confirmed_start<?) AS today,
                SUM(status='COMPLETED' AND updated_at>=?) AS completed
                FROM bookings`,[now,today,tomorrow,new Date(now.getTime()-7*86400000)]);
            return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Number(value||0)]));
        }
    };
}

function bookingLayout(title,content) {
    return layout(title,`<nav class="admin-nav" aria-label="Booking navigation"><a href="/">Home</a><a href="/book">Book an Appointment</a><a href="/privacy.html">Privacy Policy</a></nav>${content}`);
}
export function bookingFormPage(services,selected,csrf,key,values={},errors=[],now=new Date(),showDetails=true) {
    const text=(name)=>typeof values[name]==='string'?escape(values[name]):'';
    const input=(name,label,attributes='')=>`<label for="booking-${name}">${label}</label><input id="booking-${name}" name="${name}" value="${text(name)}" ${attributes}>`;
    const available=services.filter(bookable);
    const choose=`<form class="admin-card booking-service-choice" action="/book" method="get"><label for="booking-service">Service required</label>
        <select id="booking-service" name="service" required><option value="">Select a service</option>${available.map(s=>`<option value="${s.id}"${String(s.id)===String(selected?.id)?' selected':''}>${escape(s.name)}</option>`).join('')}</select>
        <button class="button button-secondary" type="submit">Choose Service</button></form>`;
    const form=selected&&showDetails?`<form class="admin-card booking-form" action="/book" method="post">
        <input type="hidden" name="_csrf" value="${escape(csrf)}"><input type="hidden" name="submission_key" value="${escape(key)}"><input type="hidden" name="service_id" value="${selected.id}">
        <h2>${escape(selected.name)}</h2><p>Guide price: ${escape(formatPrice(selected))}. Final scope and charges will be agreed before work begins.</p>
        ${input('name','Full name','autocomplete="name" maxlength="160" required')}
        ${input('phone','Mobile number','type="tel" autocomplete="tel" maxlength="40" required')}
        ${input('email','Email address','type="email" autocomplete="email" maxlength="254" required')}
        <label for="booking-type">Appointment type</label><select id="booking-type" name="appointment_type" required><option value="">Select a type</option>${selected.appointment_types.split(',').filter(t=>appointmentTypes.includes(t)).map(t=>`<option value="${t}"${values.appointment_type===t?' selected':''}>${t}</option>`).join('')}</select>
        ${input('address','Service address and suburb (required for on-site visits)','autocomplete="street-address" maxlength="500" aria-describedby="booking-address-note"')}
        <p id="booking-address-note">For on-site requests, include the street address and suburb. Otherwise this field is optional.</p>
        <fieldset><legend>Preferred appointment — Adelaide time</legend>
        ${input('preferred_date','Preferred date',`type="date" min="${adelaideLocal(now).slice(0,10)}" required`)}${input('preferred_time','Preferred time','type="time" required')}</fieldset>
        <fieldset><legend>Second preference (optional) — Adelaide time</legend>
        ${input('alternative_date','Second preferred date',`type="date" min="${adelaideLocal(now).slice(0,10)}"`)}${input('alternative_time','Second preferred time','type="time"')}</fieldset>
        <label for="booking-description">Describe the problem or work required</label><textarea id="booking-description" name="description" rows="5" maxlength="5000" required>${text('description')}</textarea>
        <p>Please do not include passwords, payment details or sensitive information.</p>
        <div class="booking-trap" aria-hidden="true"><label for="booking-website">Leave this field blank</label><input id="booking-website" name="website" tabindex="-1" autocomplete="off"></div>
        <label class="admin-checkbox"><input type="checkbox" name="terms" value="1" required${values.terms==='1'?' checked':''}><span>I agree to the <a href="/booking-terms" target="_blank" rel="noopener">booking terms (opens a new tab)</a> and acknowledge the <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy (opens a new tab)</a>.</span></label>
        <p class="admin-notice">${bookingNotice}</p><button type="submit" class="button button-primary">Send Booking Request</button></form>`:'';
    return bookingLayout('Book an Appointment',`<p class="admin-notice">${bookingNotice} Dates and times are preferences, not reserved availability. All times are Adelaide time.</p>
        ${errors.length?`<div role="alert" class="admin-notice"><h2>Please check your request</h2><ul>${errors.map(e=>`<li>${escape(e)}</li>`).join('')}</ul></div>`:''}
        ${available.length?(showDetails&&selected?`<p><a href="/book?service=${Number(selected.id)}">Change service or dates</a></p>`:choose):'<p>Online booking requests are not currently available. <a href="/#contact">Contact us to arrange an appointment.</a></p>'}${form}`);
}
export const receivedPage=()=>bookingLayout('Booking Request Received',`<p role="status" class="admin-notice">${bookingReceived}</p><p>Your request has been saved. This page does not confirm an appointment. Email notifications are handled separately. Contact us directly if you do not receive an update.</p><a href="/">Return home</a>`);
export const bookingTermsPage=()=>bookingLayout('Booking Request Terms',`<div class="admin-card"><p>Version: ${TERMS_VERSION}</p><p>${bookingNotice}</p>
    <p>Your requested times are preferences. Everbright Digital will review the service, appointment type, location and availability before agreeing an appointment with you.</p>
    <p>Displayed prices are guides. Scope, applicable travel, materials and final charges will be agreed before work begins. Sending a request does not authorise payment.</p>
    <p>Please provide accurate contact details. Contact Everbright Digital using the details on our website if you need to change or withdraw a request.</p>
    <p>We store your contact details and request in our business database to review, arrange and retain a history of services. Read our <a href="/privacy.html">Privacy Policy</a>. Do not submit passwords, payment information or sensitive device data.</p></div>`);
export function bookingListPage(rows,csrf) {
    return layout('Bookings',`${adminNav(csrf)}<p>Open a request to review it and record your decision. Contact the customer after deciding.</p><div class="admin-service-list">${rows.map(r=>`<article class="admin-card"><h2><a href="/admin/bookings/${r.id}">Request #${r.id}</a></h2><p><strong class="admin-status" data-status="${escape(r.status)}">Status: ${escape(r.status)}</strong></p><p>${escape(r.customer_name)} — ${escape(r.service_name)}</p><p>${r.confirmed_start?'Scheduled':'Preferred'}: ${escape(displayBookingTime(r.confirmed_start||r.preferred_start))}</p></article>`).join('')||'<p>No booking requests yet.</p>'}</div>`);
}
export function bookingDetailPage(row,csrf,review='') {
    const details=[['Status',row.status],['Customer',row.customer_name],['Email',row.customer_email],['Mobile',row.customer_phone],['Service',row.service_name],
        ['Price at request',formatPrice(row)],['Duration at request',`${row.duration_minutes} minutes`],['Appointment type',row.appointment_type],['Address',row.address||'Not supplied'],
        ['Preferred',displayBookingTime(row.preferred_start)],['Second preference',row.alternative_start?displayBookingTime(row.alternative_start):'Not supplied'],
        ['Terms accepted',`${row.terms_version} — ${displayBookingTime(row.terms_accepted_at)}`]];
    return layout(`Booking Request #${row.id}`,`${adminNav(csrf)}${row.customer_id?`<p><a href="/admin/customers/${Number(row.customer_id)}">View Customer Record</a></p>`:''}<div class="admin-card"><dl class="booking-details">${details.map(([k,v])=>`<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl><h2>Description</h2><p class="service-full-description">${escape(row.description)}</p></div>${review}`);
}
