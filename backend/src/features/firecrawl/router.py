import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool
from supabase import AsyncClient
from src.deps import get_supabase
from ..auth.dependencies import get_current_user
from ..personas.schemas import PersonaDetail
from .schemas import FirecrawlSearchRequest, NewsRequest, NewsResponse
from src.config import settings
from . import service

logger = logging.getLogger("hilo.firecrawl")

router = APIRouter(prefix="/firecrawl", tags=["firecrawl"])


@router.get("/search")
async def firecrawl_search(
    fullname: str,
    sources: list[str] = Query(default=["news", "web", "images"]),
    limit: int = 10,
    location: str = "Mexico",
    tbs: str | None = "qdr:w",
):
    if not settings.firecrawl_api_key:
        raise HTTPException(status_code=503, detail="FIRECRAWL_API_KEY not configured")
    req = FirecrawlSearchRequest(
        query=fullname,
        sources=sources,
        limit=limit,
        location=location,
        tbs=tbs,
    )
    return await service.search(req)


def _query_fullname(persona: PersonaDetail) -> str:
    """Build the Firecrawl query name: nombre + primer_apellido only.

    The segundo_apellido is intentionally dropped — most press articles cite
    victims by their first surname, and including the second makes the
    search too narrow (often zero results for real cases).
    """
    return " ".join(p for p in (persona.nombre, persona.primer_apellido) if p).strip()


@router.post("/news", response_model=NewsResponse)
async def firecrawl_news(
    body: NewsRequest,
    user=Depends(get_current_user),
    sb: AsyncClient = Depends(get_supabase),
):
    """Firecrawl news search for the selected victim + LLM analysis tree.

    Accepts either `id_victimadirecta` (looked up in Supabase to build the
    query from nombre + primer_apellido) or `fullname` directly (used as-is,
    since we can't reliably split it on the server). Returns a structured
    analysis (person_status, status_enum, related_people tree) plus the raw
    sources.
    """
    if not settings.firecrawl_api_key:
        raise HTTPException(status_code=503, detail="FIRECRAWL_API_KEY not configured")

    fullname = (body.fullname or "").strip()
    if not fullname and body.id_victimadirecta:
        row = await personas_service.get_persona_by_victima(sb, body.id_victimadirecta)
        if not row:
            raise HTTPException(status_code=404, detail="Persona no encontrada")
        persona = PersonaDetail(**personas_service.build_detail(row))
        fullname = _query_fullname(persona)
        logger.info(
            "firecrawl/news: resolved victim id=%s -> query_name=%r (segundo_apellido dropped for search)",
            body.id_victimadirecta, fullname,
        )
    if not fullname:
        raise HTTPException(status_code=400, detail="fullname or id_victimadirecta is required")

    try:
        return await service.search_news(NewsRequest(fullname=fullname))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
