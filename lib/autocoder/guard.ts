// ——— Autocoder guard ———
// Every path the autocoder reads or writes goes through here. The model never
// gets to pick an arbitrary filesystem location: only project source files in
// allowlisted folders, and never the files that protect the system itself.

import path from "node:path";
import { promises as fs } from "node:fs";

export const MAX_FILES_PER_PROPOSAL = 6;
export const MAX_EDITS_PER_PROPOSAL = 20;
export const MAX_FILE_BYTES = 400_000;
export const MAX_NEW_FILE_BYTES = 60_000;

const ALLOWED_DIRS = ["app", "components", "lib", "scripts", "docs"];
const ALLOWED_EXT = new Set([".ts", ".tsx", ".css", ".md", ".py"]);

// Things the autocoder may NEVER modify, even if the model asks nicely.
const PROTECTED: RegExp[] = [
  /^\.env/i,
  /^data\//,
  /^node_modules\//,
  /^\.next\//,
  /^\.git\//,
  /^package(-lock)?\.json$/,
  /^tsconfig\.json$/,
  /^next\.config\./,
  /^Dockerfile$/,
  /^\.dockerignore$/,
  /^SECURITY\.md$/,
  /^lib\/security\.ts$/,
  /^lib\/serverKey\.ts$/,
  /^lib\/privacy\//,
  /^lib\/tools\/execute\.ts$/,
  /^lib\/voice\/speechRecognition\.ts$/,
  /^lib\/voice\/voiceRouter\.ts$/,
  /^lib\/agents\/provider\.ts$/,
  /^app\/layout\.tsx$/,
  /^app\/api\/chat\//,
  /^app\/api\/agent\//,
  /^app\/api\/tts\//,
  /^app\/api\/realtime\//,
  /^app\/api\/briefing\//,
  /^app\/api\/stocks\//,
  /^app\/api\/system-check\//,
  /^components\/commandcenter\/PrivacyView\.tsx$/,
  /^lib\/evolution\//,
  /^app\/api\/privacy\//,
  /^app\/api\/evolution\//,
  /^app\/api\/android\//,
  /^lib\/agents\/androidTools\.ts$/,
  /^lib\/system\/control\.ts$/,
  /^lib\/smarthome\//,
  /^android\//,
  /^lib\/autocoder\//,
  /^app\/api\/autocoder\//,
  /^components\/addons\/Autocoder/,
  /^lib\/agents\/tool-registry\.ts$/,
  /^lib\/plugins\//,
  /^plugins\//,
  /^lib\/remote\//,
  /^app\/api\/remote\//,
  /^app\/api\/key\//,
  /^android\/policy\.py$/,
];

function extraProtected(): RegExp[] {
  return (process.env.AUTOCODER_PROTECTED || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .map((p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")));
}

export const projectRoot = () => process.cwd();

export function normalizeRel(input: string): string {
  return String(input ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

// Protection must not depend on letter case: Windows and macOS filesystems are case-insensitive,
// so "lib/Security.ts" and "lib/security.ts" are the same file there.
export function isProtected(rel: string): boolean {
  return [...PROTECTED, ...extraProtected()].some((re) => new RegExp(re.source, "i").test(rel));
}

/** New or edited API routes must keep authentication, because the model cannot be trusted to add it. */
export function routeAuthProblem(rel: string, before: string | null, after: string): string | null {
  if (!/^app\/api\/.+\/route\.ts$/i.test(rel)) return null;
  if (after.includes("requireAccess(")) return null;
  if (before === null) return `new API route ${rel} must call requireAccess(...) (new routes may not be unauthenticated)`;
  if (before.includes("requireAccess(")) return `edit would remove authentication from ${rel}`;
  return null;
}

export type PathCheck = { ok: true; rel: string; abs: string } | { ok: false; error: string };

export async function checkPath(input: string, opts: { forWrite: boolean }): Promise<PathCheck> {
  const rel = normalizeRel(input);
  if (!rel || rel.includes("\0")) return { ok: false, error: "empty or invalid path" };
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return { ok: false, error: `absolute path not allowed: ${rel}` };
  const normalized = path.posix.normalize(rel);
  if (normalized.startsWith("..") || normalized.includes("/../")) return { ok: false, error: `path escapes project: ${rel}` };
  const top = normalized.split("/")[0];
  if (!ALLOWED_DIRS.includes(top)) return { ok: false, error: `folder not allowed: ${top}/` };
  if (!ALLOWED_EXT.has(path.posix.extname(normalized).toLowerCase())) return { ok: false, error: `file type not allowed: ${normalized}` };
  if (opts.forWrite && isProtected(normalized)) return { ok: false, error: `protected file: ${normalized}` };

  const root = await fs.realpath(projectRoot());
  const abs = path.join(root, normalized);
  // Resolve symlinks on the deepest existing ancestor and make sure we stay inside the project.
  let probe = abs;
  for (;;) {
    try { probe = await fs.realpath(probe); break; }
    catch { const parent = path.dirname(probe); if (parent === probe) break; probe = parent; }
  }
  if (probe !== root && !probe.startsWith(root + path.sep)) return { ok: false, error: `symlink escapes project: ${normalized}` };
  // On case-insensitive filesystems the on-disk spelling can differ from what was requested, so also
  // test the real (canonical) relative path against the protected list.
  if (opts.forWrite && probe !== root) {
    const realRel = path.relative(root, probe).split(path.sep).join("/");
    if (isProtected(realRel)) return { ok: false, error: `protected file: ${realRel}` };
  }
  return { ok: true, rel: normalized, abs };
}

/** Readable source files the model may be shown (protected files are readable-by-name but never editable). */
export async function listSourceFiles(): Promise<{ path: string; bytes: number }[]> {
  const root = projectRoot();
  const out: { path: string; bytes: number }[] = [];
  async function walk(dirRel: string) {
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await fs.readdir(path.join(root, dirRel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") await walk(rel); continue; }
      if (!ALLOWED_EXT.has(path.posix.extname(rel).toLowerCase())) continue;
      if (isProtected(rel)) continue;
      const st = await fs.stat(path.join(root, rel)).catch(() => null);
      if (st && st.size <= MAX_FILE_BYTES) out.push({ path: rel, bytes: st.size });
    }
  }
  for (const d of ALLOWED_DIRS) await walk(d);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
