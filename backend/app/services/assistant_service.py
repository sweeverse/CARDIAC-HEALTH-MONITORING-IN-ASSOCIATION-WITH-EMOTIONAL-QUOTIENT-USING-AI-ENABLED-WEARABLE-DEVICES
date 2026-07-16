"""
AI Health Assistant
======================
Translates the platform's structured, explainable outputs (risk
classification + SHAP contributions, Heart Health Score breakdown,
generated insights, population percentile) into plain-language answers.

Two modes:
  - TEMPLATE MODE (default, no API key required): deterministic,
    grounded entirely in the subject's stored documents. Safe, fast,
    reproducible — good enough for most "what does this mean?" questions.
  - LLM MODE (if GEMINI_API_KEY, or failing that ANTHROPIC_API_KEY, is set):
    the same structured context is passed to the model as grounding, and it
    composes a more natural, conversational answer to the user's specific
    free-text question. The model is NEVER given raw unstructured access to
    make up numbers — it only narrates the structured facts it's handed.
"""

"""
AI Health Assistant
======================
Translates the platform's structured, explainable outputs (risk
classification + SHAP contributions, Heart Health Score breakdown,
generated insights, population percentile) into plain-language answers.

Groq only. Earlier revisions tried Gemini, then Groq, then Anthropic, then
silently fell back to a canned template if all three failed — in practice
that meant a broken/misconfigured Gemini key (the common case here; see
GEMINI_API_KEY's docstring in config.py) made the assistant "frequently
fall back to template responses" instead of ever reaching Groq, and the
template fallback made that degradation invisible in the UI (it just looks
like a normal answer). This version calls Groq directly and lets a failure
surface as a real error instead of masquerading as an AI-generated answer.
"""

import logging

import httpx
from app.config import settings

logger = logging.getLogger(__name__)


def _build_context(subject: dict, insights: list[dict], question: str, activity: str | None) -> str:
    risk = subject.get("risk_assessment", {})
    hhs = subject.get("heart_health_score")
    breakdown = subject.get("heart_health_score_breakdown", [])
    pct = subject.get("population_percentile", {})

    lines = [
        f"Subject: {subject.get('subject_id')}",
        f"Heart Health Score: {hhs}/100",
        f"Predicted risk class: {risk.get('predicted_class')} "
        f"(confidence {risk.get('probability')}, unsupervised model-derived, no clinical label used)",
    ]
    if breakdown:
        lines.append("Score breakdown (most negative impact first):")
        for b in breakdown[:5]:
            lines.append(f"  - {b['feature']}: value={b['value']}, healthy range={b['healthy_range']}, "
                          f"impact={b['impact']:+.1f} pts")
    if risk.get("feature_contributions"):
        lines.append("Top features driving the risk classification (SHAP):")
        for fc in risk["feature_contributions"][:5]:
            val_str = f"{fc['value']:.2f}" if fc.get("value") is not None else "not measured this window"
            lines.append(f"  - {fc['feature']}: value={val_str}, shap={fc['shap_value']:+.4f}")
    if pct:
        lines.append("Population percentile ranks: " + ", ".join(f"{k}={v}%" for k, v in pct.items() if v is not None))
    if insights:
        lines.append("Detected insights:")
        for ins in insights[:6]:
            lines.append(f"  - [{ins.get('severity')}] {ins.get('pattern')}: {ins.get('why_detected')} "
                          f"Impact: {ins.get('impact')} Recommendation: {ins.get('recommendation')}")
    return "\n".join(lines)


SYSTEM_PROMPT = (
    "You are CardioEQ AI's health assistant. Explain cardiovascular data to a "
    "non-clinician in plain, warm, concise language (3-5 sentences). Only use the "
    "facts given in the CONTEXT block below — never invent numbers. If asked something "
    "the context doesn't cover, say so plainly."
)


async def _ask_groq(context: str, question: str) -> str:
    # Groq: OpenAI-compatible, free tier with no billing card required.
    # Get a key at https://console.groq.com/keys
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama-3.3-70b-versatile",
                "max_tokens": 400,
                "temperature": 0.4,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"CONTEXT:\n{context}\n\nQUESTION: {question}"},
                ],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


def _scrub(text: str) -> str:
    """Strip the API key value out of an error string before it's logged or
    returned to the client (spec D: never expose the key in logs, network
    responses, or client-side code)."""
    out = text
    if settings.GROQ_API_KEY:
        out = out.replace(settings.GROQ_API_KEY, "***")
    return out


class AssistantUnavailable(Exception):
    """Raised when Groq can't produce an answer — either not configured or
    the request itself failed. Callers (routers/assistant.py) turn this
    into a proper HTTP error instead of silently swapping in a canned
    template that looks like a real AI answer."""


async def answer_question(subject: dict, insights: list[dict], question: str, activity: str | None = None) -> dict:
    context = _build_context(subject, insights, question, activity)

    if not settings.GROQ_API_KEY:
        raise AssistantUnavailable("The AI assistant isn't configured — GROQ_API_KEY is missing.")

    try:
        text = await _ask_groq(context, question)
    except Exception as e:
        logger.warning("Groq request failed: %s", _scrub(str(e)))
        raise AssistantUnavailable("The AI assistant couldn't reach Groq. Please try again shortly.") from e

    if not text:
        logger.warning("Groq returned an empty response.")
        raise AssistantUnavailable("The AI assistant returned an empty response. Please try again.")

    return {"answer": text, "mode": "llm_groq", "grounding_context": context}