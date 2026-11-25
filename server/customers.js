import {escape,layout,bookingReference} from './views.js';
import {adminNav,formatPrice} from './services.js';
import {displayBookingTime} from './booking-time.js';
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export function customerPageNumber(value){return typeof value==='string'&&/^[1-9]\d{0,4}$/.test(value)?Number(value):1;}
export function validateCustomer(body){
    const errors=[];
    const field=(name,max,required=false)=>{
        const v=typeof body[name]==='string'?body[name].trim():'';
        if((required&&!v)||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))errors.push(`Check ${name}.`);
        return v;
    };
    const name=field('name',160,true),email=field('email',254,true).toLowerCase();
    const entered=field('phone',40,true);
    let phone=entered.replace(/[\s()+.-]/g,'');if(/^04\d{8}$/.test(phone))phone='61'+phone.slice(1);
    if(!/^\d{8,15}$/.test(phone))errors.push('Enter a valid phone number, including a country code for overseas numbers.');
    if(!/^[^\s@<>"(),:;\\]+@[^\s@<>"(),:;\\]+\.[^\s@<>"(),:;\\]+$/.test(email))errors.push('Enter a valid email address.');
    const address=field('address',500),notes=field('notes',5000);
    if(typeof body.version!=='string'||!/^\d{1,10}$/.test(body.version))errors.push('Reload the customer profile before saving.');
    return {errors,value:{name,email,phone,address,notes,version:Number(body.version)}};
}
export function createCustomerRepository(pool){
    return {
        async remove(id,version){
            const db=await pool.getConnection();
            try{
                await db.beginTransaction();
                // Use the same lock order as booking submission before unlinking records.
                const [[lock]]=await db.query('SELECT id FROM calendar_lock WHERE id=1 FOR UPDATE');
                if(!lock)throw new Error('Calendar lock missing');
                const [[row]]=await db.execute(`SELECT c.id,COALESCE(v.version,0) AS version FROM customers c
                    LEFT JOIN customer_versions v ON v.customer_id=c.id WHERE c.id=? FOR UPDATE`,[id]);
                if(!row)throw fail('Customer not found.',404);
                if(typeof version!=='string'||!/^\d{1,10}$/.test(version)||Number(row.version)!==Number(version))throw fail('This customer profile changed. Reload the confirmation before deleting.');
                await db.execute('UPDATE bookings SET customer_id=NULL WHERE customer_id=?',[id]);
                await db.execute('DELETE FROM customer_versions WHERE customer_id=?',[id]);
                await db.execute('DELETE FROM customers WHERE id=?',[id]);
                await db.commit();
            }catch(error){await db.rollback();throw error;}finally{db.release();}
        },
        async list(search='',page=1){
            if(typeof search!=='string'||search.length>100)throw fail('Search must be at most 100 characters.',422);
            const offset=(customerPageNumber(String(page))-1)*25;
            const term='%'+search.replace(/[=%_]/g,char=>'='+char)+'%';
            const where="WHERE c.name LIKE ? ESCAPE '=' OR c.email LIKE ? ESCAPE '=' OR c.phone LIKE ? ESCAPE '=' OR c.address LIKE ? ESCAPE '='";
            let phoneSearch=search;
            if(/^[+()\d\s.-]+$/.test(search)){phoneSearch=search.replace(/\D/g,'');if(phoneSearch.startsWith('04'))phoneSearch='61'+phoneSearch.slice(1);}
            const phoneTerm='%'+phoneSearch.replace(/[=%_]/g,char=>'='+char)+'%';
            const params=[term,term,phoneTerm,term];
            const [rows]=await pool.execute(`SELECT c.id,c.name,c.email,c.phone,c.address,c.created_at,
                (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id) AS booking_count
                FROM customers c ${where} ORDER BY c.name,c.id LIMIT 25 OFFSET ${offset}`,params);
            const [[count]]=await pool.execute(`SELECT COUNT(*) AS total FROM customers c ${where}`,params);
            return {rows,total:Number(count.total),page:customerPageNumber(String(page)),search};
        },
        async detail(id,page=1){
            const [[customer]]=await pool.execute(`SELECT c.*,COALESCE(v.version,0) AS version FROM customers c
                LEFT JOIN customer_versions v ON v.customer_id=c.id WHERE c.id=?`,[id]);
            if(!customer)return null;
            const [upcoming]=await pool.execute(`SELECT * FROM bookings WHERE customer_id=? AND status='CONFIRMED'
                AND confirmed_end>UTC_TIMESTAMP() ORDER BY confirmed_start LIMIT 100`,[id]);
            const offset=(customerPageNumber(String(page))-1)*25;
            const [history]=await pool.execute(`SELECT * FROM bookings WHERE customer_id=?
                AND (status<>'CONFIRMED' OR confirmed_end IS NULL OR confirmed_end<=UTC_TIMESTAMP()) ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ${offset}`,[id]);
            const [[count]]=await pool.execute(`SELECT COUNT(*) AS total FROM bookings WHERE customer_id=?
                AND (status<>'CONFIRMED' OR confirmed_end IS NULL OR confirmed_end<=UTC_TIMESTAMP())`,[id]);
            return {customer,upcoming,history,total:Number(count.total),page:customerPageNumber(String(page))};
        },
        async save(id,value){
            const db=await pool.getConnection();
            try{
                await db.beginTransaction();
                const [[row]]=await db.execute(`SELECT c.id,COALESCE(v.version,0) AS version FROM customers c
                    LEFT JOIN customer_versions v ON v.customer_id=c.id WHERE c.id=? FOR UPDATE`,[id]);
                if(!row)throw fail('Customer not found.',404);
                if(Number(row.version)!==value.version)throw fail('This customer profile changed in another tab. Reload it before saving.');
                await db.execute('UPDATE customers SET name=?,email=?,phone=?,address=?,notes=? WHERE id=?',[value.name,value.email,value.phone,value.address,value.notes,id]);
                await db.execute('INSERT INTO customer_versions (customer_id,version) VALUES (?,1) ON DUPLICATE KEY UPDATE version=version+1',[id]);
                await db.commit();
            }catch(error){
                await db.rollback();
                if(error.code==='ER_DUP_ENTRY')throw fail('Another customer already uses this email and phone. Review both records; they have not been merged.');
                throw error;
            }finally{db.release();}
        }
    };
}
const pagination=(page,total,url)=>`<nav class="admin-nav" aria-label="Pages">${page>1?`<a href="${url(page-1)}">Previous page</a>`:''}<span>Page ${page} · ${total} records</span>${page*25<total?`<a href="${url(page+1)}">Next page</a>`:''}</nav>`;
export function customerListPage(data,csrf,errors=[],deleted=false){
    return layout('Customers',`${adminNav(csrf)}${deleted?'<p role="status" class="admin-notice">Customer profile deleted. Existing bookings have been kept.</p>':''}<p>Private customer records created from booking requests.</p>
        ${errors.length?`<p role="alert" class="admin-notice">${errors.map(escape).join(' ')}</p>`:''}
        <form class="admin-card" method="get" action="/admin/customers"><label for="customer-search">Search name, email, phone or address</label>
        <input id="customer-search" name="q" value="${escape(data.search)}" maxlength="100" type="search"><button type="submit" class="button button-secondary">Search Customers</button><a class="customer-clear" href="/admin/customers">Clear search</a></form>
        <div class="admin-service-list">${data.rows.map(c=>`<article class="admin-card"><h2><a href="/admin/customers/${c.id}">${escape(c.name)}</a></h2>
        <p>${escape(c.email)}</p><p>${escape(c.phone)}</p><p>${escape(c.address||'No address supplied')}</p><p>${Number(c.booking_count)} booking(s)</p><a href="/admin/customers/${c.id}">View customer and bookings</a></article>`).join('')||'<p>No matching customers.</p>'}</div>
        ${pagination(data.page,data.total,p=>`/admin/customers?q=${escape(encodeURIComponent(data.search))}&amp;page=${p}`)}`);
}
export function customerDetailPage(data,csrf,errors=[],saved=false,submitted=null){
    const c=data.customer,value=submitted?{...c,...submitted,version:c.version}:c;
    const field=(key,label,attrs='')=>`<label for="customer-${key}">${label}</label><input id="customer-${key}" name="${key}" value="${escape(value[key]||'')}" ${attrs}>`;
    const bookings=rows=>rows.map(b=>`<article class="admin-card booking-decision"><h3><a href="/admin/bookings/${b.id}">Booking ${bookingReference(b.id)} — ${escape(b.service_name)}</a></h3>
        <p><strong class="admin-status" data-status="${escape(b.status)}">Status: ${escape(b.status)}</strong></p><p>${b.confirmed_start?'Scheduled':'Preferred'}: ${escape(displayBookingTime(b.confirmed_start||b.preferred_start))}</p>
        <p>Price at request: ${escape(formatPrice(b))}</p></article>`).join('');
    return layout('Customer Record',`${adminNav(csrf)}<h2>${escape(c.name)}</h2>
        ${saved?'<p role="status" class="admin-notice">Customer profile saved. Details on past bookings are unchanged.</p>':''}
        ${errors.length?`<p role="alert" class="admin-notice">${errors.map(escape).join(' ')}</p>`:''}
        <form class="admin-card" method="post" action="/admin/customers/${c.id}"><input type="hidden" name="_csrf" value="${escape(csrf)}"><input type="hidden" name="version" value="${Number(value.version)}">
        ${field('name','Full name','required maxlength="160" autocomplete="off"')}${field('email','Email','type="email" required maxlength="254" autocomplete="off"')}
        ${field('phone','Phone / mobile','type="tel" required maxlength="40" autocomplete="off"')}${field('address','Address / suburb','maxlength="500" autocomplete="off"')}
        <label for="customer-notes">Private notes</label><textarea id="customer-notes" name="notes" rows="5" maxlength="5000" aria-describedby="customer-notes-help">${escape(value.notes||'')}</textarea>
        <p id="customer-notes-help">Visible to administrators only. Do not store passwords, payment details or unnecessary sensitive information.</p>
        <button class="button button-primary" type="submit">Save Customer</button></form>
        <section class="admin-history"><h2>Upcoming and Ongoing Confirmed Bookings</h2>${bookings(data.upcoming)||'<p>No upcoming confirmed appointments.</p>'}</section>
        <section class="admin-history"><h2>Booking History and Pending Requests</h2>${bookings(data.history)||'<p>No previous bookings or pending requests.</p>'}
        ${pagination(data.page,data.total,p=>`/admin/customers/${c.id}?page=${p}`)}</section>
        <section class="admin-card admin-delete-section"><h2>Delete customer profile</h2><p>Remove this profile and its private notes. Existing booking records and their saved contact details will remain.</p><a class="button button-secondary" href="/admin/customers/${Number(c.id)}/delete">Delete Customer</a></section>`);
}

export function customerDeletePage(data,csrf,errors=[]){
    const c=data.customer;
    return layout('Delete Customer',`${adminNav(csrf)}<section class="admin-card admin-delete-section"><h2>Delete ${escape(c.name)}?</h2>
        <p>This permanently removes the customer profile, address and private notes from the customer list. There is no undo.</p>
        <p>Existing bookings, calendar reservations, decision history and queued emails remain unchanged, including contact details saved with those records. This does not cancel appointments or erase all personal data. A future booking may create a new customer profile.</p>
        ${errors.length?`<p role="alert" class="admin-notice">${errors.map(escape).join(' ')}</p>`:''}
        <form method="post" action="/admin/customers/${Number(c.id)}/delete"><input type="hidden" name="_csrf" value="${escape(csrf)}"><input type="hidden" name="version" value="${Number(c.version)}">
        <label class="admin-checkbox"><input type="checkbox" name="confirm" value="1" required>I understand that this customer profile and private notes will be permanently deleted.</label>
        <button type="submit" class="button admin-delete-button">Permanently Delete Customer</button> <a class="customer-clear" href="/admin/customers/${Number(c.id)}">Keep Customer</a></form></section>`);
}
