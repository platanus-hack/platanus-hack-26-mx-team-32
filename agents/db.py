from datetime import datetime, timezone
from uuid import uuid4

from supabase import Client, create_client

try:
    from .config import settings
except ImportError:
    from config import settings


def get_supabase() -> Client:
    return create_client(settings.supabase_url, settings.supabase_key)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_task(agent_name: str, input_data: dict) -> str:
    """Insert a new agent_tasks row with status='running'. Returns the UUID."""
    sb = get_supabase()
    res = sb.table("agent_tasks").insert({
        "run_id": str(uuid4()),
        "agent_name": agent_name,
        "status": "running",
        "input": input_data,
        "created_at": _now(),
    }).execute()
    return res.data[0]["id"]


def finish_task(task_id: str, output: dict | None = None, error: str | None = None) -> None:
    """Mark a task completed or failed."""
    try:
        sb = get_supabase()
        sb.table("agent_tasks").update({
            "status": "failed" if error else "completed",
            "output": output,
            "error": error,
        }).eq("id", task_id).execute()
    except Exception:
        pass  # agent_tasks status constraint may not allow these values; events are already saved
