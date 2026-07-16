from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import ensure_indexes, ensure_admin_account
from app.routers import auth, subjects, population, assistant, reports, research


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await ensure_indexes()
    except Exception as e:
        # Don't crash startup if Mongo is briefly unreachable; surfaces clearly in logs.
        print(f"[startup] could not ensure indexes (is MONGODB_URI reachable?): {e}")
    try:
        await ensure_admin_account()
    except Exception as e:
        print(f"[startup] could not bootstrap admin account (is MONGODB_URI reachable?): {e}")
    yield


app = FastAPI(
    title="CardioEQ AI API",
    description="Explainable cardiovascular intelligence platform — calibrated risk "
                 "prediction, HRV/ECG time-series analytics, population benchmarking, and "
                 "an AI health assistant.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store_cache_headers(request: Request, call_next):
    """
    Task 10 — API audit: every endpoint must return the latest analytics /
    recalculated metrics / refreshed graph data / synchronized DB values,
    never a stale cached copy. This app has no server-side cache layer to
    begin with (every GET queries Mongo fresh), so the remaining risk is
    purely HTTP-level: a browser or intermediary proxy caching a GET
    response. Setting Cache-Control: no-store on every /api/* response,
    in one place, closes that off across the board rather than
    per-endpoint (which would be easy to forget on any new route).
    """
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


app.include_router(auth.router)
app.include_router(subjects.router)
app.include_router(population.router)
app.include_router(assistant.router)
app.include_router(reports.router)
app.include_router(research.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "CardioEQ AI API"}
