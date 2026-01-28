/**
 * Analyze precedent memos to extract writing style and structure.
 * Uses Claude to learn firm-specific patterns.
 */

import { claudeJson } from "./claude";
import { log } from "./logger";
import { StyleGuide, PrecedentMemo } from "./memoTypes";
import { randomUUID } from "crypto";

interface AnalysisResult {
  ok: boolean;
  styleGuide?: StyleGuide;
  error?: string;
}

/**
 * Analyze multiple precedent memos to create a style guide.
 */
export async function analyzeStyleFromPrecedents(
  precedents: PrecedentMemo[],
  firmName?: string
): Promise<AnalysisResult> {
  if (precedents.length === 0) {
    return { ok: false, error: "No precedent memos provided" };
  }

  try {
    // Prepare precedent texts for analysis
    const precedentTexts = precedents
      .map((p, idx) => {
        return `\n=== PRECEDENT MEMO ${idx + 1}: ${p.filename} ===\n${p.extractedText || ""}`;
      })
      .join("\n\n");

    // Build analysis prompt
    const system = `You are an expert at analyzing investment memo writing styles.
Your task is to extract the common patterns, structure, and vocabulary from precedent memos.
Return STRICT JSON only. No markdown.`;

    const prompt = `Analyze these ${precedents.length} precedent investment memos and extract the writing style:

${precedentTexts}

Extract the following patterns:
1. Common section names and their typical order
2. Heading style (title-case, all-caps, sentence-case)
3. Common vocabulary and phrases used repeatedly
4. Average section length (in sentences)
5. Tone and formality level

Return JSON in this exact format:
{
  "sections": ["Executive Summary", "Company Overview", ...],
  "headingStyle": "title-case" | "all-caps" | "sentence-case",
  "commonPhrases": ["compelling opportunity", "strong management team", ...],
  "averageSectionLength": 5,
  "vocabulary": {
    "EBITDA": 10,
    "strategic": 5,
    ...
  },
  "tone": "formal" | "conversational" | "technical"
}`;

    const result = await claudeJson<{
      sections: string[];
      headingStyle: string;
      commonPhrases: string[];
      averageSectionLength: number;
      vocabulary: Record<string, number>;
      tone: string;
    }>({
      system,
      prompt,
      maxTokens: 4096,
    });

    if (!result.ok) {
      log.error("style guide analysis failed", { error: result.error });
      return { ok: false, error: result.error || "Claude analysis failed" };
    }

    const analysis = result.data;

    // Build style guide
    const styleGuide: StyleGuide = {
      id: randomUUID(),
      firmName,
      sections: analysis.sections || [],
      vocabulary: analysis.vocabulary || {},
      formattingPatterns: {
        averageSectionLength: analysis.averageSectionLength || 5,
        headingStyle: analysis.headingStyle || "title-case",
        commonPhrases: analysis.commonPhrases || [],
      },
      precedentIds: precedents.map((p) => p.id),
      createdAt: new Date(),
    };

    log.info("style guide created", {
      styleGuideId: styleGuide.id,
      sectionsCount: styleGuide.sections.length,
      precedentsUsed: precedents.length,
    });

    return { ok: true, styleGuide };
  } catch (e: any) {
    log.error("style guide analysis exception", { message: e.message });
    return { ok: false, error: e.message || "Unknown error" };
  }
}

/**
 * Get default style guide (when no precedents available).
 */
export function getDefaultStyleGuide(): StyleGuide {
  return {
    id: "default",
    firmName: "Default Template",
    sections: [
      "Executive Summary",
      "Company Overview",
      "Market Analysis",
      "Financial Performance",
      "Investment Thesis",
      "Risk Factors",
      "Valuation",
      "Recommendation",
    ],
    vocabulary: {},
    formattingPatterns: {
      averageSectionLength: 5,
      headingStyle: "title-case",
      commonPhrases: [],
    },
    precedentIds: [],
    createdAt: new Date(),
  };
}
