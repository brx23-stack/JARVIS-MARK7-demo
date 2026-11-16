import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProviderAllowed,
  filterToolsForPrivacyMode,
  getPrivacyMode,
  isToolAllowedInPrivacyMode,
  isToolInCurrentRelease,
} from "../../lib/privacy/policy.ts";

const originalMode = process.env.JARVIS_PRIVACY_MODE;
const originalEndpoint = process.env.LOCAL_LLM_BASE_URL;

test.after(() => {
  if (originalMode === undefined) delete process.env.JARVIS_PRIVACY_MODE;
  else process.env.JARVIS_PRIVACY_MODE = originalMode;
  if (originalEndpoint === undefined) delete process.env.LOCAL_LLM_BASE_URL;
  else process.env.LOCAL_LLM_BASE_URL = originalEndpoint;
});

test("standard mode is the default", () => {
  delete process.env.JARVIS_PRIVACY_MODE;
  assert.equal(getPrivacyMode(), "standard");
});

test("local-only mode permits only Ollama on loopback", () => {
  process.env.JARVIS_PRIVACY_MODE = "local_only";
  process.env.LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";
  assert.doesNotThrow(() => assertProviderAllowed("ollama"));
  assert.throws(() => assertProviderAllowed("openai"), /cloud AI providers are blocked/i);
  process.env.LOCAL_LLM_BASE_URL = "https://example.com/v1";
  assert.throws(() => assertProviderAllowed("ollama"), /localhost, 127\.0\.0\.1, or ::1/i);
});

test("local-only mode filters tools to local memory and time", () => {
  process.env.JARVIS_PRIVACY_MODE = "local_only";
  assert.equal(isToolAllowedInPrivacyMode("remember_fact"), true);
  assert.equal(isToolAllowedInPrivacyMode("web_search"), false);
  assert.equal(isToolAllowedInPrivacyMode("create_calendar_event"), false);
  const tools = filterToolsForPrivacyMode([
    { function: { name: "remember_fact" } },
    { function: { name: "web_search" } },
  ]);
  assert.deepEqual(tools.map((tool) => tool.function?.name), ["remember_fact"]);
});

test("device-control capabilities are excluded from the release in every mode", () => {
  process.env.JARVIS_PRIVACY_MODE = "standard";
  for (const name of ["open_app", "set_system_volume", "media_control", "browser_control", "android_open_app", "smart_home_control"]) {
    assert.equal(isToolInCurrentRelease(name), false, `${name} should be excluded`);
    assert.equal(isToolAllowedInPrivacyMode(name), false, `${name} should be blocked`);
  }
  assert.equal(isToolInCurrentRelease("web_search"), true);
});

test("standard tool list still excludes host/device control", () => {
  process.env.JARVIS_PRIVACY_MODE = "standard";
  const tools = filterToolsForPrivacyMode([
    { function: { name: "web_search" } },
    { function: { name: "open_app" } },
    { function: { name: "android_open_app" } },
  ]);
  assert.deepEqual(tools.map((tool) => tool.function?.name), ["web_search"]);
});
