"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkflow = createWorkflow;
exports.getWorkflow = getWorkflow;
exports.requireWorkflow = requireWorkflow;
exports.updateDeal = updateDeal;
exports.recordRun = recordRun;
exports.setResult = setResult;
const node_crypto_1 = require("node:crypto");
const workflows = new Map();
function nowIso() {
    return new Date().toISOString();
}
function createWorkflow(initial) {
    const id = (0, node_crypto_1.randomUUID)();
    const t = nowIso();
    const wf = {
        id,
        createdAt: t,
        updatedAt: t,
        deal: initial?.deal,
        runs: [],
    };
    workflows.set(id, wf);
    return wf;
}
function getWorkflow(id) {
    return workflows.get(id) ?? null;
}
function requireWorkflow(id) {
    const wf = getWorkflow(id);
    if (!wf)
        throw new Error("Workflow not found");
    return wf;
}
function updateDeal(id, deal) {
    const wf = requireWorkflow(id);
    wf.deal = deal;
    wf.updatedAt = nowIso();
    return wf;
}
function recordRun(id, run) {
    const wf = requireWorkflow(id);
    const r = { id: (0, node_crypto_1.randomUUID)(), at: nowIso(), ...run };
    wf.runs.unshift(r);
    wf.updatedAt = nowIso();
    return r;
}
function setResult(id, result) {
    const wf = requireWorkflow(id);
    wf.lastResult = result;
    wf.updatedAt = nowIso();
    return wf;
}
