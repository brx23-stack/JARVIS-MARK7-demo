# Changelog

## Unreleased (v1.2.0-merged)

### Added
- **Performance Mode restored**: AUTO/HIGH/MEDIUM/LOW render quality with
  FPS monitoring and hysteresis-based automatic adaptation, merged back in
  from Mark 7.1 v1.0.0 (it was dropped from the standalone desktop-mode
  build). Composes correctly with Desktop Mode's pixel-ratio cap instead of
  one overriding the other, including across monitor/resize changes.
- **Adaptive hand-tracking quality restored**: detection interval and
  grab-point smoothing now scale with the active performance quality, also
  merged back in from Mark 7.1 v1.0.0.
- Restored a `try/catch` safety net around `HandTracker.start()` that the
  standalone desktop-mode build had dropped — without it, a failed camera
  or landmarker init could leave the webcam stream open with nothing
  consuming it.
- **Desktop Mode** (unchanged from v1.1.0-desktop-mode): automatic detection
  of desktop PCs (Windows/macOS/Linux) vs. Android/mobile, resolved once
  from the platform rather than viewport width, so resizing a window or
  rotating a phone never flips the mode.
  - `DESKTOP MODE: ACTIVE` / `DESKTOP MODE: OFF` HUD status line.
  - Fullscreen support (button + `F` key) with a `fullscreenchange` listener
    keeping the HUD label in sync.
  - Arrow-key orb rotation on desktop, guarded so it (and other single-key
    shortcuts) never fires while typing in a text field.
  - Desktop-optimized rendering: higher device-pixel-ratio cap for a sharper
    orb, re-applied on every resize so moving the window across monitors
    with different scaling keeps it crisp.
  - Desktop camera constraints drop the mobile-only `facingMode: "user"`
    request and ask for a higher ideal resolution, so external webcams and
    phone-as-webcam virtual cameras work normally and the browser's own
    camera-selection UI can offer a choice when multiple cameras exist —
    still through the exact same single `getUserMedia` call and the same
    MediaPipe hand-tracking pipeline (no second stream, no duplicate
    tracker).
  - Minor large-screen HUD polish (1600px+), scoped strictly behind the
    detected desktop mode so Android/mobile layout and behavior are
    completely unchanged.
- GitHub repository documentation files
- Security policy
- Contribution guidelines
- Code of Conduct
- Changelog

### Unchanged
- AI provider connection popup (Groq/NVIDIA/Gemini), `/api/chat`,
  `/api/key`, and `lib/serverKey.ts` are byte-identical to the original
  Mark 7 v1.0.0 baseline — not touched by this merge.

### Documentation
- Documented multi-provider AI support
- Documented Android/Termux setup
- Documented API-key security expectations
- Documented current performance limitations

## 1.0.0

- JARVIS MARK 7 multi-provider project baseline.

## 2026-09-02 — Memory Graph Intelligence
- Added true depth-limited multi-hop graph retrieval (up to 5 hops).
- Added automatic duplicate entity merging with alias preservation.
- Added semantic-memory states for active, uncertain, and superseded memories.
- Added automatic contradiction detection for matching subject/relation triples.
- Explicit corrections and single-valued preferences can supersede older knowledge.
- Chat memory prompts now instruct JARVIS to reason over connected local knowledge.
- `/api/memory` accepts `depth` for graph retrieval and reports graph depth.

## Unreleased
- Command Center now uses live data; new Tasks, Approvals, Calendar, Memory & Usage and Tools views; approvals inbox (`JARVIS_APPROVAL_TOOLS`); phone layout + installable PWA. See COMMAND_CENTER.md.


## 2026-11-16 — Privacy-first release scope

- Defined MARK 7 as a voice-first personal AI workspace focused on privacy, personal evolution, research, memory, and bounded AI agents.
- Explicitly excluded native desktop, Android, cross-device, and smart-device control from the current release.
- Added server-side local-only privacy policy: loopback Ollama only, no cloud fallback, no network tools, no autonomous agent execution, and no online TTS.
- Added authenticated `/api/privacy` status endpoint.
- Added explicit release-scope gating for legacy device-control tools and Android Hands.
- Rewrote README/security documentation and added architecture, privacy, feature-status, roadmap, AI handoff, and release-checklist documents.
- Important limitations remain: memory files are plaintext; browser speech locality is not guaranteed; full Privacy Center and local STT/TTS are future work.

- Added Personal Evolution goal/milestone tracking and a skill-evidence log in the Command Center.
- Added Privacy & Security view with privacy-mode status and authenticated local-data export/deletion.
- Local-only mode now disables browser speech input/output because browser/OS processing is not guaranteed local.
- Extended Autocoder protections to privacy, evolution, voice, and API policy boundaries; excluded Android source from writable scope.
