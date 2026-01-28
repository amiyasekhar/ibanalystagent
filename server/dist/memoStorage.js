"use strict";
/**
 * In-memory storage for precedent memos, style guides, and generated memos.
 * Similar to workflows.ts pattern.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.savePrecedent = savePrecedent;
exports.getPrecedent = getPrecedent;
exports.getAllPrecedents = getAllPrecedents;
exports.deletePrecedent = deletePrecedent;
exports.saveStyleGuide = saveStyleGuide;
exports.getStyleGuide = getStyleGuide;
exports.getAllStyleGuides = getAllStyleGuides;
exports.deleteStyleGuide = deleteStyleGuide;
exports.saveGeneratedMemo = saveGeneratedMemo;
exports.getGeneratedMemo = getGeneratedMemo;
exports.getAllGeneratedMemos = getAllGeneratedMemos;
exports.updateMemoStatus = updateMemoStatus;
exports.setMemoExportPath = setMemoExportPath;
exports.deleteGeneratedMemo = deleteGeneratedMemo;
exports.getMemoStats = getMemoStats;
const crypto_1 = require("crypto");
// In-memory stores
const precedents = new Map();
const styleGuides = new Map();
const generatedMemos = new Map();
// Precedent Memos
function savePrecedent(precedent) {
    const full = {
        id: (0, crypto_1.randomUUID)(),
        uploadedAt: new Date(),
        ...precedent,
    };
    precedents.set(full.id, full);
    return full;
}
function getPrecedent(id) {
    return precedents.get(id);
}
function getAllPrecedents() {
    return Array.from(precedents.values());
}
function deletePrecedent(id) {
    return precedents.delete(id);
}
// Style Guides
function saveStyleGuide(styleGuide) {
    styleGuides.set(styleGuide.id, styleGuide);
    return styleGuide;
}
function getStyleGuide(id) {
    return styleGuides.get(id);
}
function getAllStyleGuides() {
    return Array.from(styleGuides.values());
}
function deleteStyleGuide(id) {
    return styleGuides.delete(id);
}
// Generated Memos
function saveGeneratedMemo(memo) {
    generatedMemos.set(memo.id, memo);
    return memo;
}
function getGeneratedMemo(id) {
    return generatedMemos.get(id);
}
function getAllGeneratedMemos() {
    return Array.from(generatedMemos.values());
}
function updateMemoStatus(id, status) {
    const memo = generatedMemos.get(id);
    if (!memo)
        return undefined;
    memo.status = status;
    generatedMemos.set(id, memo);
    return memo;
}
function setMemoExportPath(id, exportPath) {
    const memo = generatedMemos.get(id);
    if (!memo)
        return undefined;
    memo.exportPath = exportPath;
    generatedMemos.set(id, memo);
    return memo;
}
function deleteGeneratedMemo(id) {
    return generatedMemos.delete(id);
}
// Stats
function getMemoStats() {
    return {
        precedentsCount: precedents.size,
        styleGuidesCount: styleGuides.size,
        generatedMemosCount: generatedMemos.size,
    };
}
