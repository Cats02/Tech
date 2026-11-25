import {parseAdelaide,adelaideLocal,displayBookingTime} from './booking-time.js';
import {escape,layout} from './views.js';
import {adminNav} from './services.js';
const error=(message,status=409)=>Object.assign(new Error(message),{status});
export const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const validDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number(day.slice(0,4))>=2000&&Number(day.slice(0,4))<=2099&&Boolean(parseAdelaide(day,'12:00'));
export function shiftDay(day,count){const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);}
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
export function fitsHours(start,end,hours,grid=false){
    const a=adelaideLocal(new Date(start)),b=adelaideLocal(new Date(end));
    const opening=hours?parseAdelaide(a.slice(0,10),hours.opens.slice(0,5)):null,closing=hours?parseAdelaide(a.slice(0,10),hours.closes.slice(0,5)):null;
    return Boolean(hours?.enabled&&a.slice(0,10)===b.slice(0,10)&&new Date(end)>new Date(start)&&
        opening&&closing&&new Date(start)>=opening&&new Date(end)<=closing&&
        (!grid||(minutes(a.slice(11))-minutes(hours.opens))%15===0));
}
export async function assertAvailable(db,start,end,{ignoreBookingId=null,grid=false}={}) {
    const weekday=new Date(adelaideLocal(start).slice(0,10)+'T12:00:00Z').getUTCDay();
    const [[hours]]=await db.execute('SELECT * FROM business_availability WHERE weekday=?',[weekday]);
    if(!fitsHours(start,end,hours,grid))throw error('That appointment is outside available business hours. Choose another time.');
    const [busy]=await db.execute(`SELECT id FROM calendar_reservations WHERE start_at<? AND end_at>?
        AND (booking_id IS NULL OR booking_id<>?) LIMIT 1 FOR UPDATE`,[end,start,ignoreBookingId??0]);
    const [confirmed]=await db.execute(`SELECT id FROM bookings WHERE status='CONFIRMED' AND id<>?
        AND confirmed_start<? AND confirmed_end>? LIMIT 1 FOR UPDATE`,[ignoreBookingId??0,end,start]);
    if(busy.length||confirmed.length)throw error('That time is no longer available. Choose another time.');
}
export function generateSlots(day,duration,hours,reservations,now=new Date()){
    if(!validDay(day)||!Number.isInteger(duration)||duration<15||duration>1440||!hours?.enabled)return [];
    const slots=[];
    for(let m=minutes(hours.opens);m<minutes(hours.closes);m+=15){
        const time=`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
        const start=parseAdelaide(day,time);if(!start||start<=now||start.getTime()>now.getTime()+366*86400000)continue;
        const end=new Date(start.getTime()+duration*60000);
        if(fitsHours(start,end,hours)&&!reservations.some(r=>new Date(r.start_at)<end&&new Date(r.end_at)>start))slots.push(time);
    }
    return slots;
}
export function validateHours(body){
    const rows=[];
    for(let weekday=0;weekday<7;weekday++){
        const opens=body[`open_${weekday}`],closes=body[`close_${weekday}`];
        if(typeof opens!=='string'||typeof closes!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(opens)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(closes)||opens>=closes)throw error(`Check the opening and closing times for ${dayNames[weekday]}.`,422);
        rows.push({weekday,enabled:body[`enabled_${weekday}`]==='1',opens,closes});
    }
    return rows;
}
export function createSchedulingRepository(pool){
    const transaction=async(version,work)=>{
        if(!/^\d{1,10}$/.test(String(version||'')))throw error('Reload Settings before saving.');
        const db=await pool.getConnection();
        try{
            await db.beginTransaction();const [[lock]]=await db.query('SELECT id FROM calendar_lock WHERE id=1 FOR UPDATE');if(!lock)throw new Error('Calendar lock missing');
            const [[settings]]=await db.query('SELECT version FROM schedule_settings WHERE id=1 FOR UPDATE');
            if(!settings||Number(settings.version)!==Number(version))throw error('Settings changed in another tab. Reload and try again.');
            await work(db);await db.query('UPDATE schedule_settings SET version=version+1 WHERE id=1');await db.commit();
        }catch(e){await db.rollback();throw e;}finally{db.release();}
    };
    return {
        async settings(){
            const [hours]=await pool.query('SELECT * FROM business_availability ORDER BY weekday');
            const [[settings]]=await pool.query('SELECT version FROM schedule_settings WHERE id=1');
            const [blocks]=await pool.query("SELECT * FROM calendar_reservations WHERE kind='BLOCKED' AND end_at>UTC_TIMESTAMP() ORDER BY start_at");
            return {hours,blocks,version:settings.version};
        },
        async monthAvailability(service,month){
            const first=month+'-01',next=new Date(first+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
            const last=next.toISOString().slice(0,10),start=parseAdelaide(first,'00:00'),end=parseAdelaide(last,'00:00');
            const [hours]=await pool.query('SELECT * FROM business_availability');
            const [busy]=await pool.execute('SELECT start_at,end_at FROM calendar_reservations WHERE start_at<? AND end_at>?',[end,start]);
            const [confirmed]=await pool.execute("SELECT confirmed_start AS start_at,confirmed_end AS end_at FROM bookings WHERE status='CONFIRMED' AND confirmed_start<? AND confirmed_end>?",[end,start]);
            const days=[];for(let day=first;day<last;day=shiftDay(day,1)){
                const weekday=new Date(day+'T12:00:00Z').getUTCDay();
                days.push({date:day,available:generateSlots(day,Number(service.duration_minutes),hours.find(h=>Number(h.weekday)===weekday),[...busy,...confirmed]).length>0});
            }
            return days;
        },
        async slots(service,day){
            if(!validDay(day))return [];
            const start=parseAdelaide(day,'00:00'),end=parseAdelaide(shiftDay(day,1),'00:00');
            const weekday=new Date(day+'T12:00:00Z').getUTCDay();
            const [[hours]]=await pool.execute('SELECT * FROM business_availability WHERE weekday=?',[weekday]);
            const [busy]=await pool.execute('SELECT start_at,end_at FROM calendar_reservations WHERE start_at<? AND end_at>?',[end,start]);
            const [confirmed]=await pool.execute("SELECT confirmed_start AS start_at,confirmed_end AS end_at FROM bookings WHERE status='CONFIRMED' AND confirmed_start<? AND confirmed_end>?",[end,start]);
            return generateSlots(day,Number(service.duration_minutes),hours,[...busy,...confirmed]);
        },
        saveHours:async(body)=>{
            const rows=validateHours(body);
            await transaction(body.version,async db=>{
                const [existing]=await db.query("SELECT confirmed_start,confirmed_end FROM bookings WHERE status='CONFIRMED' AND confirmed_end>UTC_TIMESTAMP() FOR UPDATE");
                for(const booking of existing){
                    const weekday=new Date(adelaideLocal(booking.confirmed_start).slice(0,10)+'T12:00:00Z').getUTCDay();
                    if(!fitsHours(booking.confirmed_start,booking.confirmed_end,rows[weekday]))throw error('These hours would exclude a confirmed appointment. Cancel or reschedule that appointment first.');
                }
                for(const row of rows)await db.execute('UPDATE business_availability SET enabled=?,opens=?,closes=? WHERE weekday=?',[row.enabled,row.opens,row.closes,row.weekday]);
            });
        },
        addBlock:async(body)=>{
            const start=parseAdelaide(body.start_date,body.start_time),end=parseAdelaide(body.end_date,body.end_time);
            const label=typeof body.label==='string'?body.label.trim():'';
            if(!label||label.length>160||/[\x00-\x1f]/.test(label)||!start||!end||end<=start||end<=new Date()||end-start>366*86400000)throw error('Enter a label and valid blocked start/end times (up to one year).',422);
            await transaction(body.version,async db=>{
                const [busy]=await db.execute('SELECT id FROM calendar_reservations WHERE start_at<? AND end_at>? LIMIT 1 FOR UPDATE',[end,start]);
                const [confirmed]=await db.execute("SELECT id FROM bookings WHERE status='CONFIRMED' AND confirmed_start<? AND confirmed_end>? LIMIT 1 FOR UPDATE",[end,start]);
                if(busy.length||confirmed.length)throw error('That block overlaps a confirmed appointment or another blocked period.');
                await db.execute("INSERT INTO calendar_reservations (kind,start_at,end_at,label) VALUES ('BLOCKED',?,?,?)",[start,end,label]);
            });
        },
        removeBlock:async(id,version)=>transaction(version,async db=>{
            if(!/^[1-9]\d{0,18}$/.test(String(id)))throw error('Block not found.',404);
            const [result]=await db.execute("DELETE FROM calendar_reservations WHERE id=? AND kind='BLOCKED'",[id]);
            if(!result.affectedRows)throw error('Block not found.',404);
        }),
        async calendar(from,to){
            const [bookings]=await pool.execute(`SELECT b.id,b.status,b.customer_name,b.service_name,b.preferred_start,b.alternative_start,b.confirmed_start,b.confirmed_end,b.duration_minutes,r.proposed_start
                FROM bookings b LEFT JOIN booking_review r ON r.booking_id=b.id
                WHERE (COALESCE(b.confirmed_start,r.proposed_start,b.preferred_start)<? AND DATE_ADD(COALESCE(b.confirmed_start,r.proposed_start,b.preferred_start),INTERVAL b.duration_minutes MINUTE)>?)
                ORDER BY COALESCE(b.confirmed_start,r.proposed_start,b.preferred_start)`,[to,from]);
            const [blocks]=await pool.execute("SELECT id,label,start_at,end_at FROM calendar_reservations WHERE kind='BLOCKED' AND start_at<? AND end_at>? ORDER BY start_at",[to,from]);
            return {bookings,blocks};
        }
    };
}
export function settingsPage(data,csrf,errors=[],saved=false){
    const hidden=`<input type="hidden" name="_csrf" value="${escape(csrf)}"><input type="hidden" name="version" value="${data.version}">`;
    return layout('Settings',`${adminNav(csrf)}<p>Business timezone: Australia/Adelaide. Available times are offered at 15-minute intervals. Booking requests still require manual approval.</p>
        ${saved?'<p role="status" class="admin-notice">Availability settings saved.</p>':''}${errors.length?`<p role="alert" class="admin-notice">${errors.map(escape).join(' ')}</p>`:''}
        <form method="post" action="/admin/settings/hours" class="admin-card">${hidden}<h2>Business Hours</h2><p>Enable the days you accept bookings. All days start disabled until you configure them.</p>
        ${data.hours.map(h=>`<fieldset><legend>${dayNames[h.weekday]}</legend><label class="admin-checkbox"><input type="checkbox" name="enabled_${h.weekday}" value="1"${h.enabled?' checked':''}> Accept bookings</label>
        <label for="open-${h.weekday}">Opening time</label><input id="open-${h.weekday}" name="open_${h.weekday}" type="time" value="${escape(h.opens.slice(0,5))}" required>
        <label for="close-${h.weekday}">Closing time</label><input id="close-${h.weekday}" name="close_${h.weekday}" type="time" value="${escape(h.closes.slice(0,5))}" required></fieldset>`).join('')}
        <button class="button button-primary" type="submit">Save Business Hours</button></form>
        <form method="post" action="/admin/settings/blocks" class="admin-card booking-decision">${hidden}<h2>Add Blocked Period</h2>
        <label for="block-label">Label</label><input id="block-label" name="label" maxlength="160" placeholder="Unavailable" required>
        ${['start','end'].map(part=>`<label for="block-${part}-date">${part==='start'?'Start':'End'} date</label><input id="block-${part}-date" name="${part}_date" type="date" required>
        <label for="block-${part}-time">${part==='start'?'Start':'End'} time — Adelaide</label><input id="block-${part}-time" name="${part}_time" type="time" required>`).join('')}
        <button class="button button-secondary" type="submit">Add Blocked Period</button></form>
        <h2>Upcoming Blocked Periods</h2>${data.blocks.map(b=>`<article class="admin-card booking-decision"><h3>${escape(b.label)}</h3><p>${escape(displayBookingTime(b.start_at))} – ${escape(displayBookingTime(b.end_at))}</p>
        <form method="post" action="/admin/settings/blocks/${b.id}/remove">${hidden}<button class="button button-secondary" type="submit">Remove Blocked Period</button></form></article>`).join('')||'<p>No upcoming blocked periods.</p>'}`);
}
export function calendarRange(day,view){
    if(!validDay(day))day=adelaideLocal(new Date()).slice(0,10);
    if(view==='week'){
        const weekday=new Date(day+'T12:00:00Z').getUTCDay();const first=shiftDay(day,-((weekday+6)%7));
        return {first,last:shiftDay(first,7),days:7,previous:shiftDay(first,-7),next:shiftDay(first,7),view:'week'};
    }
    const first=day.slice(0,7)+'-01',d=new Date(first+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);const last=d.toISOString().slice(0,10);
    const previous=new Date(first+'T12:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);
    return {first,last,days:Math.round((new Date(last)-new Date(first))/86400000),previous:previous.toISOString().slice(0,10),next:last,view:'month'};
}
export function calendarPage(range,data,csrf){
    const cells=[];
    for(let i=0;i<range.days;i++){
        const day=shiftDay(range.first,i),from=parseAdelaide(day,'00:00'),to=parseAdelaide(shiftDay(day,1),'00:00');
        const bookings=data.bookings.filter(b=>{const s=new Date(b.confirmed_start||b.proposed_start||b.preferred_start);return s<to&&new Date(s.getTime()+b.duration_minutes*60000)>from;});
        const blocks=data.blocks.filter(b=>new Date(b.start_at)<to&&new Date(b.end_at)>from);
        cells.push(`<section class="calendar-day"><h2>${escape(dayNames[new Date(day+'T12:00:00Z').getUTCDay()])} ${escape(day)}</h2>
            ${bookings.map(b=>`<p><a href="/admin/bookings/${b.id}"><strong>${escape(b.status)}${b.status==='PENDING'&&b.proposed_start?' · PROPOSED':''}</strong> — ${escape(b.customer_name)}<br>${escape(b.service_name)}<br>${escape(displayBookingTime(b.confirmed_start||b.proposed_start||b.preferred_start))}</a></p>`).join('')}
            ${blocks.map(b=>`<p><strong>BLOCKED</strong> — ${escape(b.label)}<br>${escape(displayBookingTime(b.start_at))} – ${escape(displayBookingTime(b.end_at))}</p>`).join('')}
            ${!bookings.length&&!blocks.length?'<p>No entries</p>':''}</section>`);
    }
    return layout('Calendar',`${adminNav(csrf)}<p>All times are Adelaide time. PENDING requests do not reserve appointments.</p>
        <nav class="admin-nav" aria-label="Calendar views"><a href="/admin/calendar?date=${range.first}&view=month">Month</a><a href="/admin/calendar?date=${range.first}&view=week">Week</a>
        <a href="/admin/calendar?date=${range.previous}&view=${range.view}">Previous</a><a href="/admin/calendar?date=${range.next}&view=${range.view}">Next</a><a href="/admin/calendar?view=${range.view}">Today</a></nav>
        <p>${range.first} to ${shiftDay(range.last,-1)}</p><div class="calendar-grid">${cells.join('')}</div>`);
}
