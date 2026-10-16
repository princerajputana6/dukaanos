import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Suvakta native shell (iOS + Android) via Capacitor.
 *
 * Suvakta is a server-rendered app on Cloudflare Workers, so the native apps run as a
 * thin WebView around the live production site rather than bundling a static export.
 * `server.url` points the shell at https://suvakta.com; the files in `webDir` are only
 * shown as an offline fallback.
 *
 * Voice (the mic feature) needs native permission wiring — see BUILD-MOBILE.md:
 *   iOS:     NSMicrophoneUsageDescription in Info.plist
 *   Android: RECORD_AUDIO in AndroidManifest + grant the WebView PermissionRequest
 */
const config: CapacitorConfig = {
  appId: "com.suvakta.app",
  appName: "Suvakta",
  webDir: "mobile/www",
  server: {
    url: "https://suvakta.com",
    // Only allow navigation to our own domain inside the app WebView; everything else
    // (payment/help links) opens in the system browser.
    allowNavigation: ["suvakta.com", "*.suvakta.com"],
    androidScheme: "https",
    iosScheme: "https",
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#0b1a18",
      showSpinner: false,
    },
  },
};

export default config;
