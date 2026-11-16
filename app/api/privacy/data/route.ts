import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";

export const dynamic = "force-dynamic";
const DATA_DIR = path.join(process.cwd(), "data");
const PERSONAL_FILES = [
  "memory.json", "learning.jsonl", "semantic-memory.json", "memory-graph.json",
  "evolution.json", "agent-tasks.json", "ai-usage.json",
  "autocoder/proposals.json", "autocoder/audit.log",
] as const;
const PERSONAL_DIRS = ["autocoder", "browser-profile"] as const;

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 5, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const exported: Record<string, string | null> = {};
  for (const filename of PERSONAL_FILES) {
    try { exported[filename] = await fs.readFile(path.join(DATA_DIR, filename), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") exported[filename] = null; else throw error; }
  }
  return NextResponse.json({ exportedAt: new Date().toISOString(), format: "jarvis-personal-data-export-v1", files: exported }, {
    headers: { "cache-control": "no-store", "content-disposition": "attachment; filename=jarvis-personal-data-export.json" },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = requireAccess(req, 3, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (req.headers.get("x-jarvis-confirm-delete") !== "DELETE_ALL_PERSONAL_DATA") {
    return NextResponse.json({ error: "Explicit deletion confirmation is required." }, { status: 400 });
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const filename of PERSONAL_FILES) {
    const file = path.join(DATA_DIR, filename);
    try { await fs.rm(file, { force: true }); deleted.push(filename); }
    catch { failed.push(filename); }
  }
  for (const directory of PERSONAL_DIRS) {
    try { await fs.rm(path.join(DATA_DIR, directory), { recursive: true, force: true }); deleted.push(`${directory}/`); }
    catch { failed.push(`${directory}/`); }
  }
  return NextResponse.json({ deleted, failed, note: "This removes the listed local data files plus Autocoder history/snapshots and the local browser profile. It does not remove .env credentials, external provider records, backups outside data/, server logs, or data retained by third-party services." }, { headers: { "cache-control": "no-store" } });
}
