import json
import re
from datetime import datetime, timezone
from typing import TypedDict

from anthropic import Anthropic
from langgraph.graph import END, StateGraph

try:
    from .config import settings
    from .db import finish_task, get_supabase
except ImportError:
    from config import settings
    from db import finish_task, get_supabase

_RISK_KEYWORDS = re.compile(
    r"trabajo|empleo|vacante|sueldo|buen dinero|sin experiencia|norte|"
    r"cruzar|levant|secuestr|trata|enganche|reclut",
    re.I,
)

_SYSTEM = (
    "Eres un extractor de eventos de riesgo social para México. "
    "Analiza el texto y responde con un objeto JSON con exactamente estos campos: "
    "event_type (uno de: oferta_laboral_sospechosa, secuestro_levanton, "
    "balacera_enfrentamiento, trata_enganche, narcomenudeo_contexto, "
    "control_territorial_contexto, otro), "
    "estado (string o null), municipio (string o null), "
    "summary (string breve, max 120 chars), "
    "confidence (float 0-1), needs_human_review (bool). "
    "Responde SOLO el JSON, sin explicaciones."
)


class ExtractorState(TypedDict):
    task_id: str
    text: str
    source_url: str
    extracted_event: dict | None
    error: str | None


def _fallback_extract(text: str) -> dict:
    hits = len(_RISK_KEYWORDS.findall(text))
    return {
        "event_type": "oferta_laboral_sospechosa" if hits >= 2 else "otro",
        "estado": None,
        "municipio": None,
        "summary": f"Texto con {hits} señal(es) de riesgo detectadas (fallback determinístico).",
        "confidence": min(0.3 + hits * 0.1, 0.8),
        "needs_human_review": True,
    }


def extract_node(state: ExtractorState) -> dict:
    if not settings.anthropic_api_key:
        return {"extracted_event": _fallback_extract(state["text"]), "error": None}

    client = Anthropic(api_key=settings.anthropic_api_key)
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=_SYSTEM,
            messages=[{"role": "user", "content": state["text"][:4000]}],
        )
        raw = msg.content[0].text.strip()
        match = re.search(r"\{.*?\}", raw, re.DOTALL)
        if not match:
            return {"extracted_event": _fallback_extract(state["text"]), "error": None}
        event = json.loads(match.group())
        return {"extracted_event": event, "error": None}
    except Exception as exc:
        return {"extracted_event": _fallback_extract(state["text"]), "error": str(exc)}


def save_event_node(state: ExtractorState) -> dict:
    event = state.get("extracted_event")
    supabase_error: str | None = None
    if event:
        try:
            sb = get_supabase()
            now = datetime.now(timezone.utc).isoformat()
            sb.table("social_risk_events").insert({
                "event_type": event.get("event_type", "otro"),
                "estado": event.get("estado"),
                "municipio": event.get("municipio"),
                "summary_public": event.get("summary"),
                "confidence": event.get("confidence", 0.3),
                "severity": 4 if event.get("event_type") in (
                    "secuestro_levanton", "trata_enganche"
                ) else 2,
                "privacy_level": "restricted",
                "review_status": "pending",
                "reported_at": now,
                "evidence_json": json.dumps({"source_url": state.get("source_url")}),
            }).execute()
        except Exception as exc:
            supabase_error = str(exc)

    finish_task(
        state["task_id"],
        output=event,
        error=supabase_error or state.get("error"),
    )
    return {}


def build_extractor_graph():
    builder = StateGraph(ExtractorState)
    builder.add_node("extract", extract_node)
    builder.add_node("save_event", save_event_node)
    builder.set_entry_point("extract")
    builder.add_edge("extract", "save_event")
    builder.add_edge("save_event", END)
    return builder.compile()


extractor_app = build_extractor_graph()
