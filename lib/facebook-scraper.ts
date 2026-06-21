import { config } from "dotenv";
config({ path: ".env.local" });
import { chromium, type Browser } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const FACEBOOK_GROUP_URL =
  process.env.FACEBOOK_GROUP_URL ??
  "https://www.facebook.com/groups/1917199411779792/";

export interface ScrapedPost {
  url: string;
  content: string;
  imageBase64: string[];
}

export interface ScrapeSummary {
  inserted: number;
  skipped: number;
  failed: number;
  errors: string[];
  totalPostsSeen: number;
}

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
  is_fake_job: boolean | null;
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

async function extractJobPatternWithClaudeJob(post: ScrapedPost): Promise<JobPatternExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const prompt = `You are a fake-job scam analyst for Mexico. Location accuracy is critical.

IMAGE PROCESSING ORDER (for every image attached):
  1. Read all visible text (OCR) — transcribe every word you can see.
  2. Identify location signals in that text (addresses, landmarks, colonias, metro stations).
  3. Analyze intent and tactics (recruitment promises, fees, urgency, contact methods).

Extract in this PRIORITY ORDER:

STEP 1 — LOCATION (HIGHEST PRIORITY):
1. location_text — The most specific location signal in the post text OR in the OCR'd image text:
   exact street address, colonia, landmark, metro station, meeting point, hiring office address,
   directions, any WhatsApp-shared location reference. Return null ONLY if truly absent.

STEP 2 — ADDITIONAL INFORMATION:
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
9. image_descriptions — array describing what each image shows (after OCR and location extraction).

STEP 3 — VERIFICATION:
10. is_fake_job — boolean: true if this post shows clear signs of a fake or scam job offer
    (upfront fees, vague company, unrealistic salary, off-platform contact, urgency tactics);
    false if it appears to be a legitimate job post; null if insufficient information.

Post text:
${post.content}

Respond as STRICT JSON only (no markdown fences), exactly this shape:
{"tone_description":string|null,"tone_keywords":[],"image_descriptions":[],"location_text":string|null,"job_title":string|null,"company_name":string|null,"salary_mentioned":string|null,"upfront_fee":string|null,"contact_method":string|null,"is_fake_job":boolean|null}`;

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
        system: "You are a fake-job scam analyst for Mexico. Location accuracy is critical — always extract the most specific location signal available. For images: first read all text (OCR), then identify location signals, then analyze intent. Output only valid JSON.",
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
      is_fake_job: typeof parsed.is_fake_job === "boolean" ? parsed.is_fake_job : null,
    };
  } catch (err) {
    console.warn(`extractJobPatternWithClaudeJob failed: ${err instanceof Error ? err.message : "unknown"}`);
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
      is_fake_job: null,
    };
  }
}

interface ClaudePatternExtraction {
  tone_description: string | null;
  tone_keywords: string[];
  image_descriptions: string[];
  location_text: string | null;
  is_fake_job: boolean | null;
}

/**
 * Launch headless chromium with pre-authenticated session cookies (FB_C_USER +
 * FB_XS), navigate directly to the target group, scroll to load posts, and
 * capture [role="article"] elements incrementally (Facebook virtualizes the DOM).
 */
async function fetchFacebookGroupPosts(groupUrl: string): Promise<ScrapedPost[]> {
  const cUser = process.env.FB_C_USER;
  const xs = process.env.FB_XS;
  if (!cUser || !xs) {
    throw new Error(
      "Missing FB_C_USER or FB_XS in environment. Get them from DevTools → Application → Cookies on facebook.com after logging in.",
    );
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
      locale: "es-ES",
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "languages", { get: () => ["es-ES", "es", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      (window as unknown as Record<string, unknown>).chrome = { runtime: {} };
    });

    await context.addCookies([
      {
        name: "c_user",
        value: cUser,
        domain: ".facebook.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
      {
        name: "xs",
        value: xs,
        domain: ".facebook.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
      {
        name: "datr",
        value: "mBdsZ-abcdef123456",
        domain: ".facebook.com",
        path: "/",
        secure: true,
        sameSite: "None",
      },
    ]);

    const page = await context.newPage();
    await page.goto(groupUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    if (page.url().includes("login") || page.url().includes("two_step_verification")) {
      throw new Error("Facebook session cookies expired or invalid.");
    }

    const seenPosts = new Map<string, { text: string; imageBase64: string[] }>();
    let noNewCount = 0;

    for (let i = 0; i < 300; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);

      const articleHandles = await page.$$('[role="article"]');

      let newThisScroll = 0;
      for (const article of articleHandles) {
        const text = await article
          .evaluate((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
          .catch(() => "");
        if (text.length <= 20) continue;

        const key = text.slice(0, 100);
        if (seenPosts.has(key)) continue;

        const imageBase64: string[] = [];
        try {
          const imgHandles = await article.$$('img[src*="scontent"]');
          for (const img of imgHandles.slice(0, 5)) {
            try {
              const bytes = await img.screenshot({ type: "png" });
              imageBase64.push(Buffer.from(bytes).toString("base64"));
            } catch {
              // element detached or not visible — skip
            }
          }
        } catch {
          // $$() failed — continue without images
        }

        seenPosts.set(key, { text, imageBase64 });
        newThisScroll++;
      }

      if (newThisScroll === 0) {
        noNewCount++;
        if (noNewCount >= 15) {
          console.log(`Stopping at scroll ${i + 1}: no new posts for 15 scrolls`);
          break;
        }
      } else {
        noNewCount = 0;
      }

      if ((i + 1) % 25 === 0) {
        console.log(`Scroll ${i + 1}: ${seenPosts.size} unique posts captured`);
      }
    }
    console.log(`Scroll complete: ${seenPosts.size} unique posts`);

    const posts: ScrapedPost[] = [];
    let idx = 0;
    for (const { text, imageBase64 } of Array.from(seenPosts.values())) {
      posts.push({
        url: `${groupUrl}#post-${idx}`,
        content: text.slice(0, 5000),
        imageBase64,
      });
      idx += 1;
    }

    return posts;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Parse a relative date string from FB post text (e.g. "3d", "1w", "2m").
 */
function parseRelativeDate(text: string): string | null {
  const matches = Array.from(text.matchAll(/(\d{1,2})(h|d|w|m|y)(?=[A-Z\d\s]|$)/gi));
  if (matches.length === 0) return null;

  const limits = { h: 23, d: 30, w: 52, m: 12, y: 10 };
  let best: { num: number; unit: string } | null = null;
  const unitOrder = { h: 1, d: 2, w: 3, m: 4, y: 5 };

  for (const m of matches) {
    const num = parseInt(m[1]);
    const unit = m[2].toLowerCase();
    if (num > limits[unit as keyof typeof limits]) continue;
    if (!best) {
      best = { num, unit };
      continue;
    }
    const bestRank = unitOrder[best.unit as keyof typeof unitOrder];
    const curRank = unitOrder[unit as keyof typeof unitOrder];
    if (curRank > bestRank || (curRank === bestRank && num > best.num)) {
      best = { num, unit };
    }
  }

  if (!best) return null;
  const now = new Date();
  switch (best.unit) {
    case "h": now.setHours(now.getHours() - best.num); break;
    case "d": now.setDate(now.getDate() - best.num); break;
    case "w": now.setDate(now.getDate() - best.num * 7); break;
    case "m": now.setMonth(now.getMonth() - best.num); break;
    case "y": now.setFullYear(now.getFullYear() - best.num); break;
  }
  return now.toISOString();
}

/**
 * Call Claude API to extract pattern information from a Facebook post.
 */
async function extractPatternWithClaude(post: ScrapedPost): Promise<ClaudePatternExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  const prompt = `Analyze this Facebook scam-report post.

IMAGE PROCESSING ORDER (for every image attached):
  1. Read all visible text (OCR) — transcribe every word you can see.
  2. Identify location signals in that text (addresses, landmarks, colonias, metro stations).
  3. Analyze intent and tactics (recruitment promises, fees, urgency, contact methods).

Extract in this PRIORITY ORDER:

STEP 1 — LOCATION (HIGHEST PRIORITY):
- location_text: The most specific location signal found in the post text OR in the OCR'd image text
  (street address, colonia, landmark, metro station, city name, directions).
  Return null only if truly absent.

STEP 2 — ADDITIONAL INFORMATION:
- tone_description: A short description of the scam tactic (e.g. "WhatsApp recruitment with upfront uniform fee").
- tone_keywords: Array of tags from this exact set only: urgency, job_offer, payment_request,
  data_harvest, off_platform_contact, high_salary, vague_company, immediate_start, uniform_fee,
  investment_return, crypto, delivery_job
- image_descriptions: Array describing what each image shows (after OCR and location extraction).

STEP 3 — VERIFICATION:
- is_fake_job: boolean — true if this post shows signs of a fake or scam job offer
  (upfront fees, vague company, unrealistic salary, off-platform contact, urgency);
  false if it appears legitimate; null if insufficient information.

Post text:
${post.content}

Respond as STRICT JSON only (no markdown fences), exactly this shape:
{"tone_description": string|null, "tone_keywords": string[], "image_descriptions": string[], "location_text": string|null, "is_fake_job": boolean|null}`;

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
        system: "You are a scam-pattern analyst. For images: first read all text (OCR), then identify location signals, then analyze intent and tactics. You output only valid JSON. You never assert specific crimes, persons, or groups — only describe the tactic and pattern.",
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const textBlock = data.content.find((b) => b.type === "text");
    const raw = textBlock?.text ?? "";
    const sanitized = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(sanitized) as ClaudePatternExtraction;
    return {
      tone_description: parsed.tone_description ?? null,
      tone_keywords: Array.isArray(parsed.tone_keywords) ? parsed.tone_keywords : [],
      image_descriptions: Array.isArray(parsed.image_descriptions) ? parsed.image_descriptions : [],
      location_text: parsed.location_text ?? null,
      is_fake_job: typeof parsed.is_fake_job === "boolean" ? parsed.is_fake_job : null,
    };
  } catch {
    return {
      tone_description: null,
      tone_keywords: [],
      image_descriptions: [],
      location_text: null,
      is_fake_job: null,
    };
  }
}

interface GeocodeResult {
  lat: number;
  lng: number;
  region: string;
}

// CDMX bounding box used to bias geocoding toward Mexico City for bare street addresses
const CDMX_BOUNDS = "19.0494,-99.3648|19.5933,-98.9486";

function buildGeocodeAddress(locationText: string): string {
  const lower = locationText.toLowerCase();
  // If the text already mentions a city, state, or country — use as-is
  const hasCityHint = /ciudad de m[eé]xico|cdmx|guadalajara|monterrey|puebla|estado de m[eé]xico|m[eé]xico|mexico/i.test(locationText);
  if (hasCityHint) return locationText;
  // Bare street addresses ("Rio Elba 21 y 22") get CDMX appended
  const looksLikeStreet = /\d/.test(lower) || /\bcalle\b|\bav(enida)?\b|\bblvd\b|\bcolonia\b|\bcol\.\b/i.test(lower);
  if (looksLikeStreet) return `${locationText}, Ciudad de México, México`;
  // Anything else: append México so it resolves within the country
  return `${locationText}, México`;
}

async function geocodeLocation(locationText: string): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const address = buildGeocodeAddress(locationText);

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "es");
  url.searchParams.set("region", "mx");
  url.searchParams.set("components", "country:MX");
  // Bias results toward CDMX for street-level queries
  url.searchParams.set("bounds", CDMX_BOUNDS);

  type GeocodeResponse = {
    status: string;
    results: Array<{
      geometry: { location: { lat: number; lng: number } };
      address_components: Array<{ long_name: string; types: string[] }>;
    }>;
  };

  async function tryFetch(queryUrl: URL): Promise<GeocodeResult | null> {
    try {
      const res = await fetch(queryUrl.toString());
      if (!res.ok) return null;
      const data = await res.json() as GeocodeResponse;
      if (data.status === "REQUEST_DENIED") {
        console.error(
          `[geocode] REQUEST_DENIED — GOOGLE_MAPS_API_KEY is invalid or not a Maps Platform key.\n` +
          `  Current value looks like an OAuth client ID (ends with .apps.googleusercontent.com).\n` +
          `  Get a real key from https://console.cloud.google.com → APIs → Geocoding API → Credentials.`,
        );
        return null;
      }
      if (data.status !== "OK" || data.results.length === 0) return null;
      const first = data.results[0];
      const { lat, lng } = first.geometry.location;
      const regionComponent = first.address_components.find((c) =>
        c.types.includes("administrative_area_level_1"),
      );
      return { lat, lng, region: regionComponent?.long_name ?? "" };
    } catch {
      return null;
    }
  }

  // First attempt: enriched address with CDMX bounds bias
  const result = await tryFetch(url);
  if (result) return result;

  // Fallback: drop bounds bias but keep country restriction (wider search)
  const fallbackUrl = new URL(url.toString());
  fallbackUrl.searchParams.delete("bounds");
  return tryFetch(fallbackUrl);
}

async function parallelBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function scrapeAndSeedFacebookPatterns(): Promise<ScrapeSummary> {
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

  let posts: ScrapedPost[] = [];
  try {
    posts = await fetchFacebookGroupPosts(FACEBOOK_GROUP_URL);
  } catch (e) {
    summary.errors.push(`Playwright scrape failed: ${e instanceof Error ? e.message : "unknown"}`);
    summary.failed += 1;
    return summary;
  }

  if (posts.length === 0) {
    summary.errors.push("No posts captured from Facebook group");
    summary.failed += 1;
    return summary;
  }
  summary.totalPostsSeen = posts.length;
  console.log(`\nExtracting patterns from ${posts.length} posts (8 concurrent Claude calls)...`);

  // Step 1: parallel Claude extractions (8 at a time — stays under rate limit)
  const extractions = await parallelBatch(posts, 8, async (post, i) => {
    try {
      const result = await extractPatternWithClaude(post);
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

  // Step 2: parallel geocoding (all at once — Google Maps handles it)
  const locationsToGeocode = extractions.map((e) => e.location_text);
  const uniqueTexts = [...new Set(locationsToGeocode.filter(Boolean) as string[])];
  console.log(`\nGeocoding ${uniqueTexts.length} unique locations in parallel...`);

  const geocodeCache = new Map<string, GeocodeResult | null>();
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

  // Step 3: build rows
  const now = new Date().toISOString();
  const rows = posts.map((post, i) => {
    const extraction = extractions[i];
    const geocode = extraction.location_text ? (geocodeCache.get(extraction.location_text) ?? null) : null;
    return {
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
  });

  // Step 4: batch upsert (Supabase handles up to 500 rows per call)
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

/**
 * Retroactively geocode rows that have location_text but no coordinates.
 * Call this after scrapeAndSeedFacebookPatterns to fill gaps from previous runs.
 */
export async function geocodeMissingLocations(): Promise<{ updated: number; failed: number }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || !process.env.GOOGLE_MAPS_API_KEY) return { updated: 0, failed: 0 };

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from("facebook_patterns")
    .select("id, location_text")
    .not("location_text", "is", null)
    .is("location_latitude", null)
    .limit(500);

  if (error || !data || data.length === 0) return { updated: 0, failed: 0 };

  console.log(`\nRetroactive geocoding: ${data.length} rows with location_text but no coordinates...`);

  const uniqueTexts = [...new Set(data.map((r) => r.location_text as string))];
  const cache = new Map<string, GeocodeResult | null>();
  await Promise.all(
    uniqueTexts.map(async (text) => {
      cache.set(text, await geocodeLocation(text));
    }),
  );

  let updated = 0;
  let failed = 0;
  await Promise.all(
    data.map(async (row) => {
      const geo = cache.get(row.location_text as string) ?? null;
      if (!geo) { failed++; return; }
      const { error: upErr } = await supabase
        .from("facebook_patterns")
        .update({
          location_latitude: geo.lat,
          location_longitude: geo.lng,
          location_region: geo.region,
        })
        .eq("id", row.id);
      if (upErr) { failed++; } else { updated++; }
    }),
  );

  console.log(`Retroactive geocoding done: ${updated} updated, ${failed} failed`);
  return { updated, failed };
}

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
    const result = await extractJobPatternWithClaudeJob(post);
    if ((i + 1) % 10 === 0 || i + 1 === posts.length) {
      console.log(`  Claude extraction: ${i + 1}/${posts.length}`);
    }
    return result;
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
      is_fake_job: extraction.is_fake_job ?? null,
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
