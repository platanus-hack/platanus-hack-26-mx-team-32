# Hilo — Architecture Document for Delegation

> **What:** Forensic record-linkage engine for Mexico's missing persons crisis. Cross-references desaparecidos (search files) against unidentified bodies via distinguishing marks (tattoos, scars) normalized to BNDF vocabulary.
> **Vision:** The connective layer mandated by law in 2017 that the State never built. Every family that searches, every body that waits.
> **Monetization:** Government contracts (CNB, fiscalías) + NGO licenses + international grants.

## Core Innovation

**Semantic equivalence solving:** Morgue bureaucratic lexicon ↔ desperate family language.
- `"ancla brazo der."` (SEMEOF forensic code) ≡ `"tatuaje de áncora en antebrazo derecho"` (family report)
- LLM-powered normalization to BNDF (Banco Nacional de Datos Forenses) vocabulary
- Dual-Plane Verifier: `INGEST → BLOCK → SCORE → VERIFY → HUMAN REVIEW → NOTIFY`

## Current State

### Two parallel codebases (should be merged):
- **hilo/** — TypeScript-only (Node + SQLite + better-sqlite3). Original hackathon build.
- **sendero-demo/** — TS frontend + Python backend (FastAPI + uvicorn). Newer, more features.

### sendero-demo structure (primary, merge target)
```
app/                    — React + Vite frontend
  src/
    components/         — AgentDot, BodyFeatureMap, ChatDrawer, GlassCard,
                          NewsAnalysisWidget, PersonConnectionsGraph
    features/           — auth, chat, firecrawl (news), landing (map+search),
                          matching, notifications, profile, theme
    screens/            — Home, Landing, Login, Onboarding, Profile
    lib/                — http, mexico-borders, supabase
backend/                — Python FastAPI
  src/
    config.py, db.py, deps.py, llm.py, main.py
    features/           — auth, firecrawl, matching, personas, vinculos
agents/                 — Python AI agents
  config.py, db.py, state.py, run_agent.py
  missing_case_extractor.py
  official_source_researcher.py
  public_web_acquirer.py
  review_recommender.py
  social_intel_extractor.py
  data_cleaner.py, fosas_pipeline.py
  tests/                — unit tests for each agent
lib/                    — TypeScript shared library
  acquisition/          — providers (facebook, firecrawl, geocoding, mock)
                          extractors, workflow, policy, safety
  detector/             — detect.ts, signals.ts (pattern detection)
  embed/                — embed.ts, image.ts (vector embeddings)
  match/                — block.ts, score.ts, verify.ts (matching pipeline)
  db.ts, llm.ts, seedgen.ts, facebook-scraper.ts
  ingest/features.ts
db/
  dataset/              — RNPDNO data, geocoding, schema
  schema_app.sql, schema_embeddings.sql, seed_cuerpos.sql
data/raw/               — fosas_raw.json, mexico_geo.json, poblacion.csv,
                          rnpdno_desaparecidos.csv, timeseries_victimas.csv
```

### Key routes (backend FastAPI)
```
GET  /                              — landing (map with persons)
GET  /search                        — search desaparecidos
POST /v2/search                     — advanced search
POST /v2/scrape                     — acquire new data
GET  /{persona_id}                  — person detail
GET  /{victima_id}/foto             — person photo
GET  /personas/{persona_id}/candidatos — matching candidates
POST /match/preview                 — preview match scores
POST /match/notify                  — notify family of potential match
GET  /me                            — current user
GET/POST/DELETE /vinculo            — link/vinculo management
GET  /health                        — health check
POST /news                          — fetch person news (firecrawl)
POST /firecrawl/news                — news analysis
```

### Data Sources
- **RNPDNO** (Registro Nacional de Personas Desaparecidas): 84,430 records
- **BNDF / fosas**: 487 sites, 3,187 bodies
- **Facebook**: Public desaparecidos groups (facebook-scraper)
- **News**: Firecrawl-powered news analysis per person
- **Geocoding**: Mexico state/municipality borders

### Ethics Guardrails
- 100% synthetic individuals for demo (calibrated by real RNPDNO demographics)
- System NEVER concludes a match — only ranks candidates for human review
- RBAC-protected coordinates
- "DATOS SINTÉTICOS — DEMO" banner always visible
- Append-only audit log for all operations

## Architecture (Target — Production)

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface                          │
│  Web App (React+Vite)  ·  Family Report Form  ·  Reviewer UI│
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   API Gateway (FastAPI)                      │
│  backend/src/main.py                                         │
│  · Auth (Supabase JWT)                                       │
│  · Route dispatch                                            │
│  · Rate limiting + audit log                                 │
└──┬────────┬────────┬────────┬────────┬────────┬─────────────┘
   │        │        │        │        │        │
┌──▼──┐┌───▼───┐┌───▼───┐┌───▼───┐┌───▼───┐┌───▼──────┐
│Per- ││Match- ││Acqui- ││Agent  ││Vinculo││Firecrawl │
│sonas││ing    ││sition ││Runner ││Mgr   ││News      │
│CRUD ││Engine ││Layer  ││       ││      ││          │
└──┬──┘└───┬───┘└───┬───┘└───┬───┘└──────┘└──────────┘
   │       │        │        │
   │  ┌────▼────────▼────┐   │
   │  │  Matching Pipeline│  │
   │  │  BLOCK → SCORE   │  │
   │  │  → VERIFY        │  │
   │  │  lib/match/      │  │
   │  └────┬─────────────┘  │
   │       │                 │
┌──▼───────▼─────────────────▼──────────────────────┐
│                 AI / LLM Layer                      │
│  · Semantic normalization (BNDF vocabulary)         │
│  · Embedding generation (lib/embed/)                │
│  · Agent pipeline:                                   │
│    missing_case_extractor → official_source_researcher│
│    → public_web_acquirer → social_intel_extractor    │
│    → review_recommender → data_cleaner               │
│  · Provider-agnostic (OpenAI-compatible + fallback)  │
└──┬──────────────────────────────────────────────────┘
   │
┌──▼──────────────┐  ┌───────────────┐  ┌──────────────┐
│  PostgreSQL      │  │   Supabase     │  │  SQLite      │
│  + pgvector      │  │   (Auth, RLS)  │  │  (demo/seed) │
│  (production)    │  │               │  │              │
└─────────────────┘  └───────────────┘  └──────────────┘
```

## Critical Flows

### Flow 1: Matching pipeline (core value)
```
1. INGEST: Desaparecido record arrives (RNPDNO / Facebook / family report)
   → lib/acquisition/workflow.ts: AcquisitionWorkflow.run()
   → Extract features: tattoos, scars, moles → normalize to BNDF terms
   → lib/embed/embed.ts: generate vector embeddings

2. BLOCK: Prevent impossible matches
   → lib/match/block.ts: filter by gender, approximate age range, geography
   → Removes candidates that can't possibly match

3. SCORE: Rank remaining candidates
   → lib/match/score.ts: semantic similarity between distinguishing marks
   → Weighted scoring: marks match, proximity, timeline consistency
   → Returns ranked list with confidence scores

4. VERIFY: LLM-powered verification of top candidates
   → lib/match/verify.ts: LLM reviews match, explains reasoning
   → NEVER auto-confirms — flags for human review

5. HUMAN REVIEW: Reviewer UI shows candidates with evidence
   → Reviewer marks as: confirmed match / rejected / needs investigation
   → All decisions logged to append-only audit table

6. NOTIFY: If reviewer confirms → notify family + authorities
   → POST /match/notify
```

### Flow 2: Agent pipeline (data enrichment)
```
run_agent.py orchestrates sequential agents:
  1. missing_case_extractor: identifies unreported cases from news/social
  2. official_source_researcher: searches gov databases (RNPDNO, CNB)
  3. public_web_acquirer: scrapes public web (news, social media)
  4. social_intel_extractor: extracts social signals (last seen, contacts)
  5. review_recommender: prioritizes which cases need urgent review
  6. data_cleaner: normalizes and deduplicates
  7. fosas_pipeline: processes unidentified body data from fosas reports
```

### Flow 3: Family-facing search
```
Family member opens web app → Landing page with map
  → Searches by name, location, or physical description
  → GET /search or POST /v2/search
  → Sees person card with details (if found in records)
  → Can report a sighting / new information
  → Gets match notifications if their report matches a body
```

## BNDF Semantic Normalization (key moat)

The hardest problem: mapping between different vocabularies used by:
- **Morgue (SEMEOF):** `"ancla brazo der."` — abbreviated, coded
- **Family report:** `"tatuaje de áncora en antebrazo derecho"` — descriptive, emotional
- **Official forms:** standardized but bureaucratic

Solution: LLM-powered normalization pipeline:
```
raw_text → LLM extract marks → map to BNDF vocabulary → embed → store
```

Example mappings:
| Source text | BNDF normalized | Body location |
|------------|-----------------|---------------|
| `"ancla brazo der."` | `tatuaje_ancla` | `antebrazo_derecho` |
| `"estrella en el hombro"` | `tatuaje_estrella` | `hombro` |
| `"cicatriz frente"` | `cicatriz` | `frente` |

## GTM Roadmap

### Phase 1 (now): Grant + pilot
- [ ] Merge hilo/ + sendero-demo/ into one repo
- [ ] Transition from synthetic to real RNPDNO data (with government permission)
- [ ] Pilot with 1 fiscalía estatal (state prosecutor)
- [ ] Apply for: US AID México, Open Society Foundations, UNODC grants
- [ ] Open-source the matching engine (attract collaborators)

### Phase 2: Government adoption
- [ ] Integrate with CNB (Comisión Nacional de Búsqueda) systems
- [ ] Multi-state deployment (start with states with most desaparecidos)
- [ ] Training program for fiscalía reviewers
- [ ] Audit trail for legal proceedings (chain of custody)

### Phase 3: LatAm expansion
- [ ] Adapt for Colombia (100K+ disappeared), Guatemala, El Salvador, Argentina
- [ ] Multi-language BNDF vocabulary mapping
- [ ] Interpol integration for cross-border cases

## Delegation Tasks for Fable

### Task 1: Merge codebases
```
Merge hilo/ (TS-only) into sendero-demo/ (TS+Python).
Keep Python backend + agents as primary.
Port any unique TS matching logic to Python.
Standardize on: FastAPI backend + React frontend + Supabase auth + Postgres.
Delete hilo/ after merge is verified.
```

### Task 2: Reviewer UI
```
Add app/src/features/reviewer/ with:
  - Candidate queue (sorted by match score)
  - Side-by-side comparison: desaparecido vs body
  - Evidence panel (which marks matched, confidence per mark)
  - Decision buttons: Confirmar / Rechazar / Más investigación
  - Audit log viewer (who decided what, when)
  - RBAC: only authorized reviewers can confirm
```

### Task 3: Real data pipeline
```
Add backend/src/features/ingest/ with:
  - RNPDNO CSV → Postgres ETL (replace db/dataset/scrapping.ts)
  - BNDF XML → Postgres ETL
  - Scheduled refresh (cron + agents/runner)
  - Data quality dashboard (missing fields, duplicates, geocoding failures)
```
