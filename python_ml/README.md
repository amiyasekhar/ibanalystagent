# Python ML module (logistic regression) for buyer matching

This folder contains a small **Python-first** ML pipeline:

- `generate_buyers.py`: generates a **synthetic buyer universe** at `server/data/buyers.json` (seeded + versioned)
- `generate_csv.py`: generates a **synthetic but realistic-ish** CSV dataset at `data/training_data.csv`
- `train.py`: trains a simple logistic regression model on synthetic + rule-based labels and **exports** weights to `artifacts/model.json`
- `infer.py`: loads `artifacts/model.json` and runs **inference** for a deal + list of buyers (passed via stdin JSON)

No external Python packages are required (pure Python), so it runs anywhere you have `python3`.

## Generate synthetic buyer DB

```bash
python3 python_ml/generate_buyers.py
```

This creates:
- `server/data/buyers.json`

## Generate CSV training data

```bash
python3 python_ml/generate_csv.py
```

This creates:
- `python_ml/data/training_data.csv`

## Train (export model)

```bash
python3 python_ml/train.py
```

This will create/update:
- `python_ml/artifacts/model.json`

### Optional: sklearn pipeline (recommended)

Install deps:

```bash
python3 -m pip install -r python_ml/requirements.txt
```

Then train with sklearn + calibration:

```bash
TRAIN_USE_SKLEARN=1 python3 python_ml/train.py
```

## Inference (used by Node server)

Node calls:

```bash
python3 python_ml/infer.py
```

and passes JSON on stdin with this shape:

```json
{
  "deal": {
    "name": "ExampleCo",
    "sector": "Software",
    "geography": "US",
    "revenue": 15,
    "ebitda": 5,
    "dealSize": 60,
    "description": "..."
  },
  "buyers": [
    {
      "id": "b1",
      "name": "Summit Peak Capital",
      "type": "Private Equity",
      "sectorFocus": ["Software"],
      "geographies": ["US"],
      "minEbitda": 3,
      "maxEbitda": 20,
      "minDealSize": 20,
      "maxDealSize": 150,
      "dryPowder": 500,
      "pastDeals": 18,
      "strategyTags": ["buy-and-build"]
    }
  ]
}
```

and receives JSON on stdout:

```json
{
  "modelVersion": "2025-12-12",
  "scores": [
    {
      "buyerId": "b1",
      "score": 0.83,
      "features": {
        "sectorMatch": 1,
        "geoMatch": 1,
        "sizeFit": 1,
        "dryPowderFit": 0.83,
        "activityLevel": 0.9,
        "ebitdaFit": 1
      }
    }
  ]
}
```


