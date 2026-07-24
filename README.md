# CardioEQ AI — Explainable, Unsupervised Cardiovascular Intelligence Platform

**🔗 Live demo: [cardioeq-ai.onrender.com](https://cardioeq-ai.onrender.com)**

A research-grade, explainable cardiovascular analytics platform built around a real
wearable sensor cohort: 20 subjects × 4 activities (sit / walk / run / cognitive
task), captured via PPG, GSR, a 3-axis accelerometer/gyroscope (MPU-6050), skin
temperature (DS18B20), a medical-grade pulse oximeter, and environmental
temperature/humidity.

There are **no clinician labels anywhere in this dataset or pipeline** — no one
has classified any subject as "healthy" or "at risk." That's a real, common
constraint in early-stage health-tech research, and it's exactly the scenario
**unsupervised learning** is built for: instead of learning from labeled
examples, the model learns what *normal* physiological behavior looks like
directly from the population's own data, then flags deviations from that
learned norm as elevated risk.

This isn't a mockup. The ML pipeline runs on real sensor data, the backend is a
tested, working FastAPI service, and the frontend is a full React dashboard
wired to it end-to-end. Read **"What's real vs. what you still need to do"**
below before treating this as production-ready.

---

## Architecture

```
raw_data/ (PPG/GSR/IMU/temp CSVs, 20 subjects × 4 activities, ~2.86M rows)
        │
        ▼
┌─────────────────────┐
│   ml-pipeline/        │  offline, run once (or whenever you re-train)
│   build_dataset.py    │  → feature_extraction (30s windows, HRV, stress,
│                        │     motion) → activity normalization → RobustScaler
│                        │  → unsupervised_risk.py (GMM + Isolation Forest,
│                        │     fused 60/40, percentile-ranked 0–100)
│                        │  → Heart Health Score (additive, explainable)
│                        │  → rule-based insight generation
└─────────┬──────────────┘
          │ writes data_processed/*.json + persists model artifacts
          ▼
┌─────────────────────┐        ┌──────────────────────┐
│  backend/ (FastAPI)   │◄──────►│   MongoDB              │
│  - JWT auth             │        │   subjects, sessions,   │
│  - subjects/sessions     │        │   timeseries_features,   │
│  - explainability API     │        │   insights,               │
│  - population API           │        │   population_stats,        │
│  - EQ research/correlation    │        │   users                      │
│  - AI assistant                 │        └──────────────────────┘
│  - PDF reports
│  - live upload → inference
└─────────┬─────────────────────  (reuses the SAME ml_core code
          │ REST API (JSON)        the offline pipeline used)
          ▼
┌─────────────────────┐
│  frontend/ (React)     │  Landing, Sign Up/In, Forgot Password, Profile,
│  Vite + Tailwind         │  Dashboard (Time Series / Explainability /
│  + Recharts                │  Population / Longitudinal / Insights),
└─────────────────────┘    EQ Research page, AI assistant widget, PDF download
```

---

## The dataset & why unsupervised learning fits it

`raw_data/` contains 20 healthy participants (12 male, 8 female, aged 19–26,
BMI 17–43), each recorded across 4 activities — sitting, walking, running, and
a seated cognitive task — sampled at ~80–150Hz. That's 80 CSV files, roughly
2.86 million raw observations, with 25 variables per file: PPG amplitude, GSR
conductance, 3-axis accelerometer/gyroscope, skin temperature, SpO2 (from a
separate medical-grade pulse oximeter), plus demographics and environmental
readings.

No subject in this cohort carries a clinical risk label. Getting that kind of
labeled cardiovascular data at scale is expensive, ethically heavy, and
impractical for a student research cohort — so rather than force a supervised
model onto data it was never designed for, `ml-pipeline/build_dataset.py` and
`backend/app/ml_core/unsupervised_risk.py` implement a fully label-free
pipeline:

1. **Windowing** — every recording is split into fixed 30-second,
   non-overlapping windows (the accepted minimum for stable short-term HRV
   metrics).
2. **Feature extraction** — 7 theory-driven, clinically-motivated features per
   window: Heart Rate, RR Interval, RMSSD, SDNN, Stress Index, Recovery Rate,
   and Motion Intensity. Age and BMI are computed but deliberately excluded
   from training to avoid subject-specific bias — they're used only for
   cohort benchmarking.
3. **Activity normalization** — each feature is z-scored *within* its own
   activity group, so the model learns "how risky" a window looks, not "which
   activity was this."
4. **RobustScaler** — median/IQR-based scaling, robust to the outliers and
   motion artifacts inherent to wearable sensor data.
5. **Dual anomaly detection** — a Gaussian Mixture Model (density-based) and
   an Isolation Forest (partition-based) independently score every window;
   their outputs are fused 60/40 and percentile-ranked to a 0–100 risk score.
   Agreement between the two models (Pearson r = 0.941 on this cohort) is the
   core evidence the fused score isn't an artifact of either algorithm alone.

**Honesty about the dataset's limits**, surfaced rather than papered over:
- PPG-based beat detection (adaptive band-pass filtering + threshold crossing,
  run both on the Arduino and in software) yields different absolute HRV
  magnitudes than a clinically-tuned ECG R-peak detector. `scoring.py`
  accounts for this by deriving "healthy" reference ranges from this cohort's
  own low-anomaly windows (`derive_reference_ranges`) where enough data
  exists, falling back to generic clinical-literature defaults otherwise —
  rather than blindly applying textbook ECG thresholds to a PPG signal.
- With no clinician labels anywhere, every risk category (Healthy / Mild Risk
  / Moderate Risk) is a **relative, cohort-based label** — it means "more/less
  anomalous than the other 19 people in this study," not a clinical diagnosis.
  The UI and every report surface this distinction explicitly.
- A real Pan–Tompkins QRS detector is implemented in `feature_extraction.py`
  for future raw-waveform ingestion, but is currently dormant — this dataset
  ships precomputed beat flags upstream, and the code says so honestly rather
  than pretending it's active.
- **EQ (Emotional Quotient)** is not something a PPG/GSR wearable measures, so
  it's collected separately via a short, original 15-item questionnaire (not
  a licensed instrument like Bar-On EQ-i). Only 6 of 20 subjects have
  completed it so far — correlation results against EQ are explicitly
  presented as exploratory, not statistically confirmed. Two physiological
  *proxies* — `composure_index_proxy` and `cognitive_load_index` — are also
  computed from stress/recovery/HRV dynamics as clearly-labeled stand-ins,
  never presented as validated EQ measurements.

---

## Setup

### 0. Prerequisites
- Python 3.11+, Node 18+, a MongoDB instance (Atlas or self-hosted).

### 1. Run the ML pipeline once, to fit the models and process your cohort
```bash
cd ml-pipeline
pip install -r ../backend/requirements.txt   # shares deps with the backend
# Point at wherever you extracted your raw sensor data:
export RAW_DATA_DIR=/path/to/modified_all_subjects_FIXED
python build_dataset.py
```
This writes `ml-pipeline/data_processed/*.json` (ready-to-import Mongo
documents) and persists the fitted GMM/Isolation Forest artifacts to
`backend/app/ml_core/artifacts/`, used later to score newly-uploaded subjects
live via the API. Fitting runs with `threadpool_limits` pinned to 1 thread so
scores are bit-for-bit reproducible across runs.

### 2. Configure and seed MongoDB
```bash
cd backend
cp .env.example .env
```
Edit `.env` and set `MONGODB_URI` to your real connection string and a real
`JWT_SECRET` (e.g. `openssl rand -hex 32`).

> **Security note:** rotate any credentials that were ever shared in a chat,
> ticket, or commit before using them beyond local testing.

```bash
python scripts/seed_mongo.py
```

**Resetting to a clean slate later:** `scripts/seed_mongo.py` also handles
wiping and reseeding at any point after initial setup. By default it only
clears the 5 cohort-data collections (subjects, sessions, timeseries,
insights, population stats) and leaves logins untouched. Add `--full-wipe` to
also delete every user account before reseeding:
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
Visit `http://localhost:8000/docs` for the interactive API reference. Run
`python smoke_test.py` any time to sanity-check the full API logic against an
in-memory Mongo (no live DB connection needed) — useful before/after changes.

### 4. Run the frontend
```bash
cd frontend
cp .env.example .env   # set VITE_API_BASE_URL if backend isn't on localhost:8000
npm install
npm run dev
```
Visit `http://localhost:5173`. Sign up, then explore the cohort overview,
upload a new recording, and walk through a subject's Time Series →
Explainability → Population → Longitudinal → Insights tabs.

---

## What's real vs. what you still need to do

**Fully working, tested end-to-end** (`backend/smoke_test.py` exercises all of
this against a real in-memory Mongo, including the live upload pipeline):
JWT auth (signup/login/profile), subject CRUD, windowed HRV/biomarker time
series, the unsupervised GMM + Isolation Forest risk model with per-feature
GMM-native explanations, the additive Heart Health Score with per-biomarker
breakdown, population percentile benchmarking (cohort + similar-profile),
longitudinal session comparison, rule-based explainable insight generation
(pattern → why → impact → recommendation), the EQ correlation research module,
the AI assistant (deterministic template mode by default, upgrades to a real
LLM-narrated assistant if you set an API key — the LLM only narrates
pre-computed facts, it never invents numbers), PDF report generation, and live
CSV upload → automatic feature extraction → scoring for new subjects.

**Stubbed, needs real infrastructure before production:**
- **Password reset emails**: `forgot-password` returns the reset token
  directly in the API response since no email service is wired up. Wire up
  SES/Postmark/etc. before shipping.
- **Air quality / pollution data**: schema field exists (`air_quality_index`),
  not populated. Wire up an air-quality API keyed by location.
- **EQ score coverage**: only 6 of 20 subjects have completed the
  questionnaire so far. Correlation results scale in reliability as more
  subjects complete it — no pipeline changes needed when they do.
- **Model retraining cadence**: `build_dataset.py` is run manually. For a
  production deployment, schedule it (cron/Airflow) to refit as more subjects
  are added, and version the artifacts.
- **Multi-tenancy / RBAC**: every authenticated user currently sees the full
  shared cohort. If you need per-organization data isolation, add an
  `owner_org_id` filter to the subject queries in
  `backend/app/routers/subjects.py`.
- **Real-time streaming**: current implementation is offline/batch analysis
  only — the Arduino streams to a phone for recording, not live to the
  dashboard.

---

## Project layout
```
ml-pipeline/        feature extraction, unsupervised risk model, scoring, insight generation
backend/             FastAPI app, Mongo models, auth, AI assistant, PDF reports
backend/app/ml_core/ shared ML code (used by both the offline pipeline AND live uploads)
frontend/             React + Vite + Tailwind + Recharts dashboard
```
