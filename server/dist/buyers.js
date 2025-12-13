"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUYERS = void 0;
exports.loadBuyers = loadBuyers;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("./logger");
const FALLBACK_BUYERS = [
    {
        id: "b1",
        name: "Summit Peak Capital",
        type: "Private Equity",
        sectorFocus: ["Software", "Business Services"],
        geographies: ["US", "Canada", "UK"],
        minEbitda: 3,
        maxEbitda: 20,
        minDealSize: 20,
        maxDealSize: 150,
        dryPowder: 500,
        pastDeals: 18,
        strategyTags: ["buy-and-build", "roll-up", "majority-stake"],
    },
];
function repoRoot() {
    return node_path_1.default.resolve(__dirname, "..", "..");
}
function loadBuyers() {
    try {
        const filePath = node_path_1.default.join(repoRoot(), "server", "data", "buyers.json");
        if (!node_fs_1.default.existsSync(filePath)) {
            logger_1.log.warn("buyers.json not found; using fallback buyer list", { filePath });
            return FALLBACK_BUYERS;
        }
        const raw = node_fs_1.default.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        const buyers = Array.isArray(parsed?.buyers) ? parsed.buyers : null;
        if (!buyers) {
            logger_1.log.warn("buyers.json invalid; using fallback buyer list", { filePath });
            return FALLBACK_BUYERS;
        }
        // shallow sanitize
        return buyers
            .filter((b) => b?.id && b?.name)
            .map((b) => ({
            id: String(b.id),
            name: String(b.name),
            type: b.type === "Strategic" ? "Strategic" : "Private Equity",
            sectorFocus: Array.isArray(b.sectorFocus) ? b.sectorFocus : ["Other"],
            geographies: Array.isArray(b.geographies) ? b.geographies.map(String) : ["US"],
            minEbitda: Number(b.minEbitda) || 0,
            maxEbitda: Number(b.maxEbitda) || 0,
            minDealSize: Number(b.minDealSize) || 0,
            maxDealSize: Number(b.maxDealSize) || 0,
            dryPowder: Number(b.dryPowder) || 0,
            pastDeals: Number(b.pastDeals) || 0,
            strategyTags: Array.isArray(b.strategyTags) ? b.strategyTags.map(String) : [],
        }));
    }
    catch (e) {
        logger_1.log.warn("Failed to load buyers.json; using fallback buyer list", { error: e?.message || String(e) });
        return FALLBACK_BUYERS;
    }
}
// Default export used throughout server
exports.BUYERS = loadBuyers();
