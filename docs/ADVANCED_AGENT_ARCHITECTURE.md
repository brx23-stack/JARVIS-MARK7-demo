> **Current scope note (2026-11-16):** Host/device-control capabilities described in this historical architecture (such as `open_url`, `screen_ocr`, and `browser_control`) are excluded from the current MARK 7 release and filtered by the release policy. `browser_fetch` remains a read-only research capability in standard mode. Do not re-enable excluded controls without a separate architecture/security review.

# JARVIS MARK 7 — Advanced Agent Upgrade

This upgrade keeps the existing MARK 7 UI and features intact and adds a server-side agent layer inspired by the architecture in `bertrandmbanwi/Jarvis`.

## Architecture

`User -> existing MARK 7 chat/voice/remote path -> complexity gate -> Planner -> Executor -> QA/Verifier -> existing memory`

### Planner
Creates a bounded plan of up to eight measurable steps and records dependencies.

### Executor
Runs each step with the existing MARK 7 tool implementations plus dynamically registered tools. Tool calls are bounded and their results are fed back into the executor.

### QA/Verifier
Checks the execution evidence instead of trusting the executor's claim. Failed verification pauses the task and records which steps need another attempt.

### Persistent work sessions
Tasks are stored in `data/agent-tasks.json`. Running/paused tasks can be resumed by posting their task ID to `/api/agent`.

### Semantic memory
The existing MARK 7 semantic memory and knowledge graph remain the source of truth. Agent planning retrieves relevant semantic memories and graph context before creating a plan.

### Usage/cost tracking
Every planner, executor, and verifier LLM call is recorded in `data/ai-usage.json`. Token usage is taken from provider responses. Cost is calculated when provider-specific USD-per-million-token environment variables are configured. If rates are not configured, token usage is still tracked and cost is reported as unpriced rather than guessed.

### Fallback/recovery
Agent provider calls use the same active provider selection as MARK 7 and can fall back to `LLM_FALLBACK_PROVIDER` for non-auth failures. Step failures pause the task instead of losing state.

### Browser / screen capabilities
`browser_fetch`, `open_url`, and `screen_ocr` are capability-gated, lightweight tools. They work only where the host OS provides the required capability. Screen OCR uses Tesseract when installed. `browser_control` adds optional Playwright automation. It is loaded only at runtime, so the Android/Termux install is not forced to download Chromium. On a supported desktop host, install Playwright separately and the same tool can navigate, inspect, click, type, and capture a browser screenshot. If Playwright/Chromium is missing, the tool returns a capability error and the executor can fall back to another tool.

## API

- `POST /api/agent` — run or resume an autonomous task.
- `GET /api/agent` — list tasks and usage.
- `GET /api/agent?resume=1` — return the latest paused/running task.
- `GET /api/agent?usage=1` — return usage/cost analytics.
- `GET /api/agent/tools` — list registered tools.

The normal `/api/chat` route automatically uses agent mode for complex multi-step requests (`JARVIS_AGENT_MODE=auto`). Set `JARVIS_AGENT_MODE=always` to route every chat turn through the agent pipeline, or `off` to preserve the original single-agent path.

## Safety

Dynamic tool registration is server-code only. The HTTP endpoint never accepts executable code. Existing MARK 7 security/session checks remain in front of the new APIs.
