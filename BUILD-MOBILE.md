# Suvakta mobile apps (Capacitor)

Suvakta runs as a native **WebView shell** around the live site (`https://suvakta.com`)
using [Capacitor](https://capacitorjs.com). The native apps are thin wrappers — ship a web
change by deploying the Worker as usual; the apps pick it up with no rebuild. Only rebuild
the native apps when the shell, icons, permissions, or Capacitor plugins change.

- Config: [`capacitor.config.ts`](capacitor.config.ts)
- Offline fallback page: [`mobile/www/index.html`](mobile/www/index.html)
- Native projects: `android/` (Gradle) and `ios/` (Xcode, Swift Package Manager)

---

## One-time: environment (this machine)

```bash
export JAVA_HOME="$HOME/android-toolchain/jdk21/jdk-21.0.12.1+1/Contents/Home"   # Capacitor 8 needs JDK 21
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
```

(Add these to `~/.zshrc` so every shell has them.)

---

## Android — build an installable APK (works today)

```bash
pnpm cap:sync                 # copy config + web assets into the native project
pnpm mobile:apk               # builds the debug APK
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a phone:
- **Easiest:** email/AirDrop/USB the `.apk` to the phone, tap it, allow "install from unknown
  sources" for your file manager.
- **Via cable:** `~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk`

The first time you use voice, Android asks for microphone permission — tap **Allow**.

### Release build for the Play Store (signed AAB)
1. Create a keystore (once):
   ```bash
   keytool -genkey -v -keystore suvakta-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias suvakta
   ```
   Keep `suvakta-release.jks` and its passwords safe — losing them means you can't update the app.
2. Add signing to `android/app/build.gradle` (`signingConfigs { release { ... } }`) or use Android Studio's **Build → Generate Signed Bundle / APK**.
3. Build the bundle Google Play wants:
   ```bash
   cd android && ./gradlew bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
   ```

---

## iOS — build / run (needs a Mac + Xcode, already installed here)

Capacitor 8 uses **Swift Package Manager**, so no CocoaPods needed.

```bash
pnpm cap:sync
pnpm cap:ios          # opens ios/App in Xcode
```

In Xcode:
- Pick a **Simulator** → ▶ Run — works with no Apple account (for testing only).
- To run on a **real iPhone** or ship to TestFlight/App Store you need an **Apple Developer
  account ($99/yr)**: set your Team under *Signing & Capabilities*, then Product → Archive →
  Distribute.

Microphone permission string is already set in `ios/App/App/Info.plist`.

---

## Updating the apps after a web change
Usually **nothing** — the shell loads the live site. Rebuild only when you change
`capacitor.config.ts`, native permissions, icons/splash, or plugins. Then:
```bash
pnpm cap:sync && pnpm mobile:apk     # Android
pnpm cap:sync && pnpm cap:ios        # iOS (then Archive in Xcode)
```

---

## App Store review notes (important)
A pure WebView wrapper can hit Apple's **Guideline 4.2 (minimum functionality)**. To pass:
- The app already behaves app-like (splash, status bar, native mic permission, offline page).
- In review notes, describe it as the companion app for Suvakta account holders and give a
  **test login**. Emphasise the voice feature (uses the device mic) and offline handling.
- If rejected, the next step is to add a few native touches (push notifications via
  `@capacitor/push-notifications`, native share) — the plugins are already compatible.

Google Play is far more lenient with WebView apps; expect no issue there.
