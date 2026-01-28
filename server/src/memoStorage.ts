/**
 * In-memory storage for precedent memos, style guides, and generated memos.
 * Similar to workflows.ts pattern.
 */

import { PrecedentMemo, StyleGuide, GeneratedMemo } from "./memoTypes";
import { randomUUID } from "crypto";

// In-memory stores
const precedents = new Map<string, PrecedentMemo>();
const styleGuides = new Map<string, StyleGuide>();
const generatedMemos = new Map<string, GeneratedMemo>();

// Precedent Memos
export function savePrecedent(precedent: Omit<PrecedentMemo, "id" | "uploadedAt">): PrecedentMemo {
  const full: PrecedentMemo = {
    id: randomUUID(),
    uploadedAt: new Date(),
    ...precedent,
  };
  precedents.set(full.id, full);
  return full;
}

export function getPrecedent(id: string): PrecedentMemo | undefined {
  return precedents.get(id);
}

export function getAllPrecedents(): PrecedentMemo[] {
  return Array.from(precedents.values());
}

export function deletePrecedent(id: string): boolean {
  return precedents.delete(id);
}

// Style Guides
export function saveStyleGuide(styleGuide: StyleGuide): StyleGuide {
  styleGuides.set(styleGuide.id, styleGuide);
  return styleGuide;
}

export function getStyleGuide(id: string): StyleGuide | undefined {
  return styleGuides.get(id);
}

export function getAllStyleGuides(): StyleGuide[] {
  return Array.from(styleGuides.values());
}

export function deleteStyleGuide(id: string): boolean {
  return styleGuides.delete(id);
}

// Generated Memos
export function saveGeneratedMemo(memo: GeneratedMemo): GeneratedMemo {
  generatedMemos.set(memo.id, memo);
  return memo;
}

export function getGeneratedMemo(id: string): GeneratedMemo | undefined {
  return generatedMemos.get(id);
}

export function getAllGeneratedMemos(): GeneratedMemo[] {
  return Array.from(generatedMemos.values());
}

export function updateMemoStatus(
  id: string,
  status: "draft" | "reviewed" | "final"
): GeneratedMemo | undefined {
  const memo = generatedMemos.get(id);
  if (!memo) return undefined;

  memo.status = status;
  generatedMemos.set(id, memo);
  return memo;
}

export function setMemoExportPath(id: string, exportPath: string): GeneratedMemo | undefined {
  const memo = generatedMemos.get(id);
  if (!memo) return undefined;

  memo.exportPath = exportPath;
  generatedMemos.set(id, memo);
  return memo;
}

export function deleteGeneratedMemo(id: string): boolean {
  return generatedMemos.delete(id);
}

// Stats
export function getMemoStats() {
  return {
    precedentsCount: precedents.size,
    styleGuidesCount: styleGuides.size,
    generatedMemosCount: generatedMemos.size,
  };
}
