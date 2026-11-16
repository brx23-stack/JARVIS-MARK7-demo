# JARVIS MARK 7

**A voice-first personal AI workspace focused on privacy, persistent knowledge, research, learning, and controlled AI agents.** MARK 7 is a self-hostable Next.js application with a holographic Three.js interface. It supports local Ollama models and optional cloud providers.

> **Status: pre-release engineering build.** Do not market this archive as production-ready or fully privacy-hardened yet: application-level encryption at rest, verified local STT/TTS, complete type-check/build verification, and the manual release matrix remain outstanding.
>
> **Release scope:** This release is focused on the AI workspace. Native desktop control, Android control, cross-device control, and smart-device orchestration are deliberately out of scope and must be designed as a separate future system. Legacy/experimental code may remain in the repository, but it is not a supported MARK 7 release capability.

## Product principles

1. **Privacy before convenience:** make data flows visible; prefer local services; fail closed in local-only mode.
2. **User-owned memory:** memories are local application data, not model-weight training. Users must be able to understand and manage what is retained.
3. **Evidence-based self-improvement:** learning plans and progress tracking should measure demonstrated work, not invent progress.
4. **Voice-first, not voice-only:** voice is a primary interaction mode, with a usable visual interface and text fallback.
5. **Human approval for consequential actions:** tools, integrations, and code changes must have narrow permissions and explicit approval gates.

## Current capabilities

- Three.js holographic orb interface, hand-tracking UI experiment, and browser-based voice interaction.
- Provider adapter for Ollama, Groq, NVIDIA, Gemini, OpenAI, and Anthropic-compatible endpoints.
- Local file-backed episodic, semantic, factual, and graph memory.
- Personal Evolution workspace for goals, milestones, and evidence-based skill records.
- Privacy view with active-mode status and authenticated local-data export/deletion.
- Agent planning/execution, tool registry, task tracking, and approval queue.
- Autocoder proposal workflow with guarded file scope and verification.
- Optional web search, weather, currency, Google Calendar, and Gmail-read integrations.
- Command Center for tasks, approvals, usage, memory statistics, and system checks.
- Optional Telegram/Discord gateway, disabled by default.
- PWA installation and Docker deployment.

See [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) for the distinction between implemented, experimental, and planned capabilities.

## Quickstart

Requirements: Node.js 22.6+ and npm.

```bash
git clone <repo-url>
cd JARVIS-MARK7
npm ci
npm run setup
npm run dev
```

Open `http://localhost:3000` and authenticate using the generated `JARVIS_ACCESS_TOKEN` in `.env.local`.

### Local model setup

1. Install [Ollama](https://ollama.com) on the same machine.
2. Pull a model, for example `ollama pull llama3.2`.
3. Set `LLM_PROVIDER=ollama` and `LOCAL_LLM_BASE_URL=http://localhost:11434/v1` in `.env.local`.
4. Set `JARVIS_PRIVACY_MODE=local_only` to block cloud LLMs, online TTS, browser voice input/output, network tools, and autonomous agent mode.

**Important privacy limitation:** local-only mode disables browser microphone recognition and browser speech synthesis because their processing may be remote. A verified local STT/TTS engine is not yet integrated. Memory files are also currently plaintext on disk. Read [docs/PRIVACY.md](docs/PRIVACY.md) before using sensitive information.

### Android app

Run **Actions → Build Android APK** on GitHub to get an installable APK. See [docs/ANDROID_APP.md](docs/ANDROID_APP.md).

### Docker

```bash
npm run setup
docker compose up --build
```

The Compose file binds to loopback by default and persists application data in `data/`. Do not expose the service publicly without HTTPS, strong authentication, and a deliberate threat review.

## Privacy modes

| Mode | Setting | Behaviour |
|---|---|---|
| Standard | `JARVIS_PRIVACY_MODE=standard` (default) | Configured providers and enabled integrations are available. Review provider and integration data flows. |
| Local-only | `JARVIS_PRIVACY_MODE=local_only` | Forces Ollama on a loopback endpoint; blocks cloud LLM selection/fallback, online TTS, browser speech input/output, network tools, and autonomous agent mode. |

Local-only is a network-reduction control, not a complete air-gap guarantee. Browser voice APIs are disabled in this mode until verified local STT/TTS engines exist. Enabled remote gateways, third-party integrations, operating-system telemetry, and plaintext data-at-rest remain separate concerns.

## Development and verification

```bash
npm test
npx tsc --noEmit
npm run build
```

A release is not verified until all three commands pass in a clean Node 22.6+ environment and the manual test matrix in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) is completed.

## Documentation map

- [Architecture](docs/ARCHITECTURE.md) — system boundaries and data flow.
- [Privacy](docs/PRIVACY.md) — privacy modes, data inventory, known limitations, and hardening work.
- [Feature status](docs/FEATURE_STATUS.md) — what is implemented versus experimental/planned.
- [Roadmap](docs/ROADMAP.md) — prioritised product work.
- [AI handoff](docs/AI_HANDOFF.md) — authoritative instructions for another AI developer continuing this repository.
- [Release checklist](docs/RELEASE_CHECKLIST.md) — required verification before publication.
- [Usage](docs/USAGE.md), [Command Center](COMMAND_CENTER.md), [Autocoder](AUTOCODER.md), [Deployment](DEPLOY.md), [Security](SECURITY.md).

## Project heritage and attribution

JARVIS MARK 7 retains the original project attribution and applicable licence notices. See [`LICENSE`](LICENSE) and [`AUTHORS.md`](AUTHORS.md). Do not remove or rewrite upstream attribution when modifying or redistributing inherited code/assets.
