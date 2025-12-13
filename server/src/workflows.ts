import { randomUUID } from "node:crypto";
import { AgentResult } from "./agent";
import { DealInput } from "./types";

export type WorkflowRun = {
  id: string;
  type: "extract" | "match";
  at: string; // ISO
  ok: boolean;
  note?: string;
};

export type WorkflowState = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deal?: DealInput;
  lastResult?: AgentResult;
  runs: WorkflowRun[];
};

const workflows = new Map<string, WorkflowState>();

function nowIso() {
  return new Date().toISOString();
}

export function createWorkflow(initial?: { deal?: DealInput }): WorkflowState {
  const id = randomUUID();
  const t = nowIso();
  const wf: WorkflowState = {
    id,
    createdAt: t,
    updatedAt: t,
    deal: initial?.deal,
    runs: [],
  };
  workflows.set(id, wf);
  return wf;
}

export function getWorkflow(id: string): WorkflowState | null {
  return workflows.get(id) ?? null;
}

export function requireWorkflow(id: string): WorkflowState {
  const wf = getWorkflow(id);
  if (!wf) throw new Error("Workflow not found");
  return wf;
}

export function updateDeal(id: string, deal: DealInput): WorkflowState {
  const wf = requireWorkflow(id);
  wf.deal = deal;
  wf.updatedAt = nowIso();
  return wf;
}

export function recordRun(id: string, run: Omit<WorkflowRun, "id" | "at">): WorkflowRun {
  const wf = requireWorkflow(id);
  const r: WorkflowRun = { id: randomUUID(), at: nowIso(), ...run };
  wf.runs.unshift(r);
  wf.updatedAt = nowIso();
  return r;
}

export function setResult(id: string, result: AgentResult): WorkflowState {
  const wf = requireWorkflow(id);
  wf.lastResult = result;
  wf.updatedAt = nowIso();
  return wf;
}


