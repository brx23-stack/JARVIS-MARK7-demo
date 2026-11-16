# JARVIS MARK 7 architecture

## Product boundary

MARK 7 is the personal AI workspace: conversational AI, memory, research and integrations, learning workflows, agent orchestration, and guarded code assistance. Native desktop control, Android control, cross-device command routing, and smart-device control are excluded from the current product architecture. Do not extend those systems as part of this release without a separately approved architecture proposal.

## High-level layers

1. **Presentation** — Next.js App Router, `components/JarvisOrb.tsx`, Three.js scene, voice UI, Command Center, and PWA shell.
2. **API boundary** — authenticated route handlers under `app/api/*`; `lib/security.ts` validates access and rate-limits requests.
3. **AI provider adapter** — `app/api/chat/route.ts` selects a provider, builds the prompt, runs bounded tool-calling loops, and records usage/memory.
4. **Agent runtime** — `lib/agents/*` plans and executes bounded tasks using the registered tools, task store, and QA verification.
5. **Tool/integration layer** — `lib/tools/*`, `lib/agents/tool-registry.ts`, and optional integration modules. Tools may access network services or local host capabilities; review each before enabling.
6. **Memory and evolution layer** — `lib/memory/*` stores explicit facts, episodic interactions, semantic memories, and graph relations; `lib/evolution/*` stores goals, milestones, and skill evidence in `data/`.
7. **Safety layer** — approval queue, Autocoder guard, provider privacy policy, authentication, rate limits, and optional remote gateway allowlists.

## Request flow

```text
Browser UI
  -> authenticated Next.js API
    -> privacy policy + request validation
      -> selected AI provider
        -> bounded tool loop (if allowed)
          -> local memory or explicitly enabled integration
        -> response + learning/memory consolidation
  -> UI renders response and optional voice output
```

## Privacy policy boundary

`lib/privacy/policy.ts` is the shared runtime policy for local-only mode. New API routes and new tools must consult this policy. Never rely only on hiding a UI control: enforce permissions server-side. If adding a new tool, classify it as local-only safe or network/external and add a test.

## Memory semantics

- Explicit facts are user-provided facts/preferences stored through `memory/store.ts`.
- Episodic learning records interaction and tool-result events through `memory/learning.ts`.
- Semantic memory consolidates durable information through `memory/consolidation.ts`.
- The graph stores typed entity relationships through `memory/graph.ts`.

Memory does not update model weights. Treat recalled items as evidence with provenance/uncertainty, not guaranteed truth. Do not store secrets or sensitive personal information by default.

## Deployment model

The application is a persistent Node.js Next.js server. Some gateway, rate-limit, and approval state is process-local. Do not horizontally scale without moving shared state to a durable shared service and reviewing session consistency. Keep the default bind address loopback.

## Change rules for future contributors

- Preserve existing UI and feature behaviour unless the change request explicitly authorises a redesign.
- Add tests for security policy, data persistence, tool permissions, and API behaviour.
- Update README, feature status, privacy documentation, and AI handoff whenever product scope or data flows change.
- Never claim a feature is complete based only on source presence; distinguish implemented, experimentally wired, and runtime-verified.
