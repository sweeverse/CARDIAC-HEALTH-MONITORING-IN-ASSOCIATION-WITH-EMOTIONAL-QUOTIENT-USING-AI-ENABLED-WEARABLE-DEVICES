from fastapi import APIRouter, HTTPException, Depends

from app.db import get_db, COL_SUBJECTS, COL_INSIGHTS
from app.security import get_current_user
from app.models.schemas import AssistantQuery
from app.services.assistant_service import answer_question, AssistantUnavailable

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.post("/ask")
async def ask(payload: AssistantQuery, current_user: dict = Depends(get_current_user)):
    db = get_db()
    subject = await db[COL_SUBJECTS].find_one({"subject_id": payload.subject_id})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found.")
    subject["_id"] = str(subject["_id"])

    query = {"subject_id": payload.subject_id}
    if payload.activity:
        query["activity"] = payload.activity
    insights = [d async for d in db[COL_INSIGHTS].find(query)]
    for d in insights:
        d["_id"] = str(d["_id"])

    try:
        result = await answer_question(subject, insights, payload.question, payload.activity)
    except AssistantUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    return result
