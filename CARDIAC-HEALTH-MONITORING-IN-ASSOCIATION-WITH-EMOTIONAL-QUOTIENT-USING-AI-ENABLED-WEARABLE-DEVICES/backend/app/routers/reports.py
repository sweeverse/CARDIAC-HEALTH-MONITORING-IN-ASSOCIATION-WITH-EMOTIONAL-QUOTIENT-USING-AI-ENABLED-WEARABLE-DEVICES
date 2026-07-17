from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response

from app.db import get_db, COL_SUBJECTS, COL_SESSIONS, COL_INSIGHTS
from app.security import get_current_user
from app.services.report_pdf import build_report_pdf

router = APIRouter(prefix="/api/subjects", tags=["reports"])


@router.get("/{subject_id}/report")
async def download_report(subject_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    subject = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found.")
    subject["_id"] = str(subject["_id"])

    sessions = [d async for d in db[COL_SESSIONS].find({"subject_id": subject_id}).sort("recorded_at", 1)]
    for s in sessions:
        s["_id"] = str(s["_id"])
    insights = [d async for d in db[COL_INSIGHTS].find({"subject_id": subject_id})]
    for i in insights:
        i["_id"] = str(i["_id"])

    pdf_bytes = build_report_pdf(subject, sessions, insights)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="cardioeq_report_{subject_id}.pdf"'},
    )
