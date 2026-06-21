"""CLI runner for all LangGraph agents.

Usage:
  uv run python run_agent.py researcher   --query "fiscalía jalisco desaparecidos"
  uv run python run_agent.py acquirer     --url https://www.gob.mx/fgr
  uv run python run_agent.py extractor    --text "Se busca gente para el norte buen sueldo"
  uv run python run_agent.py case         --persona-id <uuid>
  uv run python run_agent.py recommender
  uv run python run_agent.py pipeline     --query "fosas clandestinas jalisco 2024"
"""
import argparse
import json
import sys

try:
    # When run as: python -m agents.run_agent
    from .db import create_task
    from .official_source_researcher import researcher_app
    from .public_web_acquirer import acquirer_app
    from .social_intel_extractor import extractor_app
    from .missing_case_extractor import case_extractor_app
    from .review_recommender import recommender_app
    from .fosas_pipeline import pipeline_app
except ImportError:
    # When run as: cd agents && python run_agent.py (script mode)
    from db import create_task
    from official_source_researcher import researcher_app
    from public_web_acquirer import acquirer_app
    from social_intel_extractor import extractor_app
    from missing_case_extractor import case_extractor_app
    from review_recommender import recommender_app
    from fosas_pipeline import pipeline_app


def main():
    parser = argparse.ArgumentParser(description="Run a Hilo LangGraph agent")
    parser.add_argument("agent", choices=["researcher", "acquirer", "extractor", "case", "recommender", "pipeline"])
    parser.add_argument("--query", default="")
    parser.add_argument("--url", default="")
    parser.add_argument("--text", default="")
    parser.add_argument("--persona-id", dest="persona_id", default="")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    if args.agent == "researcher":
        task_id = create_task("official-source-researcher", {"query": args.query})
        result = researcher_app.invoke({"task_id": task_id, "query": args.query, "candidate_sources": [], "error": None})
        print(json.dumps(result.get("candidate_sources", []), indent=2, ensure_ascii=False))

    elif args.agent == "acquirer":
        task_id = create_task("public-web-acquirer", {"url": args.url})
        result = acquirer_app.invoke({"task_id": task_id, "url": args.url, "markdown": "", "title": "", "error": None})
        print(result.get("markdown", "")[:500])

    elif args.agent == "extractor":
        task_id = create_task("social-intel-extractor", {"text": args.text[:200]})
        result = extractor_app.invoke({"task_id": task_id, "text": args.text, "source_url": "", "extracted_event": None, "error": None})
        print(json.dumps(result.get("extracted_event"), indent=2, ensure_ascii=False))

    elif args.agent == "case":
        task_id = create_task("missing-case-extractor", {"persona_victima_id": args.persona_id})
        result = case_extractor_app.invoke({"task_id": task_id, "persona_victima_id": args.persona_id, "persona_row": None, "hilo_record": None, "error": None})
        print(json.dumps(result.get("hilo_record"), indent=2, ensure_ascii=False))

    elif args.agent == "recommender":
        task_id = create_task("review-recommender", {"limit": args.limit})
        result = recommender_app.invoke({"task_id": task_id, "limit": args.limit, "pending_matches": [], "recommendations": [], "error": None})
        print(f"Enqueued {len(result.get('recommendations', []))} items for review")

    elif args.agent == "pipeline":
        task_id = create_task("fosas-pipeline", {"query": args.query})
        result = pipeline_app.invoke({
            "task_id": task_id,
            "query": args.query,
            "scraped_pages": [],
            "extracted_events": [],
            "errors": [],
        })
        events = result.get("extracted_events", [])
        errors = result.get("errors", [])
        print(f"\nPages scraped:    {len(result.get('scraped_pages', []))}")
        print(f"Events extracted: {len(events)}")
        if events:
            print(json.dumps(events, indent=2, ensure_ascii=False))
        if errors:
            print(f"\n[WARNINGS] {len(errors)} non-fatal errors:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)

    err = result.get("error") if args.agent != "pipeline" else (
        "; ".join(result.get("errors", [])) if result.get("errors") else None
    )
    if err:
        print(f"\n[ERROR] {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
