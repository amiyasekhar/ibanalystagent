import { z } from "zod";
import { claudeJson } from "./claude";

const ReqSchema = z.object({
  companyName: z.string().min(1),
  companyDescription: z.string().optional().default(""),
  financialText: z.string().optional().default(""),
});

export type GenerateRawDealTextRequest = z.infer<typeof ReqSchema>;

function hasInventedCodename(companyName: string, rawText: string): boolean {
  const name = (companyName || "").trim().toLowerCase();
  const out = (rawText || "").trim();
  const low = out.toLowerCase();
  if (!name) return false;

  // Must mention the provided company name somewhere.
  if (!low.includes(name)) return true;

  // If user didn't provide a "Project X" name, forbid introducing "Project ___".
  const userHasProject = name.includes("project ");
  if (!userHasProject && /\bproject\s+[A-Z][a-zA-Z]+\b/.test(out)) return true;

  // Also forbid "Project [Word]" in all-caps headers.
  if (!userHasProject && /\bPROJECT\s+[A-Z][A-Z]+\b/.test(out)) return true;

  return false;
}

function fallbackRawText(input: GenerateRawDealTextRequest) {
  const name = input.companyName.trim();
  const desc = input.companyDescription.trim();
  const fin = input.financialText.trim();

  return (
    `${name} (Confidential)\n\n` +
    `${desc ? `${desc}\n\n` : ""}` +
    `Overview\n` +
    `- Business: ${desc ? "See description above." : "N/A"}\n` +
    `- Geography: N/A\n` +
    `- Sector: N/A\n\n` +
    (fin
      ? `Financials (as provided)\n${fin}\n\n`
      : "") +
    `Transaction\n` +
    `- Ownership is exploring a sell-side process / majority recapitalization.\n`
  );
}

export async function generateRawDealText(reqBody: unknown): Promise<
  | { ok: true; used: "claude" | "fallback"; rawText: string }
  | { ok: false; error: string }
> {
  const parsed = ReqSchema.safeParse(reqBody);
  if (!parsed.success) return { ok: false, error: "Invalid request body" };

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
- Use the company name EXACTLY as provided. Do NOT invent a codename (e.g., "Project Titan") unless the company name itself contains it.
- Do NOT introduce any other company/project names besides the provided company name.
- Keep it concise (~150–300 words).

Return STRICT JSON:
{ "rawText": "string" }`;

  const llm = await claudeJson<{ rawText: string }>({ system, prompt, maxTokens: 950, temperature: 0.2 });

  if (llm.ok && typeof (llm.data as any)?.rawText === "string") {
    const rawText = String((llm.data as any).rawText).trim();
    // Post-check: if the model invented a codename or failed to include the company name, retry once with stricter rules.
    if (hasInventedCodename(companyName, rawText)) {
      const strictPrompt =
        prompt +
        `\n\nABSOLUTE CONSTRAINTS:\n` +
        `- The ONLY allowed name is exactly: "${companyName}".\n` +
        `- Do NOT use "Project ___" or any substitute name.\n` +
        `- Do NOT add claims or numbers not present in financialText.\n`;

      const llm2 = await claudeJson<{ rawText: string }>({ system, prompt: strictPrompt, maxTokens: 950, temperature: 0.1 });
      if (llm2.ok && typeof (llm2.data as any)?.rawText === "string") {
        const rawText2 = String((llm2.data as any).rawText).trim();
        if (!hasInventedCodename(companyName, rawText2)) {
          return { ok: true, used: "claude", rawText: rawText2.slice(0, 6000) };
        }
      }
      // If still violating, fall back to template to guarantee correctness.
      return { ok: true, used: "fallback", rawText: fallbackRawText(parsed.data) };
    }

    return { ok: true, used: "claude", rawText: rawText.slice(0, 6000) };
  }

  return { ok: true, used: "fallback", rawText: fallbackRawText(parsed.data) };
}


