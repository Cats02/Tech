import {readFileSync} from 'node:fs';
import nodemailer from 'nodemailer';
import {createHash} from 'node:crypto';
import {escape,layout,bookingReference} from './views.js';
import {adminNav} from './services.js';
import {displayBookingTime} from './booking-time.js';

const address=v=>typeof v==='string'&&v.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v);
export function mailConfig(env=process.env) {
    const mode=['off','test','live'].includes(env.MAIL_MODE)?env.MAIL_MODE:'off';
    const port=Number(env.SMTP_PORT||465);
    const ready=mode!=='off'&&env.SMTP_HOST==='smtp.gmail.com'&&[465,587].includes(port)&&address(env.SMTP_USER)&&address(env.MAIL_FROM)&&env.SMTP_USER===env.MAIL_FROM&&Boolean(env.SMTP_PASSWORD)&&!env.SMTP_PASSWORD.startsWith('YOUR_')&&(mode!=='test'||address(env.MAIL_TEST_RECIPIENT));
    return {mode,ready,port,user:env.SMTP_USER,password:env.SMTP_PASSWORD,from:env.MAIL_FROM,testRecipient:env.MAIL_TEST_RECIPIENT};
}
export function messageFor(row,config) {
    const p=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
    const titles={received:'Booking request received',confirmed:'Appointment confirmed',proposed:'Alternative appointment time proposed',declined:'Booking request declined',cancelled:'Appointment cancelled'};
    if(!titles[row.event_type])throw new Error('Invalid mail event');
    const explanations={received:'Your request is awaiting review. This is not an appointment confirmation.',confirmed:'Your appointment has been confirmed.',proposed:'We would like to offer you the appointment time below. This time is not reserved or confirmed.',declined:'We are unable to accept this booking request. Please contact Everbright Digital to discuss alternatives.',cancelled:'This appointment has been cancelled.'};
    const lines=[`Hello ${p.name},`,titles[row.event_type],`Booking ${bookingReference(row.booking_id)}: ${p.service}`,explanations[row.event_type]];
    if(p.start)lines.push(`${row.event_type==='proposed'?'Proposed':'Appointment'}: ${displayBookingTime(p.start)}`);
    if(p.end)lines.push(`Ends: ${displayBookingTime(p.end)}`);
    const nextStep=row.event_type==='proposed'?'Please reply to this email to let us know whether this time suits you. Once we agree on a time, we will send your appointment confirmation.':row.event_type==='received'?'We will review your request and email you with an update. If you need to change any details, simply reply to this email.':row.event_type==='confirmed'?'We look forward to helping you. If you need to make a change, please reply to this email.':'If you would like to discuss another appointment, please reply to this email.';
    lines.push(nextStep,'Kind regards,\nEverbright Digital');
    const detail=(label,value)=>`<tr><td style="padding:10px 16px;color:#596579;font-size:13px;vertical-align:top;width:90px">${label}</td><td style="padding:10px 16px;color:#142338;font-size:15px;line-height:1.6;overflow-wrap:anywhere">${escape(value)}</td></tr>`;
    const html=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>${escape(titles[row.event_type])}</title></head><body style="margin:0;padding:0;background:#eef2f7;color:#142338;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dce3ed;border-radius:12px"><tr><td style="padding:20px 24px;background:#030916;border-bottom:1px solid #10bdd5"><img src="cid:everbright-header" width="320" alt="Everbright Digital" style="display:block;width:100%;max-width:320px;height:auto;border:0;color:#ffffff;font-size:22px"></td></tr><tr><td style="padding:28px 24px">${config.mode==='test'?'<p style="margin:0 0 20px;color:#795000;font-size:12px;font-weight:bold">TEST EMAIL · Delivered to your test address</p>':''}<h1 style="font-size:26px;line-height:1.25;margin:0 0 24px;color:#142338">${escape(titles[row.event_type])}</h1><p style="font-size:16px;line-height:1.65;margin:0 0 16px">Hello ${escape(p.name)},</p><p style="font-size:16px;line-height:1.65;margin:0 0 24px">${escape(explanations[row.event_type])}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f6fb;border:1px solid #dce3ed;border-radius:8px">${detail('Reference',`Booking ${bookingReference(row.booking_id)}`)}${detail('Service',p.service)}${p.start?detail(row.event_type==='proposed'?'Proposed time':'Starts',displayBookingTime(p.start)):''}${p.end?detail('Ends',displayBookingTime(p.end)):''}</table><h2 style="font-size:18px;margin:26px 0 10px;color:#142338">${row.event_type==='proposed'?'Does this time work for you?':'What happens next'}</h2><p style="font-size:16px;line-height:1.65;margin:0 0 24px">${escape(nextStep)}</p><p style="font-size:15px;line-height:1.6;margin:0">Kind regards,<br><strong>Everbright Digital</strong></p></td></tr><tr><td style="padding:18px 24px;border-top:1px solid #e3e9f1;color:#596579;font-size:12px;line-height:1.6">Sent by Everbright Digital about your booking. All appointment times use Adelaide local time. You can reply directly to this email.</td></tr></table></td></tr></table></body></html>`;

    return {from:{name:'Everbright Digital',address:config.from},replyTo:config.from,to:config.mode==='test'?config.testRecipient:row.recipient,
        subject:`${config.mode==='test'?'[TEST] ':''}${titles[row.event_type]} — Everbright Digital`,
        messageId:`<${createHash('sha256').update(row.event_key).digest('hex')}@${config.from.split('@')[1]}>`,
        text:lines.join('\n\n'),html,attachments:[{filename:'everbright-digital-header-logo.png',content:readFileSync(new URL('../assets/everbright-digital-header-logo.png',import.meta.url)),cid:'everbright-header',contentType:'image/png',contentDisposition:'inline'}],disableFileAccess:true,disableUrlAccess:true};
}
export function currentEmail(row) {
    const states={received:'PENDING',confirmed:'CONFIRMED',proposed:'PENDING',declined:'DECLINED',cancelled:'CANCELLED'};
    return states[row.event_type]===row.booking_status&&Number(row.review_version)===Number(row.current_version);
}
export function createMailer(pool,config=mailConfig(),transport) {
    const smtp=transport||(config.ready?nodemailer.createTransport({host:'smtp.gmail.com',port:config.port,secure:config.port===465,requireTLS:true,
        auth:{user:config.user,pass:config.password},tls:{rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000,
        disableFileAccess:true,disableUrlAccess:true}):null);
    const queue=async(db,event)=>{
        // Only these fields are allowed into email: never serialize a booking or private notes.
        const payload=JSON.stringify({name:event.name,service:event.service,start:event.start||null,end:event.end||null});
        await db.execute(`INSERT INTO email_outbox (booking_id,event_key,event_type,review_version,recipient,payload,status) VALUES (?,?,?,?,?,?,?)`,
            [event.id,event.key,event.type,event.version,event.email,payload,config.ready?'PENDING':'HELD']);
    };
    let running=false;
    const processQueue=async()=>{
        if(!config.ready||running)return;
        running=true;let db,locked=false;
        try {
            db=await pool.getConnection();
            const [[lock]]=await db.query("SELECT GET_LOCK('everbright-mail-worker',0) AS acquired");
            if(!lock.acquired)return;locked=true;
            await db.query("UPDATE email_outbox SET status='PENDING' WHERE status='SENDING' AND updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)");
            for(let n=0;n<5;n++) {
                const [[row]]=await db.query(`SELECT e.*,b.status AS booking_status,COALESCE(r.version,0) AS current_version FROM email_outbox e JOIN bookings b ON b.id=e.booking_id LEFT JOIN booking_review r ON r.booking_id=b.id WHERE e.status='PENDING' AND e.next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY e.id LIMIT 1`);
                if(!row)break;
                if(!currentEmail(row)){await db.execute("UPDATE email_outbox SET status='SKIPPED',last_error='OUTDATED_EVENT' WHERE id=?",[row.id]);continue;}
                await db.execute("UPDATE email_outbox SET status='SENDING',attempts=attempts+1 WHERE id=?",[row.id]);
                try {
                    const message=messageFor(row,config),result=await smtp.sendMail(message);
                    if(!result.accepted?.length)throw new Error('Not accepted');
                    await db.execute("UPDATE email_outbox SET status='SENT',sent_to=?,sent_at=UTC_TIMESTAMP(3),last_error=NULL WHERE id=?",[message.to,row.id]);
                }catch {
                    const attempts=Number(row.attempts)+1;
                    await db.execute('UPDATE email_outbox SET status=?,last_error=?,next_attempt_at=? WHERE id=?',[attempts>=5?'FAILED':'PENDING','SMTP_DELIVERY_FAILED',new Date(Date.now()+Math.min(60,2**attempts)*60000),row.id]);
                }
            }
        }finally{try{if(db){try{if(locked)await db.query("SELECT RELEASE_LOCK('everbright-mail-worker')");}finally{db.release();}}}finally{running=false;}}
    };
    return {config,queue,processQueue,
        async list(){const [rows]=await pool.query('SELECT id,booking_id,event_type,status,attempts,recipient,sent_to,last_error FROM email_outbox ORDER BY id DESC LIMIT 100');return rows;},
        async release(id){if(!config.ready)return;await pool.execute("UPDATE email_outbox SET status='PENDING',attempts=0,next_attempt_at=UTC_TIMESTAMP(3),last_error=NULL WHERE id=? AND status IN ('HELD','FAILED')",[id]);}
    };
}
export function mailPage(mailer,rows,csrf) {
    return layout('Email Notifications',`${adminNav(csrf)}<p>Mode: <strong>${escape(mailer.config.mode)}</strong>. ${mailer.config.ready?'Email delivery is configured.':'Delivery is held. Configure Gmail before releasing messages.'}</p><p>Test mode redirects all messages to your test address. SENT means accepted by Gmail, not guaranteed inbox delivery. Outdated decisions are skipped. Private notes are never emailed.</p><p>Held messages require individual release; enabling delivery does not send them automatically.</p><div class="admin-service-list">${rows.map(r=>`<section class="admin-card"><h2>Booking ${bookingReference(r.booking_id)} — ${escape(r.event_type)}</h2><p>${escape(r.status)} · Attempts: ${Number(r.attempts)}</p><p>Customer: ${escape(r.recipient)}${r.sent_to?`<br>Sent to: ${escape(r.sent_to)}`:''}</p>${r.last_error?`<p>${escape(r.last_error)}</p>`:''}${mailer.config.ready&&['HELD','FAILED'].includes(r.status)?`<form method="post" action="/admin/emails/${Number(r.id)}/release"><input type="hidden" name="_csrf" value="${escape(csrf)}"><button class="button" type="submit">Release / Retry Email</button></form>`:''}</section>`).join('')||'<p>No queued emails yet.</p>'}</div>`);
}
