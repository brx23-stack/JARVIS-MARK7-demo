# AI developer handoff — JARVIS MARK 7

This document is the authoritative context for any AI coding assistant continuing this repository. Read it before editing code. Then read `README.md`, `docs/ARCHITECTURE.md`, `docs/PRIVACY.md`, `docs/FEATURE_STATUS.md`, `docs/ROADMAP.md`, and `SECURITY.md`.

## Product definition

JARVIS MARK 7 is a privacy-conscious, voice-first personal AI workspace. Its three release pillars are:

1. **Privacy and security** — local-first provider support, transparent data handling, safe memory, authentication, permissions, and user control.
2. **Personal evolution** — learning plans, knowledge development, research organisation, goals, and evidence-based progress tracking.
3. **Advanced AI intelligence** — contextual conversation, persistent memory, research, bounded agents, and guarded coding assistance.

## Explicitly excluded scope

Do NOT implement or expand:
- Native desktop control or arbitrary host operating-system automation.
- Android phone control, Android Hands, accessibility-driven automation, or remote phone actions.
- Cross-device command routing or a universal controller.
- Smart-device control as a core MARK 7 feature.

These require a separate architecture and security review. Legacy Android files may remain for historical/experimental reference but must stay disabled and must not be advertised as supported release functionality. Do not register Android tools by default.

## Existing architecture to preserve

- Next.js App Router + React + TypeScript.
- Three.js holographic orb UI in `components/JarvisOrb.tsx` and `lib/orbScene.ts`.
- Provider selection and chat/tool loop in `app/api/chat/route.ts`.
- Memory modules in `lib/memory/` (facts, episodic events, semantic consolidation, graph).
- Agent runtime in `lib/agents/`.
- Approval queue in `lib/approvals/`.
- Autocoder guard and verification in `lib/autocoder/`.
- Command Center in `components/CommandCenter.tsx` and `components/commandcenter/`.
- Existing integrations, PWA and Docker paths, unless a requested change explicitly modifies them.

Do not replace large existing components merely to make a local change. Preserve upstream attribution and licence files.

## Privacy rules for code changes

- Server-side enforcement is mandatory; hiding a UI button is not a security boundary.
- `lib/privacy/policy.ts` is the shared policy. Any new provider, tool, agent path, TTS route, or integration must consult it.
- In `local_only` mode, cloud LLM providers, remote model endpoints, fallback providers, network tools, autonomous agent execution, and online TTS must remain blocked.
- New tools must be classified explicitly as local-only-safe or external/network-dependent.
- Do not claim browser Web Speech recognition or browser speech synthesis is local. The browser/OS controls its processing path; both are disabled in local-only mode until verified local engines are integrated.
- Do not claim memory encryption at rest: current JSON/JSONL memory files are plaintext. Use full-disk encryption until a tested encrypted-store implementation exists.
- Do not store API keys, passwords, authentication tokens, or other secrets in memory. Redaction is best-effort only.
- Keep remote gateways disabled by default; keep Android Hands disabled. Autocoder cannot edit `lib/privacy/`, `lib/evolution/`, `android/`, `app/api/android/`, or the excluded system/smart-home controller modules.
- Any destructive memory operation needs explicit user intent, authentication, and tests.

## Quality rules

1. Inspect call sites and tests before editing.
2. Make the smallest coherent change; avoid unrelated refactors.
3. Add tests for new behaviour, especially privacy/security boundaries.
4. Run `npm test`, `npx tsc --noEmit`, and `npm run build` when dependencies/environment permit.
5. If a check cannot run, state exactly why. Never report it as passed.
6. Update README and relevant architecture/privacy/status/roadmap docs when behaviour or scope changes.
7. Do not invent successful runtime tests, benchmarks, security certifications, or feature support.
8. Review generated diffs for secrets, personal data, debug logs, and accidental scope expansion.

## Immediate implementation priorities

1. Design encrypted storage and a safe plaintext migration for all user-specific files under `data/`; this is a public-release blocker.
2. Expand route-level tests for `lib/privacy/policy.ts` and prove local-only mode blocks cloud provider selection, remote Ollama endpoints, cloud fallback, network tools, autonomous agents, online TTS, external briefing routes, and browser voice.
3. Implement a real Privacy Center with inspect/export/delete/retention controls.
4. Integrate and verify local STT/TTS; make mic and wake-word states explicit.
5. Expand Personal Evolution: the initial goal/milestone tracker and skill-evidence log exist; add guided learning paths, review cycles, knowledge-vault links, and stronger analytics.
6. Harden agent/tool boundaries and make task/approval state durable where required.

## Current honest limitations

- Application-level encrypted memory is not implemented.
- Browser voice locality is not guaranteed.
- Privacy view and export/delete endpoints exist, but per-record inspection, retention controls, and complete failure/recovery UX are unfinished. The export intentionally does not export browser-profile cookies/session data; deletion removes the profile.
- Personal Evolution has an initial goal/milestone and evidence tracker, but not yet guided learning paths, review cycles, or advanced analytics.
- Some process state (approvals, rate limits, remote gateway state) is not shared across instances.
- Device control is out of scope.

## Expected handoff behaviour

Before writing code, summarise the intended change and list affected files. After editing, provide a concise change log, tests actually run and their results, known limitations, and any required manual setup. Keep this document current as the project evolves.
