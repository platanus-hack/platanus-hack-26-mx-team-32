import re
from typing import TypedDict

from langgraph.graph import END, StateGraph

try:
    from .db import finish_task, get_supabase
except ImportError:
    from db import finish_task, get_supabase

_SEXO_MAP = {"Hombre": "M", "Mujer": "F", "M": "M", "F": "F"}

_PERSONA_COLS = (
    "id_victimadirecta,nombre,primer_apellido,segundo_apellido,"
    "sexo,edad_actual,estado,municipio,fecha_hechos,fecha_percato,"
    "sana_particular,media_filiacion"
)


def _parse_height(filiacion: str | None) -> int | None:
    if not filiacion:
        return None
    match = re.search(r"[Ee]statura[:\s]*(\d{3})\s*cm", filiacion)
    if match:
        return int(match.group(1))
    match = re.search(r"\b(1[4-9]\d)\s*cm\b", filiacion)
    return int(match.group(1)) if match else None


class CaseExtractorState(TypedDict):
    task_id: str
    persona_victima_id: str
    persona_row: dict | None
    hilo_record: dict | None
    error: str | None


def fetch_persona_node(state: CaseExtractorState) -> dict:
    try:
        sb = get_supabase()
        res = (
            sb.table("personas_desaparecidas")
            .select(_PERSONA_COLS)
            .eq("id_victimadirecta", state["persona_victima_id"])
            .limit(1)
            .execute()
        )
        if not res.data:
            return {"persona_row": None, "error": f"persona {state['persona_victima_id']} not found"}
        return {"persona_row": res.data[0], "error": None}
    except Exception as exc:
        return {"persona_row": None, "error": str(exc)}


def normalize_node(state: CaseExtractorState) -> dict:
    row = state.get("persona_row")
    if not row:
        return {"hilo_record": None}

    sex_raw = (row.get("sexo") or "").strip()
    age = row.get("edad_actual")

    record = {
        "id": row["id_victimadirecta"],
        "source_id": "supabase_rnpdno",
        "record_type": "missing",
        "sex": _SEXO_MAP.get(sex_raw),
        "age_min": age,
        "age_max": age,
        "height_cm": _parse_height(row.get("media_filiacion")),
        "estado": row.get("estado"),
        "municipio": row.get("municipio"),
        "event_date": row.get("fecha_hechos") or row.get("fecha_percato"),
        "raw_description": row.get("sana_particular"),
        "pii_minimized": True,
        "synthetic": False,
    }
    return {"hilo_record": record, "error": None}


def save_task_node(state: CaseExtractorState) -> dict:
    finish_task(
        state["task_id"],
        output={"hilo_record": state.get("hilo_record")},
        error=state.get("error"),
    )
    return {}


def build_case_extractor_graph():
    builder = StateGraph(CaseExtractorState)
    builder.add_node("fetch_persona", fetch_persona_node)
    builder.add_node("normalize", normalize_node)
    builder.add_node("save_task", save_task_node)
    builder.set_entry_point("fetch_persona")
    builder.add_edge("fetch_persona", "normalize")
    builder.add_edge("normalize", "save_task")
    builder.add_edge("save_task", END)
    return builder.compile()


case_extractor_app = build_case_extractor_graph()
