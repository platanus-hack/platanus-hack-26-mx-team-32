# Data Cleaner — Design Spec
**Date:** 2026-06-21  
**Status:** Approved

## Problem

Agents extract structured event data via Claude Haiku and insert it directly into Supabase with only a regex JSON parse in between. This produces two categories of bad data:

- **Structural**: wrong types, `event_type` values not in the DB CHECK enum, `confidence` outside 0–1, `summary` over 120 chars, missing required fields, wrong column names (e.g. agents write `summary` but the column is `summary_public`)
- **Semantic**: `estado` as "CDMX" instead of "Ciudad de México", `municipio` with typos or wrong casing, vague or repetitive summaries, `tone_keywords` values outside the allowed set

## Scope

Applies to both write paths:
1. Python agents → `social_risk_events` (both `social_intel_extractor.py` and `fosas_pipeline.py`)
2. TypeScript scraper → `facebook_patterns` (`lib/facebook-scraper.ts`, both `scrapeAndSeedFacebookPatterns` and `scrapeAndSeedFakeJobPatterns`)

## Approach: Two-Stage, Table-Aware Cleaner

Each target language gets a cleaner module. Both follow the same two-stage pattern:

**Stage 1 — Python/TypeScript structural fixes (always runs, no LLM):**
- Enforce enum membership; remap invalid values to safe defaults
- Clamp numeric ranges
- Truncate oversized strings
- Coerce types (bool, float, int)
- Strip whitespace from string fields
- Filter arrays to only allowed values

**Stage 2 — Haiku LLM semantic correction (single call, falls back silently):**
- Normalize `estado` / `location_region` to official Mexican state names
- Normalize `municipio` to proper casing/spelling
- Rewrite vague or oversized `summary_public` / `tone_description`
- The prompt is built from the target table's schema rules so the model knows the constraints

If Stage 2 fails for any reason, Stage 1 output is used. The cleaner never blocks the save.

## Modules

### `agents/data_cleaner.py`

```
clean_event(event: dict, table: str) -> dict
```

- `table` is currently always `"social_risk_events"` but the function is schema-keyed so new tables can be added
- Returns a new dict (immutable — never mutates input)
- Adds `_cleaned: bool` to output so callers can log whether the LLM stage ran

### `lib/data-cleaner.ts`

```
cleanFacebookPattern(row: object): Promise<object>
```

- Same two-stage pattern
- Uses the Anthropic SDK (already a dependency in this project)
- Returns a new object; never mutates input

## Table Schemas & Rules

### `social_risk_events`

| Field | Rule |
|---|---|
| `event_type` | Must be one of: `oferta_laboral_sospechosa`, `secuestro_levanton`, `balacera_enfrentamiento`, `trata_enganche`, `narcomenudeo_contexto`, `control_territorial_contexto`, `otro`. Values `fosa_clandestina` / `hallazgo_restos` (returned by LLM prompt) → remap to `otro` and preserve original in `evidence_json` |
| `estado` | Normalize to official Mexican state name (32 states). Null if unrecognizable |
| `municipio` | Normalize casing and spelling. Null if blank |
| `summary_public` | Truncate at 120 chars in Stage 1; rewrite clearly in Stage 2 if vague |
| `confidence` | Clamp to [0.0, 1.0]. Default 0.3 if missing |
| `severity` | Int 1–5. Default 2 if missing or out of range |
| `privacy_level` | One of: `public_aggregate`, `internal`, `restricted`. Default `restricted` |
| `review_status` | One of: `pending`, `approved`, `rejected`, `hidden`. Default `pending` |

**Known bug fixed by cleaner:** the extraction prompt returns `fosa_clandestina` and `hallazgo_restos` but these are not in the DB CHECK constraint. Stage 1 remaps them to `otro` and records the original value in `evidence_json["original_event_type"]`.

### `facebook_patterns`

| Field | Rule |
|---|---|
| `tone_keywords` | Filter array to allowed set: `urgency`, `job_offer`, `payment_request`, `data_harvest`, `off_platform_contact`, `high_salary`, `vague_company`, `immediate_start`, `uniform_fee`, `investment_return`, `crypto`, `delivery_job` |
| `is_fake_job` | Must be `boolean` or `null`. Coerce if possible |
| `location_region` | Normalize to Mexican state/region name in Stage 2 |
| `tone_description` | Rewrite in Stage 2 if null and enough context exists |
| `image_descriptions` | Must be `string[]`. Default `[]` if missing |

## Integration Points

```
social_intel_extractor.py
  save_event_node()
    └── clean_event(event, "social_risk_events")  ← insert here
        └── Supabase insert

fosas_pipeline.py
  extract_node()
    └── clean_event(event, "social_risk_events")  ← insert here
        └── Supabase insert

lib/facebook-scraper.ts
  scrapeAndSeedFacebookPatterns()
  scrapeAndSeedFakeJobPatterns()
    └── rows.map(cleanFacebookPattern)  ← insert here (parallel, Promise.all)
        └── Supabase upsert
```

## Error Handling

- Stage 1 errors: should not occur (pure Python/TS logic); if they do, return original event unchanged
- Stage 2 errors: caught, logged, Stage 1 result used as fallback
- Cleaner never raises; callers do not need try/except around it
- `_cleaned: bool` field indicates whether Stage 2 ran successfully (stripped before DB insert)

## Out of Scope

- Validation of `location_latitude` / `location_longitude` (handled by geocoding step)
- Cleaning data already in the DB (retroactive migration)
- Adding new event types to the DB enum (separate migration task)
