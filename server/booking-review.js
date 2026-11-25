import { escape } from './views.js';
import { adelaideLocal, parseAdelaide, displayBookingTime } from './booking-time.js';
import {assertAvailable} from './scheduling.js';

export const allowedActions={PENDING:['accept','propose','decline','cancel'],CONFIRMED:['complete','cancel'],COMPLETED:[],CANCELLED:[],DECLINED:[]};
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export function reviewInput(row,body,now=new Date()) {
    const action=body.action;
    if(!allowedActions[row.status]?.includes(action))throw fail('This action is not allowed for the current booking status.');
    if(!/^\d{1,10}$/.test(String(body.version||''))||Number(body.version)!==Number(row.review_version||0))throw fail('This booking changed in another tab. Reload it before making a decision.');
    const note=body.note===undefined?'':typeof body.note==='string'?body.note.trim():null;
    if(note===null||note.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(note))throw fail('Use a note of at most 2000 characters.',422);
    let start=null,end=null;
    if(action==='accept'||action==='propose') {
        if(action==='propose'||body.slot==='custom')start=parseAdelaide(body.start_date,body.start_time);
        else {
            const values={preferred:row.preferred_start,alternative:row.alternative_start,proposed:row.proposed_start};
            if(Object.hasOwn(values,body.slot)&&values[body.slot])start=new Date(values[body.slot]);
        }
        if(!start||!Number.isFinite(start.getTime())||start<=now||start.getTime()>now.getTime()+366*86400000)throw fail('Choose a valid future appointment within one year. All times are Adelaide time.',422);
        const duration=Number(row.duration_minutes);
        if(!Number.isInteger(duration)||duration<15||duration>1440)throw fail('The saved booking duration needs review before scheduling.');
        end=new Date(start.getTime()+duration*60000);
    }
    if(action==='complete'&&(!row.confirmed_end||new Date(row.confirmed_end)>now))throw fail('An appointment can only be completed after its scheduled end time. Cancel it instead if it will not proceed.');
    const status={accept:'CONFIRMED',propose:'PENDING',decline:'DECLINED',cancel:'CANCELLED',complete:'COMPLETED'}[action];
    return {action,note,start,end,status};
}

export function createReviewRepository(pool,{enforceAvailability=true}={}) {
    return {
        async details(id) {
            const [[row]]=await pool.execute(`SELECT b.*, COALESCE(r.version,0) AS review_version,r.proposed_start,r.proposed_end
                FROM bookings b LEFT JOIN booking_review r ON r.booking_id=b.id WHERE b.id=?`,[id]);
            if(!row)return null;
            const [history]=await pool.execute(`SELECT e.*,a.email AS admin_email FROM booking_events e JOIN admin_users a ON a.id=e.admin_id
                WHERE e.booking_id=? ORDER BY e.id DESC LIMIT 100`,[id]);
            const predicates=[],parameters=[id];
            for(const requested of [row.preferred_start,row.alternative_start].filter(Boolean)) {
                const start=new Date(requested),end=new Date(start.getTime()+Number(row.duration_minutes)*60000);
                for(const column of ['preferred_start','alternative_start']) {
                    predicates.push(`(${column}<? AND DATE_ADD(${column},INTERVAL duration_minutes MINUTE)>?)`);
                    parameters.push(end,start);
                }
            }
            const [conflicts]=await pool.execute(`SELECT id,status,preferred_start,alternative_start FROM bookings WHERE id<>? AND status='PENDING'
                AND (${predicates.join(' OR ')}) ORDER BY preferred_start LIMIT 50`,parameters);
            return {row,history,conflicts};
        },
        async act(id,body,adminId) {
            const db=await pool.getConnection();
            try {
                await db.beginTransaction();
                // All scheduling writers, including future availability/block edits,
                // must take this same lock before reading or changing reservations.
                const [[lock]]=await db.query('SELECT id FROM calendar_lock WHERE id=1 FOR UPDATE');
                if(!lock)throw new Error('Calendar lock is missing');
                const [[row]]=await db.execute(`SELECT b.*,COALESCE(r.version,0) AS review_version,r.proposed_start,r.proposed_end
                    FROM bookings b LEFT JOIN booking_review r ON r.booking_id=b.id WHERE b.id=? FOR UPDATE`,[id]);
                if(!row)throw fail('Booking not found.',404);
                const value=reviewInput(row,body);
                if(enforceAvailability&&value.start)await assertAvailable(db,value.start,value.end,{ignoreBookingId:id});
                if(value.start) {
                    const [overlaps]=await db.execute(`SELECT id FROM calendar_reservations WHERE start_at<? AND end_at>?
                        AND (booking_id IS NULL OR booking_id<>?) LIMIT 1 FOR UPDATE`,[value.end,value.start,id]);
                    // Defensive check also covers existing confirmed appointments not yet backfilled into the calendar table.
                    const [confirmed]=await db.execute(`SELECT id FROM bookings WHERE id<>? AND status='CONFIRMED'
                        AND confirmed_start<? AND confirmed_end>? LIMIT 1 FOR UPDATE`,[id,value.end,value.start]);
                    if(overlaps.length||confirmed.length)throw fail('That time overlaps a reserved appointment or blocked period. Choose another time.');
                }
                await db.execute(`INSERT INTO booking_review (booking_id,version,proposed_start,proposed_end) VALUES (?,1,?,?)
                    ON DUPLICATE KEY UPDATE version=version+1,proposed_start=VALUES(proposed_start),proposed_end=VALUES(proposed_end)`,
                [id,value.action==='propose'?value.start:(row.proposed_start??null),value.action==='propose'?value.end:(row.proposed_end??null)]);
                if(value.action==='accept') {
                    await db.execute('INSERT INTO calendar_reservations (booking_id,start_at,end_at) VALUES (?,?,?)',[id,value.start,value.end]);
                    await db.execute('UPDATE bookings SET status=?,confirmed_start=?,confirmed_end=? WHERE id=?',[value.status,value.start,value.end,id]);
                } else {
                    await db.execute('UPDATE bookings SET status=? WHERE id=?',[value.status,id]);
                    if(value.action==='cancel')await db.execute('DELETE FROM calendar_reservations WHERE booking_id=?',[id]);
                    // Completed reservations remain for historical calendar visibility.
                }
                await db.execute(`INSERT INTO booking_events (booking_id,admin_id,action,previous_status,new_status,start_at,end_at,note)
                    VALUES (?,?,?,?,?,?,?,?)`,[id,adminId,value.action,row.status,value.status,value.start,value.end,value.note]);
                await db.commit();return value;
            }catch(error){await db.rollback();throw error;}finally{db.release();}
        }
    };
}

export function reviewPanel(row,history,conflicts,csrf,errors=[],saved=false) {
    const actions=allowedActions[row.status]||[];
    const baseTime=row.proposed_start||row.preferred_start;
    const local=adelaideLocal(new Date(baseTime));
    const hidden=`<input type="hidden" name="_csrf" value="${escape(csrf)}"><input type="hidden" name="version" value="${Number(row.review_version||0)}">`;
    const actionForm=(action,title,content='')=>`<form class="admin-card booking-decision" method="post" action="/admin/bookings/${row.id}/review">${hidden}
        <input type="hidden" name="action" value="${action}"><h3>${title}</h3>${content}<label for="${action}-note">${action==='decline'?'Reason / note (optional)':'Note (optional)'}</label>
        <textarea id="${action}-note" name="note" rows="2" maxlength="2000"></textarea><button type="submit" class="button button-secondary">${title}</button></form>`;
    const timeFields=prefix=>`<label for="${prefix}-date">Date — Adelaide time</label><input id="${prefix}-date" name="start_date" type="date" value="${local.slice(0,10)}" required>
        <label for="${prefix}-time">Time — Adelaide time</label><input id="${prefix}-time" name="start_time" type="time" value="${local.slice(11)}" required>`;
    return `<section class="admin-history" aria-labelledby="booking-review-title"><h2 id="booking-review-title">Review Booking</h2>
        ${saved?'<p role="status" class="admin-notice">Decision saved. No email has been sent; contact the customer directly.</p>':''}
        ${errors.length?`<div role="alert" class="admin-notice">${errors.map(escape).join(' ')}</div>`:''}
        ${row.confirmed_start?`<p><strong>Scheduled:</strong> ${escape(displayBookingTime(row.confirmed_start))} – ${escape(displayBookingTime(row.confirmed_end))}</p>`:''}
        ${row.proposed_start?`<p><strong>Proposed:</strong> ${escape(displayBookingTime(row.proposed_start))}. A proposal does not reserve the time or confirm the appointment.</p>`:''}
        ${conflicts.length?`<div class="admin-notice"><strong>Pending request conflict:</strong> other requests overlap this preferred time. Review each before confirming.<ul>${conflicts.map(c=>`<li><a href="/admin/bookings/${c.id}">Request #${c.id}</a> — ${escape(displayBookingTime(c.preferred_start))}</li>`).join('')}</ul></div>`:''}
        ${actions.includes('accept')?actionForm('accept','Accept',`<p>Reserves ${row.duration_minutes} minutes. Contact the customer after accepting.</p><label for="accept-slot">Appointment time</label><select id="accept-slot" name="slot">
            <option value="preferred">Preferred time</option>${row.alternative_start?'<option value="alternative">Second preference</option>':''}
            ${row.proposed_start?'<option value="proposed" selected>Proposed time</option>':''}<option value="custom">Custom date/time below</option></select>${timeFields('accept')}`):''}
        ${actions.includes('propose')?actionForm('propose','Suggest Different Time',`<p>Keeps the request PENDING. Contact the customer to discuss this proposal.</p>${timeFields('propose')}`):''}
        ${actions.includes('decline')?actionForm('decline','Decline'):''}${actions.includes('cancel')?actionForm('cancel','Cancel Booking'):''}
        ${actions.includes('complete')?actionForm('complete','Mark Completed','<p>Use after the scheduled appointment has ended.</p>'):''}
        ${!actions.length?'<p>This booking is closed. Its history is retained.</p>':''}
        <h2>Decision History</h2>${history.length?`<ul>${history.map(e=>`<li><strong>${escape(e.action.toUpperCase())}</strong>: ${escape(e.previous_status)} → ${escape(e.new_status)}
            — ${escape(displayBookingTime(e.created_at))}, ${escape(e.admin_email)}${e.start_at?`<br>Time: ${escape(displayBookingTime(e.start_at))}`:''}${e.note?`<p class="service-full-description">${escape(e.note)}</p>`:''}</li>`).join('')}</ul>`:'<p>No decisions recorded.</p>'}</section>`;
}
