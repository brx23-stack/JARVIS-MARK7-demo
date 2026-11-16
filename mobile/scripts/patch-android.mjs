// Run after `cap add android` (and before `cap sync`). Idempotent.
// Patches the generated native project: permissions, cleartext, in-app
// navigation, autoplay audio, launcher icon, lint, version numbers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, "..");
const repo = path.resolve(mobile, "..");
const android = path.join(mobile, "android");
const appDir = path.join(android, "app");
const main = path.join(appDir, "src", "main");

if (!fs.existsSync(android)) {
  console.error("mobile/android not found. Run `npx cap add android` first.");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(path.join(mobile, "capacitor.config.json"), "utf8"));
const pkg = cfg.appId;

/* 1. AndroidManifest.xml ------------------------------------------------ */
const manifestPath = path.join(main, "AndroidManifest.xml");
let m = fs.readFileSync(manifestPath, "utf8");

const perms = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
];
const features = [
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
];
let inject = "";
for (const p of perms) {
  if (!m.includes(`android:name="${p}"`)) inject += `    <uses-permission android:name="${p}" />\n`;
}
for (const f of features) {
  const name = f.match(/android:name="([^"]+)"/)[1];
  if (!m.includes(`android:name="${name}"`)) inject += `    ${f}\n`;
}
if (inject) m = m.replace(/<application/, `${inject.trimStart()}\n    <application`);
if (!/usesCleartextTraffic=/.test(m)) {
  m = m.replace(/<application/, '<application android:usesCleartextTraffic="true"');
} else {
  m = m.replace(/usesCleartextTraffic="[^"]*"/, 'usesCleartextTraffic="true"');
}
fs.writeFileSync(manifestPath, m);

/* 2. MainActivity (keep http/https navigation inside the app) ------------ */
const javaRoot = path.join(main, "java");
(function removeOld(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) removeOld(p);
    else if (/^MainActivity\.(java|kt)$/.test(e.name)) fs.rmSync(p);
  }
})(javaRoot);
const actDir = path.join(javaRoot, ...pkg.split("."));
fs.mkdirSync(actDir, { recursive: true });
fs.writeFileSync(
  path.join(actDir, "MainActivity.java"),
  `package ${pkg};

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Voice replies / TTS must be able to play without a fresh tap.
    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);

    // Keep any http(s) server (Termux localhost, LAN, hosted) inside the app
    // instead of bouncing to the external browser. Other schemes (tel:, mailto:)
    // still go through Capacitor's default handling.
    getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String scheme = request.getUrl().getScheme();
        if ("http".equals(scheme) || "https".equals(scheme)) return false;
        return super.shouldOverrideUrlLoading(view, request);
      }
    });
  }
}
`
);

/* 3. Launcher icon from the PWA icon ------------------------------------ */
const icon = path.join(repo, "public", "icon-512.png");
const res = path.join(main, "res");
if (fs.existsSync(icon) && fs.existsSync(res)) {
  for (const d of fs.readdirSync(res)) {
    if (d === "mipmap-anydpi-v26" || d === "mipmap-anydpi") {
      fs.rmSync(path.join(res, d), { recursive: true, force: true }); // drop adaptive XML
    } else if (d.startsWith("mipmap-")) {
      for (const n of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
        fs.copyFileSync(icon, path.join(res, d, n));
      }
    }
  }
} else {
  console.warn("icon or res dir missing; keeping default Capacitor icon");
}

/* 4. app/build.gradle: version + lint ----------------------------------- */
const gradlePath = fs.existsSync(path.join(appDir, "build.gradle"))
  ? path.join(appDir, "build.gradle")
  : path.join(appDir, "build.gradle.kts");
let g = fs.readFileSync(gradlePath, "utf8");
const run = parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10) || 1;
const ver = process.env.APP_VERSION_NAME || `1.0.${run}`;
g = g.replace(/versionCode\s*=?\s*\d+/, `versionCode ${run}`);
g = g.replace(/versionName\s*=?\s*"[^"]*"/, `versionName "${ver}"`);
if (!g.includes("// jarvis-lint-patch") && gradlePath.endsWith(".gradle")) {
  g += `
// jarvis-lint-patch
android {
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}
`;
}
fs.writeFileSync(gradlePath, g);

console.log(`Patched Android project: ${pkg} v${ver} (code ${run})`);
