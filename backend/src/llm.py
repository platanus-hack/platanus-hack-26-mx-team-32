"""Provider-agnostic LLM client (OpenAI-compatible chat completions).

Only LLM_API_KEY is required; base_url + model are config defaults. Returns None
when no key is set, so callers fall back to deterministic logic (the demo must
run with zero external dependencies).
"""
import json

import httpx

from src.config import settings


def chat(messages: list[dict], temperature: float = 0.2, max_tokens: int = 700) -> str | None:
    if not settings.llm_api_key:
        return None
    r = httpx.post(
        f"{settings.llm_base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.llm_api_key}",
            "X-Title": "Hilo",
        },
        json={
            "model": settings.llm_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
        timeout=45,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def chat_with_tool(
    messages: list[dict],
    *,
    tool_name: str,
    tool_description: str,
    tool_parameters: dict,
    temperature: float = 0.2,
    max_tokens: int = 1500,
) -> dict | None:
    """Force a single tool call and return its parsed arguments.

    Uses the OpenAI `tools` / `tool_choice` shape that OpenRouter and most
    OpenAI-compatible providers support. Returns `None` when no key is set or
    the model didn't invoke the tool (so callers can fall back).
    """
    if not settings.llm_api_key:
        return None
    r = httpx.post(
        f"{settings.llm_base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.llm_api_key}",
            "X-Title": "Hilo",
        },
        json={
            "model": settings.llm_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": tool_description,
                        "parameters": tool_parameters,
                    },
                }
            ],
            "tool_choice": {"type": "function", "function": {"name": tool_name}},
        },
        timeout=60,
    )
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    tool_calls = msg.get("tool_calls") or []
    if not tool_calls:
        return None
    args = tool_calls[0].get("function", {}).get("arguments")
    if not args:
        return None
    try:
        return json.loads(args)
    except (TypeError, json.JSONDecodeError):
        return None
