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
