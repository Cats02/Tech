# Everbright Digital

Existing public HTML/CSS/JavaScript website with an incremental Node.js/Express and MySQL backend. Phase 1 adds secure administrator authentication only. Services/pricing, booking requests, calendar, customer records and email are subsequent phases; the public website remains unchanged.

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

1. Backend/MySQL migrations and secure admin authentication (current).
2. Editable services/pricing, historical prices and public rendering.
3. Pending-only booking requests and customer association.
4. Manual approval, proposals, decline/cancel/complete and history.
5. Calendar, weekly availability, blocked periods and transactional overlap prevention.
6. Customer management.
7. Durable transactional email outbox and delivery retries.
8. Full security, accessibility, responsive and deployment verification.

Later MySQL scheduling will use a shared calendar lock row and database transactions for both acceptance and blocked-period updates; an unchecked query followed by an insert cannot safely prevent concurrent overlaps. UTC times will display using Australia/Adelaide. Current public content, pricing and enquiry functionality remain as-is until their respective phases.
