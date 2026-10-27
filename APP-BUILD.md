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

## Sign in with Google – one-time Firebase setup

The **Sign in with Google** button is built in, but Google only accepts it after these steps in the
[Firebase console](https://console.firebase.google.com/) for the **rentpro-saas** project.

**Who can use it:** only the Google accounts listed in `GOOGLE_ALLOWED_EMAILS` in `js/dev-auth.js`
(currently `ken05462@gmail.com` and `nancyngari2@gmail.com`). Any other Google account is signed straight back out with a message.
To allow another person, add their address to that list, then deploy the website and rebuild the APK.

### Website (laptop / phone browser)

1. **Authentication → Sign-in method → Add new provider → Google → Enable**. Pick a support email, then **Save**.
2. **Authentication → Settings → Authorized domains → Add domain**: add the website's address,
   for example `ktonysites.github.io` (and any custom domain). `localhost` is already on the list.

### Android app (APK)

Google blocks its sign-in page inside apps, so the app uses Android's own Google sign-in. That needs the app
registered in Firebase:

1. **Project settings (gear) → General → Your apps → Add app → Android**.
   - Android package name: `com.rentpro.app`
   - App nickname: `RentPro Android`
   - Debug signing certificate SHA-1: `B3:64:AF:E5:C6:CF:5A:1D:F8:5D:26:A8:86:13:0C:41:DE:6A:EE:74`
2. Click **Register app**, then on the same app card **Add fingerprint** and also add the SHA-256:
   `32:78:74:1A:84:D8:AD:61:2F:F8:74:82:10:DA:11:69:E0:E3:3D:14:8B:20:F0:3B:AD:13:BB:D9:71:B6:4C:AB`
3. **Download `google-services.json`** (download it *after* adding the fingerprints) and save it as
   `android/app/google-services.json`.
4. Rebuild and reinstall: `npm run android:apk`, then install the new `dist/RentPro.apk`.

Until `google-services.json` is in place, tapping the Google button in the app shows
"Google sign-in isn't set up in this app yet" and email/password keeps working.

> The fingerprints above belong to this PC's debug signing key (`~/.android/debug.keystore`). If you build the
> APK on another computer, or switch to a release key for the Play Store, add that key's SHA-1/SHA-256 in
> Firebase too (`keytool -list -v -keystore <keystore> -alias <alias>`).

## Notes

- **Sign-in:** the APK uses the same Firebase account as the website. The local test login (`dev@rentpro.local`)
  only works on the `http://localhost` dev server and is switched off inside the app.
- **CSV / PDF exports** download files in a browser. Inside the APK, Android's web view does not save downloads,
  so use the website on a laptop for exports.
- **Play Store:** publishing there would need a release signing key (`node tools/build-apk.cjs --release` after
  configuring signing in Android Studio) and a Google Play developer account.
