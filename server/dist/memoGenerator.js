"use strict";
/**
 * Generate investment memos following firm-specific style guides.
 * Core CrossCourt AI functionality: 80% automation of memo writing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateInvestmentMemo = generateInvestmentMemo;
exports.memoToDocxData = memoToDocxData;
const claude_1 = require("./claude");
const logger_1 = require("./logger");
const crypto_1 = require("crypto");
const styleGuideAnalyzer_1 = require("./styleGuideAnalyzer");
/**
 * Generate an investment memo following a style guide.
 */
async function generateInvestmentMemo(request, styleGuide) {
    try {
        // Use default style guide if none provided
        const guide = styleGuide || (0, styleGuideAnalyzer_1.getDefaultStyleGuide)();
        const { dealName, dealData } = request;
        // Build generation prompt
        const system = `You are an expert investment memo writer.
Generate a comprehensive, professional investment memo following the provided style guide.
Return STRICT JSON only. No markdown.`;
        const prompt = `Generate an investment memo for this opportunity:

**Deal:** ${dealName}
**Sector:** ${dealData.sector}
**Geography:** ${dealData.geography}
**Revenue:** $${dealData.revenue}M
**EBITDA:** $${dealData.ebitda}M
**Deal Size:** $${dealData.dealSize}M
**Description:** ${dealData.description}
${dealData.highlights ? `\n**Highlights:**\n${dealData.highlights.map((h) => `- ${h}`).join("\n")}` : ""}
${dealData.riskFactors ? `\n**Risk Factors:**\n${dealData.riskFactors.map((r) => `- ${r}`).join("\n")}` : ""}

**STYLE GUIDE:**
- Use these section names IN THIS ORDER: ${guide.sections.join(", ")}
- Heading style: ${guide.formattingPatterns.headingStyle}
- Target ${guide.formattingPatterns.averageSectionLength} sentences per section
${guide.formattingPatterns.commonPhrases.length > 0 ? `- Use phrases like: ${guide.formattingPatterns.commonPhrases.slice(0, 5).join(", ")}` : ""}
${guide.firmName && guide.firmName !== "Default Template" ? `- Write in the style of ${guide.firmName}` : ""}

IMPORTANT:
- Be specific and professional
- Use actual numbers from the deal data
- Make realistic assessments
- Each section should have 3-7 paragraphs
- No placeholder text or [brackets]

Return JSON in this exact format:
{
  "title": "Investment Memo: [Deal Name]",
  "sections": [
    {
      "heading": "Executive Summary",
      "level": 1,
      "content": ["Paragraph 1...", "Paragraph 2...", ...]
    },
    ...
  ]
}`;
        const result = await (0, claude_1.claudeJson)({
            system,
            prompt,
            maxTokens: 8192, // Longer output for full memo
        });
        if (!result.ok) {
            logger_1.log.error("memo generation failed", { error: result.error });
            return { ok: false, error: result.error || "Claude generation failed" };
        }
        const generated = result.data;
        // Build memo object
        const memo = {
            id: (0, crypto_1.randomUUID)(),
            dealId: request.dealId,
            dealName,
            styleGuideId: guide.id,
            title: generated.title || `Investment Memo: ${dealName}`,
            date: new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
            }),
            author: guide.firmName && guide.firmName !== "Default Template" ? guide.firmName : undefined,
            sections: generated.sections.map((s) => ({
                heading: s.heading,
                level: s.level || 1,
                content: s.content,
            })),
            status: "draft",
            generatedAt: new Date(),
        };
        logger_1.log.info("memo generated", {
            memoId: memo.id,
            dealName,
            sectionsCount: memo.sections.length,
            styleGuideUsed: guide.id,
        });
        return { ok: true, memo };
    }
    catch (e) {
        logger_1.log.error("memo generation exception", { message: e.message });
        return { ok: false, error: e.message || "Unknown error" };
    }
}
/**
 * Convert a generated memo to DOCX format data.
 */
function memoToDocxData(memo) {
    return {
        title: memo.title,
        date: memo.date,
        author: memo.author,
        sections: memo.sections.map((s) => ({
            heading: s.heading,
            level: s.level,
            content: s.content,
        })),
    };
}
