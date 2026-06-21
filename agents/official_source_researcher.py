import json
import re
from typing import TypedDict

from anthropic import Anthropic
from langgraph.graph import END, StateGraph

try:
    from .config import settings
    from .db import finish_task, get_supabase
except ImportError:
    from config import settings
    from db import finish_task, get_supabase


class ResearcherState(TypedDict):
    task_id: str
    query: str
    candidate_sources: list[dict]
    error: str | None


def generate_candidates_node(state: ResearcherState) -> dict:
    """Ask Claude for official Mexican source URLs matching the query."""
    if not settings.anthropic_api_key:
        return {"candidate_sources": [], "error": None}

    try:
        client = Anthropic(api_key=settings.anthropic_api_key)
        prompt = (
            f"List 3-5 official Mexican government or institutional sources "
            f"(URLs) relevant to: {state['query']}\n\n"
            "Respond with a JSON array only. Each element: "
            '{"name": str, "url": str, "type": "fiscalia|semefo|comision|registro_oficial|colectivo"}'
            "\nOnly include real, verifiable URLs."
        )
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        text = msg.content[0].text
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if not match:
            return {"candidate_sources": [], "error": "no JSON array in LLM response"}
        sources = json.loads(match.group())
        return {"candidate_sources": sources, "error": None}
    except json.JSONDecodeError as exc:
        return {"candidate_sources": [], "error": str(exc)}
    except Exception as exc:
        return {"candidate_sources": [], "error": str(exc)}


def save_task_node(state: ResearcherState) -> dict:
    finish_task(
        state["task_id"],
        output={"candidate_sources": state.get("candidate_sources", [])},
        error=state.get("error"),
    )
    return {}


def build_researcher_graph():
    builder = StateGraph(ResearcherState)
    builder.add_node("generate_candidates", generate_candidates_node)
    builder.add_node("save_task", save_task_node)
    builder.set_entry_point("generate_candidates")
    builder.add_edge("generate_candidates", "save_task")
    builder.add_edge("save_task", END)
    return builder.compile()


researcher_app = build_researcher_graph()
