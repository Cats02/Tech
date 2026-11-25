# Everbright launch checklist

Keep staging on spare and MAIL_MODE=test until launch is approved. Leave everbrightdigital.net and main unchanged.

## Verified so far

- Owner tested receipt, confirmation, proposal, decline and cancellation emails on staging.
- Automated application checks: 38 passing. Database behaviour in these tests uses test doubles.
- Dependency audit: no known vulnerabilities after updating Nodemailer.
- Staging anonymous admin access redirects to login; private environment, source, Git and migration files are blocked.
- Local browser workflows: request/review/calendar/customer/email screens fit five widths with 140% text. Header and skip-link fixes are prepared locally and require deployment.

## Still required before launch

- Commit/push phase 8 changes to spare, wait for Hostinger Completed, and test a fresh branded email with the updated library.
- Confirm the heading stays visible when scrolling admin/booking pages. Test keyboard-only form navigation, error recovery, reduced motion and preferred accessibility palettes. A screen-reader review remains required; browser layout checks do not establish WCAG compliance.
- Export an encrypted/restricted database backup and retain the deployment version. Restore into a separate disposable database and verify bookings, history, services and administrator sign-in there. Never test restoration over staging or live data.
- Run npm run test:database against a separate empty disposable database ending _test, with ALLOW_TEST_DATABASE=true. Never use the customer database. Document the result; this has not been run locally.
- Configure and test a mail worker schedule with a protected environment, or verify the hosting process remains active while idle. Confirm a pending retry is eventually processed without someone browsing the site. Do not assume an in-process timer provides reliable idle delivery.
- Review business hours, durations, prices, contact address and appointment types. Close test appointments so they do not reserve real availability. Retain history rather than deleting records blindly.
- Review Google account sending limits, reply inbox monitoring and the privacy notice. Check email content/times on the actual recipient device; browser previews cannot prove Gmail rendering.
- Review pending/held/failed email entries before changing delivery mode. Messages use the mode active at send time. Do not switch test records to live recipients accidentally.
- Record the intended production origin, proxy setting, database, TLS, stable session secret and mail settings. Store secrets in Hostinger, never Git/chat. Revoke unused Google app passwords.
- Obtain the owner’s explicit launch decision before changing domain routing, deploying to main or enabling live customer delivery. Have the previous deployment and database backup available for recovery.

## After approved launch

Verify the public site, login, request submission, one agreed real notification, calendar conflict prevention and customer history. Monitor private runtime/error logs and email failures. SENT means SMTP accepted; it does not guarantee inbox delivery. Never restore a database backup over newer customer transactions without a recovery plan.
