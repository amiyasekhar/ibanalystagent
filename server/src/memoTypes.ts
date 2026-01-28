/**
 * Types for Investment Memo Generator (CrossCourt AI prototype)
 */

export interface PrecedentMemo {
  id: string;
  filename: string;
  filePath: string;
  uploadedAt: Date;
  extractedText?: string;
  sections?: PrecedentSection[];
  metadata?: {
    totalPages?: number;
    totalParagraphs?: number;
  };
}

export interface PrecedentSection {
  heading: string;
  level?: number;
  content: string[];
  page?: number;
}

export interface StyleGuide {
  id: string;
  firmName?: string;
  sections: string[]; // Common section names
  vocabulary: Record<string, number>; // Word frequency
  formattingPatterns: {
    averageSectionLength: number;
    headingStyle: string; // "title-case" | "all-caps" | "sentence-case"
    commonPhrases: string[];
  };
  precedentIds: string[]; // Which memos were used to create this
  createdAt: Date;
}

export interface MemoSection {
  heading: string;
  level: number; // 1-3 for heading levels
  content: string | string[]; // Single paragraph or multiple
}

export interface GeneratedMemo {
  id: string;
  dealId?: string;
  dealName: string;
  styleGuideId?: string;
  title: string;
  date?: string;
  author?: string;
  sections: MemoSection[];
  status: "draft" | "reviewed" | "final";
  generatedAt: Date;
  exportPath?: string;
}

export interface MemoGenerationRequest {
  dealId?: string;
  dealName: string;
  dealData: {
    sector: string;
    geography: string;
    revenue: number;
    ebitda: number;
    dealSize: number;
    description: string;
    highlights?: string[];
    riskFactors?: string[];
  };
  styleGuideId?: string;
  useDefaultTemplate?: boolean;
}

export interface MemoGenerationResponse {
  ok: boolean;
  memo?: GeneratedMemo;
  error?: string;
}
