> **Scope update (2026-11-16):** This file describes an earlier additive build. The current release scope excludes desktop, Android, cross-device, and smart-device control. Legacy modules may remain in the source tree but are disabled/filtered by current release policy. See `docs/AI_HANDOFF.md` and `docs/FEATURE_STATUS.md` for authoritative current guidance.

# JARVIS MARK 7 Upgrade Notes

This build is an additive upgrade of the uploaded MARK 7 project. The original `.env.local` was intentionally excluded from this distributable so API keys, bot tokens, and access tokens are not copied into the upgraded archive. Recreate it from `.env.example` on the target machine.

The AI Orb, HUD, voice, molecule lab, hand tracking, remote messaging, memory, and research integrations remain part of the codebase. Device-control capabilities are no longer supported in the current release scope.

Added server-side modules live under `lib/agents/` and new APIs under `app/api/agent/`.
