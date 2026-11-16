import crypto from "node:crypto";
import { searchSemanticMemory, renderSemanticMemory } from "@/lib/memory/consolidation";
import { renderGraphContext } from "@/lib/memory/graph";
import { getToolDefinitions, getTool } from "./tool-registry";
import { agentLLM } from "./provider";
import { parseJson } from "./parseJson";
import { getTask, saveTask } from "./task-store";
import type { AgentPlan, AgentStep, TaskRecord } from "./types";

const MAX_STEPS = 8;
const MAX_TOOL_ROUNDS = 4;

async function makePlan(goal: string, taskId: string): Promise<AgentPlan> {
  const memory = await searchSemanticMemory(goal, 8);
  const graph = await renderGraphContext(goal, 2);
  const prompt = `You are JARVIS Planner. Break the user's goal into a safe, executable plan. Use no more than ${MAX_STEPS} steps. Each step must have one measurable objective and list dependencies by step id. Do not invent capabilities; available tools are listed separately. Return JSON only: {"goal":"...","steps":[{"id":"s1","title":"...","objective":"...","dependencies":[]}]}. Goal: ${goal}\nRelevant memory:\n${memory.map(m => m.text).join("\n")}\n${graph}`;
  const response = await agentLLM([{ role: "system", content: prompt }, { role: "user", content: goal }], { role: "planner", taskId, maxTokens: 900 });
  const parsed = parseJson<{ goal?: string; steps?: Array<{id?: string;title?: string;objective?: string;dependencies?: string[]}> }>(response.content || "");
  const raw = parsed?.steps?.slice(0, MAX_STEPS) ?? [];
  const steps: AgentStep[] = raw.map((s, i) => ({
    id: String(s.id || `s${i + 1}`),
    title: String(s.title || `Step ${i + 1}`).slice(0, 120),
    objective: String(s.objective || s.title || "").slice(0, 1000),
    dependencies: Array.isArray(s.dependencies) ? s.dependencies.slice(0, MAX_STEPS).map(String) : [],
    status: "pending", attempts: 0,
  }));
  if (!steps.length) {
    steps.push({ id: "s1", title: "Execute request", objective: goal, dependencies: [], status: "pending", attempts: 0 });
  }
  return { id: taskId, goal: parsed?.goal || goal, steps, createdAt: new Date().toISOString() };
}

async function executeStep(task: TaskRecord, step: AgentStep): Promise<{ result: string; tools: string[] }> {
  const tools = getToolDefinitions();
  const context = task.plan.steps
    .filter(s => s.status === "completed" || s.status === "verified")
    .map(s => `${s.id}: ${s.result || ""}`)
    .join("\n");
  const messages: any[] = [
    { role: "system", content: `You are JARVIS Executor. Complete exactly the assigned step using available tools. Do not claim success without tool evidence. If a tool is unavailable, explain that and choose a safe fallback. Keep final result concise.\nPrior step results:\n${context}` },
    { role: "user", content: `Task goal: ${task.goal}\nAssigned step: ${step.title}\nObjective: ${step.objective}` },
  ];
  const used: string[] = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await agentLLM(messages, { role: "executor", tools, taskId: task.id, maxTokens: 700 });
    if (!response.tool_calls?.length) return { result: response.content?.trim() || "No executor result.", tools: used };
    messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });
    for (const call of response.tool_calls) {
      const tool = getTool(call.function.name);
      used.push(call.function.name);
      const result = tool
        ? await tool.execute(call.function.arguments)
        : `Error: unknown tool "${call.function.name}".`;
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  const final = await agentLLM(messages, { role: "executor", taskId: task.id, maxTokens: 500 });
  return { result: final.content?.trim() || "Executor reached its tool-call limit.", tools: used };
}

async function verifyTask(task: TaskRecord): Promise<{ ok: boolean; summary: string; failedSteps: string[] }> {
  const evidence = task.plan.steps.map(s => `${s.id} [${s.status}] ${s.title}: ${s.result || s.error || ""}`).join("\n");
  const response = await agentLLM([
    { role: "system", content: "You are JARVIS QA/Verifier. Decide whether the user's goal is actually satisfied based only on the execution evidence. Return JSON only: {\"ok\":true|false,\"summary\":\"...\",\"failedSteps\":[\"s1\"]}. If evidence is missing, say false." },
    { role: "user", content: `Goal: ${task.goal}\nExecution evidence:\n${evidence}` },
  ], { role: "verifier", taskId: task.id, maxTokens: 400 });
  const parsed = parseJson<{ok?: boolean; summary?: string; failedSteps?: string[]}>(response.content || "");
  return {
    ok: Boolean(parsed?.ok),
    summary: String(parsed?.summary || "Verification inconclusive."),
    failedSteps: Array.isArray(parsed?.failedSteps) ? parsed.failedSteps.map(String) : [],
  };
}

export function shouldUseAgentMode(message: string) {
  if (process.env.JARVIS_AGENT_MODE === "always") return true;
  if (process.env.JARVIS_AGENT_MODE === "off") return false;
  const text = message.toLowerCase();
  return message.length >= 90 || /\b(build|create|set up|setup|install|configure|research|find|compare|plan|organize|automate|monitor|analyze|check and|then|after that|make sure|verify)\b/.test(text);
}

export async function runAutonomousTask(goal: string, existingTaskId?: string) {
  const taskId = existingTaskId || `task-${crypto.randomUUID()}`;
  let task = existingTaskId ? await getTask(existingTaskId) : null;
  if (!task) {
    const plan = await makePlan(goal, taskId);
    task = {
      id: taskId, goal, status: "planned", plan, currentStep: 0, toolsUsed: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await saveTask(task);
  }

  task.status = "running";
  await saveTask(task);

  for (let i = task.currentStep; i < task.plan.steps.length; i++) {
    const step = task.plan.steps[i];
    if (step.status === "verified" || step.status === "completed") { task.currentStep = i + 1; continue; }
    const unmet = step.dependencies.some(dep => !task!.plan.steps.find(s => s.id === dep && (s.status === "completed" || s.status === "verified")));
    if (unmet) continue;
    step.status = "running"; step.attempts += 1;
    await saveTask(task);
    try {
      const executed = await executeStep(task, step);
      step.result = executed.result;
      step.status = "completed";
      task.toolsUsed.push(...executed.tools);
    } catch (error) {
      step.status = "failed";
      step.error = error instanceof Error ? error.message : "step failed";
      task.status = "paused";
      await saveTask(task);
      return { task, reply: `Task paused after ${step.title} failed: ${step.error}` };
    }
    task.currentStep = i + 1;
    await saveTask(task);
  }

  const verification = await verifyTask(task);
  task.verification = { ok: verification.ok, summary: verification.summary, failedSteps: verification.failedSteps, checkedAt: new Date().toISOString() };
  if (!verification.ok && verification.failedSteps.length) {
    let earliest = task.plan.steps.length;
    for (const id of verification.failedSteps) {
      const index = task.plan.steps.findIndex(s => s.id === id);
      const step = index >= 0 ? task.plan.steps[index] : undefined;
      if (step) { step.status = "pending"; earliest = Math.min(earliest, index); }
    }
    task.currentStep = earliest < task.plan.steps.length ? earliest : 0;
    task.status = "paused";
    await saveTask(task);
    return { task, reply: `QA could not verify the task. ${verification.summary}` };
  }

  for (const step of task.plan.steps) if (step.status === "completed") step.status = "verified";
  task.status = "completed";
  task.completedAt = new Date().toISOString();
  await saveTask(task);
  return { task, reply: `Task completed and verified. ${verification.summary}` };
}
