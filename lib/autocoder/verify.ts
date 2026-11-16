// Verification: type-check the project and compare against the pre-edit baseline,
// so only errors the autocoder INTRODUCED count against it.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { projectRoot } from "./guard";

export type CheckResult = { skipped: boolean; errors: string[]; note?: string };

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; missing?: boolean }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: projectRoot(), timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err: any, stdout, stderr) => {
      if (err && err.code === "ENOENT") return resolve({ code: 127, out: "", missing: true });
      resolve({ code: typeof err?.code === "number" ? err.code : err ? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

// "lib/x.ts(12,5): error TS2322: msg" -> "lib/x.ts: error TS2322: msg"  (line numbers shift after edits)
const normalize = (line: string) => line.replace(/\(\d+,\d+\)/, "").trim();

export async function typecheck(): Promise<CheckResult> {
  const tsc = path.join(projectRoot(), "node_modules", "typescript", "bin", "tsc");
  try { await fs.access(tsc); } catch { return { skipped: true, errors: [], note: "typescript is not installed (run npm install)" }; }
  const r = await run(process.execPath, [tsc, "--noEmit", "-p", "tsconfig.json", "--incremental", "false"], 180_000);
  const errors = r.out.split("\n").filter((l) => /error TS\d+:/.test(l)).map(normalize);
  return { skipped: false, errors: [...new Set(errors)] };
}

export async function pythonCheck(files: string[]): Promise<CheckResult> {
  const py = files.filter((f) => f.endsWith(".py"));
  if (!py.length) return { skipped: false, errors: [] };
  const errors: string[] = [];
  for (const exe of process.platform === "win32" ? ["python"] : ["python3", "python"]) {
    const r = await run(exe, ["-m", "py_compile", ...py], 30_000);
    if (r.missing) continue;
    if (r.code !== 0) errors.push(...r.out.split("\n").filter(Boolean).slice(0, 10).map((l) => `python: ${l.trim()}`));
    return { skipped: false, errors };
  }
  return { skipped: true, errors: [], note: "python not found" };
}

export function newErrors(baseline: string[], after: string[]): string[] {
  const base = new Set(baseline);
  return after.filter((e) => !base.has(e));
}
