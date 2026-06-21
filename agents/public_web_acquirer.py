import re
from typing import TypedDict

import httpx
from langgraph.graph import END, StateGraph

try:
    from .config import settings
    from .db import finish_task
except ImportError:
    from config import settings
    from db import finish_task


class AcquirerState(TypedDict):
    task_id: str
    url: str
    markdown: str
    title: str
    error: str | None


def _strip_tags(html: str) -> str:
    html = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    html = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.I)
    return re.sub(r"<[^>]+>", " ", html).strip()


def scrape_node(state: AcquirerState) -> dict:
    """Scrape a URL via Firecrawl REST API (if key set) or plain httpx."""
    url = state["url"]

    if settings.firecrawl_api_key:
        resp = httpx.get(
            "https://api.firecrawl.dev/v1/scrape",
            params={"url": url, "formats": "markdown"},
            headers={"Authorization": f"Bearer {settings.firecrawl_api_key}"},
            timeout=30,
        )
        if resp.status_code != 200:
            return {"markdown": "", "title": "", "error": f"Firecrawl HTTP {resp.status_code}"}
        data = resp.json().get("data", {})
        return {
            "markdown": data.get("markdown", ""),
            "title": data.get("metadata", {}).get("title", ""),
            "error": None,
        }

    # Plain httpx fallback
    try:
        resp = httpx.get(url, timeout=20, follow_redirects=True)
        resp.raise_for_status()
        text = _strip_tags(resp.text)
        return {"markdown": text[:8000], "title": url, "error": None}
    except Exception as exc:
        return {"markdown": "", "title": "", "error": str(exc)}


def save_task_node(state: AcquirerState) -> dict:
    finish_task(
        state["task_id"],
        output={"markdown": state.get("markdown", ""), "title": state.get("title", "")},
        error=state.get("error"),
    )
    return {}


def build_acquirer_graph():
    builder = StateGraph(AcquirerState)
    builder.add_node("scrape", scrape_node)
    builder.add_node("save_task", save_task_node)
    builder.set_entry_point("scrape")
    builder.add_edge("scrape", "save_task")
    builder.add_edge("save_task", END)
    return builder.compile()


acquirer_app = build_acquirer_graph()
