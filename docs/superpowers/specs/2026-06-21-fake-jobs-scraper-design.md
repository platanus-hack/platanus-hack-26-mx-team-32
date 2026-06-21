# Fake Jobs Scraper Agent — Design Spec
_2026-06-21_

## Summary

Add a dedicated fake-job scam scraper that reuses the existing Facebook scraping
infrastructure (Playwright session, geocoding, Supabase upsert) but targets fake
job listings specifically: pre-filters posts by Spanish job keywords, sends only
relevant posts to a job-focused Claude prompt, and geocodes locations as the
top-priority field. Entry point: `npm run scrape:fakejobs`.

---

## Architecture

```
scrapeAndSeedFakeJobPatterns()   ← new export in lib/facebook-scraper.ts
  └─ fetchFacebookGroupPosts()   ← reused as-is (same FACEBOOK_GROUP_URL)
  └─ filterJobPosts()            ← new: drops posts without job keywords
  └─ extractJobPatternWithClaude() ← new: location-first Claude prompt
  └─ geocodeLocation()           ← reused as-is
  └─ parallelBatch()             ← reused as-is
  └─ supabase upsert             ← same facebook_patterns table, onConflict: post_url
```

New files:
- `scripts/scrape-fakejobs.ts` — CLI entry point, mirrors scrape-facebook.ts
- New script in `package.json`: `"scrape:fakejobs": "tsx scripts/scrape-fakejobs.ts"`

---

## Pre-filter: `filterJobPosts()`

Discard posts that contain none of the following Spanish job keywords (case-insensitive):

```
trabajo, empleo, vacante, sueldo, salario, contratando, puesto,
oferta, uniforme, plaza, reclutamiento, candidatos, entrevista,
whatsapp, pago, depósito, anticipo
```

This runs before Claude calls — reduces API cost and focuses extraction on relevant posts.

---

## Claude Prompt: `extractJobPatternWithClaude()` (job variant)

**Priority order for extraction:**

1. **location_text** — HIGHEST PRIORITY. Extract the most specific location signal:
   exact street address, colonia, landmark, metro station, meeting point,
   directions mentioned, any WhatsApp-shared location reference.
   Return `null` only if truly absent.

2. **job_insights** — job title, company name (even vague), salary/payment amount,
   upfront fees requested, uniform/equipment required, contact method (WhatsApp number, Telegram, etc.)

3. **tone_description** — short description of the scam tactic

4. **tone_keywords** — subset from the fixed set:
   `urgency, job_offer, payment_request, data_harvest, off_platform_contact,
   high_salary, vague_company, immediate_start, uniform_fee, investment_return,
   crypto, delivery_job`

**System role:** "You are a fake-job scam analyst for Mexico. Location accuracy is
critical — always extract the most specific location signal available. Output only
valid JSON."

**Output shape (strict JSON):**
```json
{
  "tone_description": "string|null",
  "tone_keywords": ["string"],
  "image_descriptions": ["string"],
  "location_text": "string|null",
  "job_title": "string|null",
  "company_name": "string|null",
  "salary_mentioned": "string|null",
  "upfront_fee": "string|null",
  "contact_method": "string|null"
}
```

The extra fields (`job_title`, `company_name`, etc.) are stored in the existing
`tone_description` field as a structured prefix, keeping the schema unchanged:
`"[Delivery driver @ Empresa X — $500 MXN fee] WhatsApp recruitment scam"`.

---

## Data Flow

1. `fetchFacebookGroupPosts()` — same Playwright scroll loop, same group URL
2. `filterJobPosts()` — drop non-job posts (keyword match on `post.content`)
3. Log: `"X posts after job-filter (from Y total)"`
4. `parallelBatch(filtered, 8, extractJobPatternWithClaude)` — Claude extractions
5. Deduplicate `location_text` values → `parallelBatch(unique, ∞, geocodeLocation)`
6. Build rows (same shape as existing rows)
7. Supabase batch upsert to `facebook_patterns`, `onConflict: "post_url"`

---

## Error Handling

- Same error behavior as existing scraper (summary object with `inserted/skipped/failed/errors`)
- Filter reducing to 0 posts → logged as warning, returns early with `summary.skipped = totalPostsSeen`
- Claude extraction failure → graceful fallback to null fields (same as existing)
- Geocoding failure → `location_latitude/longitude` stay null (same as existing)

---

## CLI Script: `scripts/scrape-fakejobs.ts`

Mirrors `scripts/scrape-facebook.ts`:
- Calls `scrapeAndSeedFakeJobPatterns()`
- Prints scrape summary
- Calls `geocodeMissingLocations()` if `GOOGLE_MAPS_API_KEY` present
- Displays extracted patterns with **location first** in the output (lat/lng prominent)
- `process.exit(summary.failed > 0 ? 1 : 0)`

---

## Environment Variables

Same as existing scraper — no new env vars required:
- `FB_C_USER`, `FB_XS` — Facebook session cookies
- `FACEBOOK_GROUP_URL` — target group (shared with existing scraper)
- `ANTHROPIC_API_KEY` — Claude API
- `GOOGLE_MAPS_API_KEY` — geocoding (optional but recommended)
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — database

---

## What Does NOT Change

- `fetchFacebookGroupPosts()` — untouched
- `geocodeLocation()` / `buildGeocodeAddress()` — untouched
- `scrapeAndSeedFacebookPatterns()` — untouched
- `facebook_patterns` table schema — no migrations needed
- Existing `npm run scrape:facebook` — unaffected
