const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Australia/Adelaide',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23' });
export function adelaideLocal(date) {
    const p=Object.fromEntries(parts.formatToParts(date).map(v=>[v.type,v.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Enumerate both Adelaide offsets and verify the wall time. Reject DST gaps
// and repeated times instead of silently moving a customer's appointment.
export function parseAdelaide(date,time) {
    if(typeof date!=='string'||typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return null;
    const local=`${date}T${time}`;
    const utc=Date.parse(`${local}:00Z`);
    if(!Number.isFinite(utc))return null;
    const candidates=[570,630].map(offset=>new Date(utc-offset*60000)).filter(d=>adelaideLocal(d)===local);
    return candidates.length===1?candidates[0]:null;
}
export const displayBookingTime = date => new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Adelaide',dateStyle:'medium',timeStyle:'short'}).format(new Date(date))+' (Adelaide)';
