"""
Content-fingerprinting for duplicate/repeat-recording detection.

SINGLE SOURCE OF TRUTH — used by BOTH:
  - the live upload endpoint (routers/subjects.py POST /upload), and
  - the offline dataset builder (ml-pipeline/build_dataset.py), which
    stamps the exact same fingerprint onto seeded sessions.

This used to be defined only inside routers/subjects.py, which meant
build_dataset.py / seed_mongo.py had no way to compute it — every seeded
session went into Mongo with NO content_fingerprint at all. The first time
someone re-uploaded a seeded subject's original CSV, the upload endpoint
correctly computed a fingerprint for the new file but had nothing valid to
compare it against, so it always looked like a brand-new recording
occasion instead of an exact match — even though it was the very file the
cohort was seeded from. Sharing this module fixes that: seeded sessions
now carry a real fingerprint computed the identical way, so a live
re-upload of the same source CSV correctly detects it as a duplicate.
"""
import hashlib
import io

import pandas as pd

# Bumped whenever the algorithm below changes. Sessions stamped with an
# older (or missing) version can never correctly match a freshly-computed
# fingerprint — see routers/subjects.py's /admin/legacy-sessions endpoints,
# which use this to find exactly the sessions that need a clean
# re-upload/reseed after a bump.
FINGERPRINT_VERSION = 2

# These drift independently of the actual recording (profile edits,
# re-computed BMI, etc.) and must never affect duplicate detection.
NON_SENSOR_COLUMNS = {"bmi", "age", "height_cm", "weight_kg"}


def content_fingerprint(content: bytes) -> str:
    """
    A stable fingerprint of a CSV's actual recorded data — NOT the
    subject's demographics. Demographics (BMI especially) drift naturally
    as a person's weight changes, so comparing BMI/age/height/weight to
    decide "is this a duplicate" caused legitimate re-uploads to get
    blocked every time a subject's BMI moved (Task 5 fix). Instead we hash
    the numeric SENSOR columns' rounded values, with demographic columns
    explicitly dropped, column order sorted (stable across a re-saved copy
    with reordered columns), and row order sorted (stable across a
    re-chunked/re-ordered export of the same recording) — stable across
    all of that, but changes whenever the actual recorded data differs.
    """
    try:
        df = pd.read_csv(io.BytesIO(content))
        numeric = df.select_dtypes(include="number")
        numeric = numeric.drop(columns=[c for c in numeric.columns if c.lower() in NON_SENSOR_COLUMNS],
                                errors="ignore")
        numeric = numeric.reindex(sorted(numeric.columns), axis=1).round(4)
        numeric = numeric.sort_values(by=list(numeric.columns)).reset_index(drop=True)
        payload = numeric.to_csv(index=False, float_format="%.4f").encode("utf-8")
    except Exception:
        payload = content
    return hashlib.sha256(payload).hexdigest()
