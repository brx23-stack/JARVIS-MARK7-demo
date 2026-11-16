# Privacy and data handling

## Design target

MARK 7 should prefer local processing, make external data flows explicit, and let the owner decide what is retained. The current implementation is a step toward that target, not a guarantee of end-to-end local processing.

## Local-only mode

Set:

```dotenv
JARVIS_PRIVACY_MODE=local_only
LLM_PROVIDER=ollama
LOCAL_LLM_BASE_URL=http://localhost:11434/v1
LLM_FALLBACK_PROVIDER=
```

In this mode the server:

- Selects Ollama rather than an in-memory cloud provider key.
- Rejects non-Ollama providers and remote Ollama endpoints.
- Disables configured cloud fallback.
- Filters the tool list to local memory operations and local time.
- Blocks online TTS and realtime cloud voice requests.
- Disables browser speech recognition and browser speech synthesis in the UI because their processing locality cannot be guaranteed.
- Blocks direct cloud-provider connection attempts and online Autocoder requests.
- Blocks daily briefing generation, live integration tests, and market-data requests.
- Skips calendar and weather fetches from the Command Center snapshot.
- Skips the autonomous agent execution path, which can use a broader tool registry.

The authenticated `/api/privacy` endpoint reports the active mode and its known limitations. The Privacy view also exposes authenticated export and deletion for the enumerated local data files; deletion does not erase credentials, external records, backups, or logs.

## Important boundaries

Local-only mode is not a complete network sandbox. In particular:

1. Browser `SpeechRecognition` / `webkitSpeechRecognition` is browser-vendor controlled. Some implementations may send audio to remote services; local-only mode therefore disables browser speech input. A verified local STT engine is still future work.
2. Browser `speechSynthesis` voice processing is controlled by the OS/browser and is not certified here as local; local-only mode disables it. A verified local TTS engine is still future work.
3. Existing separately configured remote gateways and third-party integrations should remain disabled. Local-only mode does not automatically rewrite every integration's environment settings.
4. The memory, task, usage, and evolution stores in `data/` are plaintext JSON/JSONL today. Use OS full-disk encryption and filesystem permissions until an application-level encrypted-store migration is implemented and tested.
5. Network access at the operating-system/container level is not blocked. For an actual air gap, enforce egress restrictions outside the application.

## Data inventory

| Data | Current location | Notes |
|---|---|---|
| Explicit facts | `data/memory.json` | Key/value memory, plaintext |
| Episodic interactions/tool results | `data/learning.jsonl` | May include user text and tool output; best-effort secret redaction |
| Semantic memories | `data/semantic-memory.json` | Consolidated knowledge, plaintext |
| Knowledge graph | `data/memory-graph.json` | Nodes and relations, plaintext |
| Agent tasks | `data/agent-tasks.json` | Task plans/results, plaintext |
| Personal Evolution goals/evidence | `data/evolution.json` | User-authored goals, milestones, and skill evidence; plaintext |
| AI usage | `data/ai-usage.json` | Usage metadata, plaintext |
| Autocoder records | `data/autocoder/` | Proposals, audit entries, and rollback snapshots; local files |
| Browser profile | `data/browser-profile/` | May contain browser session state if optional browser automation was used; sensitive local data |
| Approval queue | Process memory | Pending approval state is not durable across restart |
| Provider keys entered in UI | Server process memory | Not intentionally persisted by the key manager; restart clears them |
| Environment credentials | `.env.local` / deployment secrets | Must be protected by operator |

## External data flows in standard mode

Depending on enabled features, prompts may be sent to the selected cloud LLM provider; text may be sent to ElevenLabs/OpenAI for online TTS; search queries may go to a web search service; calendar/email data may be sent to the selected LLM for summarisation; and optional Telegram/Discord services receive their configured requests. Do not enable an integration without reviewing its provider terms and data handling.

## Required future privacy work

- Application-level authenticated encryption for memory, learning, graph, task, and usage stores, with key rotation and safe migration.
- Retention controls and inspection UI for individual memory records; the current Privacy view supports export of the listed text/JSON data and deletion of those files plus Autocoder history/snapshots and the local browser profile.
- A verified local speech-to-text and text-to-speech engine so voice can be restored in local-only mode without relying on browser/OS processing.
- Explicit per-integration network/data-flow controls and a network activity log.
- Tests proving local-only mode cannot call cloud providers or network tools.
- Backup/export encryption and recovery testing.
