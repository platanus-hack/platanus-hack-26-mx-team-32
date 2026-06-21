// app/server.js — Hilo API + reviewer UI.
// Endpoints for the madre-buscadora frontend:
//   POST /api/match        — matching service: señas+demographics → ranked candidates w/ verify
//   GET  /api/recruitment  — predictive recruitment clusters (real RNPDNO) for the map
//   GET  /api/search       — onboarding: find a record to link
//   GET  /api/alerts       — pending matches above threshold for a linked person
//   POST /api/extract      — normalize raw señas text → structured features
//   POST /api/detect-offer — fake-job recruitment detector (CRUCE signals)
//   GET  /api/risk-events  — social_risk_events from Supabase, geocoded to lat/lng markers
//   POST /api/pipeline     — trigger Python fosas pipeline for a clicked map location + layer
// Plus the reviewer UI + context/fosas/confirm/reject (RBAC).
// Run: npm run dev:ui -> http://localhost:3000

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { block } from "../lib/match/block.js";
import { scorePair } from "../lib/match/score.js";
import { extractFeatures } from "../lib/ingest/features.js";
import { detectOffer } from "../lib/detector/detect.js";
import { loadRNPDNO, buildIndex, clusterRecruitment } from "../lib/embed/embed.js";
import type { HiloRecord } from "../lib/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DB_PATH = join(ROOT, "hilo.db");
const GEN = join(ROOT, "data", "generated");
const PORT = process.env.PORT || 3000;

// Load .env from repo root if env vars not already set
if (!process.env.SUPABASE_URL) {
  try {
    const envPath = join(ROOT, ".env");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}

const sb = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_KEY ?? "",
);

// Map event_type → map layer
const EVENT_TYPE_LAYER: Record<string, string> = {
  fosa_clandestina: "fosas", hallazgo_restos: "fosas",
  secuestro_levanton: "desaparicion", balacera_enfrentamiento: "desaparicion",
  control_territorial_contexto: "desaparicion", narcomenudeo_contexto: "desaparicion",
  oferta_laboral_sospechosa: "trabajos", trata_enganche: "trabajos",
  otro: "desaparicion",
};

// Map layer → search query template
const LAYER_QUERY: Record<string, string> = {
  fosas: "fosas clandestinas",
  desaparicion: "desaparicion personas violencia",
  trabajos: "ofertas laborales falsas enganche trata personas",
};

if (!existsSync(DB_PATH)) { console.error("Run `npm run seed` first."); process.exit(1); }

// ─── municipio centroids (top recruitment hotspots) + state fallback ───
const MUNI_COORDS: Record<string, [number, number]> = {
  "CULIACÁN": [24.81, -107.39], "MAZATLÁN": [23.25, -106.41], "TIJUANA": [32.51, -117.04],
  "REYNOSA": [26.09, -98.29], "NUEVO LAREDO": [27.49, -99.51], "MATAMOROS": [25.87, -97.50],
  "ACAPULCO DE JUÁREZ": [16.85, -99.82], "NEZAHUALCÓYOTL": [19.40, -99.01], "ECATEPEC": [19.60, -99.05],
  "TOLUCA": [19.28, -99.66], "GUADALAJARA": [20.66, -103.35], "ZAPOPAN": [20.72, -103.40],
  "MORELIA": [19.70, -101.18], "URUAPAN": [19.41, -102.05], "LAZARO CARDENAS": [17.96, -102.19],
  "LÁZARO CÁRDENAS": [17.96, -102.19], "IGUALA": [18.35, -99.54], "TLAQUEPAQUE": [20.64, -103.29],
  "TLAJOMULCO": [20.47, -103.45], "SAN MATEO ATENCO": [19.27, -99.60], "CENTRO": [0, 0],
};
const STATE_COORDS: Record<string, [number, number]> = {
  "SINALOA": [24.7, -107.4], "BAJA CALIFORNIA": [30.0, -115.2], "TAMAULIPAS": [24.8, -98.4],
  "GUERRERO": [17.6, -99.9], "ESTADO DE MÉXICO": [19.5, -99.6], "JALISCO": [20.3, -103.5],
  "MICHOACÁN": [19.2, -101.8], "CHIHUAHUA": [28.4, -106.3], "CIUDAD DE MÉXICO": [19.4, -99.1],
  "GUANAJUATO": [21.0, -101.3], "VERACRUZ": [19.2, -96.7], "PUEBLA": [19.0, -97.9],
};

function coordFor(estado: string, municipio: string): [number, number] | null {
  const m = MUNI_COORDS[municipio.toUpperCase().trim()];
  if (m && m[0] !== 0) return m;
  const s = STATE_COORDS[estado.toUpperCase().trim()];
  return s ?? null;
}

// ─── pipeline: populate candidate_matches ───
function runPipeline() {
  const db = new Database(DB_PATH); db.pragma("foreign_keys = ON");
  for (const t of ["reviews", "candidate_matches"]) db.prepare(`DELETE FROM ${t}`).run();
  const records = db.prepare("SELECT * FROM records").all().map(normalizeRecord);
  const allFeats = db.prepare("SELECT * FROM features").all().map((f: any) => ({ ...f, tokens: f.tokens ? JSON.parse(f.tokens) : [] }));
  const scored = block(records).map(p => scorePair(p, allFeats, allFeats)).sort((a, b) => b.overall_score - a.overall_score);
  for (const p of scored.slice(0, 12)) {
    const v = detVerify(p);
    db.prepare(`INSERT OR REPLACE INTO candidate_matches
      (id,missing_record_id,unidentified_record_id,overall_score,field_scores,verifier_evidence,verifier_contradictions,verifier_tier,status)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), p.missing.id, p.unidentified.id, p.overall_score, JSON.stringify(p.field_scores), v.evidence, v.contradictions, v.tier, "in_review");
  }
  db.close();
}
function detVerify(p: any) {
  const hard = p.contradictions.some((c: string) => /lateralidad|temporal.*ANTES|edad incompatible/i.test(c));
  const tier = hard ? "baja" : p.overall_score >= 0.75 ? "alta" : p.overall_score >= 0.5 ? "media" : "baja";
  return { evidence: p.evidences.join(". ") || "Coincidencia parcial.", contradictions: p.contradictions.join(". ") || "Sin contradicciones duras.", tier };
}
function normalizeRecord(r: any): HiloRecord { return { ...r, pii_minimized: !!r.pii_minimized, synthetic: !!r.synthetic }; }

console.log("[pipeline] corriendo block→score→verify...");
runPipeline();

// ─── predictive recruitment clusters (real RNPDNO), precomputed ───
console.log("[recruitment] computando clusters sobre RNPDNO real...");
const _recs = loadRNPDNO(40000);
const _idx = buildIndex(_recs);
const _clusters = clusterRecruitment(_idx, 3);
const RECRUITMENT = (() => {
  const byMuni = new Map<string, { estado: string; municipio: string; count: number; minDate: string; maxDate: string; clusters: number }>();
  for (const c of _clusters) {
    const r0 = c.records[0];
    const key = r0.entidad + "|" + r0.municipio;
    const cur = byMuni.get(key) || { estado: r0.entidad, municipio: r0.municipio || "(s/d)", count: 0, minDate: "9999", maxDate: "0000", clusters: 0 };
    cur.count += c.records.length; cur.clusters += 1;
    for (const r of c.records) {
      const d = (r.fechaDesaparicion || "").slice(0, 10);
      if (d && d < cur.minDate) cur.minDate = d;
      if (d && d > cur.maxDate) cur.maxDate = d;
    }
    byMuni.set(key, cur);
  }
  const features = [...byMuni.values()].map(b => {
    const c = coordFor(b.estado, b.municipio);
    return c ? { type: "Feature", geometry: { type: "Point", coordinates: [c[1], c[0]] }, properties: { ...b, lat: c[0], lng: c[1] } } : null;
  }).filter(Boolean);
  return { type: "FeatureCollection", total_jovenes: _clusters.reduce((s, c) => s + c.records.length, 0), total_clusters: _clusters.length, num_municipios: features.length, features };
})();
console.log(`[recruitment] ${RECRUITMENT.total_clusters} clusters, ${RECRUITMENT.num_municipios} municipios mapeables`);

// ─── helpers ───
function canReadSecure(r: string) { return r === "reviewer" || r === "liaison" || r === "admin"; }
function canWrite(r: string) { return r === "reviewer" || r === "liaison" || r === "admin"; }
function jsonH() { return { "content-type": "application/json; charset=utf-8" }; }
async function readBody(req: any): Promise<any> { return new Promise(res => { let d = ""; req.on("data", (c: any) => d += c); req.on("end", () => { try { res(JSON.parse(d || "{}")); } catch { res({}); } }); }); }

// ─── HTTP ───
const server = createServer(async (req, res) => {
  // CORS — allow the Vite dev server (port 5173) to call this API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const role = url.searchParams.get("role") || "reviewer";
  const db = () => new Database(DB_PATH);

  // ── GET /api/risk-events — social_risk_events geocoded to map markers ──
  if (url.pathname === "/api/risk-events") {
    try {
      const layerFilter = url.searchParams.get("layer");
      const { data, error } = await sb
        .from("social_risk_events")
        .select("id,event_type,estado,municipio,summary_public,confidence,severity,reported_at,evidence_json")
        .order("reported_at", { ascending: false })
        .limit(200);

      if (error) {
        console.error("[risk-events] Supabase error:", error.message);
        res.writeHead(500, jsonH()); res.end(JSON.stringify({ error: error.message })); return;
      }

      const features = (data ?? []).map((e: any) => {
        const layer = EVENT_TYPE_LAYER[e.event_type] ?? "desaparicion";
        if (layerFilter && layer !== layerFilter) return null;
        const estadoPrimary = (e.estado ?? "").split(",")[0].trim();
        const municipioPrimary = (e.municipio ?? "").split(",")[0].trim();
        const coords = coordFor(estadoPrimary, municipioPrimary);
        if (!coords) return null;
        const [lat, lng] = coords;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            id: e.id, layer, event_type: e.event_type,
            summary: e.summary_public, confidence: e.confidence,
            severity: e.severity, estado: e.estado, municipio: e.municipio,
            reported_at: e.reported_at,
          },
        };
      }).filter(Boolean);

      res.writeHead(200, jsonH());
      res.end(JSON.stringify({ type: "FeatureCollection", total: features.length, features }));
    } catch (err: any) {
      console.error("[risk-events] unhandled exception:", err?.message ?? err);
      res.writeHead(500, jsonH()); res.end(JSON.stringify({ error: err?.message ?? String(err) }));
    }
    return;
  }

  // ── POST /api/pipeline — trigger Python pipeline for a map location + layer ──
  if (url.pathname === "/api/pipeline" && req.method === "POST") {
    const body = await readBody(req);
    const location: string = body.location ?? "";
    const layer: string = body.layer ?? "fosas";
    const baseQuery = LAYER_QUERY[layer] ?? "fosas clandestinas";
    const query = location ? `${baseQuery} ${location}` : baseQuery;

    const agentsDir = join(ROOT, "agents");
    const proc = spawn("uv", ["run", "python", "run_agent.py", "pipeline", "--query", query], {
      cwd: agentsDir,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    proc.unref();

    res.writeHead(200, jsonH());
    res.end(JSON.stringify({ ok: true, query, layer, location }));
    return;
  }

  if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html()); return; }
  if (url.pathname === "/api/health") { res.writeHead(200, jsonH()); res.end(JSON.stringify({ ok: true, recruitment_clusters: RECRUITMENT.total_clusters })); return; }
  if (url.pathname === "/api/context") { res.writeHead(200, jsonH()); res.end(readFileSync(join(GEN, "context_national.json"))); return; }
  if (url.pathname === "/api/fosas") {
    if (!canReadSecure(role)) { res.writeHead(403, jsonH()); res.end(JSON.stringify({ error: "DENIED", message: `role '${role}' cannot read secure_locations` })); return; }
    res.writeHead(200, jsonH()); res.end(readFileSync(join(GEN, "fosas.geojson"))); return;
  }
  if (url.pathname === "/api/recruitment") { res.writeHead(200, jsonH()); res.end(JSON.stringify(RECRUITMENT)); return; }

  // facebook scam patterns GeoJSON layer for the crime map
  if (url.pathname === "/api/crime-map") {
    const d = db();
    const rows = d.prepare("SELECT * FROM facebook_patterns WHERE location_latitude IS NOT NULL AND location_longitude IS NOT NULL ORDER BY scraped_at DESC").all() as any[];
    d.close();
    const features = rows.map((r: any) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.location_longitude, r.location_latitude] },
      properties: {
        id: r.id,
        post_url: r.post_url,
        tone_description: r.tone_description,
        tone_keywords: r.tone_keywords ? JSON.parse(r.tone_keywords) : [],
        image_descriptions: r.image_descriptions ? JSON.parse(r.image_descriptions) : [],
        location_text: r.location_text,
        location_region: r.location_region,
        scraped_at: r.scraped_at,
        post_content: r.post_content?.slice(0, 200),
      },
    }));
    res.writeHead(200, jsonH());
    res.end(JSON.stringify({ type: "FeatureCollection", total_patterns: features.length, features }));
    return;
  }

  // onboarding: search records to link (synthetic demo; RNPDNO has no names)
  if (url.pathname === "/api/search") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const estado = url.searchParams.get("estado");
    const d = db();
    let rows = d.prepare("SELECT * FROM records WHERE record_type='missing'").all().map(normalizeRecord);
    if (estado) rows = rows.filter(r => r.estado === estado);
    if (q) rows = rows.filter(r => (r.raw_description || "").toLowerCase().includes(q) || (r.municipio || "").toLowerCase().includes(q));
    res.writeHead(200, jsonH()); res.end(JSON.stringify({ count: rows.length, results: rows.slice(0, 20).map(r => ({ id: r.id, estado: r.estado, municipio: r.municipio, sex: r.sex, age_min: r.age_min, age_max: r.age_max, señas: r.raw_description, event_date: r.event_date })) })); d.close(); return;
  }

  // pending alerts for a linked person (matches above threshold, not yet confirmed)
  if (url.pathname === "/api/alerts") {
    const personId = url.searchParams.get("personId");
    const d = db();
    const rows = d.prepare(`SELECT cm.* FROM candidate_matches cm WHERE cm.status='in_review' AND cm.overall_score>=0.5
      AND (cm.missing_record_id=? OR cm.unidentified_record_id=?) ORDER BY cm.overall_score DESC`).all(personId, personId)
      .map((m: any) => ({ ...m, field_scores: JSON.parse(m.field_scores) }));
    res.writeHead(200, jsonH()); res.end(JSON.stringify({ personId, alerts: rows })); d.close(); return;
  }

  // CORE: matching service — señas+demographics → ranked candidates
  if (url.pathname === "/api/match" && req.method === "POST") {
    const body = await readBody(req);
    const qType: "missing" | "unidentified" = body.type === "missing" ? "missing" : "unidentified";
    const oppType = qType === "missing" ? "unidentified" : "missing";
    const queryRec = {
      id: "QUERY", source_id: "api", record_type: qType, sex: body.sex, age_min: body.ageMin, age_max: body.ageMax,
      height_cm: body.heightCm, estado: body.estado, municipio: body.municipio, event_date: body.eventDate,
      raw_description: body.señas || "", pii_minimized: true, synthetic: true, created_at: new Date().toISOString(),
    };
    const queryFeats = await extractFeatures(body.señas || "", "QUERY");
    const d = db();
    const pool = d.prepare("SELECT * FROM records WHERE record_type=?").all(oppType).map(normalizeRecord);
    const allFeats = d.prepare("SELECT * FROM features").all().map((f: any) => ({ ...f, tokens: f.tokens ? JSON.parse(f.tokens) : [] }));
    const scored = pool.map(r => {
      const oppFeats = allFeats.filter(f => f.record_id === r.id);
      const qFeatObjs = queryFeats.map(f => ({ ...f, record_id: "QUERY" }));
      const p = scorePair({ missing: qType === "missing" ? queryRec : r, unidentified: qType === "missing" ? r : queryRec } as any, [...allFeats, ...qFeatObjs], [...allFeats, ...qFeatObjs]);
      return { record: r, overall_score: p.overall_score, field_scores: p.field_scores, evidence: p.evidences, contradictions: p.contradictions, verifier: detVerify(p) };
    }).sort((a, b) => b.overall_score - a.overall_score);
    d.close();
    res.writeHead(200, jsonH()); res.end(JSON.stringify({ query: { type: qType, señas: body.señas, estado: body.estado }, candidates: scored.slice(0, 10) }));
    return;
  }

  // señas normalization (intake)
  if (url.pathname === "/api/extract" && req.method === "POST") {
    const body = await readBody(req);
    const feats = await extractFeatures(body.señas || "", "EXTRACT");
    res.writeHead(200, jsonH()); res.end(JSON.stringify({ input: body.señas, features: feats.map(f => ({ type: f.feature_type, region: f.body_region, laterality: f.laterality, motif: f.motif_category, raw: f.description_raw })) }));
    return;
  }

  // fake-job recruitment detector (CRUCE signals)
  if (url.pathname === "/api/detect-offer" && req.method === "POST") {
    const body = await readBody(req);
    const result = detectOffer(body.text || "", { offerState: body.offerState, contactAreaCode: body.contactAreaCode, interviewLocation: body.interviewLocation, hasImage: !!body.hasImage });
    res.writeHead(200, jsonH()); res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === "/api/state") { res.writeHead(200, jsonH()); res.end(JSON.stringify(state(role))); return; }
  if (url.pathname === "/api/confirm" && req.method === "POST") {
    if (!canWrite(role)) {
      const d = db(); d.prepare("INSERT INTO audit_log (actor,action,entity) VALUES (?,?,?)").run(role, "review_confirm_denied", url.searchParams.get("id")); d.close();
      res.writeHead(403, jsonH()); res.end(JSON.stringify({ error: "DENIED", message: `role '${role}' cannot confirm matches` })); return;
    }
    const id = url.searchParams.get("id"), reviewer = url.searchParams.get("reviewer") || "reviewer-luna";
    if (!id) { res.writeHead(400, jsonH()); res.end(JSON.stringify({ error: "MISSING_ID" })); return; }
    const d = db(); const u = d.prepare("SELECT id FROM app_users WHERE pseudonym=?").get(reviewer) as any;
    d.prepare("INSERT INTO reviews (id,match_id,reviewer_id,decision) VALUES (?,?,?,?)").run(randomUUID(), id, u.id, "confirmed");
    d.prepare("UPDATE candidate_matches SET status='confirmed' WHERE id=?").run(id);
    d.prepare("INSERT INTO audit_log (actor,action,entity) VALUES (?,?,?)").run(role, "review_confirmed", id); d.close();
    res.writeHead(200, jsonH()); res.end(JSON.stringify({ ok: true })); return;
  }
  if (url.pathname === "/api/reject" && req.method === "POST") {
    if (!canWrite(role)) {
      const d = db(); d.prepare("INSERT INTO audit_log (actor,action,entity) VALUES (?,?,?)").run(role, "review_reject_denied", url.searchParams.get("id")); d.close();
      res.writeHead(403, jsonH()); res.end(JSON.stringify({ error: "DENIED", message: `role '${role}' cannot reject matches` })); return;
    }
    const id = url.searchParams.get("id");
    if (!id) { res.writeHead(400, jsonH()); res.end(JSON.stringify({ error: "MISSING_ID" })); return; }
    const d = db();
    d.prepare("UPDATE candidate_matches SET status='rejected' WHERE id=?").run(id);
    d.prepare("INSERT INTO audit_log (actor,action,entity) VALUES (?,?,?)").run(role, "review_rejected", id); d.close();
    res.writeHead(200, jsonH()); res.end(JSON.stringify({ ok: true })); return;
  }
  res.writeHead(404); res.end("not found");
});

function state(role: string) {
  const d = new Database(DB_PATH);
  const matches = d.prepare("SELECT * FROM candidate_matches WHERE status='in_review' ORDER BY overall_score DESC").all().map((m: any) => {
    const miss = d.prepare("SELECT * FROM records WHERE id=?").get(m.missing_record_id);
    const unk = d.prepare("SELECT * FROM records WHERE id=?").get(m.unidentified_record_id);
    const mf = d.prepare("SELECT description_raw,feature_type,body_region,laterality FROM features WHERE record_id=?").all(m.missing_record_id);
    const uf = d.prepare("SELECT description_raw,feature_type,body_region,laterality FROM features WHERE record_id=?").all(m.unidentified_record_id);
    return { ...m, field_scores: JSON.parse(m.field_scores), missing: normalizeRecord(miss), unidentified: normalizeRecord(unk), missingFeatures: mf, unidentifiedFeatures: uf };
  });
  const ctx = JSON.parse(readFileSync(join(GEN, "context_national.json"), "utf-8"));
  const confirmed = (d.prepare("SELECT COUNT(*) c FROM candidate_matches WHERE status='confirmed'").get() as any).c;
  d.close();
  return { role, canReadSecure: canReadSecure(role), matches, context: ctx, confirmedCount: confirmed, recruitmentClusters: RECRUITMENT.total_clusters };
}

// minimal reviewer HTML (the full side-by-side UI lives here)
function html() { return readFileSync(join(__dirname, "ui.html"), "utf-8").replace(/__RECRUITMENT__/g, String(RECRUITMENT.total_clusters)); }

// (UI HTML kept inline for portability — same reviewer panel as before, plus a recruitment note)
const UI = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hilo</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>:root{--bg:#0e1116;--panel:#161b22;--ink:#e6edf3;--mut:#8b949e;--acc:#58a6ff;--grn:#3fb950;--red:#f85149;--yel:#d29922;--bd:#30363d}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}.ban{background:var(--yel);color:#1b1f24;font-weight:700;text-align:center;padding:6px;font-size:13px}header{padding:14px 18px;border-bottom:1px solid var(--bd);display:flex;gap:14px;flex-wrap:wrap;align-items:center}h1{margin:0;font-size:18px}h1 small{color:var(--mut);font-weight:400}.ctx{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--mut)}.ctx b{color:var(--ink)}.roles button{background:var(--panel);color:var(--ink);border:1px solid var(--bd);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:4px}.roles button.on{background:var(--acc);color:#000;border-color:var(--acc);font-weight:700}main{display:grid;grid-template-columns:1fr 380px;gap:16px;padding:16px}@media(max-width:900px){main{grid-template-columns:1fr}}.card{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:14px}.sbs{display:grid;grid-template-columns:1fr 1fr;gap:12px}.side{background:#0d1117;border:1px solid var(--bd);border-radius:8px;padding:10px;font-size:13px}.side h4{margin:0 0 6px;color:var(--acc);font-size:12px;text-transform:uppercase;letter-spacing:.5px}.score{font-size:28px;font-weight:700}.tier{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700}.t-alta{background:#1f6f3b;color:#aff5c4}.t-media{background:#3d2e00;color:#ffe8a3}.t-baja{background:#4a1e1e;color:#ffc9c9}.ev{color:var(--grn);font-size:12px;margin:6px 0}.con{color:var(--red);font-size:12px;margin:6px 0}.feat{font-size:11px;color:var(--mut);background:#0d1117;padding:3px 6px;border-radius:4px;display:inline-block;margin:2px}button.act{padding:6px 12px;border-radius:6px;border:1px solid var(--bd);cursor:pointer;font-size:12px;background:var(--panel);color:var(--ink)}.yes{border-color:var(--grn);color:var(--grn)}.no{border-color:var(--red);color:var(--red)}#map{height:320px;border-radius:8px;border:1px solid var(--bd)}.denied{display:flex;height:320px;align-items:center;justify-content:center;color:var(--red);flex-direction:column;border:1px dashed var(--red);border-radius:8px}.cnt{color:var(--mut);font-size:12px}.layer{font-size:12px;margin:6px 0}.layer label{color:var(--mut)}</style></head><body>
<div class="ban">⚠ DATOS SINTÉTICOS — DEMO · individuos sintéticos; agregados (RNPDNO) y fosas son REALES</div>
<header><h1>Hilo <small>· cola de revisión + API</small></h1>
<div class="roles" id="roles"><button data-role="reviewer" class="on">revisora</button><button data-role="readonly">readonly</button></div>
<div class="ctx" id="ctx"></div></header>
<main><div id="queue"></div><aside>
<div class="card"><h4 style="margin:0 0 8px;color:var(--mut)">Mapa: fosas reales + clusters de reclutamiento + estafas (Facebook)</h4>
<div class="layer"><label><input type="checkbox" id="lFosas" checked> fosas (azul)</label> <label><input type="checkbox" id="lRecr" checked> reclutamiento (naranja)</label> <label><input type="checkbox" id="lFB" checked> estafas FB (rojo)</label></div>
<div id="mapWrap"><div id="map"></div></div><div class="cnt" id="fosaCnt"></div></div>
<div class="card" style="font-size:12px;color:var(--mut)">API para el frontend:<br>POST /api/match · GET /api/recruitment · GET /api/search · GET /api/alerts · POST /api/extract · POST /api/detect-offer · __RECRUITMENT__ clusters activos</div>
</aside></main>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
let role="reviewer",map=null,lyrF=null,lyrR=null,lyrFB=null;
const $=s=>document.querySelector(s);const fmt=n=>Number(n).toLocaleString('es-MX');
async function load(){const s=await(await fetch('/api/state?role='+role)).json();
$('#ctx').innerHTML=\`<span><b>\${fmt(s.context.total_desaparecidos_no_loc)}</b> desaparecidos/no-loc (RNPDNO)</span><span><b>\${s.recruitmentClusters}</b> clusters reclutamiento</span><span><b>\${s.confirmedCount}</b> confirmadas</span>\`;
$('#queue').innerHTML=s.matches.length?s.matches.map(card).join(''):'<div class="card">Cola vacía.</div>';
$('#queue').querySelectorAll('[data-confirm]').forEach(b=>b.onclick=()=>act(b.dataset.confirm,'confirm'));
$('#queue').querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>act(b.dataset.reject,'reject'));
loadMap(role);}
function card(m){const cls='t-'+(m.verifier_tier||'baja');const mf=m.missingFeatures.map(f=>\`<span class="feat">\${f.feature_type}·\${f.body_region}·\${f.laterality}</span>\`).join('');const uf=m.unidentifiedFeatures.map(f=>\`<span class="feat">\${f.feature_type}·\${f.body_region}·\${f.laterality}</span>\`).join('');
return \`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="score">\${(m.overall_score*100|0)}</span><span class="cnt">/100</span> <span class="tier \${cls}">\${m.verifier_tier||'baja'}</span></div><div><button class="act yes" data-confirm="\${m.id}">✓ Confirmar</button> <button class="act no" data-reject="\${m.id}">✕ Descartar</button></div></div><div class="sbs" style="margin-top:10px"><div class="side"><h4>Ficha</h4><div>\${m.missing.sex}·\${m.missing.age_min}-\${m.missing.age_max}a·\${m.missing.height_cm}cm</div><div class="cnt">\${m.missing.estado}·\${m.missing.event_date}</div><div style="margin-top:6px">\${mf}</div></div><div class="side"><h4>Cuerpo</h4><div>\${m.unidentified.sex}·\${m.unidentified.age_min}-\${m.unidentified.age_max}a·\${m.unidentified.height_cm}cm</div><div class="cnt">\${m.unidentified.estado}·\${m.unidentified.event_date}</div><div style="margin-top:6px">\${uf}</div></div></div><div class="ev">✓ \${m.verifier_evidence||''}</div>\${(m.verifier_contradictions&&m.verifier_contradictions!=='Sin contradicciones duras.')?\`<div class="con">✗ \${m.verifier_contradictions}</div>\`:''}</div>\`;}
async function act(id,kind){await fetch('/api/'+kind+'?id='+id+(kind==='confirm'?'&reviewer=reviewer-luna':''),{method:'POST'});load();}
async function loadMap(r){const w=$('#mapWrap');if(!['reviewer','liaison','admin'].includes(r)){w.innerHTML='<div class="denied"><b>⛔ DENEGADO</b><span>readonly no puede leer secure_locations</span></div>';$('#fosaCnt').textContent='';return;}w.innerHTML='<div id="map"></div>';initMap();
const fosas=await(await fetch('/api/fosas?role='+r)).json();let nf=0,ff=0;
if(lyrF)map.removeLayer(lyrF);lyrF=L.layerGroup().addTo(map);fosas.features.forEach(ft=>{const[lng,lat]=ft.geometry.coordinates;nf++;ff+=ft.properties.fosas;L.circleMarker([lat,lng],{radius:3+Math.min(ft.properties.fosas,6),color:'#58a6ff',fillColor:'#58a6ff',fillOpacity:.5,weight:1}).addTo(lyrF);});
const rec=await(await fetch('/api/recruitment')).json();let nr=0;
if(lyrR)map.removeLayer(lyrR);lyrR=L.layerGroup().addTo(map);rec.features.forEach(ft=>{const[lng,lat]=ft.geometry.coordinates;nr++;L.circleMarker([lat,lng],{radius:6+Math.min(ft.properties.count,18),color:'#d29922',fillColor:'#f0883e',fillOpacity:.6,weight:1}).bindPopup(\`<b>\${ft.properties.municipio}, \${ft.properties.estado}</b><br>\${ft.properties.count} jóvenes · \${ft.properties.minDate}→\${ft.properties.maxDate}<br>\${ft.properties.clusters} clusters\`).addTo(lyrR);});
$('#fosaCnt').textContent=\`\${fmt(nf)} sitios fosas (\${fmt(ff)} fosas) + \${rec.total_clusters} clusters reclutamiento (\${fmt(rec.total_jovenes)} jóvenes)\`;
const fb=await(await fetch('/api/crime-map')).json();let nfb=0;
if(lyrFB)map.removeLayer(lyrFB);lyrFB=L.layerGroup().addTo(map);
(fb.features||[]).forEach(ft=>{const[lng,lat]=ft.geometry.coordinates;nfb++;const kw=(ft.properties.tone_keywords||[]).join(', ');L.circleMarker([lat,lng],{radius:5,color:'#f85149',fillColor:'#f85149',fillOpacity:.6,weight:1}).bindPopup(\`<b>Estafa reportada</b><br>\${ft.properties.tone_description||'Sin descripción'}<br><small>\${kw}</small><br>\${ft.properties.location_text||''}\`).addTo(lyrFB);});
$('#fosaCnt').textContent+=\` + \${nfb} patrones estafa Facebook\`;
$('#lFosas').onchange=e=>{e.target.checked?lyrF.addTo(map):map.removeLayer(lyrF);};$('#lRecr').onchange=e=>{e.target.checked?lyrR.addTo(map):map.removeLayer(lyrR);};$('#lFB').onchange=e=>{e.target.checked?lyrFB.addTo(map):map.removeLayer(lyrFB);};}
function initMap(){if(map)return;map=L.map('map').setView([23.6,-102],4);L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© OSM'}).addTo(map);}
$('#roles').querySelectorAll('button').forEach(b=>b.onclick=()=>{role=b.dataset.role;$('#roles').querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');load();});
load();
</script></body></html>`;
try { writeFileSync(join(__dirname, "ui.html"), UI); } catch {}

server.listen(PORT, () => console.log(`\n  Hilo API + UI → http://localhost:${PORT}\n  endpoints: /api/match · /api/recruitment · /api/search · /api/alerts · /api/extract · /api/detect-offer\n`));
