# JARVIS + Ollama

## Permanent computer setup

1. Install Ollama on the computer.
2. Download your chosen model, for example:
   `ollama pull llama3.2`
3. Set `LOCAL_LLM_MODEL` in `.env.local` to the installed model.
4. Keep `LLM_PROVIDER=ollama` for offline-first JARVIS.
5. Start Ollama with the operating system so it is available after reboot.
6. Start JARVIS with `npm start` after `npm run build`.

JARVIS never opens an AI/API popup during startup. Say `change AI` to open
provider settings, or `change my API key` for cloud providers. Say `use Ollama`
to activate the local model directly.

Ollama listens locally by default at `http://localhost:11434` and is not exposed
by JARVIS to the public internet.
