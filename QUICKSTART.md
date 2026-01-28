# Investment Memo Generator - Quick Start Guide

## ⚡ 5-Minute Setup

### 1. Ensure Server is Running

```bash
# The server should already be running on port 4000
# If not, start it:
cd server
npm run dev
```

### 2. Access the Memo Generator

Open in your browser:
```
http://localhost:5173/memo.html
```

Or if you're running Vite dev server:
```
cd client
npm run dev
# Then visit the URL shown
```

## 📋 Quick Test Workflow

### Test 1: Check System Status

```bash
curl http://localhost:4000/api/memos/stats
```

**Expected:** `{"ok":true,"stats":{"precedentsCount":0,"styleGuidesCount":0,"generatedMemosCount":0}}`

### Test 2: Generate a Sample Memo (No Precedents)

```bash
curl -X POST http://localhost:4000/api/memos/generate \
  -H "Content-Type: application/json" \
  -d '{
    "dealName": "Test SaaS Company",
    "dealData": {
      "sector": "Software",
      "geography": "US",
      "revenue": 20,
      "ebitda": 6,
      "dealSize": 80,
      "description": "Leading vertical SaaS platform for mid-market logistics companies with 300+ customers and strong retention metrics.",
      "highlights": [
        "90% gross revenue retention",
        "Experienced management team",
        "Strong competitive moat"
      ],
      "riskFactors": [
        "Customer concentration",
        "Competitive market dynamics"
      ]
    },
    "useDefaultTemplate": true
  }' | python3 -m json.tool
```

**Time:** 5-10 minutes
**Expected:** Full investment memo with 8 sections

### Test 3: Export Generated Memo

```bash
# Get the memo ID from Test 2 response
MEMO_ID="paste-id-here"

curl -X POST "http://localhost:4000/api/memos/generated/${MEMO_ID}/export" \
  | python3 -m json.tool

# Download will be available at:
# http://localhost:4000/api/memos/download/[filename]
```

## 🎬 Full Demo Workflow

### Step 1: Prepare Test Data (Optional)

If you have sample investment memos:
- Place PDF or DOCX files in a folder
- Should be 3-5 examples
- Should be similar style/format

### Step 2: Upload Precedents (Optional)

Via UI:
1. Go to "Upload Precedents" tab
2. Click "Choose Files"
3. Select 3-5 PDFs or DOCX files
4. Click "Upload"
5. Wait 10-30 seconds per file

### Step 3: Generate Memo

Via UI:
1. Go to "Generate Memo" tab
2. Fill in:
   - **Deal Name**: "Acme Software Acquisition"
   - **Sector**: Software
   - **Geography**: US
   - **Revenue**: 50 (in $M)
   - **EBITDA**: 15 (in $M)
   - **Deal Size**: 200 (in $M)
   - **Description**: "Leading SaaS platform for logistics companies with 500+ customers, 90% net revenue retention, and strong competitive position."
   - **Highlights**: (one per line)
     ```
     Strong market position
     Recurring revenue model
     Experienced management team
     High customer retention
     ```
   - **Risk Factors**: (one per line)
     ```
     Customer concentration (top 10 = 35%)
     Competitive market
     Technology obsolescence risk
     ```
3. Leave "Use default template" checked (or select a style guide if you created one)
4. Click "Generate Investment Memo"
5. **Wait 5-10 minutes**

### Step 4: View and Export

1. Once generated, automatically switches to "View Memos" tab
2. Click on the memo to see full preview
3. Click "Export to Word"
4. Download starts automatically
5. Open in Word and review

## 🐛 Troubleshooting

### Server Not Running

```bash
cd server
npm run dev
```

Look for: `Server running on http://localhost:4000`

### Port Already in Use

```bash
# Kill existing process
lsof -ti:4000 | xargs kill -9

# Start again
npm run dev
```

### Python Dependencies Missing

```bash
cd python_ml
pip3 install -r requirements.txt
```

### Claude API Errors

Check `.env` file:
```
ANTHROPIC_API_KEY=your_key_here
```

### File Upload Fails

Ensure uploads directory exists:
```bash
mkdir -p server/uploads
mkdir -p exports
```

## 📊 Expected Output

### Generated Memo Structure

```
Investment Memo: [Deal Name]
├── Executive Summary
│   └── 3-5 paragraphs overview
├── Company Overview
│   └── Business model, products, customers
├── Market Analysis
│   └── Market size, growth, competitive landscape
├── Financial Performance
│   └── Revenue, EBITDA, margins, trends
├── Investment Thesis
│   └── Why this is a good investment
├── Risk Factors
│   └── Key risks and mitigation
├── Valuation
│   └── Pricing analysis and multiples
└── Recommendation
    └── Final recommendation and next steps
```

### DOCX Export Format

- Professional formatting
- Heading levels 1-3
- Paragraph spacing
- Clean, readable layout
- Ready for editing in Word

## ⚡ Performance Expectations

| Operation | Time |
|-----------|------|
| Upload precedent (PDF) | 10-30 sec |
| Style guide analysis | 30-60 sec |
| Memo generation | **5-10 min** |
| DOCX export | 2-5 sec |
| Download | Instant |

## 🎯 Success Criteria

✅ Server responds to health check
✅ Stats endpoint returns valid JSON
✅ Memo generation completes without errors
✅ Generated memo has 8 sections
✅ DOCX export creates valid Word file
✅ Memo content is relevant to input data

## 🚀 Advanced Usage

### Create Custom Style Guide

1. Upload 3-5 precedent memos
2. Go to "Create Style Guide" tab (if using React component)
3. Select precedents to analyze
4. Enter firm name (e.g., "Goldman Sachs")
5. Click "Analyze"
6. Wait 30-60 seconds
7. Use this style guide for future memos

### API Integration

```javascript
// JavaScript example
async function generateMemo(dealData) {
  const response = await fetch('http://localhost:4000/api/memos/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dealName: dealData.name,
      dealData: dealData,
      useDefaultTemplate: true
    })
  });

  const result = await response.json();
  return result.memo;
}
```

### Batch Generation

```bash
# Generate multiple memos from JSON file
cat deals.json | jq -c '.[]' | while read deal; do
  curl -X POST http://localhost:4000/api/memos/generate \
    -H "Content-Type: application/json" \
    -d "$deal"
  sleep 600 # Wait 10 minutes between generations
done
```

## 📚 Next Steps

1. ✅ Read `MEMO_GENERATOR_README.md` for full documentation
2. ✅ Review `CROSSCOURT_AI_SUMMARY.md` for technical details
3. ✅ Try the UI at `memo.html`
4. ✅ Test API endpoints
5. ✅ Generate your first memo
6. ✅ Export to Word and review

## 💡 Tips

- **First time**: Use default template (fastest)
- **Better quality**: Upload 3-5 precedents first
- **Faster feedback**: Use smaller deal descriptions
- **Best results**: Provide detailed highlights and risk factors
- **Production use**: Switch to PostgreSQL for persistence

## 🔗 Resources

- Main README: `MEMO_GENERATOR_README.md`
- Summary: `CROSSCOURT_AI_SUMMARY.md`
- UI: `client/memo.html`
- API: `server/src/index.ts` (lines 297-531)

## ✅ Quick Validation

Run these commands to verify everything works:

```bash
# 1. Server health
curl http://localhost:4000/health

# 2. Memo stats
curl http://localhost:4000/api/memos/stats

# 3. Default style guide
curl http://localhost:4000/api/memos/style-guides/default

# 4. Generate test memo (wait 5-10 min)
curl -X POST http://localhost:4000/api/memos/generate \
  -H "Content-Type: application/json" \
  -d '{"dealName":"Test","dealData":{"sector":"Software","geography":"US","revenue":10,"ebitda":3,"dealSize":40,"description":"Test company description"},"useDefaultTemplate":true}'
```

All should return `"ok": true` ✅

---

**Ready to generate your first investment memo!** 🚀

Open `http://localhost:5173/memo.html` and get started!
