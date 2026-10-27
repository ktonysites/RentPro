# RentPro – Android App & Installable Web App

RentPro runs three ways, all using the same pages and the same Apps Script backend:

| Where | How |
|---|---|
| **Laptop / desktop** | Open the website. Wide screens get a sidebar layout. In Chrome or Edge you can also click **Install** (⊕ icon in the address bar) to open RentPro in its own window. |
| **Phone browser** | Open the website, then **⋮ → Add to Home screen / Install app**. |
| **Android app (APK)** | Install `dist/RentPro.apk` (see below). |

## Install the APK on a phone

1. Copy `dist/RentPro.apk` to the phone (WhatsApp to yourself, Google Drive, USB cable…).
2. Tap the file. When Android asks, allow **Install unknown apps** for the app you opened it from.
3. If Play Protect warns about an unknown developer, tap **More details → Install anyway**.
4. Open **RentPro** from the home screen and sign in with your normal RentPro email and password.

The APK is a debug-signed build for direct installation. It needs Android 7 or newer and only asks for internet access.

## Rebuild the APK after changing the website

The app carries its own copy of the pages, so **any change to the HTML/CSS/JS needs a rebuild** (changes to the
Apps Script backend do not).

```bash
npm install            # first time only
npm run android:apk    # copies the site into www/, syncs Android, builds dist/RentPro.apk
```

Requirements (already on this PC): Node.js, Android Studio (its bundled JDK is used automatically) and the Android SDK.
When you publish an update, bump `versionCode` / `versionName` in `android/app/build.gradle` so phones accept it as an upgrade.

Other commands:

```bash
npm run icons          # redraw the app icon, Android launcher icons and splash screen
npm run dev            # local preview with test data on http://localhost:5501
npm test               # backend tests
```

## Notes

- **Sign-in:** the APK uses the same Firebase account as the website. The local test login (`dev@rentpro.local`)
  only works on the `http://localhost` dev server and is switched off inside the app.
- **CSV / PDF exports** download files in a browser. Inside the APK, Android's web view does not save downloads,
  so use the website on a laptop for exports.
- **Play Store:** publishing there would need a release signing key (`node tools/build-apk.cjs --release` after
  configuring signing in Android Studio) and a Google Play developer account.
