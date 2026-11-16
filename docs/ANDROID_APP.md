# JARVIS MARK 7 as an Android app

The APK is a thin native shell (Capacitor + WebView) around the JARVIS interface.
JARVIS itself (memory, agents, provider calls) still runs in the Next.js server, so
the app asks for a **server address** on first launch.

## Build the APK from GitHub (no computer needed)

1. Push this repo to GitHub.
2. **Actions → Build Android APK → Run workflow.** (Pushing a tag such as `v1.0.0`
   also attaches the APK to a Release.)
3. When it finishes (~5–8 min), open the run and download **JARVIS-MARK7-apk**
   from *Artifacts*. Unzip it and install `JARVIS-MARK7.apk`
   (allow "install unknown apps" for your browser/file manager).

## Connect it

- **Server on the same phone (Termux):** `npm run build && npm start`, then tap
  *Use this phone (Termux)* in the app (`http://127.0.0.1:3000`). Use that exact
  localhost address: the camera, mic and hand tracking only work on localhost or HTTPS.
- **Hosted server:** enter its `https://` address (see DEPLOY.md). Set
  `JARVIS_ACCESS_TOKEN` before exposing it.
- Press **Back** on the JARVIS screen to return to the address screen.

## Updating without uninstalling (optional but recommended)

Without a signing key the workflow makes a fresh temporary key every run, so Android
refuses to install a new build over an old one. To fix that once, create a key
(Termux: `pkg install openjdk-21`) and add three repo secrets
(*Settings → Secrets and variables → Actions*):

```bash
keytool -genkeypair -keystore jarvis.jks -alias jarvis -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 jarvis.jks    # paste output as ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the base64 output above |
| `ANDROID_KEYSTORE_PASSWORD` | the password you chose |
| `ANDROID_KEY_ALIAS` | `jarvis` |

Keep `jarvis.jks` backed up and never commit it.
