export type AgentRole = "planner" | "executor" | "verifier";

export type AgentStep = {
  id: string;
  title: string;
  objective: string;
  dependencies: string[];
  status: "pending" | "running" | "completed" | "failed" | "verified";
  attempts: number;
  result?: string;
  error?: string;
};

export type AgentPlan = {
  id: string;
  goal: string;
  steps: AgentStep[];
  createdAt: string;
};

export type TaskRecord = {
  id: string;
  goal: string;
  status: "planned" | "running" | "completed" | "failed" | "paused";
  plan: AgentPlan;
  currentStep: number;
  toolsUsed: string[];
  verification?: {
    ok: boolean;
    summary: string;
    checkedAt: string;
    failedSteps?: string[];
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
