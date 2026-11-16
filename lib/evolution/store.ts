import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "evolution.json");

export type EvolutionMilestone = { id: string; title: string; completed: boolean; completedAt?: string; evidence?: string };
export type EvolutionGoal = {
  id: string; title: string; description: string; category: string;
  status: "active" | "paused" | "completed";
  targetDate?: string; milestones: EvolutionMilestone[];
  createdAt: string; updatedAt: string;
};
export type SkillEvidence = { id: string; skill: string; description: string; createdAt: string };
export type EvolutionData = { goals: EvolutionGoal[]; evidence: SkillEvidence[] };

let writeQueue: Promise<unknown> = Promise.resolve();

async function readData(): Promise<EvolutionData> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.goals) && Array.isArray(parsed.evidence)) return parsed as EvolutionData;
  } catch { /* first run or unreadable file: return an empty workspace */ }
  return { goals: [], evidence: [] };
}

async function writeData(data: EvolutionData): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temp = `${FILE}.tmp`;
    await fs.writeFile(temp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, FILE);
  });
  await writeQueue;
}

const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export async function getEvolutionData(): Promise<EvolutionData> { return readData(); }

export async function createEvolutionGoal(input: { title: string; description?: string; category?: string; targetDate?: string; milestones?: string[] }): Promise<EvolutionGoal> {
  const title = clean(input.title, 120);
  if (!title) throw new Error("Goal title is required.");
  const now = new Date().toISOString();
  const goal: EvolutionGoal = {
    id: crypto.randomUUID(), title, description: clean(input.description, 1000),
    category: clean(input.category, 60) || "General", status: "active",
    targetDate: /^\d{4}-\d{2}-\d{2}$/.test(input.targetDate || "") ? input.targetDate : undefined,
    milestones: (input.milestones || []).slice(0, 12).map((item) => ({ id: crypto.randomUUID(), title: clean(item, 140), completed: false })).filter((item) => item.title),
    createdAt: now, updatedAt: now,
  };
  const data = await readData(); data.goals.unshift(goal); await writeData(data); return goal;
}

export async function updateEvolutionGoal(id: string, patch: { status?: EvolutionGoal["status"]; milestoneId?: string; completed?: boolean; evidence?: string }): Promise<EvolutionGoal | null> {
  const data = await readData();
  const goal = data.goals.find((item) => item.id === id);
  if (!goal) return null;
  if (patch.status && ["active", "paused", "completed"].includes(patch.status)) goal.status = patch.status;
  if (patch.milestoneId) {
    const milestone = goal.milestones.find((item) => item.id === patch.milestoneId);
    if (!milestone) return null;
    milestone.completed = Boolean(patch.completed);
    milestone.completedAt = milestone.completed ? new Date().toISOString() : undefined;
    milestone.evidence = clean(patch.evidence, 500) || undefined;
    if (goal.milestones.length && goal.milestones.every((item) => item.completed)) goal.status = "completed";
    else if (goal.status === "completed") goal.status = "active";
  }
  goal.updatedAt = new Date().toISOString(); await writeData(data); return goal;
}

export async function deleteEvolutionGoal(id: string): Promise<boolean> {
  const data = await readData(); const next = data.goals.filter((item) => item.id !== id);
  if (next.length === data.goals.length) return false;
  data.goals = next; await writeData(data); return true;
}

export async function addSkillEvidence(input: { skill: string; description: string }): Promise<SkillEvidence> {
  const skill = clean(input.skill, 80); const description = clean(input.description, 800);
  if (!skill || !description) throw new Error("Skill and evidence description are required.");
  const item = { id: crypto.randomUUID(), skill, description, createdAt: new Date().toISOString() };
  const data = await readData(); data.evidence.unshift(item); data.evidence = data.evidence.slice(0, 500); await writeData(data); return item;
}
