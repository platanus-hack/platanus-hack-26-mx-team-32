from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from supabase import acreate_client

from .config import settings
from .features.auth.router import router as auth_router
from .features.firecrawl.router import router as firecrawl_router
from .features.matching.router import router as matching_router
from .features.personas.router import router as personas_router
from .features.vinculos.router import router as vinculos_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.supabase = await acreate_client(settings.supabase_url, settings.supabase_key)
    pool = ConnectionPool(
        settings.database_url,
        min_size=1,
        max_size=5,
        kwargs={"row_factory": dict_row},
        open=False,
    )
    pool.open()
    app.state.pool = pool
    yield
    pool.close()


app = FastAPI(title="Hilo Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    # Allow any Vercel deploy (stable alias + per-deploy hash URLs) so the
    # frontend isn't CORS-blocked on every new deployment. Regex is used
    # because allow_credentials=True forbids the "*" wildcard.
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(personas_router)
app.include_router(matching_router)
app.include_router(vinculos_router)
app.include_router(firecrawl_router)
