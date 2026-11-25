import test from 'node:test';
import assert from 'node:assert/strict';
import {mailConfig,messageFor,currentEmail,createMailer,mailPage} from '../server/mail.js';
const env={MAIL_MODE:'test',SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'465',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'fake-app-password',MAIL_FROM:'sender@example.test',MAIL_TEST_RECIPIENT:'test@example.test'};
const event={id:1,booking_id:2,event_key:'booking:2:review:1',event_type:'confirmed',review_version:1,current_version:1,booking_status:'CONFIRMED',recipient:'customer@example.test',payload:JSON.stringify({name:'<Customer>',service:'Diagnosis',start:'2026-12-01T03:00:00Z',end:null}),attempts:0};
test('Gmail configuration holds delivery unless all required settings are safe',()=>{
 assert.equal(mailConfig().ready,false);
 assert.equal(mailConfig(env).ready,true);
 for(const changed of [{MAIL_TEST_RECIPIENT:''},{SMTP_HOST:'evil.test'},{SMTP_PORT:'25'},{MAIL_FROM:'other@example.test'},{SMTP_PASSWORD:'YOUR_PASSWORD'},{MAIL_FROM:'x\r\nBcc:evil@example.test'}])assert.equal(mailConfig({...env,...changed}).ready,false);
});
test('email templates redirect test recipients, escape HTML and distinguish proposals',()=>{
 const message=messageFor(event,mailConfig(env));assert.equal(message.to,'test@example.test');assert.match(message.subject,/^\[TEST\]/);assert.match(message.html,/&lt;Customer&gt;/);assert.doesNotMatch(JSON.stringify(message),/customer@example.test/);
 assert.match(messageFor({...event,event_type:'proposed'},mailConfig(env)).text,/not reserved or confirmed/);
 assert.equal(currentEmail(event),true);assert.equal(currentEmail({...event,current_version:2}),false);assert.equal(currentEmail({...event,booking_status:'CANCELLED'}),false);
});
test('transaction outbox only captures permitted fields and holds disabled delivery',async()=>{
 const calls=[];const mailer=createMailer({},mailConfig({}));
 await mailer.queue({execute:async(...args)=>calls.push(args)},{id:2,key:'key',type:'received',version:0,email:'c@example.test',name:'Customer',service:'Diagnosis',note:'PRIVATE',description:'PRIVATE',password:'PRIVATE'});
 assert.equal(calls[0][1].at(-1),'HELD');assert.doesNotMatch(JSON.stringify(calls),/PRIVATE/);
 await mailer.processQueue();
 assert.doesNotMatch(mailPage(mailer,[],'csrf'),/fake-app-password/);
});
function fixture(row,fail=false){let selected=false;const calls=[];
 const db={query:async(sql)=>{calls.push(sql);if(sql.includes('GET_LOCK'))return [[{acquired:1}]];if(sql.startsWith('SELECT e.')){if(selected)return [[]];selected=true;return [[row]];}return [[]];},execute:async(sql,args)=>{calls.push([sql,args]);},release:()=>calls.push('released')};
 let sent=0;return {calls,get sent(){return sent;},mailer:createMailer({getConnection:async()=>db},mailConfig(env),{sendMail:async()=>{sent++;if(fail)throw new Error('secret SMTP response');return {accepted:['test@example.test']};}})};
}
test('worker marks accepted messages, retries safely, and skips superseded events',async()=>{
 const ok=fixture(event);await ok.mailer.processQueue();assert.equal(ok.sent,1);assert.ok(ok.calls.some(c=>Array.isArray(c)&&c[0].includes("status='SENT'")));
 const bad=fixture({...event,attempts:4},true);await bad.mailer.processQueue();assert.ok(bad.calls.some(c=>Array.isArray(c)&&c[1][0]==='FAILED'));assert.doesNotMatch(JSON.stringify(bad.calls),/secret SMTP/);
 const old=fixture({...event,current_version:2});await old.mailer.processQueue();assert.equal(old.sent,0);assert.ok(old.calls.some(c=>Array.isArray(c)&&c[0].includes("status='SKIPPED'")));
});


test('review email is queued before commit and enqueue failure rolls back the decision',async()=>{
 const {createReviewRepository}=await import('../server/booking-review.js');let committed=false,rolled=false,queued;
 const row={id:2,status:'PENDING',review_version:0,customer_email:'customer@example.test',customer_name:'Customer',service_name:'Diagnosis',duration_minutes:60};
 const db={beginTransaction:async()=>{},query:async()=>[[{id:1}]],execute:async(sql)=>sql.startsWith('SELECT b.')?[[row]]:[{insertId:1}],commit:async()=>{committed=true;},rollback:async()=>{rolled=true;},release:()=>{}};
 const repo=createReviewRepository({getConnection:async()=>db},{enforceAvailability:false,queueEmail:async(connection,event)=>{assert.equal(committed,false);queued=event;throw new Error('outbox unavailable');}});
 await assert.rejects(repo.act(2,{action:'decline',version:'0',note:'private decision'},1));assert.equal(rolled,true);assert.equal(committed,false);assert.equal(queued.type,'declined');assert.equal(queued.version,1);assert.doesNotMatch(JSON.stringify(queued),/private decision/);
});
