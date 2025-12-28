"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRawDealText = generateRawDealText;
const zod_1 = require("zod");
const claude_1 = require("./claude");
const ReqSchema = zod_1.z.object({
    companyName: zod_1.z.string().min(1),
    companyDescription: zod_1.z.string().optional().default(""),
    financialText: zod_1.z.string().optional().default(""),
});
function fallbackRawText(input) {
    const name = input.companyName.trim();
    const desc = input.companyDescription.trim();
    const fin = input.financialText.trim();
    return (`${name} (Confidential)\n\n` +
        `${desc ? `${desc}\n\n` : ""}` +
        `Overview\n` +
        `- Business: ${desc ? "See description above." : "N/A"}\n` +
        `- Geography: N/A\n` +
        `- Sector: N/A\n\n` +
        (fin
            ? `Financials (as provided)\n${fin}\n\n`
            : "") +
        `Transaction\n` +
        `- Ownership is exploring a sell-side process / majority recapitalization.\n`);
}
async function generateRawDealText(reqBody) {
    const parsed = ReqSchema.safeParse(reqBody);
    if (!parsed.success)
        return { ok: false, error: "Invalid request body" };
    const { companyName, companyDescription, financialText } = parsed.data;
    const system = `You are an investment banking analyst.
Write a realistic sell-side teaser-style RAW TEXT blurb (not markdown).
Return STRICT JSON only with exactly: {"rawText":"..."}.
No extra keys. No commentary.`;
    const prompt = `Create a confidential teaser-style blurb for a sell-side M&A process.

Inputs:
- Company name: ${companyName}
- Optional company description (may be empty):
${companyDescription || "(none)"}

- Optional financial input pasted by user (may be empty). It might be an unstructured table:
${financialText || "(none)"}

Requirements:
- Output should look like something a banker would paste into a teaser (short sections, readable).
- If financialText is present, include a "Financials (as provided)" section and do NOT invent numbers beyond what is provided.
- Do not fabricate customers, growth rates, or metrics not present.
- Keep it concise (~150–300 words).

Return STRICT JSON:
{ "rawText": "string" }`;
    const llm = await (0, claude_1.claudeJson)({ system, prompt, maxTokens: 950 });
    if (llm.ok && typeof llm.data?.rawText === "string") {
        const rawText = String(llm.data.rawText).trim();
        return { ok: true, used: "claude", rawText: rawText.slice(0, 6000) };
    }
    return { ok: true, used: "fallback", rawText: fallbackRawText(parsed.data) };
}
