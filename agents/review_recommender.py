from datetime import datetime, timezone
from typing import TypedDict

from langgraph.graph import END, StateGraph

try:
    from .db import finish_task, get_supabase
except ImportError:
    from db import finish_task, get_supabase

_TIER_WEIGHT = {"alta": 3.0, "media": 1.5, "baja": 0.5}
_STALENESS_HALF_LIFE_S = 1800  # 30-minute half-life for freshness bonus


def score_priority(match: dict) -> float:
    """Higher score → higher urgency for review."""
    tier_w = _TIER_WEIGHT.get(match.get("tier", "baja"), 0.5)
    match_score = float(match.get("score", 0.0))

    try:
        created = datetime.fromisoformat(match["created_at"].replace("Z", "+00:00"))
        age_s = (datetime.now(timezone.utc) - created).total_seconds()
    except Exception:
        age_s = 0

    # Staleness bonus: older un-reviewed matches get a slight bump
    staleness = min(age_s / _STALENESS_HALF_LIFE_S, 2.0)

    return tier_w * match_score + staleness * 0.2


class RecommenderState(TypedDict):
    task_id: str
    limit: int
    pending_matches: list[dict]
    recommendations: list[dict]
    error: str | None


def fetch_pending_node(state: RecommenderState) -> dict:
    """Read match_results that have no review_queue entry yet."""
    try:
        sb = get_supabase()
        res = (
            sb.table("match_results")
            .select("id,score,tier,created_at,persona_victima_id,cuerpo_id")
            .limit(state.get("limit", 20))
            .execute()
        )
        return {"pending_matches": res.data or [], "error": None}
    except Exception as exc:
        return {"pending_matches": [], "error": str(exc)}


def rank_and_enqueue_node(state: RecommenderState) -> dict:
    """Score each match and write to review_queue."""
    matches = state.get("pending_matches", [])
    ranked = sorted(matches, key=score_priority, reverse=True)

    recommendations: list[dict] = []
    try:
        sb = get_supabase()
        now = datetime.now(timezone.utc).isoformat()
        for i, m in enumerate(ranked):
            priority = len(ranked) - i  # highest rank = highest priority
            sb.table("review_queue").upsert({
                "match_result_id": m["id"],
                "priority": priority,
                "status": "pending",
                "updated_at": now,
            }, on_conflict="match_result_id").execute()
            recommendations.append({"match_result_id": m["id"], "priority": priority})
    except Exception as exc:
        return {"recommendations": [], "error": str(exc)}

    return {"recommendations": recommendations, "error": None}


def save_task_node(state: RecommenderState) -> dict:
    finish_task(
        state["task_id"],
        output={"enqueued": len(state.get("recommendations", []))},
        error=state.get("error"),
    )
    return {}


def build_recommender_graph():
    builder = StateGraph(RecommenderState)
    builder.add_node("fetch_pending", fetch_pending_node)
    builder.add_node("rank_and_enqueue", rank_and_enqueue_node)
    builder.add_node("save_task", save_task_node)
    builder.set_entry_point("fetch_pending")
    builder.add_edge("fetch_pending", "rank_and_enqueue")
    builder.add_edge("rank_and_enqueue", "save_task")
    builder.add_edge("save_task", END)
    return builder.compile()


recommender_app = build_recommender_graph()
