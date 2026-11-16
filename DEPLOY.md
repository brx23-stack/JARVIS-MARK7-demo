# Deploying JARVIS MARK 7

## Why not Netlify (or other serverless-functions platforms)

The Remote Command Gateway (`lib/remote/*`, `app/api/remote/*`) needs one
long-running Node.js process:

- `/api/remote/events` holds a Server-Sent Events connection open
  indefinitely with a 15s heartbeat. Serverless functions (Netlify, and
  most others) kill requests after a fixed timeout (Netlify: 10s free /
  26s paid) - this stream would get cut off almost immediately.
- `lib/remote/gateway.ts` and `lib/remote/recipients.ts` keep queued
  commands, UI sessions, and recipient lookups in in-memory `Map`/`Set`
  objects. That only works if every request hits the same process.
  Serverless platforms don't guarantee that - a webhook and the SSE stream
  reading it could land in separate, non-communicating instances.

Everything else in the app (the orb, chat/TTS routes, molecule lab, static
assets) is stateless and would run fine on a serverless platform. It's only
the remote gateway that requires a persistent server.

## Recommended: Railway or Render (easiest)

Both auto-detect Next.js and just need a `git push` - no Dockerfile
required (though the one in this repo works there too if you prefer
containers).

1. Push this project to a GitHub repo.
2. **Railway**: New Project -> Deploy from GitHub repo -> it detects
   `npm run build` / `npm run start` automatically.
   **Render**: New -> Web Service -> connect the repo -> Build command
   `npm install && npm run build`, Start command `npm run start`.
3. Add the environment variables from `.env.example` (AI provider key
   handling, TTS, and the `JARVIS_REMOTE_ENABLED` / `TELEGRAM_*` /
   `DISCORD_*` / `REMOTE_*` block) in the platform's dashboard.
4. Deploy. You'll get a public HTTPS URL - use it as:
   - Telegram: `https://<your-app>/api/remote/telegram` in `setWebhook`
   - Discord: `https://<your-app>/api/remote/discord` as the Interactions
     Endpoint URL

Both have free tiers usable for testing; check current sleep/uptime limits
on the free tier if you want the bots responsive around the clock.

## Alternative: Docker on any host (Fly.io, a VPS, etc.)

This repo includes a production `Dockerfile` (multi-stage, using Next.js's
`output: "standalone"` for a small image) and `.dockerignore`.

```bash
docker build -t jarvis-mark-7 .
docker run -p 3000:3000 --env-file .env.local jarvis-mark-7
```

Point that at any host that keeps the container running continuously -
Fly.io, a plain VPS with Docker, etc. - then set the same webhook URLs as
above using that host's public domain.

## If you specifically want Netlify

It's possible, but only by replacing the SSE stream with polling and the
in-memory state with an external store (e.g. Redis/Upstash) - a real
refactor of `lib/remote/gateway.ts`, `lib/remote/recipients.ts`, and the
`/api/remote/events` consumer in `components/JarvisOrb.tsx`. Ask if you
want that version built instead.


## Browser/API authentication

Before exposing the deployment publicly, set `JARVIS_ACCESS_TOKEN` to a long random secret (for example, `openssl rand -hex 32`). The browser will ask for this token once and receive an HttpOnly session cookie. `/api/chat`, `/api/key`, `/api/tts`, and the remote UI endpoints reject unauthenticated requests. Do not put the token in client-side `NEXT_PUBLIC_*` variables or commit it to the repository.

## Docker Compose

`docker-compose.yml` runs JARVIS with a persistent `data/` volume, bound to `127.0.0.1` by default.

```bash
node scripts/setup.mjs                      # once: .env + access token
docker compose up --build                   # JARVIS only
docker compose --profile ollama up --build  # + bundled Ollama, pulls LOCAL_LLM_MODEL (default llama3.2)
```

Using Ollama on the host instead? Set `DOCKER_LLM_BASE_URL=http://host.docker.internal:11434/v1` in `.env`.
Do not set `JARVIS_BIND=0.0.0.0` without HTTPS in front: the login is a token sent over whatever connection you give it.

