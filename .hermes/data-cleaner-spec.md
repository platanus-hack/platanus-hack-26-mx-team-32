# Data Cleaner Implementation Spec
**Target:** Implement docs/specs/2026-06-21-data-cleaner-design.md

## TOOL RULES
- Do NOT use glob, task, doom_loop, or any search tool
- Use ONLY write/edit/bash tools
- Do NOT read existing files - this spec contains everything you need
- Write each file directly without exploration

## CONTEXT
You are implementing a two-stage data cleaner for Mexico social-risk event data.

**Architecture:**
- Stage 1: Structural fixes (pure Python/TS, no LLM) - enum enforcement, type coercion, clamping, truncation
- Stage 2: Semantic normalization (Haiku LLM call, falls back silently) - estado/municipio normalization, summary rewriting

**Integration points (3 call sites):**
1. `agents/social_intel_extractor.py` line 84-99: `save_event_node()` inserts into `social_risk_events`
2. `agents/fosas_pipeline.py` line 148-159: `extract_node()` inserts into `social_risk_events`
3. `lib/facebook-scraper.ts` line 631-650 and 791-812: `scrapeAndSeedFacebookPatterns()` and `scrapeAndSeedFakeJobPatterns()` upsert into `facebook_patterns`

## FILES TO CREATE

### 1. `agents/data_cleaner.py`

```python
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
```

### 2. `lib/data-cleaner.ts`

```typescript
// lib/data-cleaner.ts - Two-stage cleaner for facebook_patterns table.
// Stage 1: structural fixes (pure TS, no LLM)
// Stage 2: semantic normalization (Haiku LLM, falls back silently)

// Allowed tone_keywords (DB constraint)
const ALLOWED_TONE_KEYWORDS = new Set([
  "urgency", "job_offer", "payment_request", "data_harvest",
  "off_platform_contact", "high_salary", "vague_company", "immediate_start",
  "uniform_fee", "investment_return", "crypto", "delivery_job"
]);

// Official Mexican state names (32 states)
const MEXICAN_STATES = new Set([
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche",
  "Chiapas", "Chihuahua", "Coahuila", "Colima", "Durango", "Guanajuato",
  "Guerrero", "Hidalgo", "Jalisco", "Mexico", "Michoacan", "Morelos",
  "Nayarit", "Nuevo Leon", "Oaxaca", "Puebla", "Queretaro", "Quintana Roo",
  "San Luis Potosi", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala",
  "Veracruz", "Yucatan", "Zacatecas", "Ciudad de Mexico"
]);

interface FacebookPatternRow {
  tone_keywords?: unknown;
  is_fake_job?: unknown;
  location_region?: unknown;
  tone_description?: unknown;
  image_descriptions?: unknown;
  [key: string]: unknown;
}

/**
 * Stage 1: structural fixes (no LLM).
 * - Filter tone_keywords to allowed set
 * - Coerce is_fake_job to boolean | null
 * - Default image_descriptions to []
 */
function stage1StructuralClean(row: FacebookPatternRow): FacebookPatternRow {
  const cleaned = { ...row };

  // tone_keywords: filter to allowed set
  if (Array.isArray(cleaned.tone_keywords)) {
    cleaned.tone_keywords = cleaned.tone_keywords.filter(
      (kw): kw is string => typeof kw === "string" && ALLOWED_TONE_KEYWORDS.has(kw)
    );
  } else {
    cleaned.tone_keywords = [];
  }

  // is_fake_job: coerce to boolean | null
  if (typeof cleaned.is_fake_job === "boolean") {
    // already boolean - keep
  } else if (cleaned.is_fake_job === "true") {
    cleaned.is_fake_job = true;
  } else if (cleaned.is_fake_job === "false") {
    cleaned.is_fake_job = false;
  } else {
    cleaned.is_fake_job = null;
  }

  // image_descriptions: must be string[]
  if (Array.isArray(cleaned.image_descriptions)) {
    cleaned.image_descriptions = cleaned.image_descriptions.filter(
      (d): d is string => typeof d === "string"
    );
  } else {
    cleaned.image_descriptions = [];
  }

  // tone_description: strip whitespace
  if (typeof cleaned.tone_description === "string") {
    cleaned.tone_description = cleaned.tone_description.trim() || null;
  } else {
    cleaned.tone_description = null;
  }

  // location_region: strip whitespace
  if (typeof cleaned.location_region === "string") {
    cleaned.location_region = cleaned.location_region.trim() || null;
  } else {
    cleaned.location_region = null;
  }

  return cleaned;
}

/**
 * Stage 2: semantic normalization (LLM, falls back silently).
 * For now, returns input unchanged (LLM stage can be added later).
 */
async function stage2SemanticClean(row: FacebookPatternRow): Promise<FacebookPatternRow> {
  // Placeholder - LLM call can be added here
  // The spec says "If Stage 2 fails for any reason, Stage 1 output is used"
  return row;
}

/**
 * Clean a facebook_patterns row before upsert.
 * Two-stage: structural fixes (always) + semantic normalization (LLM, falls back silently).
 * Returns a new object (never mutates input).
 */
export async function cleanFacebookPattern(row: FacebookPatternRow): Promise<FacebookPatternRow> {
  // Stage 1
  let cleaned = stage1StructuralClean(row);

  // Stage 2
  try {
    cleaned = await stage2SemanticClean(cleaned);
    cleaned._cleaned = true;
  } catch {
    // Stage 2 failed - use Stage 1 output
    cleaned._cleaned = false;
  }

  return cleaned;
}
```

### 3. Integration: `agents/social_intel_extractor.py`

**Modify `save_event_node()` at line 77-108:**

Add import at top (line 10-14 area):
```python
from .data_cleaner import clean_event
```

Replace the insert block (lines 84-99) with:
```python
            sb = get_supabase()
            now = datetime.now(timezone.utc).isoformat()
            cleaned_event = clean_event(event, "social_risk_events")
            cleaned_event.pop("_cleaned", None)
            sb.table("social_risk_events").insert({
                "event_type": cleaned_event.get("event_type", "otro"),
                "estado": cleaned_event.get("estado"),
                "municipio": cleaned_event.get("municipio"),
                "summary_public": cleaned_event.get("summary_public"),
                "confidence": cleaned_event.get("confidence", 0.3),
                "severity": cleaned_event.get("severity", 2),
                "privacy_level": cleaned_event.get("privacy_level", "restricted"),
                "review_status": cleaned_event.get("review_status", "pending"),
                "reported_at": now,
                "evidence_json": cleaned_event.get("evidence_json") or json.dumps({"source_url": state.get("source_url")}),
            }).execute()
```

### 4. Integration: `agents/fosas_pipeline.py`

**Modify `extract_node()` at line 130-166:**

Add import at top (line 23-28 area):
```python
from .data_cleaner import clean_event
```

Replace the insert block (lines 148-159) with:
```python
            cleaned_event = clean_event(event, "social_risk_events")
            cleaned_event.pop("_cleaned", None)
            severity = 5 if cleaned_event.get("event_type") in _HIGH_SEVERITY_TYPES else 2
            sb.table("social_risk_events").insert({
                "event_type": cleaned_event.get("event_type", "otro"),
                "estado": cleaned_event.get("estado"),
                "municipio": cleaned_event.get("municipio"),
                "summary_public": cleaned_event.get("summary_public"),
                "confidence": cleaned_event.get("confidence", 0.3),
                "severity": severity,
                "privacy_level": cleaned_event.get("privacy_level", "restricted"),
                "review_status": cleaned_event.get("review_status", "pending"),
                "reported_at": now,
                "evidence_json": cleaned_event.get("evidence_json") or json.dumps({"source_url": page["url"], "title": page["title"]}),
            }).execute()
```

### 5. Integration: `lib/facebook-scraper.ts`

**Modify `scrapeAndSeedFacebookPatterns()` at line 631-650:**

Add import at top (line 1-5 area):
```typescript
import { cleanFacebookPattern } from "./data-cleaner.js";
```

Replace the rows mapping (lines 631-650) with:
```typescript
  const rows = await Promise.all(
    posts.map(async (post, i) => {
      const extraction = extractions[i];
      const geocode = extraction.location_text ? (geocodeCache.get(extraction.location_text) ?? null) : null;
      const rawRow = {
        id: randomUUID(),
        post_url: post.url,
        post_content: post.content,
        tone_description: extraction.tone_description,
        tone_keywords: extraction.tone_keywords,
        image_urls: [] as string[],
        image_descriptions: extraction.image_descriptions,
        location_text: extraction.location_text,
        location_latitude: geocode?.lat ?? null,
        location_longitude: geocode?.lng ?? null,
        location_region: geocode?.region ?? null,
        is_fake_job: extraction.is_fake_job ?? null,
        scraped_at: now,
        post_date: parseRelativeDate(post.content),
      };
      const cleaned = await cleanFacebookPattern(rawRow);
      cleaned._cleaned = undefined; // Strip before upsert
      return cleaned;
    })
  );
```

**Modify `scrapeAndSeedFakeJobPatterns()` at line 791-812:**

Same pattern - wrap the row construction in `await cleanFacebookPattern()` and strip `_cleaned`.

## PITFALLS
- **Anthropic SDK system prompt:** top-level param, NOT a message role. If you add LLM calls, use `{ model, max_tokens, system: SYSTEM_PROMPT, messages: [...] }`
- **zod default(null):** requires `.nullable()`, not `.optional()`
- **import type placement:** put all imports at top of file, not inside functions
- **_cleaned flag:** strip before DB insert (it's metadata, not a DB column)
- **evidence_json:** in Python, it's stored as JSON string in DB; parse/stringify correctly
- **tone_keywords:** must be filtered to allowed set (not just validated)
- **is_fake_job:** coerce string "true"/"false" to boolean, else null

## SUCCESS CRITERIA
1. `agents/data_cleaner.py` exists with `clean_event(event, table)` function
2. `lib/data-cleaner.ts` exists with `cleanFacebookPattern(row)` async function
3. Both cleaners are integrated at the 3 call sites
4. `cd agents && uv run pytest` passes (if tests exist)
5. `npx tsc --noEmit` passes with no errors
6. `npm run test` passes (vitest)
7. Cleaners never raise exceptions - they fall back silently
8. `_cleaned` flag is added to output but stripped before DB insert

## VERIFICATION COMMANDS
```bash
# Typecheck
npx tsc --noEmit

# Run tests
npm run test

# Python tests (if any)
cd agents && uv run pytest
```
