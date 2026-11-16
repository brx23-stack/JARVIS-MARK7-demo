// Shared by the server snapshot builder and the Command Center UI (type-only imports on the client).

export type TaskStatus = "planned" | "running" | "completed" | "failed" | "paused";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "verified";

export type TaskView = {
  id: string; goal: string; status: TaskStatus; currentStep: number;
  steps: { id: string; title: string; status: StepStatus; error?: string; result?: string }[];
  toolsUsed: string[]; verification?: { ok: boolean; summary: string };
  createdAt: string; updatedAt: string;
};

export type ApprovalView = {
  id: string; source: "tool" | "autocoder"; title: string; detail: string;
  diff?: string; files?: string[]; createdAt: string;
};

export type Snapshot = {
  at: string;
  system: {
    cpuPercent: number | null; memPercent: number; memUsedGb: number; memTotalGb: number;
    diskPercent: number | null; diskFreeGb: number | null; platform: string; uptimeHours: number;
  };
  tasks: { items: TaskView[]; running: number; paused: number; completed: number; failed: number };
  usage: {
    requests: number; totalTokens: number; costUsd: number | null;
    daily: { day: string; tokens: number; requests: number }[];
    lastByRole: Record<string, number>;
    byProvider: Record<string, { requests: number; tokens: number; costUsd: number | null }>;
  };
  tools: { name: string; description: string; source: string }[];
  memory: { memories: number; graph: Record<string, unknown> | null; episodic: Record<string, unknown> | null };
  calendar: { configured: boolean; events: { summary: string; start: string; end: string; location?: string }[]; error?: string };
  weather: { place: string; tempC: number; condition: string } | null;
  integrations: {
    calendar: boolean; email: boolean; telegram: boolean; discord: boolean;
    autocoder: { enabled: boolean; mode: string; armed: boolean };
    approvalTools: string[];
  };
  approvals: ApprovalView[];
  recentDecisions: { id: string; tool: string; status: string; createdAt: string; result?: string }[];
};
