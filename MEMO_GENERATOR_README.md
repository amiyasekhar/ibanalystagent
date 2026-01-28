# Investment Memo Generator - CrossCourt AI Prototype

## Overview

This is a prototype implementation of CrossCourt AI's core functionality: **automated investment memo generation with 80% automation**.

### Key Features

1. **Precedent Learning**: Upload 3-5 example investment memos (PDF or DOCX)
2. **Style Guide Creation**: AI analyzes your precedents to learn writing patterns, vocabulary, and structure
3. **Memo Generation**: Generate new investment memos in 5-10 minutes following your firm's style
4. **DOCX Export**: Export generated memos to properly formatted Word documents

## Architecture

```
Frontend (HTML/React) → Express API → Claude Sonnet 4.5 (Analysis & Generation)
                                   → Python (Document Processing)
                                   → In-memory Storage
```

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **AI**: Claude Sonnet 4.5 (Anthropic)
- **Document Processing**: Python (python-docx, PyMuPDF)
- **Frontend**: React + Vanilla JS (HTML version)
- **Storage**: In-memory (Map-based)

## Setup

### 1. Install Dependencies

```bash
# Backend
cd server
npm install

# Python
cd ../python_ml
pip install -r requirements.txt
```

### 2. Environment Variables

Ensure `.env` contains:
```
ANTHROPIC_API_KEY=your_claude_api_key_here
PORT=4000
```

### 3. Start the Server

```bash
# From project root
cd server
npm run dev
```

Server runs on `http://localhost:4000`

### 4. Access the Memo Generator

Open in browser:
```
http://localhost:5173/memo.html
```

Or if using the React component:
```
http://localhost:5173
```

## Usage Workflow

### Step 1: Upload Precedent Memos

1. Go to "Upload Precedents" tab
2. Click "Choose Files" and select 3-5 example memos (PDF or DOCX)
3. Click "Upload"
4. System extracts text and identifies document structure

**What it does:**
- Extracts full text from PDFs/DOCX
- Identifies sections and headings
- Prepares for style analysis

### Step 2: Generate Style Guide (Optional)

1. Go to "Create Style Guide" tab
2. Select precedents to analyze
3. Enter firm name (optional)
4. Click "Analyze"

**What it does:**
- Claude analyzes writing patterns across precedents
- Extracts common section names and order
- Identifies vocabulary and phrases
- Determines heading style and tone
- Creates reusable style guide

### Step 3: Generate Investment Memo

1. Go to "Generate Memo" tab
2. Fill in deal details:
   - Deal name (required)
   - Sector, geography, financials
   - Description (required)
   - Highlights (optional)
   - Risk factors (optional)
3. Select style guide or use default template
4. Click "Generate Investment Memo"

**What it does:**
- Takes 5-10 minutes
- Claude generates complete memo following style guide
- Creates sections: Executive Summary, Company Overview, Market Analysis, Financial Performance, Investment Thesis, Risk Factors, Valuation, Recommendation
- Uses deal-specific data and metrics

### Step 4: Export to Word

1. Go to "View Memos" tab
2. Click on a generated memo to preview
3. Click "Export to Word"
4. Download DOCX file

**What you get:**
- Properly formatted Word document
- Headings at correct levels
- Clean paragraph formatting
- Ready for review and editing

## API Endpoints

### Precedent Management
- `POST /api/memos/precedents/upload` - Upload precedent files
- `GET /api/memos/precedents` - List all precedents

### Style Guide
- `POST /api/memos/style-guides/analyze` - Analyze precedents
- `GET /api/memos/style-guides` - List style guides
- `GET /api/memos/style-guides/default` - Get default template

### Memo Generation
- `POST /api/memos/generate` - Generate memo
- `GET /api/memos/generated` - List all generated memos
- `GET /api/memos/generated/:id` - Get specific memo
- `POST /api/memos/generated/:id/export` - Export to DOCX
- `GET /api/memos/download/:filename` - Download exported file

### Stats
- `GET /api/memos/stats` - Get system statistics

## File Structure

```
server/src/
├── memoTypes.ts              # TypeScript types
├── precedentExtractor.ts     # Extract text from PDFs/DOCX
├── styleGuideAnalyzer.ts     # Analyze writing style with Claude
├── memoGenerator.ts          # Generate memos with Claude
├── docExport.ts              # Export to DOCX
├── memoStorage.ts            # In-memory storage
└── index.ts                  # API endpoints (added memo routes)

python_ml/
├── export_docx.py            # DOCX generation
├── extract_precedent.py      # PDF/DOCX text extraction
└── requirements.txt          # Python dependencies

client/
├── memo.html                 # Standalone HTML interface
└── src/MemoGenerator.tsx     # React component (optional)
```

## Example: Generate a Memo

### Request:
```bash
curl -X POST http://localhost:4000/api/memos/generate \
  -H "Content-Type: application/json" \
  -d '{
    "dealName": "Acme SaaS Acquisition",
    "dealData": {
      "sector": "Software",
      "geography": "US",
      "revenue": 50,
      "ebitda": 15,
      "dealSize": 200,
      "description": "Leading vertical SaaS platform for logistics companies with 500+ customers and 90% NRR.",
      "highlights": ["Strong market position", "Recurring revenue model", "Experienced team"],
      "riskFactors": ["Customer concentration", "Competitive market"]
    },
    "useDefaultTemplate": true
  }'
```

### Response:
```json
{
  "ok": true,
  "memo": {
    "id": "uuid",
    "dealName": "Acme SaaS Acquisition",
    "title": "Investment Memo: Acme SaaS Acquisition",
    "sections": [
      {
        "heading": "Executive Summary",
        "level": 1,
        "content": ["Paragraph 1...", "Paragraph 2..."]
      },
      ...
    ],
    "status": "draft",
    "generatedAt": "2024-01-20T..."
  }
}
```

## CrossCourt AI Alignment

This prototype implements CrossCourt AI's core features:

| CrossCourt AI Feature | Implementation |
|----------------------|----------------|
| Learn from precedents (3-5 papers) | ✅ Upload & analyze precedents |
| Capture style, vocabulary, decision rules | ✅ Claude style guide analysis |
| Generate in 5-10 minutes | ✅ Claude memo generation |
| 80% automation | ✅ Full memo draft, human review needed |
| Firm-specific customization | ✅ Style guides per firm |
| Office export (DOCX) | ✅ Python-docx export |

## Performance

- **Precedent Upload**: ~10-30 seconds per file
- **Style Analysis**: ~30-60 seconds (depends on precedent count)
- **Memo Generation**: **5-10 minutes** (Claude Sonnet 4.5)
- **DOCX Export**: ~2-5 seconds

## Limitations

1. **In-memory storage**: Restarts clear all data (use database for production)
2. **No persistence**: Precedents/memos lost on server restart
3. **Single-tenant**: No user accounts or isolation
4. **Basic formatting**: DOCX export is functional but not publication-ready
5. **No versioning**: Can't track memo revisions
6. **No collaboration**: Single-user editing only

## Future Enhancements

### Phase 2 (Multi-Agent Research)
- Web search integration
- Finance API connections (EODHD, Crunchbase)
- Market research agents
- Comparable transaction analysis

### Phase 3 (Investor Reporting)
- Quarterly report automation
- PowerPoint generation
- Chart/graph creation
- Data-driven narratives

### Phase 4 (Production Features)
- PostgreSQL database
- User authentication
- Multi-tenant isolation
- Version control
- Real-time collaboration
- Advanced formatting
- Template library

## Testing

### Manual Test Flow

1. **Prepare Test Files**: Create 3 sample investment memos (or use real ones)
2. **Upload**: Test precedent upload endpoint
3. **Analyze**: Create style guide from precedents
4. **Generate**: Create memo with test deal data
5. **Export**: Download DOCX and verify formatting
6. **Validate**: Check memo follows style guide patterns

### API Testing

```bash
# Health check
curl http://localhost:4000/health

# Upload precedent (multipart)
curl -X POST http://localhost:4000/api/memos/precedents/upload \
  -F "precedents=@memo1.pdf" \
  -F "precedents=@memo2.docx"

# Generate memo
curl -X POST http://localhost:4000/api/memos/generate \
  -H "Content-Type: application/json" \
  -d '{ "dealName": "Test Deal", "dealData": {...} }'

# Get stats
curl http://localhost:4000/api/memos/stats
```

## Troubleshooting

### Python Dependencies Missing
```bash
cd python_ml
pip install python-docx python-pptx PyMuPDF python-dotenv
```

### Claude API Errors
- Check `ANTHROPIC_API_KEY` in `.env`
- Verify API key has sufficient credits
- Check network connectivity

### File Upload Fails
- Ensure `uploads/` directory exists (created automatically)
- Check file size (<25MB)
- Verify PDF/DOCX format

### Memo Generation Timeout
- Increase timeout in `memoGenerator.ts` if needed
- Default: 8192 tokens, may need more for long memos

## Demo Script

**For showcasing the CrossCourt AI prototype:**

1. **Introduction** (1 min)
   - "This is CrossCourt AI's investment memo generator"
   - "80% automation, 5-10 minute generation time"

2. **Upload Precedents** (2 min)
   - Show 3 example memos
   - Upload and extract
   - Show identified sections

3. **Generate Memo** (5-10 min)
   - Enter deal details
   - Click generate
   - **Wait for completion** (use this time to explain the process)

4. **Review & Export** (2 min)
   - Show generated memo
   - Highlight style matching
   - Export to Word
   - Open and show formatting

5. **Q&A** (remaining time)

## License

Prototype for CrossCourt AI demonstration purposes.

## Contact

Built by: [Your Name]
Date: January 2024
Purpose: CrossCourt AI job application prototype
