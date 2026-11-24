export function escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
export function layout(title, content) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex,nofollow"><title>${escape(title)} | Everbright Digital</title>
        <link rel="icon" href="/assets/everbright-digital-favicon.png">
        <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/admin.css"></head>
        <body class="admin-page"><header class="site-header"><div class="container navbar">
        <a href="/" class="logo" aria-label="Everbright Digital home"><img class="brand-logo" src="/assets/everbright-digital-header-logo.png" alt="Everbright Digital"></a>
        <a href="#admin-content">Skip to content</a></div></header>
        <main id="admin-content" class="container admin-content"><h1>${escape(title)}</h1>${content}</main>
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
    return layout('Dashboard', `<div class="admin-card"><p>Signed in as ${escape(admin.email)}.</p>
        <p><a class="button button-primary" href="/admin/services">Services &amp; Pricing</a></p>
        <p><a class="button button-secondary" href="/admin/bookings">Bookings — ${escape(pending)} PENDING</a></p>
        <p>Booking requests require manual review. Open Bookings to review requests and contact the customer to arrange an appointment.</p>
        <form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${escape(csrf)}">
        <button class="button button-secondary" type="submit">Log Out</button></form></div>`);
}
