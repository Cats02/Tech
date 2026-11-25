# Everbright Digital

Existing public HTML/CSS/JavaScript website with an incremental Node.js/Express and MySQL backend. Phases 1–7 add secure administrator authentication, database-backed services/pricing, customer booking requests, manual approval, calendar views, availability and private customer management. Transactional email and final production hardening are subsequent phases. The public layout, assets, URLs, enquiry form and accessibility features are preserved.

## Requirements

- Node.js 22.21+ (or Node.js 24 LTS).
- MySQL 8+ or compatible MariaDB with InnoDB. Use the same database engine/version for integration testing and production.
- HTTPS and a verified proxy configuration for production.

## Local setup

1. Install dependencies with `npm ci` using the committed package-lock.json.
2. Copy `.env.example` to `.env`. Generate a random session secret using the command in that example. Enter database credentials locally; never commit this file or paste credentials into chat.
3. Create an empty application database and grant the application user access only to that database. Migrations need CREATE/ALTER/INDEX privileges; normal runtime only needs SELECT/INSERT/UPDATE/DELETE once deployment migrations are complete.
4. Run `npm run migrate`.
5. Run `npm run admin:create` in an interactive terminal. Enter email and a unique password of 15–128 characters at the hidden prompts. First-admin setup closes once an administrator exists. No default account, public registration, password-in-URL or password-in-command-line setup exists.
6. Run `npm start`, then visit the APP_ORIGIN URL and `/admin`.

Startup deliberately fails if required configuration, database access or authentication tables are missing. A database outage never enables a fallback administrator or an in-memory production store.

## Hostinger deployment

Configure this repository as a **Node.js/Express application**, not just static Git file deployment. Select Node.js 24 LTS, repository root as application root, `server/index.js` as entry file if requested, and `npm start` as the start command. There is no frontend compilation step.

Create a Hostinger MySQL database/user and set the real environment variables through hPanel. Use `NODE_ENV=production`, the exact HTTPS `APP_ORIGIN`, a new random SESSION_SECRET, and your database values. Hostinger documents 127.0.0.1 for its local MySQL connections; use the actual host provided by your account. For remote MySQL enable TLS with certificate verification. Do not set DB_SSL=true for a local server unless it supports it.

Set TRUST_PROXY_HOPS to the number of trusted reverse proxies actually used by your deployment (often 1, but verify with Hostinger). Do not blindly trust arbitrary forwarded headers. Secure admin cookies require the app to see HTTPS correctly. APP_ORIGIN has no trailing slash or path.

Before starting the app, run migrations in the deployment/SSH terminal, then run the interactive first-admin command. Ensure requests are routed to Node, with only `/assets`, the three allowlisted CSS/JS files, and public HTML served statically. Never expose the repository root through a parallel web-server file mapping: `.env`, `server/`, SQL migrations, lockfiles and source tests must not be web-accessible. Verify this after deployment. The Node application itself uses an explicit public-file allowlist.

Use a staging hostname first. Do not change the live domain until authentication, proxy settings, database integration tests, private-file access checks and backups are verified. Keep the existing CNAME file for now; it does not configure Hostinger's application runtime or DNS.

Connection guidance: https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/
Environment settings: https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/

## Security and operations

- Passwords use Node's salted scrypt (N=131072, r=8, p=1), with bounded hashing concurrency. No password is stored in plaintext.
- Every admin route except the login is protected by a server-side active-admin check. Future routes must be registered after that middleware.
- Sessions are stored in MySQL, have a four-hour lifetime, rotate on login, and are destroyed on logout. Production cookies use Secure, HttpOnly, SameSite=Strict and the __Host- prefix.
- Mutations require a session-bound CSRF token and reject foreign Origin headers. Logout is POST-only.
- Login throttling is shared in MySQL: 20 attempts/IP and 10 attempts/account per 15-minute window, including successful attempts. Keys are HMAC hashes. Configure the trusted proxy correctly so IP throttling is accurate.
- Admin pages have no analytics or third-party scripts, no-store caching and a restrictive CSP. Public analytics and Formspree are retained with explicit CSP sources and hashes of the existing inline analytics code.
- SQL uses bound parameters; dynamic content is escaped. Database failure fails closed. Logs omit passwords, request bodies, database details and session data.
- Expired sessions and rate-limit entries are cleaned periodically. Configure backups and test restoring them; database/session backups contain sensitive information and need restricted access.
- No password recovery UI or additional-user management is included in Phase 1. Loss of the only admin credentials requires an authorised server-side recovery procedure; never delete customer data to recover access.

## Checks

`npm test` runs HTTP/security tests with an isolated in-memory test session store only. It does not prove MySQL connectivity.

`npm run test:database` checks real migrations, session persistence and concurrent rate limiting. It intentionally requires `ALLOW_TEST_DATABASE=true` and DB_NAME ending `_test`; use a separate empty disposable database. Never run integration tests against the live customer database. It creates application tables and test rate-limit records.

Before production: run both suites, dependency auditing, mobile/keyboard checks and a live private-file/HTTPS/cookie check. A successful health endpoint only indicates the process is running, not a full database readiness check.

## Implementation sequence

1. Backend/MySQL migrations and secure admin authentication (implemented).
2. Editable services/pricing, historical prices and public rendering (implemented).
3. Pending-only booking requests and customer association (implemented).
4. Manual approval, proposals, decline/cancel/complete and history (implemented).
5. Calendar, weekly availability, blocked periods and transactional overlap prevention (implemented).
6. Customer management (implemented).
7. Durable transactional email outbox and delivery retries (implemented; five message types verified by the owner on staging).
8. Full security, accessibility, responsive and deployment verification.

Later MySQL scheduling will use a shared calendar lock row and database transactions for both acceptance and blocked-period updates; an unchecked query followed by an insert cannot safely prevent concurrent overlaps. UTC times will display using Australia/Adelaide. Current public content, pricing and enquiry functionality remain as-is until their respective phases.

## Phase 2 deployment and service management

Before pushing Phase 2 to the auto-deployed staging branch, run migrations against its database. Alternatively, import `server/migrations/002-services.sql` using phpMyAdmin (the same import method used for Phase 1). It creates services/price_history and seeds 17 existing services without overwriting services on repeat import. Run `npm run migrate` from a configured SSH shell later to register/check migration history; the initial manual imports are idempotent. Never edit a migration already registered in schema_migrations.

Deploy only after tables exist. Phase 2 startup checks require them. Public `/`, `/index.html`, `/website-development.html` and `/cad-3d-printing.html` are rendered from the database. Hard-coded markup inside clearly marked pricing blocks remains as a static-source reference for the original design; Node replaces it on every request. Database failures return an error rather than displaying outdated prices. The original generic service-category information remains static content.

Sign in and select **Services & Pricing**. Add/edit services, short/full plain-text descriptions, homepage notes, category, amount/type/unit, booking duration, appointment types, visibility and display order. Support services can appear in the homepage pricing list; web/CAD services also appear on their respective specialist pages. The homepage note is a separate optional field so existing travel/diagnosis policies are retained. Existing homepage label variants are preserved until the service name is edited. One-Page Website pricing is shared with the homepage Website Development entry.

Prices use integer AUD cents. From + hourly unit preserves existing “From $70 per hour” pricing. Request a Quote has no amount. Price/type/unit changes and their administrator are recorded atomically with the edit, displayed in Adelaide time. Older forms receive HTTP 409 rather than overwriting changes. No delete action exists, so services can be hidden without erasing history.

Seeded services start with online booking disabled, no appointment types, and a provisional 60-minute duration. Review these values before enabling booking when Phase 3 is available. Enabling this field in Phase 2 does not create a public booking form yet.

Phase 2 verification: `npm test` covers validation, price formatting, escaping, public rendering, protected edits, CSRF, price-history rendering, stale forms and authentication. `npm run test:database` additionally exercises real service persistence, audit writes and concurrent edits, and still requires a disposable `_test` database. Browser checks should include all public pages and the editor at mobile widths, larger text settings and keyboard operation.

## Phase 3 deployment and booking requests

Before pushing Phase 3 to the auto-deployed branch, import `server/migrations/003-booking-requests.sql` into the same staging database using phpMyAdmin, or run `npm run migrate` in a configured SSH shell. This creates customers/bookings without altering existing admin/services records. No new environment variables or dependencies are required. Startup requires the new tables. A successful manual SQL import verifies table creation, but does not replace testing the application submission and review paths.

After deployment, edit an appropriate service in Services & Pricing: review its duration, select allowed appointment types and enable online booking. Services must be visible, booking-enabled and have at least one valid appointment type to appear at `/book`. Seeded services remain booking-disabled until you do this. Existing public navigation and homepage gain Book an Appointment links. The existing Formspree enquiry form still works separately.

Customers first choose a service, then enter details and preferences. This two-step form works without JavaScript, shows only that service's appointment types and avoids putting personal details into URLs. On-site requests require a service address/suburb. Dates use Australia/Adelaide time and must be future dates within one year. DST gaps and repeated wall times are rejected. Both date and time are required for an optional second preference.

Every submitted request is PENDING, regardless of extra client-supplied status/price fields. A transaction associates customers by normalised email plus phone, stores a service/price/duration snapshot, and records the accepted booking-terms version. Australian mobile numbers in 04… and +614… forms normalise to the same number. Existing customer profile details are not blindly overwritten: each booking separately retains the submitted name/contact/address. Repeated submissions of the same issued form key return the same request rather than inserting duplicates. Initial keys are bound to the session and expire with it.

The receipt page is generic and contains no customer data or public booking lookup ID. Customer and booking data can only be viewed under authenticated `/admin/bookings` routes. Dashboard links show the pending request count. This phase includes read-only admin review; ACCEPT, propose-time and other status actions arrive in Phase 4. Calendar/availability enforcement arrives in Phase 5: the current form collects explicitly labelled preferences, not available or reserved slots. Do not advertise automatic confirmation.

Form POSTs require CSRF and same-origin checks, plus session-bound submission keys. Shared MySQL rate limits cover GETs and POSTs by IP, and valid submissions by normalised contact. A honeypot catches basic spam. Database errors never display a successful receipt. Public booking forms and admin pages have no third-party analytics scripts. The existing privacy page now describes the booking database; booking terms are at `/booking-terms`. Mail delivery is not implemented until Phase 7; the receipt clearly says no confirmation email is sent at this stage. Operators should check the admin queue and contact customers using the existing business communication channels.

Verification: `npm test` covers timezones, validation, allowed services/types, consent, on-site addresses, XSS escaping, CSRF, private records, retry handling, rate limits and rollback on failed storage. `npm run test:database` additionally verifies real booking persistence, customer deduplication, snapshots and idempotency in a disposable `_test` database. Check a genuine test request in staging before accepting customer use; do not submit real customer data to disposable tests.

## Phase 4 deployment and booking decisions

Import `server/migrations/004-booking-review.sql` into the same staging database BEFORE pushing this phase to `spare`, or apply it with `npm run migrate` in a configured SSH shell. It creates the calendar lock, reservation, review-version and decision-history tables without changing existing bookings or customer records. Startup requires these tables and the calendar lock row. No new dependencies or environment variables are needed.

Open a request under Admin → Bookings. PENDING requests offer Accept, Suggest Different Time, Decline and Cancel Booking. Accept can use the preferred time, second preference, latest proposal or a custom Adelaide date/time. The duration comes from the immutable booking snapshot, not the browser or current service settings. Acceptance requires a future time and reserves its entire duration. A proposal keeps the request PENDING, does not reserve time and must be discussed with the customer. Decline supports an optional note. CONFIRMED appointments offer cancellation or completion; completion is allowed only after the scheduled end. Closed requests retain their audit trail and cannot be reopened through these controls.

All decisions require authentication, CSRF and a current review version. Replaying an old form returns a conflict. Status, reservation and audit writes commit together. Scheduling decisions take `calendar_lock` row 1 before reading/updating appointments, use locking overlap reads, and reject intervals overlapping other reservations or confirmed appointments. Adjacent intervals are allowed. Cancellation releases the reservation while preserving the appointment and history. Completion retains its historical reservation. Pending conflicts consider both preferred and second-choice intervals and are explicitly labelled in the review panel. Pending requests never silently reserve capacity or confirm one another.

Every future scheduling writer (especially blocked periods and availability changes) MUST acquire the same calendar lock before changing reservations. This transaction discipline prevents concurrent confirmations from both winning; it is not a native MySQL exclusion constraint and must not be bypassed by direct scheduling writes. Calendar month/week UI, working hours and block-management screens are Phase 5. Phase 4 reserves appointments in the calendar data model but does not yet offer these screens.

The dashboard now counts pending requests, confirmed upcoming appointments, today's confirmed appointments in Adelaide, and appointments completed in the last seven days. Admin notes and decision history are private. No transactional email is sent yet: the success message tells the operator to contact the customer directly. Configure email delivery in Phase 7 before relying on automated notifications.

`npm test` checks allowed transitions, proposal semantics, saved durations, completion timing, stale forms, scheduling-lock use, overlap rejection, rollback, escaping, authentication and CSRF. The optional disposable-MySQL suite additionally races two approvals for the same interval and checks that exactly one wins, then checks cancellation releases capacity. It is NOT run against the staging or production customer database. After deployment use a test booking to verify a proposal remains PENDING, accepting reserves the chosen time, a conflicting acceptance is rejected, and cancellation records history and frees capacity.

## Phase 5 deployment, calendar and availability

Import `server/migrations/005-calendar-availability.sql` into the same staging database BEFORE pushing Phase 5, or run `npm run migrate`. New tables store weekly hours and an optimistic settings version. No credentials or packages change. **All seven days initially have bookings disabled. After deployment open Settings and enable your actual business days and opening/closing times. Until then, public booking forms show no available times and new approvals cannot be scheduled.** Existing bookings are retained.

Admin Calendar offers month/week date ranges, previous/next/today navigation, booking detail links, status text, proposed pending times and blocked intervals. It is a responsive day-card calendar rather than a drag-and-drop scheduler. Cancelled/completed entries retain their historical times. Pending requests and proposals appear but never reserve capacity. All dates use Australia/Adelaide and correctly span daylight-saving days.

Settings controls each weekday, opening and closing times, plus labelled multi-day blocked periods. Hours are same-day intervals (no overnight opening periods). Start must precede end even when the day is disabled. Changes that would exclude an existing future/ongoing confirmed appointment are rejected: first resolve that appointment. Blocks may span up to a year, must end in the future, and cannot overlap confirmed appointments or existing blocks. Removing a block never deletes bookings. Settings use the shared scheduling lock and version checks; stale forms receive a conflict rather than overwriting newer changes.

The public booking form now asks customers to choose service and dates first, then select server-generated available times. This works without JavaScript. Changing dates reloads the form, so customers should do this before entering personal details. Times are offered every 15 minutes from opening; the full service duration must fit inside business hours and outside reservations/blocks. A second date/time is optional. Invalid, closed, past or fully occupied days offer no slots. Slot responses reveal no customer details or block labels.

Public submissions acquire the same database scheduling lock as approvals/settings, then recheck both preferences against current hours and reservations before creating a PENDING request. Manually crafted times must align with the offered 15-minute grid. Accept/propose also recheck hours and reservations using the saved duration (administrators can choose any minute inside hours). A slot may disappear between viewing and submitting; the customer then receives an availability conflict and refreshed choices. Pending requests do not remove a slot, so competing requests still receive explicit conflict warnings for manual review.

`npm test` covers slot boundaries/durations, closed days, reservation/block exclusion, adjacent intervals, DST/month/week ranges, guarded scheduling writes, settings conflicts, escaped calendar text, public choice-only controls, authentication and CSRF. The disposable MySQL suite enables test availability for its fixtures; NEVER point that suite at your real business database. Before live use, verify configured hours, a blocked period, a confirmed appointment and the public available-time dropdown on staging.

## Phase 6 deployment and customer records

Before pushing this phase to `spare`, import `server/migrations/006-customer-profiles.sql` into the staging database, or apply migrations through the configured SSH environment. It adds a version table for customer edits; existing customer data, private notes and booking history are retained. No credentials, environment settings or dependencies change. Startup requires the new table.

Admin → Customers lists customers created by booking requests. Search name, email, phone or address; results are paginated at 25 records. Search wildcards are treated as literal text and queries use bound parameters. Australian 04… phone searches also match canonical 614… numbers. Search text is carried in the private admin URL: hosting access logs/browser history may retain that URL, so use the shortest necessary search and restrict access to hosting logs.

Open a customer to edit their name, email, phone, address/suburb and private notes, or follow links to their bookings. Current/future confirmed appointments appear separately from previous bookings and pending requests. History is paginated at 25 records; up to 100 upcoming confirmed appointments are shown. Booking detail pages link back to the associated customer profile.

Profile edits never rewrite the name, contact details, address, service or price snapshots stored on past bookings. A repeated booking still uses normalised email+phone to associate customers. Changing profile contact details changes that matching key for later requests; requests using former details may need manual review. Profiles are not automatically merged by name/email alone. Saving contact details that collide with another existing email+phone pair returns a conflict and does not merge, delete or move either record. No customer-delete or merge operation is provided in this phase.

All customer routes are behind the existing active-admin middleware, return no-store responses, and reject unprotected POSTs. Version checks reject stale profile edits. Private notes are escaped as plain text and never returned by public routes. Avoid storing passwords, payment data or unnecessary sensitive information in notes. Existing privacy/retention obligations still apply; configure database backups and protect hosting access separately.

`npm test` covers profile validation/normalisation, search escaping/pagination, stale/duplicate edits, preserved booking prices, private-note escaping and auth/CSRF. The optional disposable MySQL suite adds real profile saves/searches/version checks and verifies a historical booking's customer snapshot does not change. Before live use, edit a test customer's note in staging, reopen the profile to verify persistence, and verify their booking history links.


## Phase 7: Gmail notifications

Import server/migrations/007-email-outbox.sql into the staging database BEFORE pushing spare. Startup now requires email_outbox. No old bookings are emailed retroactively. MAIL_MODE defaults to off: new events are HELD until individually released by an admin. Never put credentials in Git or chat.

Customer messages cover request received (not confirmed), confirmation, alternative time proposal (not reserved), decline and cancellation. Immutable contact snapshots are used. Completion sends no email. Private profile notes, decision notes, descriptions, phone numbers and addresses are excluded. The outbox insert shares the booking transaction, so a failed database enqueue rolls the change back; SMTP failure never rolls a saved booking back.

Configure Hostinger environment variables: MAIL_MODE=test, SMTP_HOST=smtp.gmail.com, SMTP_PORT=465 (or 587 with required STARTTLS), SMTP_USER=your full Gmail/Workspace address, MAIL_FROM=the exact same address, SMTP_PASSWORD=a Google app password, MAIL_TEST_RECIPIENT=an address you control. Restart/redeploy after changes. Account passwords are not supported. Google requires 2-Step Verification for app passwords; organization policy may disable them. See [Google setup](https://support.google.com/mail/answer/7104828) and [Nodemailer Gmail guidance](https://nodemailer.com/guides/using-gmail). If app passwords are unavailable, stop and arrange a supported provider/authentication method; do not weaken account security.

Test mode replaces every recipient with MAIL_TEST_RECIPIENT and prefixes subjects [TEST]. Submit a test booking, then inspect Admin → Emails and the test inbox/spam folder. Test each decision with suitable test bookings. Check Adelaide times and that private notes never appear. SENT means Gmail accepted the message, not that the inbox received it. Only after successful staging tests set MAIL_MODE=live and redeploy. Pending messages use the CURRENT mode at send time: finish test queues before changing to live. Held/failed messages require individual Release / Retry Email; obsolete status/version messages become SKIPPED.

The web process polls every 30 seconds, five messages per pass, protected by a database named lock across instances. Up to five attempts use increasing delays. Errors shown in admin are generic and omit SMTP responses/credentials. Hosting may suspend an idle application: use the mail:work command in a separately configured scheduled job for reliable idle processing. SSH/cron does not inherit hPanel variables; configure its protected environment independently, never under public_html or in Git. Worker needs database credentials and the same email settings; do not print them. Queue delivery is at least once: a crash after SMTP acceptance but before recording SENT can cause a duplicate, despite stable Message-ID values. A decision made while a send is in flight cannot recall that message; the subsequent decision is queued separately.

Local tests use fake SMTP and database fixtures. Real MySQL migration/transaction checks and Gmail delivery remain staging validation steps; no real email was sent during local tests. Gmail has account limits and may block hosting sign-ins; inspect the queue and Google account security if SMTP fails, without exposing passwords.


## Phase 8 verification and launch gate

Local review updated Nodemailer to the patched version recorded in package-lock.json. The full npm audit returned zero known vulnerabilities at review time. This is a point-in-time dependency check, not a guarantee of security. The 38 automated tests pass, including Hostinger require compatibility, authentication, CSRF, transactions with test doubles, and email retries. Anonymous staging checks verified admin redirects/no-store and private-file blocking. Browser fixtures verified booking/review/calendar/customer/email layouts at five widths (320–1440px) with text enlarged to 140%. Admin/booking headers now scroll normally so headings and focused fields remain visible; the skip link has a focusable main destination.

These checks do not substitute for a real MySQL integration run or assistive-technology testing. Before production, complete the steps in LAUNCH-CHECKLIST.md. Keep MAIL_MODE=test and preserve the main branch/live domain until those steps and the owner’s launch decision. No new SQL migration is needed for the phase 8 dependency/header changes.


## Admin presentation refresh

Shared private screens use a compact branded header, desktop sidebar with active section, wrapping mobile navigation, consistent forms and booking status labels. The dashboard shows live repository summary counts and management shortcuts. Unavailable summary counts are shown as an em dash rather than invented data. Authentication, CSRF checks, routes and database writes are unchanged. No migration is required. Verified the 38-test suite and local workflow/browser fixtures at five widths with 140% text. Stage on spare before reviewing the new appearance.


## Customer profile deletion

Import 008-customer-deletion.sql before deploying this change. It makes bookings.customer_id nullable without removing existing links or booking records. Admin → Customers → customer record → Delete Customer opens a separate confirmation page, requires a checkbox and CSRF-protected POST, and checks the customer version in a transaction. The shared calendar lock serializes deletion with booking submissions. Deletion unlinks bookings, deletes customer_versions, then deletes the customer profile/private notes; failures roll back. Booking/contact snapshots, reservations, event history and email records remain. This is profile deletion, not complete personal-data erasure or appointment cancellation. A new request can create a new profile for the same contact. Restore from an approved backup is the only recovery for deleted notes. Local transaction tests use mocks; MySQL migration/restore checks remain separate staging work.
