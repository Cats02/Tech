export function bookingReference(id) {
    const digits=String(id);
    if(!/^[1-9]\d*$/.test(digits))return '—';
    return digits.padStart(3,'0');
}
export function escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
export function workspaceNav(csrf) {
    return `<nav class="admin-nav" aria-label="Admin navigation"><a href="/admin">Dashboard</a><a href="/admin/bookings">Bookings</a><a href="/admin/calendar">Calendar</a><a href="/admin/services">Services &amp; Pricing</a><a href="/admin/customers">Customers</a><a href="/admin/settings">Settings</a><a href="/admin/emails">Emails</a><form action="/admin/logout" method="post"><input type="hidden" name="_csrf" value="${escape(csrf)}"><button type="submit">Log Out</button></form></nav>`;
}
export function layout(title, content) {
    const nav=content.match(/<nav class="admin-nav" aria-label="Admin navigation">[\s\S]*?<\/nav>/)?.[0];
    const section=/Booking/.test(title)?'bookings':/Service/.test(title)?'services':/Customer/.test(title)?'customers':title==='Calendar'?'calendar':title==='Settings'?'settings':title==='Email Notifications'?'emails':'';
    const active='/admin'+(section?'/'+section:'');
    const navigation=nav?.replace(`href="${active}"`,`href="${active}" aria-current="page"`);
    if(nav)content=content.replace(nav,'');
    const descriptions={Dashboard:'Your business at a glance.',Bookings:'Review requests and keep appointments moving.',Calendar:'Plan your week with a clear view of availability.',Settings:'Manage business hours and time away.','Services & Pricing':'Keep your service catalogue and prices up to date.',Customers:'Find customer details and follow their booking history.','Email Notifications':'Track booking messages and delivery status.'};

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex,nofollow"><title>${escape(title)} | Everbright Digital</title>
        <link rel="icon" href="/assets/everbright-digital-favicon.png">
        <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/admin.css"></head>
        <body class="admin-page${nav?' admin-workspace':title==='Admin Login'?' admin-login':''}"><header class="site-header"><div class="container navbar">
        <a href="/" class="logo" aria-label="Everbright Digital home"><img class="brand-logo" src="/assets/everbright-digital-header-logo.png" alt="Everbright Digital"></a>
        ${nav?'<div class="admin-brand-context"><span>EVERBRIGHT DIGITAL</span><strong>Business workspace</strong></div>':''}<a href="#admin-content" class="admin-skip">Skip to content</a></div></header>
        <div class="${nav?'admin-shell':'admin-public-shell'}">${nav?`<aside class="admin-sidebar"><p class="admin-sidebar-label">MANAGE YOUR BUSINESS</p>${navigation}<p class="admin-sidebar-note">Appointment times<br>Australia / Adelaide</p></aside>`:''}<main id="admin-content" tabindex="-1" class="container admin-content"><div class="admin-page-heading"><p class="admin-eyebrow">${nav?'WORKSPACE':'EVERBRIGHT DIGITAL'}</p><h1>${escape(title)}</h1>${descriptions[title]?`<p class="admin-page-description">${descriptions[title]}</p>`:''}</div>${content}</main></div>
        <script src="/script.js" defer></script></body></html>`;
}
export function loginPage(csrf, message = '') {
    return layout('Admin Login', `<form method="post" action="/admin/login" class="admin-card">
        ${message ? `<p role="alert">${escape(message)}</p>` : ''}
        <input type="hidden" name="_csrf" value="${escape(csrf)}">
        <label for="admin-email">Email</label><input id="admin-email" name="email" type="email" autocomplete="username" required maxlength="254">
        <label for="admin-password">Password</label><input id="admin-password" name="password" type="password" autocomplete="current-password" required maxlength="128">
        <button class="button button-primary" type="submit">Log In</button></form>`);
}
export function dashboardPage(admin, csrf, pending=0) {
    const summary=typeof pending==='object'?pending:null;
    const count=summary?summary.pending:pending;
    const metrics=[['Pending requests',count,'Awaiting your review'],["Today's appointments",summary?.today??'—','Confirmed · Adelaide time'],['Upcoming bookings',summary?.upcoming??'—','Confirmed appointments'],['Completed this week',summary?.completed??'—','Over the last 7 days']];
    return layout('Dashboard',`${workspaceNav(csrf)}<div class="admin-session"><span class="admin-session-dot" aria-hidden="true"></span>Signed in as <strong>${escape(admin.email)}</strong></div>
        <section class="admin-metrics" aria-label="Booking overview">${metrics.map(([label,value,note])=>`<article class="admin-metric"><h2>${label}</h2><p class="admin-metric-value">${escape(value)}</p><p>${note}</p></article>`).join('')}</section>
        <section class="admin-dashboard-grid"><article class="admin-card admin-priority"><p class="admin-eyebrow">BOOKING REQUESTS</p><h2>Ready for your review</h2><p>${Number(count)>0?`You have ${escape(count)} pending requests. Review the details and agree on a time with each customer.`:'You’re all caught up. New booking requests will appear here for your review.'}</p><a class="button button-primary" href="/admin/bookings">Bookings — ${escape(count)} PENDING</a></article>
        <article class="admin-card"><p class="admin-eyebrow">YOUR SCHEDULE</p><h2>Plan the days ahead</h2><p>Check appointments, review proposed times and manage your availability.</p><a class="button button-secondary" href="/admin/calendar">Open Calendar</a></article></section>
        <section class="admin-quick-section"><h2>Manage your business</h2><div class="admin-quick-links"><a href="/admin/services"><strong>Services &amp; Pricing</strong><span>Update your catalogue, prices and booking options</span></a><a href="/admin/customers"><strong>Customers</strong><span>Contact details, private notes and booking history</span></a><a href="/admin/settings"><strong>Availability Settings</strong><span>Business hours and blocked periods</span></a><a href="/admin/emails"><strong>Email Notifications</strong><span>Check delivery and review held messages</span></a></div></section>`);
}
