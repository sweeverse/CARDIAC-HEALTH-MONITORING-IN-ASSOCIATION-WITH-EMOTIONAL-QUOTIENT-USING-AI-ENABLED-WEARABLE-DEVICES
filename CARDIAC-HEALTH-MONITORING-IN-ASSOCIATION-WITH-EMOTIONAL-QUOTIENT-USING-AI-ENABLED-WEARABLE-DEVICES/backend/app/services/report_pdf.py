"""Generates a downloadable cardiovascular analytics PDF report for a subject."""

import io
from datetime import datetime, timezone

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image,
)

PRIMARY = colors.HexColor("#CF0A0A")
ACCENT = colors.HexColor("#DC5F00")
LIGHT_BG = colors.HexColor("#F4F1EA")


def _breakdown_chart(breakdown: list[dict]) -> Image | None:
    """Horizontal bar chart of each biomarker's point impact on the Heart Health Score."""
    if not breakdown:
        return None
    features = [b["feature"] for b in breakdown][::-1]
    impacts = [b["impact"] for b in breakdown][::-1]
    bar_colors = ["#CF0A0A" if v < -8 else "#DC5F00" if v < -2 else "#2F8F5B" for v in impacts]

    fig, ax = plt.subplots(figsize=(6.4, max(1.6, 0.4 * len(features))), dpi=150)
    ax.barh(features, impacts, color=bar_colors)
    ax.axvline(0, color="#888", linewidth=0.8)
    ax.set_xlabel("Points impact on Heart Health Score", fontsize=9)
    ax.tick_params(labelsize=9)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=6.4 * inch, height=(max(1.6, 0.4 * len(features))) * inch)


def _sessions_chart(sessions: list[dict]) -> Image | None:
    """Heart Health Score across recorded sessions, colored by activity."""
    scored = [s for s in sessions if s.get("avg_heart_health_score") is not None]
    if len(scored) < 2:
        return None
    activity_colors = {"sit": "#0E4F4A", "walk": "#DC5F00", "run": "#CF0A0A", "cog": "#C98A2E"}
    labels = [s.get("activity", "?") for s in scored]
    values = [s["avg_heart_health_score"] for s in scored]
    point_colors = [activity_colors.get(a, "#CF0A0A") for a in labels]

    fig, ax = plt.subplots(figsize=(6.4, 2.4), dpi=150)
    ax.plot(range(len(values)), values, color="#CF0A0A", linewidth=2, zorder=1)
    ax.scatter(range(len(values)), values, c=point_colors, s=40, zorder=2, edgecolors="white", linewidths=1)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, fontsize=8, rotation=0)
    ax.set_ylabel("Heart Health Score", fontsize=9)
    ax.set_ylim(0, 100)
    ax.tick_params(labelsize=9)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=6.4 * inch, height=2.4 * inch)


def build_report_pdf(subject: dict, sessions: list[dict], insights: list[dict]) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.6 * inch, bottomMargin=0.6 * inch)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle("TitleX", parent=styles["Title"], textColor=PRIMARY, fontSize=22)
    h2 = ParagraphStyle("H2X", parent=styles["Heading2"], textColor=PRIMARY, spaceBefore=14)
    body = ParagraphStyle("BodyX", parent=styles["BodyText"], fontSize=10, leading=14)

    story = []
    story.append(Paragraph("CardioEQ AI — Cardiovascular Intelligence Report", title_style))
    story.append(Paragraph(
        f"Subject {subject.get('subject_id')} &nbsp;|&nbsp; Generated "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", body))
    story.append(Spacer(1, 0.2 * inch))

    risk = subject.get("risk_assessment", {})
    demo = subject.get("demographics", {})
    summary_data = [
        ["Heart Health Score", f"{subject.get('heart_health_score', '—')}/100"],
        ["Predicted Risk Class", risk.get("predicted_class", "—")],
        ["Model Risk Score", f"{risk.get('risk_score', '—')}/100" if risk.get("risk_score") is not None else "—"],
        ["Classification Confidence", f"{(risk.get('probability') or 0) * 100:.0f}%"],
        ["Age", demo.get("age", "—")],
        ["BMI", demo.get("bmi", "—")],
    ]
    t = Table(summary_data, colWidths=[2.6 * inch, 3.4 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), LIGHT_BG),
        ("TEXTCOLOR", (0, 0), (0, -1), PRIMARY),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDD8CC")),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.25 * inch))

    story.append(Paragraph("Why This Risk Classification", h2))
    drivers = risk.get("human_readable_drivers", [])
    if drivers:
        for i, d in enumerate(drivers, 1):
            story.append(Paragraph(f"{i}. {d}", body))
    else:
        story.append(Paragraph("No dominant drivers — biomarkers sit close to the cohort average.", body))
    story.append(Spacer(1, 0.2 * inch))

    story.append(Paragraph("Heart Health Score Breakdown (Explainable AI)", h2))
    breakdown = subject.get("heart_health_score_breakdown", [])
    if breakdown:
        rows = [["Biomarker", "Value", "Healthy Range", "Points", "Impact"]]
        for b in breakdown:
            rows.append([b["feature"], str(b["value"]), b["healthy_range"],
                         f"{b['points_awarded']}/{b['max_points']}", f"{b['impact']:+.1f}"])
        bt = Table(rows, colWidths=[1.5 * inch, 1 * inch, 1.4 * inch, 1.1 * inch, 1 * inch])
        bt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDD8CC")),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
        ]))
        story.append(bt)
        chart = _breakdown_chart(breakdown)
        if chart:
            story.append(Spacer(1, 0.12 * inch))
            story.append(chart)
    story.append(Spacer(1, 0.2 * inch))

    story.append(Paragraph("Top Feature Contributions", h2))
    contributions = risk.get("feature_contributions", [])[:6]
    if contributions:
        rows = [["Feature", "Value", "Risk Contribution"]]
        for c in contributions:
            val_str = f"{c['value']:.2f}" if c.get("value") is not None else "n/a"
            rows.append([c["feature"], val_str, f"{c['shap_value']:+.4f}"])
        ct = Table(rows, colWidths=[2 * inch, 2 * inch, 2 * inch])
        ct.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDD8CC")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
        ]))
        story.append(ct)
    story.append(Spacer(1, 0.2 * inch))

    story.append(Paragraph("Sessions Recorded", h2))
    if sessions:
        rows = [["Activity", "Windows", "Avg HR", "Avg RMSSD", "Avg Stress", "Avg HHS"]]
        for s in sessions:
            rows.append([
                s.get("activity"), s.get("window_count"),
                _fmt(s.get("avg_heart_rate")), _fmt(s.get("avg_rmssd")),
                _fmt(s.get("avg_stress_index")), _fmt(s.get("avg_heart_health_score")),
            ])
        st = Table(rows, colWidths=[1.1 * inch] * 6)
        st.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDD8CC")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ]))
        story.append(st)
        sessions_chart = _sessions_chart(sessions)
        if sessions_chart:
            story.append(Spacer(1, 0.12 * inch))
            story.append(sessions_chart)
    story.append(Spacer(1, 0.25 * inch))

    story.append(Paragraph("Explainable Insights", h2))
    for ins in insights[:10]:
        story.append(Paragraph(f"<b>{ins.get('pattern')}</b> [{ins.get('activity', '')}]", body))
        story.append(Paragraph(f"<i>Why detected:</i> {ins.get('why_detected')}", body))
        story.append(Paragraph(f"<i>Impact:</i> {ins.get('impact')}", body))
        story.append(Paragraph(f"<i>Recommendation:</i> {ins.get('recommendation')}", body))
        story.append(Spacer(1, 0.12 * inch))

    story.append(Spacer(1, 0.3 * inch))
    story.append(Paragraph(
        "This report is generated by a research-grade analytics platform using an unsupervised "
        "risk score (Gaussian Mixture + Isolation Forest) fit on physiological patterns across the "
        "cohort, with no clinician labels used in training or calibration. It is intended to support, not "
        "replace, clinical judgment, and is not a medical diagnosis.",
        ParagraphStyle("Disclaimer", parent=body, textColor=colors.HexColor("#888"), fontSize=8),
    ))

    doc.build(story)
    return buf.getvalue()


def _fmt(v):
    return f"{v:.1f}" if isinstance(v, (int, float)) else "—"
