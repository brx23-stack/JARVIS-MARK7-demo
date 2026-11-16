# Co-developer setup

This repository contains no API keys, access tokens, `.env.local`, or personal `data/` files. Each developer must create their own local configuration.

## First run

```bash
npm ci
cp .env.example .env.local
openssl rand -hex 32  # copy output into JARVIS_ACCESS_TOKEN in .env.local
npm run setup
npm test
npm run typecheck
npm run dev
```

Requirements: Node.js 22.6+ and npm. Install Ollama locally and set `LLM_PROVIDER=ollama` for local model use. Set `JARVIS_PRIVACY_MODE=local_only` to activate the server-side local-only policy; this disables browser voice input/output until verified local speech engines are added.

## Rules

- Never commit `.env.local`, secrets, personal `data/`, or generated exports.
- Read `docs/AI_HANDOFF.md` before changing architecture or product scope.
- Keep desktop, Android, cross-device, and smart-device control out of MARK 7. They belong in a separate future project.
- Keep `JARVIS_REMOTE_ENABLED=false` unless remote messaging is specifically needed and its privacy implications are understood.
- Treat plugins as trusted server-side code; inspect them before enabling.
- Preserve upstream attribution and licence notices.
- Update README, feature status, privacy docs, roadmap, and AI handoff when behaviour changes.
- Do not claim a test/build/security review passed unless it was actually run.

## Required checks

```bash
npm test
npm run typecheck
npm run build
```

Then complete `docs/RELEASE_CHECKLIST.md` on the target platform.
