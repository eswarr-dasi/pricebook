# Packaging Tare

The app is a PWA. Both stores need it wrapped, and both wrappers point at a
**live HTTPS URL** rather than bundling the files. So the first step is not a
build tool, it is a permanent address.

## 0. Host it (blocks everything else)

The trycloudflare tunnel is temporary; its address changes every restart, and
Android's ownership check is tied to the domain. Put the folder on any static
host with HTTPS:

- GitHub Pages, Netlify, Cloudflare Pages - all free, no build step
- Upload the whole directory as-is

Confirm afterwards that these are reachable on the real domain:
  /manifest.webmanifest
  /sw.js
  /.well-known/assetlinks.json

## Android (Google Play)

Play takes an **AAB**, not an APK. APKs are only for sideloading.

Needed, and not currently on this machine:
  - Node.js            (Bubblewrap is a Node CLI)   brew install node
  - Android SDK        (Bubblewrap offers to fetch it)
  - JDK 17             ALREADY INSTALLED (Temurin 17.0.9)
  - Play Console       25 USD, one time

    npx @bubblewrap/cli init --manifest https://YOUR-DOMAIN/manifest.webmanifest
    npx @bubblewrap/cli build

`init` creates a signing keystore. Print its fingerprint:

    keytool -list -v -keystore android.keystore -alias android \
      | grep SHA256

Put that fingerprint and your package id into `.well-known/assetlinks.json`,
redeploy, and only then `build`. If the fingerprint does not match, the app
still installs but opens with a browser address bar across the top, which is
the single most common TWA mistake.

`build` produces `app-release-bundle.aab` (upload this) and
`app-release-signed.apk` (sideloading only).

## iPhone (App Store)

A PWA cannot be submitted directly. It needs a native shell around a WKWebView.

Needed, and not currently on this machine:
  - Full Xcode         (Command Line Tools only right now; Xcode is a ~7 GB
                        install from the Mac App Store)
  - Node.js            for the Capacitor CLI
  - CocoaPods          sudo gem install cocoapods
  - Apple Developer    99 USD per year

    npm i @capacitor/core @capacitor/cli
    npx cap init Tare com.yourname.tare --web-dir=.
    npx cap add ios
    npx cap open ios          # then Product > Archive in Xcode

Two things the review will look at:

  - **Guideline 4.2, minimum functionality.** Apple rejects apps that are a
    website in a shell. Tare's case is the offline database, the camera
    scanning, and the on-device barcode decoder in src/ean.js - lead with
    those, not with the web app.
  - **Camera permission.** Info.plist needs NSCameraUsageDescription with a
    real sentence, and App Store Connect needs a privacy policy URL.

## Both stores

  - Privacy policy URL is required because the app asks for the camera.
    The honest version is short: nothing is collected, nothing is transmitted,
    everything is in IndexedDB on the device.
  - Store listing screenshots are in store/screenshots (1080x1920, within
    Play's 320-3840 limit).
  - App icon for the listings: icons/icon-512.png.
