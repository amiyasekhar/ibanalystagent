"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureUploadsDir = ensureUploadsDir;
exports.sanitizeFilename = sanitizeFilename;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function ensureUploadsDir() {
    const dir = node_path_1.default.resolve(process.cwd(), "uploads");
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
function sanitizeFilename(name) {
    return (name || "file")
        .replace(/[^\w.\-]+/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 140);
}
