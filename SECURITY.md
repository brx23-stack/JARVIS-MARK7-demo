# Security Policy

## Supported security posture

JARVIS is a self-hosted personal application, not a hardened multi-tenant service. Keep it bound to loopback unless you have deliberately configured HTTPS, authentication, firewalling, and a persistent deployment environment. Do not expose an unauthenticated development server to the internet.

## Reporting a vulnerability

Do not publish API keys, credentials, tokens, private memory, or exploit details in public issues. Contact the repository maintainer privately first. Include the affected version, impact, reproduction steps, and any safe proof-of-concept details.

## Required operator practices

- Generate a unique high-entropy `JARVIS_ACCESS_TOKEN`; never use the example value.
- Keep `.env`, `.env.local`, `data/`, OAuth refresh tokens, and bot credentials out of version control and backups that are not encrypted.
- Use full-disk encryption and restrictive filesystem permissions. **Application-level encryption for memory files is not yet implemented.**
- Keep `JARVIS_REMOTE_ENABLED=false` unless remote access is specifically needed and sender allowlists/webhook secrets are configured.
- Keep `ANDROID_HANDS_ENABLED` unset/false. Android Hands is legacy experimental code, not part of the current release scope.
- Keep plugins disabled unless their source has been reviewed; plugins execute server-side code.
- Configure `JARVIS_PRIVACY_MODE=local_only` when cloud AI/TTS and network tools must be blocked. This does not make browser Web Speech APIs local or disable every separately configured integration.
- Do not expose the service over plain HTTP on an untrusted network.
- Review approval-required tools and do not grant broad permissions by default.

## Known limitations (must not be described as solved)

- Memory and learning stores are local JSON/JSONL files and are not encrypted at application level.
- Browser speech recognition/synthesis locality depends on browser and OS implementation.
- Rate limits, session state, approvals, and some gateway state are process-local; horizontally scaled deployments need shared durable state.
- Credential redaction is best-effort pattern matching, not a guarantee that arbitrary secrets are detected.
- The project has not been represented as penetration-tested or independently security-certified.

## Secret exposure

If a secret is committed or shared, revoke/rotate it immediately. Removing it from the latest commit is not sufficient because it may remain in repository history, caches, logs, or backups.

## Outbound fetches, tokens and Autocoder paths (hardening notes)

- `browser_fetch` (and any future tool that fetches model-chosen URLs) goes through `lib/netGuard.ts`: public internet only, private/loopback/link-local/metadata addresses blocked on the connected IP and on every redirect, 1 MB response cap, output labelled as untrusted. Opt in to LAN hosts with `JARVIS_FETCH_ALLOW_HOSTS` (preferred) or `JARVIS_FETCH_ALLOW_PRIVATE=true`.
- Access tokens (`JARVIS_ACCESS_TOKEN`, `REMOTE_ADMIN_TOKEN`) and `TELEGRAM_WEBHOOK_SECRET` shorter than 16 characters, or matching the `.env.example` placeholders, are treated as not configured. Run `node scripts/setup.mjs` to generate a real token.
- The Autocoder's protected-path list is case-insensitive and also checks the canonical on-disk path. New or edited `app/api/**/route.ts` files must keep a `requireAccess(...)` call.
- Memory writes are serialized (read-modify-write) and atomic; an unreadable `memory.json` is backed up as `memory.json.corrupt-<timestamp>` before a new one is started.

