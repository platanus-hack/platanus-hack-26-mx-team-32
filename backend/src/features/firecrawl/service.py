import httpx
import logging

from src.config import settings
from src.llm import chat_with_tool
from .schemas import FirecrawlSearchRequest, NewsAnalysis, NewsRequest, NewsResponse, RelatedPerson

logger = logging.getLogger("hilo.firecrawl")

FIRECRAWL_URL = "https://api.firecrawl.dev/v2/search"


async def search(req: FirecrawlSearchRequest) -> dict:
    payload = {
        "query": req.query,
        "sources": req.sources,
        "categories": [],
        "tbs": req.tbs,
        "limit": req.limit,
        "location": req.location,
        "scrapeOptions": {
            "onlyMainContent": False,
            "maxAge": 172800000,
            "proxy": "stealth",
            "parsers": ["pdf"],
            "formats": [
                {
                    "type": "json",
                    "schema": {
                        "type": "object",
                        "required": [],
                        "properties": {
                            "relevant_information": {"type": "string"},
                            "additional_notes": {"type": "string"},
                            "source": {"type": "string"},
                        },
                    },
                    "prompt": "extract relevant case information of the victim",
                }
            ],
        },
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            FIRECRAWL_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {settings.firecrawl_api_key}",
                "Content-Type": "application/json",
            },
            timeout=120,
        )
        r.raise_for_status()
        return r.json()


# ── News analysis for the Home widget ──────────────────────────────────────


# Exact payload the widget uses, per the spec.
NEWS_PAYLOAD = {
    "query": "",  # filled in at call time
    "sources": ["news", "web"],
    "categories": [],
    "tbs": "qdr:w",  # past week
    "limit": 10,
    "location": "Mexico",
    "scrapeOptions": {
        "onlyMainContent": False,
        "maxAge": 172800000,
        "proxy": "stealth",
        "parsers": ["pdf"],
        "formats": ["markdown"],
    },
}

# Tool schema for the LLM. Uses a recursive $ref so the related_people tree
# can nest arbitrarily deep.
_NEWS_TOOL_NAME = "extract_person_news"
_NEWS_TOOL_PARAMETERS = {
    "type": "object",
    "properties": {
        "person_status": {
            "type": "string",
            "description": (
                "Spanish summary (1-3 sentences) of what the most recent and "
                "reliable news say about the person's current status / situation."
            ),
        },
        "status_enum": {
            "type": "string",
            "enum": ["found_dead", "found_alive", "not_found"],
            "description": (
                "The person's disposition: 'found_dead' if reported found dead, "
                "'found_alive' if found alive, 'not_found' otherwise."
            ),
        },
        "related_people": {
            "type": "array",
            "description": "People mentioned in the news in relation to the victim.",
            "items": {"$ref": "#/$defs/RelatedPerson"},
        },
    },
    "required": ["person_status", "status_enum", "related_people"],
    "additionalProperties": False,
    "$defs": {
        "RelatedPerson": {
            "type": "object",
            "properties": {
                "person_name": {"type": "string"},
                "person_status": {
                    "type": "string",
                    "description": "Spanish summary of this person's status in the case.",
                },
                "status_enum": {
                    "type": "string",
                    "enum": ["found_dead", "found_alive", "not_found"],
                },
                "related_people": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/RelatedPerson"},
                },
            },
            "required": ["person_name", "person_status", "status_enum", "related_people"],
            "additionalProperties": False,
        }
    },
}


def _extract_items(firecrawl_resp: dict) -> list[dict]:
    """Pull the news+web result items out of a Firecrawl v2 search response.

    Tolerant of a few response shapes Firecrawl has shipped:
      - {"data": {"news": [...], "web": [...], "images": [...]}}  (v2 grouped)
      - {"data": [...]}                                            (flat list)
      - {"results": [...]}                                         (alt key)
      - [...]                                                       (raw list)
    """
    if not isinstance(firecrawl_resp, dict):
        if isinstance(firecrawl_resp, list):
            return [it for it in firecrawl_resp if isinstance(it, dict) and it.get("url")]
        return []

    data = firecrawl_resp.get("data")
    candidates: list[dict] = []
    if isinstance(data, list):
        # Flat list of results.
        candidates = [it for it in data if isinstance(it, dict) and it.get("url")]
    elif isinstance(data, dict):
        # Grouped: news + web (optionally images).
        for key in ("news", "web", "images", "results"):
            for it in (data.get(key) or []):
                if isinstance(it, dict) and it.get("url"):
                    candidates.append(it)
    else:
        # Some Firecrawl responses put the grouped object at the top level.
        for key in ("news", "web", "results"):
            for it in (firecrawl_resp.get(key) or []):
                if isinstance(it, dict) and it.get("url"):
                    candidates.append(it)

    # Deduplicate by URL while preserving order.
    seen: set[str] = set()
    deduped: list[dict] = []
    for it in candidates:
        u = it["url"]
        if u in seen:
            continue
        seen.add(u)
        deduped.append(it)
    return deduped


def _build_news_context(items: list[dict], max_total_chars: int = 200_000) -> str:
    """Concatenate ALL items' title + full markdown into a single prompt context.

    The LLM digests the full body of every result. We only truncate as a
    hard safety net to stay under the model's context window (200k chars ≈
    ~50k tokens, well within Claude/OpenAI limits). The final block is
    truncated to fit the cap rather than dropped, so a single very long
    article still contributes.
    """
    blocks: list[str] = []
    running = 0
    for i, it in enumerate(items, 1):
        title = (it.get("title") or "").strip()
        # Firecrawl returns the scraped content as `markdown` when that format
        # is requested; fall back to content/snippet if present.
        body = (it.get("markdown") or it.get("content") or it.get("snippet") or "").strip()
        url = it.get("url", "")
        header = f"[{i}] {title} — {url}"
        block = f"{header}\n{body}" if body else header
        sep = 4 if blocks else 0  # "\n\n---\n\n" between blocks

        if running + sep + len(block) <= max_total_chars:
            blocks.append(block)
            running += sep + len(block)
        else:
            # Final block: truncate to whatever room is left, but always
            # include at least the header so the LLM sees the source.
            remaining = max_total_chars - running - sep
            if remaining > len(header) + 200:
                truncated = block[: remaining - 60] + "\n[…truncado…]"
                blocks.append(truncated)
            logger.info(
                "_build_news_context: capped at %d items (safety limit %d chars)",
                len(blocks), max_total_chars,
            )
            break

    return "\n\n---\n\n".join(blocks)


def _default_analysis() -> NewsAnalysis:
    return NewsAnalysis(
        person_status="Sin información reciente en las noticias consultadas.",
        status_enum="not_found",
        related_people=[],
    )


async def _run_llm_analysis(person_name: str, news_context: str) -> NewsAnalysis:
    """Call the LLM with the news context and return a validated NewsAnalysis."""
    if not news_context.strip():
        logger.warning("_run_llm_analysis: empty news_context, returning default")
        return _default_analysis()

    system = (
        "Eres un analista forense mexicano que revisa notas periodísticas para "
        "ayudar a buscadoras (madres que buscan a sus familiares desaparecidos). "
        "Tu trabajo es extraer, SOLO a partir de las notas proporcionadas, la "
        "situación actual de la persona y las personas relacionadas. "
        "Reglas estrictas:\n"
        "  - NO inventes datos. Si una nota no menciona un dato, no lo rellenes.\n"
        "  - Cita mentalmente la nota; si no hay evidencia suficiente, usa "
        "    status_enum='not_found' y 'Sin información reciente...'.\n"
        "  - Escribe los resúmenes en español en tercera persona como un "
        "    párrafo narrativo legible (3-5 frases para la persona raíz, 2-4 "
        "    frases para cada persona relacionada). Incluye contexto concreto "
        "    que aparezca en las notas: rol en el caso, acciones descritas, "
        "    fechas o lugares si los hay, y la fuente cuando ayude. Evita "
        "    afirmaciones absolutas ('posible', 'según las notas') cuando el "
        "    caso lo requiera.\n"
        "  - En 'related_people' incluye únicamente personas mencionadas "
        "    explícitamente en las notas como vinculadas al caso (familiares, "
        "    testigos, sospechosos, otras víctimas). No inventes nombres.\n"
        "  - Si no hay personas relacionadas, devuelve una lista vacía."
    )
    user = (
        f"Persona buscada: {person_name}\n\n"
        f"Notas periodísticas (de Firecrawl, última semana, México):\n\n"
        f"{news_context}\n\n"
        "Llama a la herramienta extract_person_news con el resultado."
    )

    parsed = chat_with_tool(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        tool_name=_NEWS_TOOL_NAME,
        tool_description=(
            "Extrae el estado de la persona buscada y las personas relacionadas "
            "a partir de las notas periodísticas proporcionadas."
        ),
        tool_parameters=_NEWS_TOOL_PARAMETERS,
        temperature=0.1,
        max_tokens=3000,
    )

    if not parsed:
        logger.warning(
            "LLM returned no parsed output for person=%r (context_len=%d). "
            "Check that LLM_API_KEY is set and the model supports tool-calling.",
            person_name, len(news_context),
        )
        return _default_analysis()

    # Validate/normalize with Pydantic so the response is always well-formed.
    try:
        result = NewsAnalysis.model_validate(parsed)
        logger.info(
            "LLM parsed OK for person=%r: status=%s related=%d",
            person_name, result.status_enum, len(result.related_people),
        )
        return result
    except Exception as e:
        logger.warning("LLM output failed strict validation for person=%r: %s. Raw keys=%s. Falling back to coercion.", person_name, e, list(parsed.keys()) if isinstance(parsed, dict) else type(parsed).__name__)
        related_raw = parsed.get("related_people") or []
        related: list[RelatedPerson] = []
        for r in related_raw:
            try:
                related.append(RelatedPerson.model_validate(r))
            except Exception:
                continue
        return NewsAnalysis(
            person_status=str(parsed.get("person_status") or _default_analysis().person_status),
            status_enum=parsed.get("status_enum") if parsed.get("status_enum") in ("found_dead", "found_alive", "not_found") else "not_found",
            related_people=related,
        )


async def search_news(req: NewsRequest) -> NewsResponse:
    """Firecrawl news search + LLM analysis for the selected victim."""
    if not settings.firecrawl_api_key:
        logger.error("search_news called but FIRECRAWL_API_KEY is not configured")
        raise RuntimeError("FIRECRAWL_API_KEY not configured")

    fullname = (req.fullname or "").strip()
    if not fullname:
        logger.error("search_news called without a fullname (id_victimadirecta=%r)", req.id_victimadirecta)
        raise ValueError("fullname is required")

    query = f"{fullname} DESAPARECIDO"
    payload = {**NEWS_PAYLOAD, "query": query}
    logger.info("Firecrawl news search: query=%r sources=%s location=%s", query, payload["sources"], payload["location"])

    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                FIRECRAWL_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.firecrawl_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=120,
            )
    except httpx.HTTPError as e:
        logger.exception("Firecrawl HTTP error for query=%r: %s", query, e)
        raise

    logger.info("Firecrawl response: status=%d bytes=%d", r.status_code, len(r.content))

    if r.status_code >= 400:
        logger.error("Firecrawl non-2xx for query=%r: %s", query, r.text[:1000])
        r.raise_for_status()

    try:
        firecrawl_resp = r.json()
    except json.JSONDecodeError:
        logger.error("Firecrawl returned non-JSON for query=%r: %s", query, r.text[:500])
        raise

    # Log the top-level shape so we can diagnose empty results fast.
    if isinstance(firecrawl_resp, dict):
        top_keys = list(firecrawl_resp.keys())
        logger.info("Firecrawl body top-level keys=%s success=%s", top_keys, firecrawl_resp.get("success"))
        data_obj = firecrawl_resp.get("data")
        if isinstance(data_obj, dict):
            news_n = len(data_obj.get("news") or [])
            web_n = len(data_obj.get("web") or [])
            images_n = len(data_obj.get("images") or [])
            logger.info("Firecrawl data counts: news=%d web=%d images=%d", news_n, web_n, images_n)
            if "warning" in firecrawl_resp:
                logger.warning("Firecrawl warning: %s", firecrawl_resp.get("warning"))
            if "error" in firecrawl_resp:
                logger.error("Firecrawl error field: %s", firecrawl_resp.get("error"))
            if news_n == 0 and web_n == 0:
                logger.info(
                    "Firecrawl returned no news/web items for query=%r. Full data=%s",
                    query, json.dumps(data_obj)[:2000],
                )
        elif isinstance(data_obj, list):
            logger.info("Firecrawl data is a flat list of %d items", len(data_obj))
            if data_obj:
                logger.info("Firecrawl first item keys=%s", list(data_obj[0].keys()) if isinstance(data_obj[0], dict) else type(data_obj[0]).__name__)
        else:
            logger.warning("Firecrawl 'data' is %r (value=%r)", type(data_obj).__name__, str(data_obj)[:300])
    else:
        logger.warning("Firecrawl body is %r", type(firecrawl_resp).__name__)

    # When items are empty, dump a (truncated) full body so we can see exactly
    # what Firecrawl sent back — invaluable for diagnosing shape changes.
    items = _extract_items(firecrawl_resp)
    if not items:
        logger.warning(
            "Firecrawl returned 0 usable items for query=%r. Raw body (truncated 4KB): %s",
            query, json.dumps(firecrawl_resp)[:4000],
        )
    else:
        logger.info("Extracted %d deduplicated news items for query=%r", len(items), query)
        first = items[0]
        if isinstance(first, dict):
            logger.info("First item keys=%s url=%s title=%r markdown_len=%d",
                        list(first.keys()), first.get("url"),
                        (first.get("title") or "")[:80],
                        len(first.get("markdown") or first.get("content") or ""))

    sources = [
        {"url": it.get("url"), "title": it.get("title"), "snippet": (it.get("markdown") or it.get("snippet") or "")[:300]}
        for it in items
    ]
    news_context = _build_news_context(items)
    logger.info("News context length: %d chars (from %d items)", len(news_context), len(items))

    analysis = await _run_llm_analysis(fullname, news_context)
    logger.info(
        "LLM analysis: status=%s related_people=%d person_status=%r",
        analysis.status_enum, len(analysis.related_people), analysis.person_status[:120],
    )

    return NewsResponse(query=query, sources=sources, analysis=analysis)
