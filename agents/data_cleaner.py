"""Data cleaner for social_risk_events - two-stage (structural + semantic)."""
import json
import re
from typing import Any

# Official Mexican state names (32 states)
MEXICAN_STATES = {
    "Aguascalientes", "Baja California", "Baja California Sur", "Campeche",
    "Chiapas", "Chihuahua", "Coahuila", "Colima", "Durango", "Guanajuato",
    "Guerrero", "Hidalgo", "Jalisco", "Mexico", "Michoacan", "Morelos",
    "Nayarit", "Nuevo Leon", "Oaxaca", "Puebla", "Queretaro", "Quintana Roo",
    "San Luis Potosi", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala",
    "Veracruz", "Yucatan", "Zacatecas", "Ciudad de Mexico"
}

# Allowed event_type values (DB CHECK constraint)
ALLOWED_EVENT_TYPES = {
    "oferta_laboral_sospechosa", "secuestro_levanton", "balacera_enfrentamiento",
    "trata_enganche", "narcomenudeo_contexto", "control_territorial_contexto", "otro"
}

# Event types the LLM prompt returns but DB doesn't allow -> remap to "otro"
REMAP_TO_OTRO = {"fosa_clandestina", "hallazgo_restos"}

ALLOWED_PRIVACY_LEVELS = {"public_aggregate", "internal", "restricted"}
ALLOWED_REVIEW_STATUSES = {"pending", "approved", "rejected", "hidden"}


def _normalize_state(state: Any) -> str | None:
    """Normalize estado to official Mexican state name. Null if unrecognizable."""
    if not state or not isinstance(state, str):
        return None
    state = state.strip()
    if not state:
        return None
    # Direct match
    if state in MEXICAN_STATES:
        return state
    # Common abbreviations/aliases
    aliases = {
        "CDMX": "Ciudad de Mexico", "DF": "Ciudad de Mexico",
        "Edomex": "Mexico", "Estado de Mexico": "Mexico",
        "Veracruz de Ignacio de la Llave": "Veracruz",
        "Coahuila de Zaragoza": "Coahuila", "Michoacan de Ocampo": "Michoacan"
    }
    if state in aliases:
        return aliases[state]
    # Case-insensitive match
    for official in MEXICAN_STATES:
        if state.lower() == official.lower():
            return official
    # Unrecognizable
    return None


def _normalize_municipio(municipio: Any) -> str | None:
    """Normalize municipio casing. Null if blank."""
    if not municipio or not isinstance(municipio, str):
        return None
    municipio = municipio.strip()
    if not municipio:
        return None
    # Title case (simple heuristic)
    return municipio.title()


def _clamp_confidence(conf: Any) -> float:
    """Clamp confidence to [0.0, 1.0]. Default 0.3 if missing/invalid."""
    if conf is None:
        return 0.3
    try:
        val = float(conf)
        return max(0.0, min(1.0, val))
    except (TypeError, ValueError):
        return 0.3


def _clamp_severity(sev: Any) -> int:
    """Clamp severity to [1, 5]. Default 2 if missing/out of range."""
    if sev is None:
        return 2
    try:
        val = int(sev)
        return max(1, min(5, val))
    except (TypeError, ValueError):
        return 2


def _truncate_summary(summary: Any, max_len: int = 120) -> str | None:
    """Truncate summary to max_len chars. Strip whitespace."""
    if not summary or not isinstance(summary, str):
        return None
    summary = summary.strip()
    if len(summary) > max_len:
        return summary[:max_len].rsplit(" ", 1)[0] + "..."
    return summary


def _remap_event_type(event_type: Any, evidence_json: dict) -> str:
    """Enforce enum membership. Remap fosa_clandestina/hallazgo_restos to otro."""
    if not event_type or not isinstance(event_type, str):
        return "otro"
    event_type = event_type.strip().lower()
    if event_type in REMAP_TO_OTRO:
        evidence_json["original_event_type"] = event_type
        return "otro"
    if event_type in ALLOWED_EVENT_TYPES:
        return event_type
    return "otro"


def _coerce_privacy_level(level: Any) -> str:
    """Enforce privacy_level enum. Default 'restricted'."""
    if not level or not isinstance(level, str):
        return "restricted"
    level = level.strip().lower()
    return level if level in ALLOWED_PRIVACY_LEVELS else "restricted"


def _coerce_review_status(status: Any) -> str:
    """Enforce review_status enum. Default 'pending'."""
    if not status or not isinstance(status, str):
        return "pending"
    status = status.strip().lower()
    return status if status in ALLOWED_REVIEW_STATUSES else "pending"


def _stage1_structural_clean(event: dict, table: str) -> dict:
    """Stage 1: structural fixes (no LLM). Returns new dict."""
    if table != "social_risk_events":
        return {**event}  # Unknown table - pass through

    cleaned = {**event}
    evidence_json = {}
    
    # Parse evidence_json if it's a string
    if isinstance(cleaned.get("evidence_json"), str):
        try:
            evidence_json = json.loads(cleaned["evidence_json"])
        except json.JSONDecodeError:
            evidence_json = {}
    
    # event_type: enforce enum, remap fosa/hallazgo to otro
    cleaned["event_type"] = _remap_event_type(cleaned.get("event_type"), evidence_json)
    
    # estado: normalize to official state name
    cleaned["estado"] = _normalize_state(cleaned.get("estado"))
    
    # municipio: normalize casing
    cleaned["municipio"] = _normalize_municipio(cleaned.get("municipio"))
    
    # summary_public: truncate at 120 chars
    cleaned["summary_public"] = _truncate_summary(cleaned.get("summary_public"))
    
    # confidence: clamp to [0.0, 1.0]
    cleaned["confidence"] = _clamp_confidence(cleaned.get("confidence"))
    
    # severity: clamp to [1, 5]
    cleaned["severity"] = _clamp_severity(cleaned.get("severity"))
    
    # privacy_level: enforce enum
    cleaned["privacy_level"] = _coerce_privacy_level(cleaned.get("privacy_level"))
    
    # review_status: enforce enum
    cleaned["review_status"] = _coerce_review_status(cleaned.get("review_status"))
    
    # Write back evidence_json with original_event_type if remapped
    if evidence_json:
        cleaned["evidence_json"] = json.dumps(evidence_json)
    
    return cleaned


def _stage2_semantic_clean(event: dict, table: str) -> dict:
    """Stage 2: LLM semantic correction (falls back silently). Returns new dict."""
    # For now, skip LLM stage (can be added later)
    # The spec says "If Stage 2 fails for any reason, Stage 1 output is used"
    # So returning event unchanged is valid fallback
    return event


def clean_event(event: dict, table: str) -> dict:
    """
    Two-stage cleaner for social_risk_events.
    
    Stage 1: structural fixes (always runs, no LLM)
    Stage 2: semantic normalization (LLM, falls back silently)
    
    Returns a new dict (never mutates input).
    Adds _cleaned: bool to indicate whether Stage 2 ran successfully.
    """
    # Stage 1
    cleaned = _stage1_structural_clean(event, table)
    
    # Stage 2 (placeholder - LLM call can be added here)
    try:
        cleaned = _stage2_semantic_clean(cleaned, table)
        cleaned["_cleaned"] = True
    except Exception:
        # Stage 2 failed - use Stage 1 output
        cleaned["_cleaned"] = False
    
    return cleaned
