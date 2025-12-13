## IB Analyst Agent (Full‑Stack TS + Python ML)

This repo is a demo “investment banking analyst copilot” that does:

- **Deal extraction agent**: raw text → structured deal fields (Claude-first, deterministic fallback)
- **Buyer ranking/matching**: **Python** logistic regression + feature engineering + mandate filtering
- **Buyer search**: keyword + filter search over a synthetic buyer universe (ranked + explained)
- **Personalized email agent**: outreach drafts via Claude (with template fallback)
- **Analyst workflow simulation**: in-memory workflows with run history (extract → match)
- **Full-stack TypeScript**: React (Vite) client + Node/Express server

### Quickstart

#### 1) Generate synthetic buyer DB + training data + train/export ML model

From repo root:

```bash
python3 python_ml/generate_buyers.py
python3 python_ml/generate_csv.py
python3 python_ml/train.py
```

This creates training/inference artifacts in `python_ml/artifacts/`.

##### Optional: sklearn pipeline (recommended)

```bash
python3 -m pip install -r python_ml/requirements.txt
TRAIN_USE_SKLEARN=1 python3 python_ml/train.py
```

#### 2) Start the server

```bash
cd server
npm install
npm run dev
```

Server runs at `http://localhost:4000`.

#### 3) Start the client

```bash
cd client
npm install
npm run dev
```

Client runs at the Vite URL printed in your terminal (usually `http://localhost:5173`).

### Demo script (2–3 minutes)

#### 0) Prereqs
- Server running: `cd server && npm run dev`
- Client running: `cd client && npm run dev`
- (Optional) Claude enabled: set `ANTHROPIC_API_KEY` in repo-root `.env`

#### 1) Confirm Claude is working (optional)

```bash
curl -sS http://localhost:4000/api/debug/claude
```

You should see `{"ok":true,"data":{"ping":"pong"}}`.

#### 2) Run the main analyst workflow (Extract → Match → Outreach)
1. Open the client in your browser.
2. Click **New workflow**.
3. Paste this into **Raw deal text**:

```text
Project Orion — Vertical SaaS (Transportation Management)

US-based SaaS platform serving mid-market 3PLs and regional carriers. Cloud TMS with carrier integrations, billing automation, and workflow tools. ~80% recurring subscription revenue with multi-year customer relationships.

FY2025E revenue: $18.5m
FY2025E EBITDA: $5.2m
Target EV: ~$70m

Majority transaction preferred. Growth via upsells and channel partnerships.
```

4. Click **Extract fields** (watch the run history update).
5. Click **Match buyers**.
6. In **Output**:
   - **Summary**: teaser-style summary
   - **Buyers**: ranked matches + rationale
   - **Outreach**: drafts (copyable)

#### 3) Try Buyer Search (keywords + filters)
1. Go to **Output → Buyer Search**.
2. Use this search:
   - Query: `buy-and-build roll-up`
   - Type: `Private Equity`
   - Sector: `Software`
   - Geography: `US`
   - Tag: `buy-and-build`
   - EV ($m) min/max: `20` / `150`
   - EBITDA ($m) min/max: `3` / `20`
3. Click **Search** to get ranked buyers + explanations.

#### 4) Debug with logs (single file)

```bash
tail -f server/logs/server.log.txt
```

You’ll see:
- HTTP request/response
- Python inference start/ok/fail
- Claude call succeeded/failed

### Environment variables

#### Server

- `PORT` (default `4000`)
- `ANTHROPIC_API_KEY` (enables Claude for extraction + summary + outreach)
- `CLAUDE_MODEL` (optional)
- `LOG_FILE` (optional): file path for server logs
  - default: `server/logs/server.log.txt` (relative to server working dir)

#### Where to put `.env`

The server explicitly loads **repo-root** `.env` (`./.env`) and then optionally loads `./server/.env` as an override (see `server/src/loadEnv.ts`).

### Logging

The server logs **every request/response**, plus **Python inference** and **Claude calls**, to:
- `server/logs/server.log.txt` (default)

### API

#### Claude debug

- `GET /api/debug/claude`
  - Forces a tiny Claude JSON response so you can confirm the key/model works.

#### Deal extraction

- `POST /api/extract-deal`
  - Body: `{ "rawText": "..." }`
  - Returns: `{ ok: true, used: "claude"|"fallback", deal: { name, sector, geography, revenue, ebitda, dealSize, description } }`

#### Matching

- `POST /api/match-buyers`
  - Supports **legacy** body:
    - `{ dealName, sector, geography, revenueMillions, ebitdaMillions, dealSizeMillions, description }`
  - Also supports **new** body:
    - `{ deal: { name, sector, geography, revenue, ebitda, dealSize, description } }`
  - Returns: `{ dealSummary, buyers: [{name, score, rationale}], outreachDrafts, modelVersion?, llmUsed?, llmError? }`

#### Analyst workflow (in-memory)

- `POST /api/workflows`
  - Creates an in-memory workflow (returns `workflow.id`)
- `GET /api/workflows/:id`
  - Returns workflow state including run history
- `POST /api/workflows/:id/extract`
  - Body: `{ "rawText": "..." }`
  - Extracts and stores `workflow.deal`
- `POST /api/workflows/:id/match`
  - Runs matching + outreach for `workflow.deal` and stores `workflow.lastResult`

#### Buyer search

- `GET /api/buyers/search`
  - Query params (all optional): `q`, `sector`, `geography`, `type`, `tag`, `minDeal`, `maxDeal`, `minEbitda`, `maxEbitda`, `limit`
  - Returns: `{ ok: true, results: [{ id, name, type, sectorFocus, geographies, minDealSize, maxDealSize, minEbitda, maxEbitda, strategyTags, score, reason }] }`

Example:

```bash
curl -sS "http://localhost:4000/api/buyers/search?q=buy-and-build&sector=Software&geography=US&type=Private%20Equity&limit=10"
```

### Where things live

- **Python ML**: `python_ml/train.py`, `python_ml/infer.py`, `python_ml/artifacts/*`
- **Synthetic buyer DB**: `python_ml/generate_buyers.py` → `server/data/buyers.json`
- **Training data generator**: `python_ml/generate_csv.py` → `python_ml/data/training_data.csv`
- **Buyer universe loader**: `server/src/buyers.ts`
- **Buyer search**: `server/src/buyerSearch.ts`
- **Node orchestration**:
  - API routes: `server/src/index.ts`
  - Matching + outreach agent: `server/src/agent.ts`
  - Deal extraction agent: `server/src/extractDeal.ts`
  - Python bridge: `server/src/pythonMl.ts`
  - Workflow state: `server/src/workflows.ts`
  - Logging: `server/src/logger.ts`, `server/src/requestLogging.ts`
- **React UI**: `client/src/App.tsx`, styles in `client/src/App.css`


