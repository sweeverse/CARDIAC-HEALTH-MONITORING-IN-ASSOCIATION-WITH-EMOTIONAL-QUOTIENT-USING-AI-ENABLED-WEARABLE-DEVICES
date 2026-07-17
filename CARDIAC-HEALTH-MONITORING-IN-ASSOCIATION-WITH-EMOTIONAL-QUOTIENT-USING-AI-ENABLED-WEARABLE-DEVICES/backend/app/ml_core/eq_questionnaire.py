"""
CardioEQ AI — EQ-style Short-Form Self-Report Questionnaire
=============================================================
NOTE ON PROVENANCE: this is an ORIGINAL short self-report instrument
written for this project, covering the same five broad domains commonly
used in emotional-intelligence research (self-awareness, self-regulation,
motivation, empathy, social skills). It is NOT the Bar-On EQ-i or any
other licensed/copyrighted psychometric instrument, and its scores are
not validated against or equivalent to those instruments' norms. Treat
it as a lightweight research proxy for this platform, not a
clinically validated EQ measurement.

Each item is a 1-5 Likert statement ("1 = Strongly disagree" ... "5 =
Strongly agree"). Composite score = mean item score, rescaled to 0-100.
Subscale score = mean of that domain's 3 items, rescaled to 0-100.
"""

EQ_DOMAINS = ["self_awareness", "self_regulation", "motivation", "empathy", "social_skills"]

EQ_QUESTIONS = [
    # Self-awareness
    {"id": "sa1", "domain": "self_awareness", "text": "I can usually tell what emotion I'm feeling as it's happening, not just afterward."},
    {"id": "sa2", "domain": "self_awareness", "text": "I notice early physical signs (racing heart, tension) when I'm becoming stressed or upset."},
    {"id": "sa3", "domain": "self_awareness", "text": "I understand how my mood affects the way I think and act."},
    # Self-regulation
    {"id": "sr1", "domain": "self_regulation", "text": "When something frustrates me, I can stay composed long enough to think before reacting."},
    {"id": "sr2", "domain": "self_regulation", "text": "I recover from a stressful moment without it affecting the rest of my day."},
    {"id": "sr3", "domain": "self_regulation", "text": "I can calm myself down using a technique that reliably works for me."},
    # Motivation
    {"id": "mo1", "domain": "motivation", "text": "I keep working toward a goal even after an initial setback."},
    {"id": "mo2", "domain": "motivation", "text": "I stay focused on long-term outcomes rather than giving up when things get hard."},
    {"id": "mo3", "domain": "motivation", "text": "I find it easy to motivate myself without needing external pressure."},
    # Empathy
    {"id": "em1", "domain": "empathy", "text": "I can tell how someone is feeling even if they don't say it directly."},
    {"id": "em2", "domain": "empathy", "text": "I adjust how I communicate based on the other person's emotional state."},
    {"id": "em3", "domain": "empathy", "text": "People often come to me because they feel understood by me."},
    # Social skills
    {"id": "ss1", "domain": "social_skills", "text": "I can defuse tension in a group when a disagreement starts to escalate."},
    {"id": "ss2", "domain": "social_skills", "text": "I build rapport with new people fairly quickly."},
    {"id": "ss3", "domain": "social_skills", "text": "I express disagreement without damaging the relationship."},
]


def score_eq_answers(answers: dict) -> dict:
    """
    answers: {question_id: int (1-5)}
    Returns composite (0-100) + per-domain subscores (0-100).
    Missing answers are excluded from their domain's mean rather than
    zero-filled, so a partially-completed form doesn't silently drag the
    score down.
    """
    domain_scores = {d: [] for d in EQ_DOMAINS}
    for q in EQ_QUESTIONS:
        val = answers.get(q["id"])
        if val is None:
            continue
        val = max(1, min(5, int(val)))
        domain_scores[q["domain"]].append(val)

    subscores = {}
    all_vals = []
    for d, vals in domain_scores.items():
        if vals:
            mean_1_5 = sum(vals) / len(vals)
            subscores[d] = round((mean_1_5 - 1) / 4 * 100, 1)  # rescale 1-5 -> 0-100
            all_vals.extend(vals)
        else:
            subscores[d] = None

    if not all_vals:
        return {"composite": None, "subscores": subscores, "n_answered": 0}

    composite = round((sum(all_vals) / len(all_vals) - 1) / 4 * 100, 1)
    return {"composite": composite, "subscores": subscores, "n_answered": len(all_vals)}
