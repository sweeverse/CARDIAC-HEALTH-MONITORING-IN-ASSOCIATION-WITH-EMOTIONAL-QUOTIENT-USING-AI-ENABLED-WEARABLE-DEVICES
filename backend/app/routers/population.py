from fastapi import APIRouter, Depends

from app.db import get_db, COL_POPULATION_STATS
from app.security import get_current_user

router = APIRouter(prefix="/api/population", tags=["population"])


@router.get("/stats")
async def get_population_stats(current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db[COL_POPULATION_STATS].find_one({"_id": "global"})
    if doc:
        doc["_id"] = str(doc["_id"])
    return doc or {"cohort_size": 0, "features": {}}
