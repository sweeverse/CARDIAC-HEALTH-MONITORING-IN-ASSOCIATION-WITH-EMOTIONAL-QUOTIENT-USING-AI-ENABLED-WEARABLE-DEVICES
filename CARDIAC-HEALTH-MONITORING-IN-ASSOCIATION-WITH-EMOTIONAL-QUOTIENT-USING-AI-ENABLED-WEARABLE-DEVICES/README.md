# CardioEQ AI — Semi-Supervised Cardiovascular Intelligence Platform

A research-grade, explainable cardiovascular analytics platform built around your
actual wearable sensor cohort: 20 subjects × 4 activities (sit / walk / run /
cognitive task), PPG + GSR + accelerometer + SpO2 + environmental temp/humidity,
with only 5 of 20 subjects clinician-labeled — exactly the scenario Semi-Supervised
Learning is for.

This isn't a mockup. The ML pipeline runs on your real data, the backend is a
tested, working FastAPI service, and the frontend is a full React dashboard wired
to it. Read the **"What's real vs. what you still need to do"** section at the
bottom before treating this as production-ready.

---

## Architecture

```
EVERYTHING_DATA.zip (raw PPG/GSR/IMU CSVs, 20 subjects)
        │
        ▼
┌─────────────────────┐
│   ml-pipeline/       │  offline, run once (or whenever you re-train)
│   build_dataset.py   │  → feature_extraction → SelfTrainingClassifier (SSL)
│                       │  → Heart Health Scoring → explainable insights
└─────────┬─────────────┘
          │ writes data_processed/*.json + persists model artifacts
          ▼
┌─────────────────────┐        ┌──────────────────────┐
│  backend/ (FastAPI)  │◄──────►│   MongoDB Atlas       │
│  - JWT auth           │        │   CardioEQ database   │
│  - subjects/sessions   │        │   subjects, sessions,  │
│  - explainability API  │        │   timeseries_features, │
│  - population API      │        │   insights, users      │
│  - AI assistant         │        └──────────────────────┘
│  - PDF reports           │
│  - live upload→inference  │  (reuses the SAME ml_core code
└─────────┬─────────────────┘   the offline pipeline used)
          │ REST API (JSON)
          ▼
┌─────────────────────┐
│  frontend/ (React)   │  Landing, Sign Up/In, Forgot Password, Profile,
│  Vite + Tailwind      │  Dashboard (Time Series / Explainability /
│  + Recharts            │  Population / Longitudinal / Insights),
└─────────────────────┘  AI assistant widget, PDF download
```

## The dataset & why Semi-Supervised Learning fits it

`EVERYTHING_DATA.zip` contains 20 subjects, each with 4 raw sensor recordings
(sit/walk/run/cognitive task) sampled at ~80-100Hz: PPG with beat detection,
GSR (skin conductance), 3-axis accelerometer/gyroscope, skin temperature, SpO2,
plus BMI/age/height/weight and environmental temperature/humidity. Only **5 of
the 20 subjects** carry a `condition` label (healthy / mild risk / moderate risk)
in `subject_metadata.csv` — the other 15 are unlabeled. That's the real-world
situation SSL exists for, and it's what `ml-pipeline/ssl_model.py` does: train a
RandomForest on the 5 labeled subjects, then use `sklearn`'s
`SelfTrainingClassifier` to iteratively pseudo-label confident unlabeled subjects
and retrain, without needing more clinician labels.

**Honesty about the dataset's limits**, surfaced rather than papered over:
- PPG-based beat detection (simple threshold crossing in the raw signal) yields
  different absolute HRV magnitudes than a clinically-tuned ECG R-peak detector.
  `scoring.py` accounts for this by deriving "healthy" reference ranges from
  this cohort's own healthy-labeled subjects (`derive_reference_ranges`)
  rather than blindly applying textbook ECG thresholds.
- With only 5 labeled seeds, the self-training classifier's confidence is
  appropriately modest — it doesn't fabricate certainty it doesn't have. The
  UI surfaces `is_clinician_labeled` vs. pseudo-labeled and the model's
  confidence on every subject card.
- **EQ (Emotional Quotient) and air quality/pollution** are in the original
  brief but not in the uploaded dataset — they aren't things a PPG/GSR wearable
  measures. Rather than fabricate numbers, the schema has real `eq_score` /
  `air_quality_index` fields (populate them from a validated EQ questionnaire
  or an air-quality API) and a clearly-labeled `composure_index_proxy` derived
  from stress-recovery dynamics as a stand-in for demo purposes — never
  presented as a validated EQ score.

---

## Setup

### 0. Prerequisites
- Python 3.11+, Node 18+, a MongoDB Atlas cluster (you already have one).

### 1. Run the ML pipeline once, to train the model and process your cohort
```bash
cd ml-pipeline
pip install -r ../backend/requirements.txt   # shares deps with the backend
# Point at wherever you extracted EVERYTHING_DATA.zip:
export RAW_DATA_DIR=/path/to/modified_all_subjects_FIXED
python build_dataset.py
```
This writes `ml-pipeline/data_processed/*.json` (ready-to-import Mongo documents)
and persists the trained model to `backend/app/ml_core/artifacts/` (used later
for scoring newly-uploaded subjects live, via the API).

### 2. Configure and seed MongoDB
```bash
cd backend
cp .env.example .env
```
Edit `.env` and set `MONGODB_URI` to your **real** connection string (with the
actual password, not the `<password>` placeholder Atlas shows you) and a real
`JWT_SECRET` (e.g. `openssl rand -hex 32`).

> **Security note:** a connection string with a password was shared earlier in
> this conversation. Rotate that password in Atlas → Database Access before
> using this in anything beyond local testing — credentials that have been
> pasted into a chat shouldn't be treated as secret anymore.

> **Network note:** this build environment's sandbox could not reach
> `*.mongodb.net`, so the seed script below has been written and smoke-tested
> against an in-memory Mongo mock (`backend/smoke_test.py`), but not against
> your live Atlas cluster. Run it from your own machine/server where Atlas is
> reachable.

```bash
python scripts/seed_mongo.py
```

**Resetting to a clean slate later:** `scripts/seed_mongo.py` is also how you
wipe and reseed at any point after initial setup, not just once at the start.
By default it only clears the 5 cohort-data collections (subjects, sessions,
timeseries, insights, population stats) and leaves every login untouched.
Add `--full-wipe` to also delete every user account (every participant's
login, admin included) before reseeding — the admin account is recreated
immediately after from your `.env`, everyone else would need to sign up
again:
```bash
python scripts/seed_mongo.py --full-wipe   # asks you to type DELETE EVERYTHING to confirm
python scripts/seed_mongo.py --full-wipe --dry-run   # preview only, deletes nothing
```

### 3. Run the backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Visit `http://localhost:8000/docs` for the interactive API reference.
Run `python smoke_test.py` any time to sanity-check the full API logic against
an in-memory Mongo (no Atlas connection needed) — useful before/after changes.

### 4. Run the frontend
```bash
cd frontend
cp .env.example .env   # set VITE_API_BASE_URL if backend isn't on localhost:8000
npm install
npm run dev
```
Visit `http://localhost:5173`. Sign up for an account, then explore the cohort
overview, upload a new recording, and walk through a subject's Time Series →
Explainability → Population → Longitudinal → Insights tabs.

---

## What's real vs. what you still need to do

**Fully working, tested end-to-end** (`backend/smoke_test.py` exercises all of
this against a real in-memory Mongo, including the live upload pipeline):
JWT auth (signup/login/profile), subject CRUD, windowed HRV/biomarker time
series, the semi-supervised risk classifier with SHAP explanations, the
additive Heart Health Score with per-feature breakdown, population percentile
benchmarking (cohort + similar-profile), longitudinal session comparison,
rule-based explainable insight generation, the AI assistant (template-based by
default, upgrades to a real Claude-powered conversational assistant if you set
`ANTHROPIC_API_KEY`), PDF report generation, and live CSV upload → automatic
feature extraction → classification → scoring for new subjects.

**Stubbed, needs real infrastructure before production:**
- **Password reset emails**: `forgot-password` returns the reset token
  directly in the API response (logged in `auth.py` with a loud comment) since
  no email service is wired up. Wire up SES/Postmark/etc. before shipping.
- **Air quality / pollution data**: schema field exists (`air_quality_index`),
  not populated. Wire up an air-quality API (OpenWeatherMap, AirVisual) keyed
  by location.
- **EQ score**: collected via the Profile page as a self-reported field from a
  real EQ assessment the user already took — there's no EQ test built in.
- **Model retraining cadence**: `build_dataset.py` is run manually. For a
  production deployment, schedule it (e.g. cron/Airflow) to retrain as more
  clinician-labeled subjects come in, and version the artifacts.
- **Multi-tenancy / RBAC**: every authenticated user currently sees the full
  shared cohort. If you need per-organization data isolation, add an
  `owner_org_id` filter to the subject queries in `backend/app/routers/subjects.py`.

---

## Project layout
```
ml-pipeline/        feature extraction, SSL training, scoring, insight generation
backend/             FastAPI app, Mongo models, auth, AI assistant, PDF reports
backend/app/ml_core/ shared ML code (used by both the offline pipeline AND live uploads)
frontend/             React + Vite + Tailwind + Recharts dashboard
```
