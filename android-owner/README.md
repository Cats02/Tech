# Everbright Owner for Android

An Android owner client for https://everbrightdigital.net, with native navigation and secure embedded access to the existing private admin workspace. This is an Android APK/AAB project, not a PWA. Booking/customer screens currently use the website in a hardened WebView; they are not separately rewritten native data screens. There is no second database or duplicated password system.

## Included

- Native branded header, Home/Bookings/Calendar/Customers tabs, More menu for services, hours, emails and sign-out.
- Existing server-side administrator authentication, CSRF protection and sessions. No credentials or database secrets are embedded in the app.
- Refresh confirmation, native connection-error/retry view and Android Back navigation.
- Screen-capture/recent-app preview protection. If an Android device screen lock exists, device-credential confirmation on launch and after more than 30 seconds in the background. This does not replace the server login.
- Only exact HTTPS everbrightdigital.net content is loaded inside the app. Other links require a user-confirmed handoff. No JavaScript-to-Java bridge, file/content access, mixed HTTP, third-party cookies or web debugging.
- Android 8+ support; target/compile API 36. No camera, contacts, location or storage permission. Internet is required.

## Build

Open this folder in Android Studio with JDK 17, Android SDK platform 36 and build tools 35.0.0. Alternatively run ./gradlew testDebugUnitTest lintDebug assembleDebug bundleRelease (gradlew.bat on Windows). Gradle 8.13 is checksum-verified by the wrapper. Install required SDK packages through Android Studio/SDK Manager and accept the SDK terms as appropriate.

Debug APK: app/build/outputs/apk/debug/app-debug.apk. It uses package net.everbrightdigital.owner.test and is for device testing. The release application ID is net.everbrightdigital.owner; confirm it before the first Play upload because that identity becomes permanent.

Release bundle: app/build/outputs/bundle/release/app-release.aab. This output is unsigned until an owner-controlled upload key is configured. Do not upload the unsigned bundle or a debug APK to Google Play. Use Android Studio Generate Signed Bundle to create a signed AAB, retain the upload key securely and enroll in Play App Signing. Never commit signing keys/passwords. No release credentials are created by this project.

## Verify on your Android phone before release

1. Launch and verify screen-lock prompt (when the phone has a PIN/password configured), branded shell, login and session expiry.
2. Sign in with your existing owner credentials. Check all tabs, month/day navigation, customer editing and admin workflows. The app connects to LIVE data: use your own clearly marked test requests; email behaviour follows the website MAIL_MODE setting.
3. Check font enlargement, keyboard scrolling, rotation and Android Back. Test loss of internet, retry and return after 30 seconds away.
4. Sign out, then verify Android Back does not reveal a private page and customer routes require sign-in.
5. Verify phone/mail links ask before opening another app. Downloads currently direct the owner to the browser; no native file upload/download feature is supplied.

Local compilation, lint and unit checks do not prove behaviour on a physical Android device. There is no offline booking sync, push notification service, native biometric library or in-app customer account registration in this first version. Existing server changes appear in the embedded workspace without an Android release; changes to native navigation/security require a new app build.

## Google Play preparation

Create and verify your Play Console account, establish internal testing and add your Google account as a tester. Supply an accurate privacy policy and Data safety answers based on the website's actual customer-data and Google email processing. Give reviewers approved test-access instructions through Play Console without putting passwords in this repository. Complete store branding/content ratings and any required verification/testing. This repository is not a submission or guarantee of Play approval; all WebView, functionality, privacy and account policies still apply.

If public customer booking is planned later, keep the owner-only admin permissions enforced on the server. Do not put business/customer records into public app resources.
