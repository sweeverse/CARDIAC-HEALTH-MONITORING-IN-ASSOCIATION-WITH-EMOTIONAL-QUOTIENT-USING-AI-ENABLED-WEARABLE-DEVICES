"""
CardioEQ AI — Research analyses endpoints.

LOOCV, inter/intra-subject variability, and per-activity reference ranges
are heavy, cohort-wide computations done OFFLINE in ml-pipeline/build_dataset.py
(same pattern as the risk model itself) — this router just serves those
precomputed artifacts. EQ correlation is different: it depends on
eq_score, which only gets set live as people actually complete the EQ
questionnaire through the app, so that one is computed live against
whatever real scores currently exist in Mongo.
"""

import json
import math
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends

from app.db import get_db, COL_SUBJECTS, COL_SESSIONS
from app.security import get_current_user
from app.ml_core.feature_extraction import normalize_subject_id

router = APIRouter(prefix="/api/research", tags=["research"])

ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "ml_core" / "artifacts"


def _read_artifact(name: str):
    path = ARTIFACTS_DIR / name
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


@router.get("/unsupervised-validation")
async def get_unsupervised_validation(current_user: dict = Depends(get_current_user)):
    data = _read_artifact("unsupervised_model_report.json")
    if data is None:
        return {"error": "Validation report hasn't been computed yet — run ml-pipeline/build_dataset.py to generate it."}
    return data


@router.get("/loocv")
async def get_loocv(current_user: dict = Depends(get_current_user)):
    """
    Deprecated path, kept so any existing bookmark/integration doesn't 404.
    The model is unsupervised now (no train/test labels to leave one out
    of), so this just proxies the unsupervised validation report — use
    /api/research/unsupervised-validation going forward.
    """
    data = _read_artifact("unsupervised_model_report.json")
    if data is None:
        return {"error": "Validation report hasn't been computed yet — run ml-pipeline/build_dataset.py to generate it."}
    return {**data, "deprecated_note": "This endpoint now serves unsupervised validation metrics, not LOOCV accuracy — the model no longer trains on labels. See /api/research/unsupervised-validation."}


@router.get("/variability")
async def get_variability(current_user: dict = Depends(get_current_user)):
    data = _read_artifact("variability_analysis.json")
    if data is None:
        return {"error": "Variability analysis hasn't been computed yet — run ml-pipeline/build_dataset.py."}
    return {"features": data}


@router.get("/reference-ranges-by-activity")
async def get_reference_ranges_by_activity(current_user: dict = Depends(get_current_user)):
    data = _read_artifact("reference_ranges_by_activity.json")
    if data is None:
        return {"error": "Per-activity reference ranges haven't been computed yet — run ml-pipeline/build_dataset.py."}
    return {"by_activity": data}


def _pearson(x: list[float], y: list[float]) -> float | None:
    if len(x) < 2 or len(y) < 2:
        return None
    x, y = np.array(x, dtype=float), np.array(y, dtype=float)
    if np.std(x) == 0 or np.std(y) == 0:
        return None
    return round(float(np.corrcoef(x, y)[0, 1]), 3)


# --- p-value for a Pearson r, without a scipy dependency ---------------
# Standard result: for n paired samples, t = r*sqrt((n-2)/(1-r^2)) with
# df = n-2 follows a Student's t distribution under H0: r=0. The two-tailed
# p-value equals the regularized incomplete beta function
# I_x(df/2, 1/2) at x = df/(df+t^2) — implemented via the continued-fraction
# method from Numerical Recipes so this works with only numpy installed.
def _betacf(a: float, b: float, x: float, max_iter: int = 200, eps: float = 1e-10) -> float:
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < 1e-30:
        d = 1e-30
    d = 1.0 / d
    h = d
    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < 1e-30:
            d = 1e-30
        c = 1.0 + aa / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < 1e-30:
            d = 1e-30
        c = 1.0 + aa / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    ln_beta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1.0 - x)
    front = math.exp(ln_beta)
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def _pearson_p_value(r: float | None, n: int) -> float | None:
    """Two-tailed p-value for H0: population correlation = 0. None if r/n undefined."""
    if r is None or n < 3 or abs(r) >= 1:
        return None
    df = n - 2
    t_sq = r * r * df / (1 - r * r)
    x = df / (df + t_sq)
    p = _betai(df / 2.0, 0.5, x)
    return round(min(max(p, 0.0), 1.0), 4)


def _linreg(x: list[float], y: list[float]) -> dict | None:
    """Ordinary least-squares best-fit line y = slope*x + intercept."""
    if len(x) < 2:
        return None
    x, y = np.array(x, dtype=float), np.array(y, dtype=float)
    if np.std(x) == 0:
        return None
    slope, intercept = np.polyfit(x, y, 1)
    return {"slope": round(float(slope), 4), "intercept": round(float(intercept), 4)}


# Cardiac/cardiovascular metrics correlated against eq_score. `direction`
# just informs the plain-language interpretation text (which way is
# "better") — it never hides or reorders data. risk_score is nested under
# risk_assessment on the subject doc (not a top-level field like the
# others), so it's special-cased in the extraction loop below.
CARDIAC_METRICS = [
    {"key": "risk_score", "label": "ML Risk Score", "unit": "/ 100", "direction": "lower_better", "source": "subject"},
    {"key": "composure_index_proxy", "label": "Composure Proxy", "unit": "/ 100", "direction": "higher_better", "source": "subject"},
    {"key": "cognitive_load_index", "label": "Cognitive Load Index", "unit": "", "direction": "lower_better", "source": "subject"},
    {"key": "avg_rmssd", "label": "HRV (RMSSD)", "unit": "ms", "direction": "higher_better", "source": "sessions"},
    {"key": "avg_stress_index", "label": "Stress Index", "unit": "", "direction": "lower_better", "source": "sessions"},
    {"key": "avg_recovery_rate", "label": "Recovery Rate", "unit": "", "direction": "higher_better", "source": "sessions"},
    {"key": "avg_heart_rate", "label": "Resting Heart Rate", "unit": "bpm", "direction": "neutral", "source": "sessions"},
]


def _subject_metric_value(s: dict, key: str):
    if key == "risk_score":
        return (s.get("risk_assessment") or {}).get("risk_score")
    return s.get(key)


def _interpret(r: float | None, metric_label: str, direction: str) -> str:
    if r is None:
        return f"Not enough subjects with both an EQ score and {metric_label} yet to assess a relationship."
    strength = "weak" if abs(r) < 0.2 else "moderate" if abs(r) < 0.5 else "strong"
    if abs(r) < 0.2:
        return f"No clear linear relationship between self-reported EQ and {metric_label} in the current sample (r = {r})."
    sign = "higher" if r > 0 else "lower"
    quality = {
        "higher_better": "better" if r > 0 else "worse",
        "lower_better": "worse" if r > 0 else "better",
        "neutral": None,
    }[direction]
    tail = f", i.e. {quality} on this measure" if quality else ""
    return f"{strength.capitalize()} {'positive' if r > 0 else 'negative'} correlation: higher self-reported EQ tends to go with {sign} {metric_label}{tail}."


@router.get("/eq-cardiac-correlation")
async def get_eq_cardiac_correlation(current_user: dict = Depends(get_current_user)):
    """
    Task 14-18: EQ score vs. cardiovascular health metrics, computed live
    from whatever's actually in Mongo right now — no hardcoded/sample data.
    Every subject who has BOTH a completed EQ questionnaire AND at least one
    recorded session is included automatically; this refreshes on every
    request, so new uploads/questionnaires show up immediately without any
    offline recompute step.
    """
    db = get_db()
    subjects_raw = [s async for s in db[COL_SUBJECTS].find({"eq_score": {"$ne": None}})]

    # Canonicalize + de-duplicate subject IDs before doing anything else.
    # Historically some subject_id values landed in Mongo in a slightly
    # different form than the canonical "S01" style (pre-normalize_subject_id
    # signups, admin edge cases, etc.) — two docs like "S20" and "s20"/"S2"
    # are the SAME subject to a person reading the page, but a raw string
    # match treats them as different, which is what produced duplicate
    # entries (e.g. two "S20"s) and a self-reported EQ score that didn't
    # match the point actually plotted for that subject (whichever
    # duplicate happened to be read first/last off different queries).
    # Keeping exactly one doc per normalized ID — the one with the most
    # recently completed EQ questionnaire — makes every value on this page
    # (header EQ score, scatter point, tooltip) come from the same record.
    by_norm_id: dict[str, dict] = {}
    for s in subjects_raw:
        norm_id = normalize_subject_id(str(s.get("subject_id") or "").strip())
        if not norm_id:
            continue
        s["subject_id"] = norm_id
        prev = by_norm_id.get(norm_id)
        if prev is None or (s.get("eq_completed_at") or "") >= (prev.get("eq_completed_at") or ""):
            by_norm_id[norm_id] = s
    subjects = list(by_norm_id.values())
    subject_ids = [s["subject_id"] for s in subjects]

    sessions = [sess async for sess in db[COL_SESSIONS].find({})] if subject_ids else []
    sessions_by_subject: dict[str, list[dict]] = {}
    for sess in sessions:
        sid = normalize_subject_id(str(sess.get("subject_id") or "").strip())
        if sid in by_norm_id:
            sessions_by_subject.setdefault(sid, []).append(sess)

    # One row per subject with an EQ score AND at least one recorded session
    # — subject-level fields come straight off the subject doc; session-level
    # ones are averaged across all of that subject's recorded activities.
    rows = []
    for s in subjects:
        sid = s["subject_id"]
        subj_sessions = sessions_by_subject.get(sid, [])
        if not subj_sessions:
            continue
        row = {"subject_id": sid, "eq_score": s["eq_score"]}
        for m in CARDIAC_METRICS:
            if m["source"] == "subject":
                val = _subject_metric_value(s, m["key"])
                row[m["key"]] = val if isinstance(val, (int, float)) else None
            else:
                vals = [sess.get(m["key"]) for sess in subj_sessions if sess.get(m["key"]) is not None]
                row[m["key"]] = round(float(np.mean(vals)), 2) if vals else None
        rows.append(row)

    n_eligible = len(rows)
    if n_eligible < 3:
        return {
            "insufficient_data": True,
            "n_subjects_with_eq_score": len(subjects),
            "n_eligible_subjects": n_eligible,
            "message": (
                f"Only {n_eligible} subject(s) currently have both a completed EQ questionnaire and at least "
                "one recorded session. At least 3 are needed for a meaningful correlation — complete more EQ "
                "questionnaires and/or upload more recordings to unlock this analysis."
            ),
        }

    analyses = []
    for m in CARDIAC_METRICS:
        pairs = [(r["eq_score"], r[m["key"]], r["subject_id"]) for r in rows if r.get(m["key"]) is not None]
        eq_vals = [p[0] for p in pairs]
        metric_vals = [p[1] for p in pairs]
        r = _pearson(eq_vals, metric_vals)
        n = len(pairs)
        analyses.append({
            "metric_key": m["key"],
            "metric_label": m["label"],
            "unit": m["unit"],
            "direction": m["direction"],
            "n": n,
            "r": r,
            "p_value": _pearson_p_value(r, n),
            "regression": _linreg(eq_vals, metric_vals) if r is not None else None,
            "points": [{"subject_id": sid, "eq_score": eq, "value": val} for eq, val, sid in pairs],
            "interpretation": _interpret(r, m["label"], m["direction"]),
        })

    # Correlation matrix across EQ score + every cardiac metric, pairwise,
    # using only subjects with both values present for that specific pair
    # (so one subject missing e.g. avg_rmssd doesn't shrink every cell).
    matrix_keys = [{"key": "eq_score", "label": "EQ Score"}] + [{"key": m["key"], "label": m["label"]} for m in CARDIAC_METRICS]
    matrix = []
    for a in matrix_keys:
        row_out = []
        for b in matrix_keys:
            pairs = [(r[a["key"]], r[b["key"]]) for r in rows if r.get(a["key"]) is not None and r.get(b["key"]) is not None]
            if a["key"] == b["key"]:
                row_out.append(1.0)
            else:
                row_out.append(_pearson([p[0] for p in pairs], [p[1] for p in pairs]) if len(pairs) >= 3 else None)
        matrix.append(row_out)

    return {
        "insufficient_data": False,
        "n_subjects_with_eq_score": len(subjects),
        "n_eligible_subjects": n_eligible,
        "eligible_subject_ids": [r["subject_id"] for r in rows],
        "analyses": analyses,
        "correlation_matrix": {"labels": [k["label"] for k in matrix_keys], "keys": [k["key"] for k in matrix_keys], "matrix": matrix},
    }