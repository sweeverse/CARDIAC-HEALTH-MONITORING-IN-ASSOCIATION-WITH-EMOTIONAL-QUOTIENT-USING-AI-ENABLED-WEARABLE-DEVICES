"""
CardioEQ AI — shared cross-cutting response-formatting utilities.

Two single-purpose helpers, each meant to be the ONE place its concern is
handled, used by every API response that needs it:

  - to_ist(...)   : timestamp standardization (Phase 1, Task 8). Storage
                    stays exactly as-is (UTC, native BSON datetimes) —
                    this only converts at the API response boundary, after
                    any DB query/sort has already happened, so it can never
                    affect stored data or query ordering.
  - round2(...)   : number formatting (Phase 1, Task 9 / Phase 2, Task 21).
                    Formatting only — never used before a value is stored
                    or before it feeds into further computation, only when
                    it's about to leave the API as a response value.
"""

from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))


def to_ist(value):
    """
    Convert a UTC datetime (or an already-serialized UTC/aware ISO-8601
    string) into an ISO-8601 string carrying the +05:30 (IST) offset.

    This is the single formatting function used by every API response
    that returns a timestamp — routers never hand-format a datetime
    themselves. DB storage is untouched: Mongo continues to store (and
    sort on) real UTC datetimes; this only runs on the way out, after the
    value has already been fetched (and any query-level sort already
    applied).

    Returns None for None input, and returns non-datetime/non-string
    values unchanged (defensive — should not normally happen).
    """
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value  # not a parseable timestamp string — leave as-is
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST).isoformat()


# Field names treated as timestamps wherever a document is serialized for
# an API response. Centralized here so every call site (subjects.py,
# auth.py, etc.) converts the same set of fields the same way.
TIMESTAMP_FIELDS = ("recorded_at", "created_at", "updated_at", "eq_completed_at")


def apply_ist_timestamps(doc: dict) -> dict:
    """Convert every known timestamp field present in `doc` to IST, in place. Returns doc for chaining."""
    if not isinstance(doc, dict):
        return doc
    for field in TIMESTAMP_FIELDS:
        if field in doc and doc[field] is not None:
            doc[field] = to_ist(doc[field])
    return doc


def round2(value):
    """
    Round a number to exactly 2 decimal places for display (Heart Health
    Score, percentiles, etc.) — formatting only, applied at the API
    response boundary. Does not touch whatever full-precision value is
    stored or used internally for further computation upstream of this
    call. None passes through unchanged.
    """
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return value


# Scalar fields formatted to exactly 2 decimals wherever they appear in an
# API response (Task 9 / Task 21: Heart Health Score, always two decimal
# places, never fewer — "82.46" not "82.5" or "82").
SCORE_FIELDS = ("heart_health_score", "avg_heart_health_score")
# Dict-valued fields whose every value is itself a percentile figure.
PERCENTILE_DICT_FIELDS = ("population_percentile", "similar_cohort_percentile")


def apply_score_formatting(doc: dict) -> dict:
    """Round every known Heart Health Score / percentile field in `doc` to exactly 2 decimals, in place."""
    if not isinstance(doc, dict):
        return doc
    for field in SCORE_FIELDS:
        if field in doc and doc[field] is not None:
            doc[field] = round2(doc[field])
    for field in PERCENTILE_DICT_FIELDS:
        if isinstance(doc.get(field), dict):
            doc[field] = {k: round2(v) for k, v in doc[field].items()}
    return doc
