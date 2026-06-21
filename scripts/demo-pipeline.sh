#!/usr/bin/env bash
# Full pipeline demo: all 5 agents + bridge TS
# Usage: bash scripts/demo-pipeline.sh <persona_victima_id>
set -euo pipefail

PERSONA_ID="${1:-}"
if [ -z "$PERSONA_ID" ]; then
  echo "Usage: $0 <persona_victima_id>"
  echo "Find one with: SELECT id_victimadirecta FROM personas_desaparecidas LIMIT 1"
  exit 1
fi

echo "═══════════════════════════════════════"
echo " Hilo Agents Demo Pipeline"
echo "═══════════════════════════════════════"

cd "$(dirname "$0")/.."

# Test that all agents are runnable and tests pass
echo ""
echo "▶ Step 0: Verify Python agents and tests"
cd agents && uv run pytest tests/ -v --tb=short && cd ..

echo ""
echo "═══════════════════════════════════════"
echo " Individual Agent Demos (dry run mode)"
echo "═══════════════════════════════════════"

# Note: The actual agent invocations below use mocked Supabase connections
# since SUPABASE_URL and SUPABASE_KEY are dummy values.
# Agents will print their output or error gracefully.

echo ""
echo "▶ [1/6] official-source-researcher"
cd agents && uv run python run_agent.py researcher --query "fiscalía jalisco personas desaparecidas" 2>&1 | head -20 || true && cd ..

echo ""
echo "▶ [2/6] public-web-acquirer"
cd agents && uv run python run_agent.py acquirer --url "https://www.gob.mx/fgr" 2>&1 | head -20 || true && cd ..

echo ""
echo "▶ [3/6] social-intel-extractor"
cd agents && uv run python run_agent.py extractor \
  --text "Se busca gente para trabajar en el norte, buen sueldo sin experiencia, contactar por WhatsApp" 2>&1 | head -20 || true && cd ..

echo ""
echo "▶ [4/6] missing-case-extractor"
cd agents && uv run python run_agent.py case --persona-id "$PERSONA_ID" 2>&1 | head -20 || true && cd ..

echo ""
echo "▶ [5/6] bridge-match.ts (ficha → lib/match → match_results)"
npm run bridge:match -- "$PERSONA_ID" 2>&1 | head -20 || true

echo ""
echo "▶ [6/6] review-recommender"
cd agents && uv run python run_agent.py recommender 2>&1 | head -20 || true && cd ..

echo ""
echo "═══════════════════════════════════════"
echo " Done. Check Supabase:"
echo "  SELECT * FROM match_results ORDER BY created_at DESC LIMIT 5;"
echo "  SELECT * FROM review_queue   ORDER BY priority DESC LIMIT 5;"
echo "  SELECT * FROM agent_tasks    ORDER BY created_at DESC LIMIT 10;"
echo "═══════════════════════════════════════"
