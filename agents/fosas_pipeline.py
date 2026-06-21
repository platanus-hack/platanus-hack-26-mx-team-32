"""
Pipeline: Firecrawl search → extractor in a single LangGraph workflow.

Firecrawl /search finds real articles and returns their markdown in one call,
replacing the hallucination-prone researcher + scrape two-step.

Usage:
  uv run python run_agent.py pipeline --query "fosas clandestinas jalisco 2024"
  uv run python run_agent.py pipeline --query "hallazgos restos humanos semefo mexico"
  uv run python run_agent.py pipeline --query "violencia organizada desaparecidos mexico"
  uv run python run_agent.py pipeline --query "trata de personas enganche ofertas laborales"
"""
import json
import re
import time
from datetime import datetime, timezone
from typing import TypedDict

import httpx
from anthropic import Anthropic
from langgraph.graph import END, StateGraph

try:
    from .config import settings
    from .db import finish_task, get_supabase
except ImportError:
    from config import settings
    from db import finish_task, get_supabase


_EXTRACT_SYSTEM = (
    "Eres un extractor de eventos de riesgo social y hallazgos forenses para México. "
    "Analiza el texto y responde con un objeto JSON con exactamente estos campos: "
    "event_type (uno de: fosa_clandestina, hallazgo_restos, secuestro_levanton, "
    "balacera_enfrentamiento, trata_enganche, oferta_laboral_sospechosa, "
    "narcomenudeo_contexto, control_territorial_contexto, otro), "
    "estado (string o null), municipio (string o null), "
    "summary (string breve, max 120 chars), "
    "confidence (float 0-1), needs_human_review (bool). "
    "Responde SOLO el JSON, sin explicaciones."
)

_HIGH_SEVERITY_TYPES = {"fosa_clandestina", "hallazgo_restos", "secuestro_levanton", "trata_enganche"}

_FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search"


class PipelineState(TypedDict):
    task_id: str
    query: str
    scraped_pages: list[dict]
    extracted_events: list[dict]
    errors: list[str]


# ── Node 1: Firecrawl search ──────────────────────────────────────────────────

def search_node(state: PipelineState) -> dict:
    """Search the web with Firecrawl and return scraped article markdown."""
    if not settings.firecrawl_api_key:
        return {
            "scraped_pages": [],
            "errors": state["errors"] + ["search: FIRECRAWL_API_KEY not set"],
        }

    try:
        resp = httpx.post(
            _FIRECRAWL_SEARCH_URL,
            headers={
                "Authorization": f"Bearer {settings.firecrawl_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "query": state["query"],
                "limit": 5,
                "scrapeOptions": {"formats": ["markdown"]},
            },
            timeout=60,
        )
        if resp.status_code != 200:
            return {
                "scraped_pages": [],
                "errors": state["errors"] + [f"search: Firecrawl HTTP {resp.status_code} — {resp.text[:200]}"],
            }

        results = resp.json().get("data", [])
        pages = [
            {
                "url": r.get("url", ""),
                "title": r.get("metadata", {}).get("title", r.get("url", "")),
                "markdown": r.get("markdown", ""),
            }
            for r in results
            if r.get("markdown")
        ]
        print(f"[search] Firecrawl returned {len(pages)} pages for: {state['query']!r}")
        for p in pages:
            print(f"  -> {p['url']} ({len(p['markdown'])} chars)")
        return {"scraped_pages": pages, "errors": state["errors"]}

    except Exception as exc:
        return {"scraped_pages": [], "errors": state["errors"] + [f"search: {exc}"]}


# ── Node 2: extractor ─────────────────────────────────────────────────────────

def _extract_event(text: str, source_url: str) -> tuple[dict | None, str | None]:
    if not settings.anthropic_api_key:
        return None, "no anthropic key"

    try:
        client = Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=_EXTRACT_SYSTEM,
            messages=[{"role": "user", "content": text[:4000]}],
        )
        raw = msg.content[0].text.strip()
        match = re.search(r"\{.*?\}", raw, re.DOTALL)
        if not match:
            return None, f"extractor: no JSON in response for {source_url}"
        event = json.loads(match.group())
        event["source_url"] = source_url
        return event, None
    except Exception as exc:
        return None, f"extractor [{source_url}]: {exc}"


def extract_node(state: PipelineState) -> dict:
    events: list[dict] = []
    errors = list(state["errors"])
    sb = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    for page in state["scraped_pages"]:
        event, err = _extract_event(page["markdown"], page["url"])
        if err:
            errors.append(err)
            continue
        if not event:
            continue

        events.append(event)

        try:
            severity = 5 if event.get("event_type") in _HIGH_SEVERITY_TYPES else 2
            sb.table("social_risk_events").insert({
                "event_type": event.get("event_type", "otro"),
                "estado": event.get("estado"),
                "municipio": event.get("municipio"),
                "summary_public": event.get("summary"),
                "confidence": event.get("confidence", 0.3),
                "severity": severity,
                "privacy_level": "restricted",
                "review_status": "pending",
                "reported_at": now,
                "evidence_json": json.dumps({"source_url": page["url"], "title": page["title"]}),
            }).execute()
            print(f"[extractor] saved '{event.get('event_type')}' (conf={event.get('confidence')}) — {page['url']}")
        except Exception as exc:
            errors.append(f"db insert [{page['url']}]: {exc}")

        time.sleep(0.5)

    return {"extracted_events": events, "errors": errors}


# ── Node 3: save ──────────────────────────────────────────────────────────────

def save_node(state: PipelineState) -> dict:
    finish_task(
        state["task_id"],
        output={
            "pages_scraped": len(state["scraped_pages"]),
            "events_extracted": len(state["extracted_events"]),
            "events": state["extracted_events"],
        },
        error="; ".join(state["errors"]) if state["errors"] else None,
    )
    return {}


# ── Graph ─────────────────────────────────────────────────────────────────────

def build_pipeline_graph():
    builder = StateGraph(PipelineState)
    builder.add_node("search", search_node)
    builder.add_node("extract", extract_node)
    builder.add_node("save", save_node)
    builder.set_entry_point("search")
    builder.add_edge("search", "extract")
    builder.add_edge("extract", "save")
    builder.add_edge("save", END)
    return builder.compile()


pipeline_app = build_pipeline_graph()
