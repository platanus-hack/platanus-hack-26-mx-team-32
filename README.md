# Hilo

**Motor de *record-linkage* forense para la crisis de personas desaparecidas en México.**
Cruza fichas de búsqueda (personas desaparecidas) contra cuerpos no identificados a través de **señas particulares** (tatuajes, cicatrices, lunares…), alineado al **Banco Nacional de Datos Forenses (BNDF)** — la capa conectiva que la ley mandatizó y el Estado no ha hecho funcionar.

> **Platanus Hack 26 · Track Legacy.** Lo que faltaba no era el algoritmo: era la capa conectiva. Hilo la demuestra, de forma segura.

---

## ⚠ Ética y seguridad (requisitos de aceptación, no lineamientos)

1. **Individuos sintéticos.** Las fichas y cuerpos que el matcher cruza son **100% sintéticos**, pero con demografía **calibrada por el RNPDNO real**. Nunca se usa PII de víctimas reales (nombres, fotos, señas de personas específicas).
2. **Datos reales, pero solo agregados.** El contexto visible (conteos, tendencias, fosas) proviene de fuentes públicas: **RNPDNO** (CC0) y el **mapa de fosas clandestinas** (Quinto Elemento Lab / CNB). Sin nombres ni identidad individual.
3. **El sistema NUNCA concluye un match.** Solo propone *candidatos* con evidencia. La única vía a `confirmed` es una revisión humana.
4. **Coordenadas e identidades protegidas.** Las fosas y los usuarios viven en tablas con control de acceso por rol (RBAC). Una sesión `readonly` **no puede** leer `secure_locations`. Es estructural, no esperado.
5. **Banner "DATOS SINTÉTICOS — DEMO"** siempre visible en la UI.

---

## Arquitectura (Dual-Plane Verifier)

```
FUENTES SINTÉTICAS ─▶ INGEST/NORMALIZE ─▶ BLOCK ─▶ SCORE ─▶ VERIFY ─▶ REVISIÓN HUMANA ─▶ NOTIFY
(fichas, cuerpos)     (→ records +        (filtra)  (por campo) (evidencia +        (confirm/reject)   (lista cerrada)
                       features, tokens)              contradicciones)         ⚠ nunca concluye
                                                                                    │
                                                                       AUDIT LOG (append-only)
```

- **Ingest/normalize** (`lib/ingest/features.ts`): convierte texto libre de señas en features normalizadas con vocabulario controlado (BNDF). Determinístico; mejora a LLM cuando hay `LLM_API_KEY`.
- **Block** (`lib/match/block.ts`): corta pares con filtros baratos (estado adyacente, sexo compatible, edad solapada, regla temporal dura: `desaparición ≤ hallazgo`).
- **Score** (`lib/match/score.ts`): scoring por campo. Las señas usan: solapamiento controlado (tipo + región + motivo) + Jaccard léxico sobre tokens. **La lateralidad es un DISQUALIFIER**: izquierda vs derecha ⇒ el match queda tapado a score bajo sin importar el resto.
- **Verify** (`lib/match/verify.ts`): **segundo plano separado** que recibe el par ya puntuado y escribe evidencia + contradicciones + tier (alta/media/baja). **Ranquea para una humana; nunca declara match.** LLM cuando hay key, determinístico si no.
- **Revisión humana** (`lib/db.ts`): la ÚNICA vía a `confirmed` (escribe `reviews` + audit). Notifica a una **lista cerrada** (enlace), nunca a familia ni público.
- **Seguridad** (`lib/db.ts`): RBAC en el adaptador — `readonly` no lee `secure_locations` ni `tips`. Audit append-only.

### LLM provider-agnostic
El cliente es **OpenAI-compatible** (`lib/llm.ts`). Funciona con cualquier proveedor vía variables de entorno, y si no hay key, **todo cae a lógica determinística** — el demo corre sin ninguna dependencia externa:

```bash
export LLM_API_KEY=...        # Anthropic / OpenAI / MiniMax / DeepSeek / Qwen / Moonshot
export LLM_BASE_URL=https://api.minimax.chat/v1   # o el que uses
export LLM_MODEL=minimax-...                       # opcional
```

---

## Datos reales (capa de contexto)

Generados por `scripts/prep_data.py` desde fuentes públicas:

| Activo | Origen | Volumen |
|---|---|---|
| Desaparecidos/no-loc. | RNPDNO (Consulta Pública / datamx.io, CC0) | 84,430 (de 133,566 registros) |
| Fosas clandestinas | Quinto Elemento Lab / CNB (Mapbox dataset) | 487 sitios · 1,038 fosas · 3,187 cuerpos |
| Población municipal | lapanquecita repo (CONAPO-style) | 2,475 munis |
| Víctimas SESNSP | datos abiertos incidencia delictiva | 225K filas |

Proveniencia completa en `data/generated/provenance.json`.

**Cómo se usa el dato real:** solo agregados (conteos, tendencias, tasas, mapa de fosas) van a la UI. Las distribuciones demográficas reales (edad/sexo/estado) **calibran** el generador de individuos sintéticos para que el demo sea demográficamente realista. Los registros individuales reales **no** se muestran ni cruzan.

---

## Cómo correrlo

```bash
npm install

# 1. Generar agregados reales (Python 3, sin dependencias)
npm run prep            # scripts/prep_data.py → data/generated/

# 2. Sembrar DB (sintéticos calibrados + fosas reales + answer-key)
npm run seed            # scripts/seed.ts → hilo.db

# 3. Demo CLI end-to-end (el "wow")
npm run demo            # demo.ts

# 4. UI de revisora
npm run dev:ui          # → http://localhost:3000
```

### El momento "wow" (en orden)
1. Cae un cuerpo nuevo en vivo (ancla, antebrazo derecho, Jalisco).
2. El sistema surfacea un **candidato ranqueado** con panel side-by-side: señas ✓ · estatura ✓ · temporal coherente ✓.
3. Un **near-miss se rechaza** por contradicción de lateralidad (izquierda vs derecha) — claramente no auto-vincula.
4. La revisora confirma → audit + notificación a enlace (lista cerrada).
5. Cambias a `readonly` → **no puede leer ni una coordenada** de fosas. Seguridad demostrada.
6. Verificación contra answer-key: **10/10 true matches surfaced, 3/3 near-misses rechazados.**

---

## Estructura

```
hilo/
├── lib/
│   ├── types.ts              # modelo (espejo de schema-bndf.md)
│   ├── schema.sql            # SQLite (adaptado de schema-bndf.md, RBAC en db.ts)
│   ├── db.ts                 # adaptador SQLite + control de acceso por rol + audit
│   ├── llm.ts                # cliente LLM OpenAI-compatible (fallback determinístico)
│   ├── seedgen.ts            # generador sintético calibrado (planted matches + near-misses)
│   ├── ingest/features.ts    # extracción/normalización de señas
│   └── match/{block,score,verify}.ts
├── scripts/{prep_data.py, seed.ts}
├── app/server.js             # UI revisora (side-by-side + mapa fosas + toggle de rol)
├── demo.ts                   # runner del wow end-to-end
├── data/raw/                 # datos públicos crudos (RNPDNO, fosas, pob., SESNSP, geo)
└── data/generated/           # agregados limpios + distribuciones + answer-key + provenance
```

---

## Pitch para jueces (linea lista)

> "El BNDF fue mandatado por ley en 2017 para ser esta capa conectiva. No funciona — los datos de desaparecidos y cuerpos viven en silos incompatibles (Excel de fiscalía, WhatsApp de colectivo, ficha escaneada de SEMEFO). Hilo demuestra que la capa funciona, de forma segura: resolvemos **señas** en vocabulario controlado para que 'ancla brazo der.' (semefo) coincida con 'tatuaje de áncora en antebrazo derecho' (ficha); la lateralidad descarta near-misses; un verificador separado prioriza para revisión humana y **nunca concluye**; las coordenadas de fosas se protegen por rol. Lo demostramos sobre datos sintéticos calibrados por el RNPDNO real, porque usar víctimas reales sin consentimiento familiar es ilegal y poco ético — y eso mismo es lo que hace falta para adoptarlo con datos reales."

**Rúbrica:** Técnico (multi-agente dual-plane + record-linkage) · Ambición (capa que el Estado no construyó) · Ejecución (demo punta a punta) · Impacto (84,430 desaparecidos) · Originalidad (nadie más hace linkage forense).


#START BACKEND
  uv run uvicorn src.main:app --reload --port 8000

    Option B — activate the venv yourself (now that uv sync created it):
  source .venv/bin/activate
  uvicorn src.main:app --reload --port 8000

#START FRONTEND
    bun run dev