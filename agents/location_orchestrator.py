"""
Orchestrator agent that dispatches existing sub-agents to search for
fosas clandestinas, trabajos falsos, and desaparecidos by location.

The orchestrator itself does no analysis — it builds location-specific
queries and delegates to the appropriate specialist agents.
"""
from typing import TypedDict

from langgraph.graph import END, StateGraph

try:
    from .db import create_task, finish_task, get_supabase
    from .official_source_researcher import researcher_app
except ImportError:
    from db import create_task, finish_task, get_supabase
    from official_source_researcher import researcher_app

_PERSONA_COLS = (
    "id_victimadirecta,nombre,primer_apellido,segundo_apellido,"
    "sexo,edad_actual,estado,municipio,fecha_hechos,fecha_percato"
)


class OrchestratorState(TypedDict):
    task_id: str
    estado: str | None
    municipio: str | None
    fosas_sources: list[dict]
    trabajos_sources: list[dict]
    desaparecidos_sources: list[dict]
    desaparecidos_records: list[dict]
    error: str | None


def _location(state: OrchestratorState) -> str:
    parts = [p for p in [state.get("municipio"), state.get("estado")] if p]
    return ", ".join(parts) if parts else "México"


def dispatch_fosas_node(state: OrchestratorState) -> dict:
    """Ask official_source_researcher for sources on clandestine graves at this location."""
    query = f"fosas clandestinas {_location(state)}"
    sub_task_id = create_task("official-source-researcher", {"query": query, "dispatched_by": state["task_id"]})
    result = researcher_app.invoke({
        "task_id": sub_task_id,
        "query": query,
        "candidate_sources": [],
        "error": None,
    })
    return {"fosas_sources": result.get("candidate_sources", [])}


def dispatch_trabajos_node(state: OrchestratorState) -> dict:
    """Ask official_source_researcher for sources on fake job scams at this location."""
    query = f"trabajos falsos enganche trata de personas {_location(state)}"
    sub_task_id = create_task("official-source-researcher", {"query": query, "dispatched_by": state["task_id"]})
    result = researcher_app.invoke({
        "task_id": sub_task_id,
        "query": query,
        "candidate_sources": [],
        "error": None,
    })
    return {"trabajos_sources": result.get("candidate_sources", [])}


def dispatch_desaparecidos_node(state: OrchestratorState) -> dict:
    """
    Two-part dispatch:
    1. Ask official_source_researcher for official missing-persons sources in this location.
    2. Query personas_desaparecidas table directly for actual records (bulk location lookup
       that the per-persona missing_case_extractor doesn't support).
    """
    query = f"personas desaparecidas registro RNPDNO {_location(state)}"
    sub_task_id = create_task("official-source-researcher", {"query": query, "dispatched_by": state["task_id"]})
    result = researcher_app.invoke({
        "task_id": sub_task_id,
        "query": query,
        "candidate_sources": [],
        "error": None,
    })
    official_sources = result.get("candidate_sources", [])

    try:
        sb = get_supabase()
        q = sb.table("personas_desaparecidas").select(_PERSONA_COLS)
        if state.get("estado"):
            q = q.ilike("estado", f"%{state['estado']}%")
        if state.get("municipio"):
            q = q.ilike("municipio", f"%{state['municipio']}%")
        db_result = q.order("fecha_hechos", desc=True).limit(50).execute()
        records = db_result.data or []
    except Exception as exc:
        return {
            "desaparecidos_sources": official_sources,
            "desaparecidos_records": [],
            "error": str(exc),
        }

    return {
        "desaparecidos_sources": official_sources,
        "desaparecidos_records": records,
    }


def save_task_node(state: OrchestratorState) -> dict:
    finish_task(
        state["task_id"],
        output={
            "location": _location(state),
            "fosas": {
                "official_sources": state.get("fosas_sources", []),
            },
            "trabajos_falsos": {
                "official_sources": state.get("trabajos_sources", []),
            },
            "desaparecidos": {
                "official_sources": state.get("desaparecidos_sources", []),
                "records": state.get("desaparecidos_records", []),
                "total": len(state.get("desaparecidos_records", [])),
            },
        },
        error=state.get("error"),
    )
    return {}


def build_orchestrator_graph():
    builder = StateGraph(OrchestratorState)
    builder.add_node("dispatch_fosas", dispatch_fosas_node)
    builder.add_node("dispatch_trabajos", dispatch_trabajos_node)
    builder.add_node("dispatch_desaparecidos", dispatch_desaparecidos_node)
    builder.add_node("save_task", save_task_node)
    builder.set_entry_point("dispatch_fosas")
    builder.add_edge("dispatch_fosas", "dispatch_trabajos")
    builder.add_edge("dispatch_trabajos", "dispatch_desaparecidos")
    builder.add_edge("dispatch_desaparecidos", "save_task")
    builder.add_edge("save_task", END)
    return builder.compile()


orchestrator_app = build_orchestrator_graph()
