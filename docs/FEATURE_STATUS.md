# Feature status

This file intentionally separates source-code presence from release readiness.

| Area | Status | Notes |
|---|---|---|
| Holographic orb UI | Implemented | Existing Three.js/React interface; visual QA still required |
| Provider adapters | Implemented | Ollama and several cloud-compatible providers |
| Local-only policy | Implemented in server routes | Blocks cloud LLM selection/fallback, network tools, autonomous agent path, and online TTS; not a full air gap |
| Browser voice input/output | Experimental/platform-dependent | Browser Web Speech locality is not guaranteed; not certified offline |
| Explicit factual memory | Implemented | Local plaintext JSON |
| Episodic memory | Implemented | Local plaintext JSONL with best-effort redaction |
| Semantic memory and graph | Implemented | Local plaintext JSON |
| Agent orchestration | Implemented | Bounded planner/executor/QA path; standard mode only |
| Approval queue | Implemented | Process-local; pending approvals do not survive restart |
| Autocoder | Implemented, opt-in | Guarded source scope and verification; requires adversarial testing |
| Command Center | Implemented | Uses current task, approval, usage, memory and integration data |
| Calendar/email/weather/search | Optional integrations | External data flows; require explicit configuration and review |
| Telegram/Discord gateway | Optional, disabled by default | Persistent process and allowlist required |
| Native desktop controller | Out of current scope | Future independent architecture |
| Android controller / Android Hands | Legacy experimental, out of current scope | Do not enable or market as a MARK 7 release feature |
| Application-level encrypted memory | Planned | Not implemented; use full-disk encryption |
| Privacy Center | Partially implemented | Privacy status view plus authenticated export/delete for listed local data files; individual retention controls remain planned |
| Personal Evolution | Initial implementation | Command Center goal/milestone tracker and evidence log; learning-path generation and richer analytics remain planned |
| Native offline speech engine | Planned | Browser APIs are not a verified substitute |

## Release language

Use “implemented” only for code that exists and has a clear path. Use “verified” only after tests pass in the target environment. Do not call MARK 7 fully offline, encrypted-at-rest, penetration-tested, or a universal device controller.
