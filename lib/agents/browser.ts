import { promises as fs } from "fs";
import path from "path";

type BrowserState = {
  playwright: any;
  context: any;
  page: any;
  initialized: boolean;
};

const globalKey = "__jarvisMark7Browser";
const globalStore = globalThis as typeof globalThis & { [globalKey]?: BrowserState };

function state(): BrowserState {
  if (!globalStore[globalKey]) globalStore[globalKey] = { playwright: null, context: null, page: null, initialized: false };
  return globalStore[globalKey]!;
}

async function loadPlaywright(): Promise<any> {
  // Optional dependency: deliberately loaded at runtime so Android/Termux
  // installs do not need to bundle Chromium or a native browser package.
  const dynamicImport = new Function("return import('playwright')");
  return dynamicImport();
}

async function ensureBrowser() {
  const s = state();
  if (s.initialized && s.page && !s.page.isClosed()) return s;
  const mod = await loadPlaywright();
  s.playwright = mod;
  const profile = path.join(process.cwd(), "data", "browser-profile");
  await fs.mkdir(profile, { recursive: true });
  s.context = await mod.chromium.launchPersistentContext(profile, {
    headless: process.env.JARVIS_BROWSER_HEADLESS === "true",
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  });
  s.page = s.context.pages()[0] || await s.context.newPage();
  s.page.setDefaultTimeout(Number(process.env.JARVIS_BROWSER_TIMEOUT_MS || 15000));
  s.initialized = true;
  return s;
}

export async function browserControl(action: string, params: Record<string, unknown>) {
  try {
    const s = await ensureBrowser();
    switch (action) {
      case "navigate": {
        const url = String(params.url || "");
        if (!/^https?:\/\//i.test(url)) return "Error: only http(s) URLs are allowed.";
        await s.page.goto(url, { waitUntil: "domcontentloaded" });
        return `Navigated to ${s.page.url()}.`;
      }
      case "get_text":
        return String((await s.page.locator("body").innerText()).slice(0, 8000));
      case "click": {
        const selector = String(params.selector || "");
        if (!selector) return "Error: selector is required.";
        await s.page.locator(selector).first().click();
        return `Clicked ${selector}.`;
      }
      case "type": {
        const selector = String(params.selector || "");
        const text = String(params.text || "");
        if (!selector) return "Error: selector is required.";
        await s.page.locator(selector).first().fill(text);
        return `Typed into ${selector}.`;
      }
      case "screenshot": {
        const output = path.join(process.cwd(), "data", `browser-${Date.now()}.png`);
        await s.page.screenshot({ path: output, fullPage: false });
        return `Browser screenshot saved at ${output}.`;
      }
      default:
        return `Error: unsupported browser action "${action}".`;
    }
  } catch (error) {
    return `Browser automation unavailable or failed: ${error instanceof Error ? error.message : "unknown error"}.`;
  }
}
