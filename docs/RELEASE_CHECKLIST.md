# Release checklist

A checkbox is complete only when someone has actually verified it on the release candidate.

## Build and quality

- [ ] Clean install using Node.js 22.6+ and `npm ci`.
- [ ] `npm test` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` passes.
- [ ] CI passes on the release commit.
- [ ] No secrets, local `.env` files, personal memory, or test artifacts are included.

## Authentication and security

- [ ] Every API route has appropriate authentication and rate limiting.
- [ ] Access token is high entropy and not exposed to client bundles.
- [ ] HTTPS is configured for any non-loopback deployment.
- [ ] Remote gateways are disabled unless explicitly configured and tested.
- [ ] Plugins and Autocoder are opt-in and their source/permissions reviewed.
- [ ] Prompt injection and untrusted tool-result handling are tested.
- [ ] Approval-required actions cannot be approved by remote chat gateways.

## Privacy

- [ ] Application-level encryption at rest is implemented for personal memory, evolution, task, and usage data, with key rotation/recovery and safe plaintext migration; otherwise release is explicitly limited to local beta/testing.
- [ ] Verified local STT/TTS is available before claiming voice works in strict local-only mode; otherwise browser voice remains disabled there.
- [ ] Local-only mode tested against cloud provider selection and fallback.
- [ ] Remote Ollama endpoint rejected in local-only mode.
- [ ] Network tools and online TTS blocked in local-only mode.
- [ ] Browser speech limitations disclosed to the user.
- [ ] Plaintext memory limitation disclosed; full-disk encryption recommended.
- [ ] Data backup and recovery tested.

## Product and device matrix

- [ ] Desktop browser UI tested.
- [ ] Android browser/PWA layout tested.
- [ ] Voice permissions, mute, interruption, and text fallback tested.
- [ ] Command Center and approval workflow tested.
- [ ] Memory retrieval, correction, and corruption recovery tested.
- [ ] Device-control claims absent from release documentation and marketing.

## Publication

- [ ] README and AI handoff match actual behaviour.
- [ ] Feature status distinguishes implemented, experimental, planned, and verified.
- [ ] Licence and upstream attribution preserved.
- [ ] Known limitations and security reporting instructions published.
