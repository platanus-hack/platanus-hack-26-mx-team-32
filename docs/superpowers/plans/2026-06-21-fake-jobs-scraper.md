# Fake Jobs Scraper Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `scrapeAndSeedFakeJobPatterns()` to the existing Facebook scraper library, plus a `scripts/scrape-fakejobs.ts` CLI entry point and `npm run scrape:fakejobs` script, that pre-filters posts for job-scam keywords, runs a location-first Claude extraction, geocodes with Google Maps, and upserts to `facebook_patterns`.

**Architecture:** Extend `lib/facebook-scraper.ts` with three new non-exported helpers (`JOB_KEYWORDS`, `filterJobPosts`, `extractJobPatternWithClaude` job-variant, `buildJobToneDescription`) and one new export (`scrapeAndSeedFakeJobPatterns`). A new `scripts/scrape-fakejobs.ts` mirrors the existing `scripts/scrape-facebook.ts` pattern. No schema changes.

**Tech Stack:** TypeScript, Playwright, Anthropic Claude API (claude-sonnet-4-6), Google Maps Geocoding API, Supabase JS client, Vitest for tests, tsx runner.

## Global Constraints

- All new code in TypeScript strict mode (existing tsconfig)
- No new npm dependencies
- No changes to `facebook_patterns` Supabase schema
- Existing exports (`scrapeAndSeedFacebookPatterns`, `geocodeMissingLocations`, `ScrapedPost`, `ScrapeSummary`) must remain untouched
- `filterJobPosts` must be a pure function (no I/O) — exported for testing
- Test runner: `npm test` (vitest run)
- Commit message format: `feat: <description>`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `lib/facebook-scraper.ts` | Add `JOB_KEYWORDS`, `filterJobPosts`, `buildJobToneDescription`, `extractJobPatternWithClaude` (job variant), `scrapeAndSeedFakeJobPatterns` |
| Create | `lib/facebook-scraper.test.ts` | Unit tests for `filterJobPosts` and `buildJobToneDescription` |
| Create | `scripts/scrape-fakejobs.ts` | CLI entry point for the new scraper |
| Modify | `package.json` | Add `"scrape:fakejobs"` script |

---

### Task 1: `filterJobPosts` — pre-filter pure function + tests

**Files:**
- Modify: `lib/facebook-scraper.ts` (append after the `ScrapeSummary` interface, before `ClaudePatternExtraction`)
- Create: `lib/facebook-scraper.test.ts`

**Interfaces:**
- Produces: `export function filterJobPosts(posts: ScrapedPost[]): ScrapedPost[]`
- Produces: `export const JOB_KEYWORDS: readonly string[]`

- [ ] **Step 1: Create the test file**

Create `lib/facebook-scraper.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { filterJobPosts, JOB_KEYWORDS } from "./facebook-scraper.js";
import type { ScrapedPost } from "./facebook-scraper.js";

function makePost(content: string): ScrapedPost {
  return { url: "https://facebook.com/groups/test#post-0", content, imageBase64: [] };
}

describe("filterJobPosts", () => {
  it("keeps posts that contain a job keyword", () => {
    const post = makePost("Se busca candidato para vacante de repartidor, buen sueldo");
    expect(filterJobPosts([post])).toHaveLength(1);
  });

  it("drops posts with no job keywords", () => {
    const post = makePost("Vendo refrigerador en buen estado, llama al 5512345678");
    expect(filterJobPosts([post])).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const post = makePost("OFERTA DE EMPLEO disponible hoy");
    expect(filterJobPosts([post])).toHaveLength(1);
  });

  it("returns empty array when given empty array", () => {
    expect(filterJobPosts([])).toHaveLength(0);
  });

  it("matches keyword 'whatsapp' as recruitment contact signal", () => {
    const post = makePost("Manda mensaje por WhatsApp al 5512345678 para más info");
    expect(filterJobPosts([post])).toHaveLength(1);
  });

  it("matches keyword 'uniforme' as upfront-fee signal", () => {
    const post = makePost("Debes pagar tu uniforme antes de empezar");
    expect(filterJobPosts([post])).toHaveLength(1);
  });

  it("JOB_KEYWORDS contains expected core keywords", () => {
    const kws = JOB_KEYWORDS as readonly string[];
    expect(kws).toContain("trabajo");
    expect(kws).toContain("vacante");
    expect(kws).toContain("uniforme");
    expect(kws).toContain("depósito");
  });
});
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
npm test -- --reporter=verbose 2>&1 | head -30
```

Expected: `Cannot find module './facebook-scraper.js'` or `filterJobPosts is not a function`

- [ ] **Step 3: Add `JOB_KEYWORDS` and `filterJobPosts` to `lib/facebook-scraper.ts`**

Insert the following block immediately after the closing `}` of the `ScrapeSummary` interface (around line 22), before the `ClaudePatternExtraction` interface:

```typescript
export const JOB_KEYWORDS = [
  "trabajo", "empleo", "vacante", "sueldo", "salario",
  "contratando", "puesto", "oferta", "uniforme", "plaza",
  "reclutamiento", "candidatos", "entrevista", "whatsapp",
  "pago", "depósito", "anticipo",
] as const;

export function filterJobPosts(posts: ScrapedPost[]): ScrapedPost[] {
  return posts.filter((post) => {
    const lower = post.content.toLowerCase();
    return JOB_KEYWORDS.some((kw) => lower.includes(kw));
  });
}
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|filterJobPosts"
```

Expected: all 7 `filterJobPosts` tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/facebook-scraper.ts lib/facebook-scraper.test.ts
git commit -m "feat: add filterJobPosts pre-filter for job-scam keywords"
```

---

### Task 2: `buildJobToneDescription` + tests

**Files:**
- Modify: `lib/facebook-scraper.ts` (add after `filterJobPosts`)
- Modify: `lib/facebook-scraper.test.ts` (append new describe block)

**Interfaces:**
- Consumes: `JobPatternExtraction` interface (defined in this task)
- Produces: `function buildJobToneDescription(e: JobPatternExtraction): string | null`
- Produces: `interface JobPatternExtraction` (internal, not exported)

- [ ] **Step 1: Append tests to `lib/facebook-scraper.test.ts`**

Add this import at the top of the file alongside the existing imports:

```typescript
import { buildJobToneDescription } from "./facebook-scraper.js";
```

Append this describe block at the end of `lib/facebook-scraper.test.ts`:

```typescript
describe("buildJobToneDescription", () => {
  it("returns full structured prefix when all fields present", () => {
    const result = buildJobToneDescription({
      tone_description: "WhatsApp recruitment scam",
      tone_keywords: ["job_offer", "uniform_fee"],
      image_descriptions: [],
      location_text: "Colonia Roma Norte",
      job_title: "Delivery driver",
      company_name: "Empresa XYZ",
      salary_mentioned: "$500/día",
      upfront_fee: "$300 MXN uniforme",
      contact_method: "WhatsApp 5512345678",
    });
    expect(result).toBe("[Delivery driver @ Empresa XYZ — $300 MXN uniforme fee] WhatsApp recruitment scam");
  });

  it("omits prefix parts that are null", () => {
    const result = buildJobToneDescription({
      tone_description: "Fake job via WhatsApp",
      tone_keywords: [],
      image_descriptions: [],
      location_text: null,
      job_title: "Promotor",
      company_name: null,
      salary_mentioned: null,
      upfront_fee: null,
      contact_method: null,
    });
    expect(result).toBe("[Promotor] Fake job via WhatsApp");
  });

  it("returns tone_description only when no prefix fields are set", () => {
    const result = buildJobToneDescription({
      tone_description: "Generic recruitment scam",
      tone_keywords: [],
      image_descriptions: [],
      location_text: null,
      job_title: null,
      company_name: null,
      salary_mentioned: null,
      upfront_fee: null,
      contact_method: null,
    });
    expect(result).toBe("Generic recruitment scam");
  });

  it("returns null when tone_description is null and no prefix fields", () => {
    const result = buildJobToneDescription({
      tone_description: null,
      tone_keywords: [],
      image_descriptions: [],
      location_text: null,
      job_title: null,
      company_name: null,
      salary_mentioned: null,
      upfront_fee: null,
      contact_method: null,
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify new tests FAIL**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "buildJobToneDescription|Cannot find"
```

Expected: `buildJobToneDescription is not a function`

- [ ] **Step 3: Add `JobPatternExtraction` interface and `buildJobToneDescription` to `lib/facebook-scraper.ts`**

Insert after `filterJobPosts` (after the closing `}` of that function, before the `ClaudePatternExtraction` interface):

```typescript
interface JobPatternExtraction {
  tone_description: string | null;
  tone_keywords: string[];
  image_descriptions: string[];
  location_text: string | null;
  job_title: string | null;
  company_name: string | null;
  salary_mentioned: string | null;
  upfront_fee: string | null;
  contact_method: string | null;
}

export function buildJobToneDescription(e: JobPatternExtraction): string | null {
  const parts: string[] = [];
  if (e.job_title) parts.push(e.job_title);
  if (e.company_name) parts.push(`@ ${e.company_name}`);
  if (e.upfront_fee) parts.push(`— ${e.upfront_fee} fee`);
  const prefix = parts.length > 0 ? `[${parts.join(" ")}] ` : "";
  if (!prefix && !e.tone_description) return null;
  return `${prefix}${e.tone_description ?? ""}`.trim() || null;
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|buildJobTone"
```

Expected: all 4 `buildJobToneDescription` tests green, all prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add lib/facebook-scraper.ts lib/facebook-scraper.test.ts
git commit -m "feat: add buildJobToneDescription and JobPatternExtraction interface"
```

---

### Task 3: `extractJobPatternWithClaude` and `scrapeAndSeedFakeJobPatterns`

**Files:**
- Modify: `lib/facebook-scraper.ts` (append two new functions before the final closing of the file)

**Interfaces:**
- Consumes: `ScrapedPost`, `ScrapeSummary`, `JobPatternExtraction`, `buildJobToneDescription`, `filterJobPosts`, `geocodeLocation`, `parallelBatch`, `parseRelativeDate` (all in same file)
- Produces: `export async function scrapeAndSeedFakeJobPatterns(): Promise<ScrapeSummary>`

Note: `extractJobPatternWithClaude` (job variant) is an internal async function — not exported, not tested directly (it hits a live API). Its logic is exercised via integration when running the script manually.

- [ ] **Step 1: Append `extractJobPatternWithClaude` (job variant) to `lib/facebook-scraper.ts`**

Add this function after `buildJobToneDescription` and before `geocodeLocation` (insert before the line `interface GeocodeResult {`):

```typescript
async function extractJobPatternWithClaudeJob(post: ScrapedPost): Promise<JobPatternExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const prompt = `You are a fake-job scam analyst for Mexico. Location accuracy is critical.

Analyze this Facebook post. Images (if any) are screenshots — OCR them and use their text.

Extract in this PRIORITY ORDER:

1. location_text — HIGHEST PRIORITY. The most specific location signal in the post or images:
   exact street address, colonia, landmark, metro station, meeting point, hiring office address,
   directions, any WhatsApp-shared location reference. Return null ONLY if truly absent.

2. job_title — the role being offered (e.g. "repartidor", "promotor", "cajera"). null if absent.

3. company_name — company or brand name, even vague (e.g. "empresa seria", "importante compañía"). null if absent.

4. salary_mentioned — any salary or daily rate mentioned (e.g. "$500 diarios", "sueldo quincenal"). null if absent.

5. upfront_fee — any payment required from the applicant (uniform, kit, deposit, "inscripción"). null if absent.

6. contact_method — how to apply: WhatsApp number, Telegram handle, email, etc. null if absent.

7. tone_description — one sentence describing the scam tactic (e.g. "WhatsApp recruitment demanding uniform deposit").

8. tone_keywords — array, only from this exact set:
   urgency, job_offer, payment_request, data_harvest, off_platform_contact,
   high_salary, vague_company, immediate_start, uniform_fee, investment_return,
   crypto, delivery_job

9. image_descriptions — array describing what each image shows.

Post text:
${post.content}

Respond as STRICT JSON only (no markdown fences), exactly this shape:
{"tone_description":string|null,"tone_keywords":[],"image_descriptions":[],"location_text":string|null,"job_title":string|null,"company_name":string|null,"salary_mentioned":string|null,"upfront_fee":string|null,"contact_method":string|null}`;

  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } };

  const imageBlocks: ContentBlock[] = post.imageBase64.map((data) => ({
    type: "image",
    source: { type: "base64", media_type: "image/png", data },
  }));

  const content: ContentBlock[] = [...imageBlocks, { type: "text", text: prompt }];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: "You are a fake-job scam analyst for Mexico. Location accuracy is critical — always extract the most specific location signal available. Output only valid JSON.",
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) throw new Error(`Claude API error: ${response.statusText}`);

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const textBlock = data.content.find((b) => b.type === "text");
    const raw = textBlock?.text ?? "";
    const sanitized = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(sanitized) as JobPatternExtraction;

    return {
      tone_description: parsed.tone_description ?? null,
      tone_keywords: Array.isArray(parsed.tone_keywords) ? parsed.tone_keywords : [],
      image_descriptions: Array.isArray(parsed.image_descriptions) ? parsed.image_descriptions : [],
      location_text: parsed.location_text ?? null,
      job_title: parsed.job_title ?? null,
      company_name: parsed.company_name ?? null,
      salary_mentioned: parsed.salary_mentioned ?? null,
      upfront_fee: parsed.upfront_fee ?? null,
      contact_method: parsed.contact_method ?? null,
    };
  } catch {
    return {
      tone_description: null,
      tone_keywords: [],
      image_descriptions: [],
      location_text: null,
      job_title: null,
      company_name: null,
      salary_mentioned: null,
      upfront_fee: null,
      contact_method: null,
    };
  }
}
```

- [ ] **Step 2: Append `scrapeAndSeedFakeJobPatterns` to `lib/facebook-scraper.ts`**

Add this function at the end of `lib/facebook-scraper.ts`, after `geocodeMissingLocations`:

```typescript
export async function scrapeAndSeedFakeJobPatterns(): Promise<ScrapeSummary> {
  const summary: ScrapeSummary = {
    inserted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    totalPostsSeen: 0,
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn("Warning: GOOGLE_MAPS_API_KEY not set — geocoding will be skipped");
  }

  let allPosts: ScrapedPost[] = [];
  try {
    allPosts = await fetchFacebookGroupPosts(FACEBOOK_GROUP_URL);
  } catch (e) {
    summary.errors.push(`Playwright scrape failed: ${e instanceof Error ? e.message : "unknown"}`);
    summary.failed += 1;
    return summary;
  }

  summary.totalPostsSeen = allPosts.length;

  const posts = filterJobPosts(allPosts);
  console.log(`\nJob-filter: ${posts.length} job-related posts (from ${allPosts.length} total)`);

  if (posts.length === 0) {
    console.warn("No job-related posts found after filter — nothing to process");
    summary.skipped = allPosts.length;
    return summary;
  }

  console.log(`\nExtracting job patterns from ${posts.length} posts (8 concurrent Claude calls)...`);
  const extractions = await parallelBatch(posts, 8, async (post, i) => {
    try {
      const result = await extractJobPatternWithClaudeJob(post);
      if ((i + 1) % 10 === 0 || i + 1 === posts.length) {
        console.log(`  Claude extraction: ${i + 1}/${posts.length}`);
      }
      return result;
    } catch {
      return {
        tone_description: null,
        tone_keywords: [],
        image_descriptions: [],
        location_text: null,
        job_title: null,
        company_name: null,
        salary_mentioned: null,
        upfront_fee: null,
        contact_method: null,
      };
    }
  });

  const uniqueTexts = [...new Set(
    extractions.map((e) => e.location_text).filter(Boolean) as string[]
  )];
  console.log(`\nGeocoding ${uniqueTexts.length} unique locations in parallel...`);

  const geocodeCache = new Map<string, Awaited<ReturnType<typeof geocodeLocation>>>();
  await Promise.all(
    uniqueTexts.map(async (text) => {
      const result = await geocodeLocation(text);
      geocodeCache.set(text, result);
      if (result) {
        console.log(`  ✓ "${text}" → ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)} (${result.region})`);
      } else {
        console.log(`  ✗ "${text}" → no result`);
      }
    }),
  );

  const now = new Date().toISOString();
  const rows = posts.map((post, i) => {
    const extraction = extractions[i];
    const geocode = extraction.location_text
      ? (geocodeCache.get(extraction.location_text) ?? null)
      : null;
    return {
      id: randomUUID(),
      post_url: post.url,
      post_content: post.content,
      tone_description: buildJobToneDescription(extraction),
      tone_keywords: extraction.tone_keywords,
      image_urls: [] as string[],
      image_descriptions: extraction.image_descriptions,
      location_text: extraction.location_text,
      location_latitude: geocode?.lat ?? null,
      location_longitude: geocode?.lng ?? null,
      location_region: geocode?.region ?? null,
      scraped_at: now,
      post_date: parseRelativeDate(post.content),
    };
  });

  console.log(`\nUpserting ${rows.length} rows in batch...`);
  const BATCH = 200;
  for (let start = 0; start < rows.length; start += BATCH) {
    const chunk = rows.slice(start, start + BATCH);
    const { error } = await supabase
      .from("facebook_patterns")
      .upsert(chunk, { onConflict: "post_url" });
    if (error) {
      summary.errors.push(`Batch upsert error (rows ${start}–${start + chunk.length}): ${error.message}`);
      summary.failed += chunk.length;
    } else {
      summary.inserted += chunk.length;
    }
  }

  return summary;
}
```

- [ ] **Step 3: Run typecheck — verify no TypeScript errors**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: no errors. If you see `Property 'X' does not exist`, check that `JobPatternExtraction` is defined before its first use and that `buildJobToneDescription` is exported.

- [ ] **Step 4: Run tests — all still passing**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests green, no regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/facebook-scraper.ts
git commit -m "feat: add scrapeAndSeedFakeJobPatterns with location-first Claude extraction"
```

---

### Task 4: CLI script + npm script

**Files:**
- Create: `scripts/scrape-fakejobs.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scrapeAndSeedFakeJobPatterns(): Promise<ScrapeSummary>` from `../lib/facebook-scraper.js`
- Consumes: `geocodeMissingLocations(): Promise<{updated: number; failed: number}>` from `../lib/facebook-scraper.js`

- [ ] **Step 1: Create `scripts/scrape-fakejobs.ts`**

```typescript
#!/usr/bin/env node
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { scrapeAndSeedFakeJobPatterns, geocodeMissingLocations } from "../lib/facebook-scraper.js";

async function displayJobPatterns() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from("facebook_patterns")
    .select(
      "tone_description, tone_keywords, location_text, location_region, location_latitude, location_longitude, post_date, image_descriptions, post_url",
    )
    .order("scraped_at", { ascending: false })
    .limit(100);

  if (error || !data) {
    console.error("Could not fetch extracted patterns:", error?.message);
    return;
  }

  const withLocation = data.filter((r) => r.location_text);
  const withCoords = data.filter((r) => r.location_latitude != null);

  const keywordCount: Record<string, number> = {};
  for (const row of data) {
    for (const kw of row.tone_keywords ?? []) {
      keywordCount[kw] = (keywordCount[kw] ?? 0) + 1;
    }
  }
  const topKeywords = Object.entries(keywordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([kw, n]) => `${kw}(${n})`)
    .join(", ");

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  FAKE JOB PATTERNS  (${data.length} most recent records)`.padEnd(64) + "║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\n  Posts with location text : ${withLocation.length}/${data.length}`);
  console.log(`  Posts with geocoordinates: ${withCoords.length}/${data.length}`);
  console.log(`  Top keywords             : ${topKeywords || "(none)"}`);

  console.log("\n──────────────────────────────────────────────────────────────");
  data.forEach((row, i) => {
    const num = String(i + 1).padStart(3);
    const tone = row.tone_description ?? "(no tone extracted)";
    const kws = (row.tone_keywords ?? []).join(", ") || "(none)";
    const loc = row.location_text ?? "(no location)";
    const region = row.location_region ? ` [${row.location_region}]` : "";
    const coords =
      row.location_latitude != null
        ? ` (${Number(row.location_latitude).toFixed(4)}, ${Number(row.location_longitude).toFixed(4)})`
        : " (no coords)";
    const date = row.post_date ? new Date(row.post_date).toLocaleDateString("es-MX") : "unknown date";
    const images = (row.image_descriptions ?? []).length;

    console.log(`\n${num}. ${tone}`);
    console.log(`     LOCATION : ${loc}${region}${coords}`);
    console.log(`     keywords : ${kws}`);
    console.log(`     date     : ${date}  |  images: ${images}`);
    if ((row.image_descriptions ?? []).length) {
      row.image_descriptions!.forEach((d, j) => console.log(`     img[${j}]  : ${d}`));
    }
  });

  console.log("\n──────────────────────────────────────────────────────────────\n");
}

async function main() {
  console.log("Starting fake-jobs pattern scraper...");
  console.log("Target: Supabase facebook_patterns table");

  const summary = await scrapeAndSeedFakeJobPatterns();

  console.log("\n=== Scrape Summary ===");
  console.log(`Total posts seen : ${summary.totalPostsSeen}`);
  console.log(`After job filter : see log above`);
  console.log(`Inserted         : ${summary.inserted}`);
  console.log(`Skipped          : ${summary.skipped}`);
  console.log(`Failed           : ${summary.failed}`);

  if (summary.errors.length > 0) {
    console.log("\nErrors:");
    summary.errors.forEach((err) => console.log(`  - ${err}`));
  }

  if (process.env.GOOGLE_MAPS_API_KEY) {
    const geo = await geocodeMissingLocations();
    if (geo.updated > 0) {
      console.log(`\nRetroactive geocoding: ${geo.updated} rows updated`);
    }
  }

  await displayJobPatterns();

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `scrape:fakejobs` to `package.json`**

In `package.json`, inside the `"scripts"` object, add after the `"scrape:facebook"` line:

```json
"scrape:fakejobs": "tsx scripts/scrape-fakejobs.ts",
```

The scripts block should look like:
```json
"scrape:facebook": "tsx scripts/scrape-facebook.ts",
"scrape:fakejobs": "tsx scripts/scrape-fakejobs.ts",
```

- [ ] **Step 3: Run typecheck — verify no errors**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Dry-run the script help (no FB cookies needed)**

```bash
node -e "import('./scripts/scrape-fakejobs.ts')" 2>&1 | head -5
```

Or verify the script is importable without crashing:

```bash
npm run typecheck 2>&1 && echo "typecheck OK"
```

Expected: `typecheck OK`

- [ ] **Step 5: Run tests — all still passing**

```bash
npm test 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add scripts/scrape-fakejobs.ts package.json
git commit -m "feat: add scrape:fakejobs CLI entry point and npm script"
```

---

## How to Run

```bash
# Requires .env.local with:
# FB_C_USER, FB_XS, ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
# SUPABASE_SERVICE_ROLE_KEY, GOOGLE_MAPS_API_KEY (optional but recommended)

npm run scrape:fakejobs
```

Output:
1. Playwright scrolls the Facebook group and captures all posts
2. Job-filter log: `"X job-related posts (from Y total)"`
3. Claude extracts patterns from filtered posts (location-first prompt)
4. Google Maps geocodes all unique `location_text` values
5. Batch upsert to `facebook_patterns`
6. Summary table with LOCATION prominently displayed for each record

The existing `npm run scrape:facebook` is **not affected** — both scripts share the same table and dedup on `post_url`.
