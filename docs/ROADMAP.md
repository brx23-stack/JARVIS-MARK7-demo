# MARK 7 product roadmap

## Release objective

Ship a stable, privacy-conscious, voice-first personal AI workspace. Device control is intentionally excluded and reserved for a future independent project.

## P0 — Release safety, privacy, and correctness

- Implement encrypted-at-rest storage for facts, episodic, semantic, graph, evolution, task, and usage data, with safe migration and recovery tests.
- Do not label the project production-ready or privacy-hardened until this is complete.
- Verify authentication on every API route and tighten any exceptions.
- Add tests for local-only provider, tool, fallback, and TTS blocking.
- Complete clean install, TypeScript, test, and production build checks.
- Audit prompt injection through web pages, email, calendar, plugins, and tool results.
- Review all default-enabled integrations and make external data flows explicit.
- Add recovery guidance for corrupted memory files and safe backups.

## P1 — Privacy foundation

- Add key rotation, encrypted backups, and tested recovery for the encrypted data store.
- Complete Privacy Center: inspect retained categories, manage individual records, and set retention.
- Provide clear per-provider and per-integration disclosure.
- Add local network/egress tests; do not label the app air-gapped unless external egress is blocked.

## P1 — Voice-first reliability

- Integrate a verified local speech-to-text engine and local TTS engine.
- Add explicit mic state, mute control, wake-word opt-in, push-to-talk fallback, and transcript privacy controls.
- Support interruption/cancellation and resilient device/browser fallback.
- Keep browser Web Speech as a clearly labelled convenience path, not the privacy guarantee.

## P1 — Personal Evolution

- [x] Initial goals, milestones, and skill-evidence tracker in the Command Center.
- [ ] Learning plans with goals, prerequisites, milestones, and source references.
- Skill ledger that records evidence (completed exercises, projects, assessments) rather than subjective scores alone.
- Reflection/review workflow and progress history.
- Knowledge vault linking notes, documents, concepts, and projects.
- User control over what learning activity is retained.

## P2 — Intelligence and agent quality

- Multi-agent roles with strict capability boundaries.
- Source-aware research summaries and claim provenance.
- Better retrieval ranking, memory correction UI, and stale-memory handling.
- Agent replay, task cancellation, idempotency, and durable task state.
- Autocoder sandboxing, diff review, rollback, and expanded regression tests.

## Separate future project: Universal Controller

Desktop, Android, and cross-device control require a separate threat model, native agents, secure pairing, scoped permissions, and platform-specific testing. They are not a MARK 7 milestone and must not be silently reintroduced through plugins or integrations.
