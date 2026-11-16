import { promises as fs } from "fs";
import path from "path";
import type { TaskRecord } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "agent-tasks.json");
let queue: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<TaskRecord[]> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(tasks: TaskRecord[]) {
  queue = queue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tasks.slice(-500), null, 2), "utf8");
    await fs.rename(tmp, FILE);
  });
  await queue;
}

export async function saveTask(task: TaskRecord) {
  const tasks = await readAll();
  const index = tasks.findIndex((x) => x.id === task.id);
  if (index >= 0) tasks[index] = task;
  else tasks.push(task);
  task.updatedAt = new Date().toISOString();
  await writeAll(tasks);
  return task;
}

export async function getTask(id: string) {
  return (await readAll()).find((x) => x.id === id) ?? null;
}

export async function listTasks(limit = 20) {
  return (await readAll()).slice(-Math.max(1, Math.min(limit, 100))).reverse();
}

export async function latestResumableTask() {
  const tasks = await readAll();
  return [...tasks].reverse().find((x) => x.status === "paused" || x.status === "running") ?? null;
}
