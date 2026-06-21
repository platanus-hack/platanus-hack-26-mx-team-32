import { supabase } from '../../lib/supabase'

// ── Geocoding centroids ──
// Kept in sync with `coordFor` in `app/server.ts`. social_risk_events stores
// estado/municipio as free text (no lat/lng), so we resolve to known
// municipio hotspots first, then fall back to the state centroid. Events whose
// locality matches neither table are dropped from the fosas layer rather than
// rendered at a misleading location.
const MUNI_COORDS: Record<string, [number, number]> = {
  'CULIACÁN': [24.81, -107.39], 'MAZATLÁN': [23.25, -106.41], 'TIJUANA': [32.51, -117.04],
  'REYNOSA': [26.09, -98.29], 'NUEVO LAREDO': [27.49, -99.51], 'MATAMOROS': [25.87, -97.50],
  'ACAPULCO DE JUÁREZ': [16.85, -99.82], 'NEZAHUALCÓYOTL': [19.40, -99.01], 'ECATEPEC': [19.60, -99.05],
  'TOLUCA': [19.28, -99.66], 'GUADALAJARA': [20.66, -103.35], 'ZAPOPAN': [20.72, -103.40],
  'MORELIA': [19.70, -101.18], 'URUAPAN': [19.41, -102.05], 'LAZARO CARDENAS': [17.96, -102.19],
  'LÁZARO CÁRDENAS': [17.96, -102.19], 'IGUALA': [18.35, -99.54], 'TLAQUEPAQUE': [20.64, -103.29],
  'TLAJOMULCO': [20.47, -103.45], 'SAN MATEO ATENCO': [19.27, -99.60],
}
const STATE_COORDS: Record<string, [number, number]> = {
  'SINALOA': [24.7, -107.4], 'BAJA CALIFORNIA': [30.0, -115.2], 'TAMAULIPAS': [24.8, -98.4],
  'GUERRERO': [17.6, -99.9], 'ESTADO DE MÉXICO': [19.5, -99.6], 'JALISCO': [20.3, -103.5],
  'MICHOACÁN': [19.2, -101.8], 'CHIHUAHUA': [28.4, -106.3], 'CIUDAD DE MÉXICO': [19.4, -99.1],
  'GUANAJUATO': [21.0, -101.3], 'VERACRUZ': [19.2, -96.7], 'PUEBLA': [19.0, -97.9],
}

function coordFor(estado: string | null, municipio: string | null): [number, number] | null {
  const m = municipio ? MUNI_COORDS[municipio.toUpperCase().trim()] : undefined
  if (m && m[0] !== 0) return m
  const s = estado ? STATE_COORDS[estado.toUpperCase().trim()] : undefined
  return s ?? null
}

function tryParseJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export interface PersonOnMap {
  id: number
  id_victimadirecta: string | null
  nombre: string | null
  primer_apellido: string | null
  segundo_apellido: string | null
  edad_actual: number | null
  edad_hechos: number | null
  estado: string | null
  municipio: string | null
  fecha_hechos: string | null
  estatus_victima: string | null
  lat: number
  lng: number
}

const COLUMNS = [
  'id',
  'id_victimadirecta',
  'nombre',
  'primer_apellido',
  'segundo_apellido',
  'edad_actual',
  'edad_hechos',
  'estado',
  'municipio',
  'fecha_hechos',
  'estatus_victima',
  'latitud',
  'longitud',
].join(',')

export async function fetchPersonsOnMap(): Promise<PersonOnMap[]> {
  const { data, error } = await supabase
    .from('personas_desaparecidas')
    .select(COLUMNS)
    .not('latitud', 'is', null)
    .not('longitud', 'is', null)

  if (error) throw error
  const rows = ((data || []) as unknown) as Array<Record<string, unknown>>
  return rows.map(row => ({
    id: row.id as number,
    id_victimadirecta: (row.id_victimadirecta as string) ?? null,
    nombre: row.nombre as string | null,
    primer_apellido: row.primer_apellido as string | null,
    segundo_apellido: row.segundo_apellido as string | null,
    edad_actual: row.edad_actual as number | null,
    edad_hechos: row.edad_hechos as number | null,
    estado: row.estado as string | null,
    municipio: row.municipio as string | null,
    fecha_hechos: row.fecha_hechos as string | null,
    estatus_victima: row.estatus_victima as string | null,
    lat: row.latitud as number,
    lng: row.longitud as number,
  }))
}

export interface PersonDetail {
  id: number
  imagen: string | null
  sexo: string | null
  nacionalidad: string | null
  fecha_nacimiento: string | null
  lugar_nacimiento: string | null
  sana_particular: string | null
  media_filiacion: string | null
  prendas_de_vestir: string | null
  tiene_discapacidad: boolean | null
  tipo_discapacidad: string | null
  municipio_hecho: string | null
  estado_hecho: string | null
  habla_espaniol: boolean | null
}

export function parseSenas(raw: string | null): string[] {
  const items = (raw || '').split('<br>').map(s => s.trim()).filter(Boolean)
  return items.filter(s => s.toUpperCase() !== 'NINGUNA')
}

export function parseFiliacion(raw: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (raw || '').split('<br>')) {
    if (part.includes(':')) {
      const [key, ...rest] = part.split(':')
      const value = rest.join(':').trim()
      if (key.trim() && value) out[key.trim()] = value
    }
  }
  return out
}

export async function fetchPersonDetail(id: number): Promise<PersonDetail> {
  const { data, error } = await supabase
    .from('personas_desaparecidas')
    .select('*')
    .eq('id', id)
    .limit(1)

  if (error) throw error
  const row = ((data?.[0] || null) as unknown) as Record<string, unknown> | null
  if (!row) throw new Error('Persona no encontrada')

  return {
    id: row.id as number,
    imagen: row.imagen as string | null,
    sexo: row.sexo as string | null,
    nacionalidad: row.nacionalidad as string | null,
    fecha_nacimiento: row.fecha_nacimiento as string | null,
    lugar_nacimiento: row.lugar_nacimiento as string | null,
    sana_particular: row.sana_particular as string | null,
    media_filiacion: row.media_filiacion as string | null,
    prendas_de_vestir: row.prendas_de_vestir as string | null,
    tiene_discapacidad: row.tiene_discapacidad as boolean | null,
    tipo_discapacidad: row.tipo_discapacidad as string | null,
    municipio_hecho: row.municipio_hecho as string | null,
    estado_hecho: row.estado_hecho as string | null,
    habla_espaniol: row.habla_espaniol as boolean | null,
  }
}

const FOSA_EVENT_TYPES = new Set(['fosa_clandestina', 'hallazgo_restos'])

export interface FosaOnMap {
  id: string
  lat: number
  lng: number
  event_type: string
  estado: string | null
  municipio: string | null
  summary: string | null
  confidence: number | null
  severity: number | null
  reported_at: string | null
}

export async function fetchFosasOnMap(): Promise<FosaOnMap[]> {
  const { data, error } = await supabase
    .from('social_risk_events')
    .select('id,event_type,estado,municipio,summary_public,confidence,severity,reported_at,evidence_json')
    .order('reported_at', { ascending: false })
    .limit(500)

  if (error) throw error
  const rows = ((data || []) as unknown) as Array<Record<string, unknown>>

  const fosas: FosaOnMap[] = []
  for (const row of rows) {
    const eventType = (row.event_type as string) ?? ''
    const evidence = tryParseJson(row.evidence_json)
    const originalType = evidence.original_event_type as string | undefined
    const isFosa =
      FOSA_EVENT_TYPES.has(eventType) ||
      (eventType === 'otro' && originalType != null && FOSA_EVENT_TYPES.has(originalType))
    if (!isFosa) continue

    const estado = (row.estado as string | null) ?? null
    const municipio = (row.municipio as string | null) ?? null
    const estadoPrimary = (estado ?? '').split(',')[0].trim() || null
    const municipioPrimary = (municipio ?? '').split(',')[0].trim() || null
    const coords = coordFor(estadoPrimary, municipioPrimary)
    if (!coords) continue

    fosas.push({
      id: String(row.id),
      lat: coords[0],
      lng: coords[1],
      event_type: originalType ?? eventType,
      estado,
      municipio,
      summary: (row.summary_public as string | null) ?? null,
      confidence: (row.confidence as number | null) ?? null,
      severity: (row.severity as number | null) ?? null,
      reported_at: (row.reported_at as string | null) ?? null,
    })
  }
  return fosas
}

export interface FakeJobOnMap {
  id: string
  lat: number
  lng: number
  post_url: string | null
  summary: string | null
  tone_keywords: string[]
  location_text: string | null
  location_region: string | null
  is_fake_job: boolean | null
  reported_at: string | null
}

export async function fetchFakeJobsOnMap(): Promise<FakeJobOnMap[]> {
  const { data, error } = await supabase
    .from('facebook_patterns')
    .select('id,post_url,tone_description,tone_keywords,location_text,location_region,location_latitude,location_longitude,is_fake_job,scraped_at,post_date')
    .order('scraped_at', { ascending: false })
    .limit(500)

  if (error) throw error
  const rows = ((data || []) as unknown) as Array<Record<string, unknown>>
  const result: FakeJobOnMap[] = []
  for (const row of rows) {
    let lat = (row.location_latitude as number | null) ?? null
    let lng = (row.location_longitude as number | null) ?? null
    if (lat == null || lng == null) {
      const coords = coordFor(row.location_region as string | null, null)
      if (!coords) continue
      ;[lat, lng] = [coords[0], coords[1]]
    }
    result.push({
      id: String(row.id),
      lat,
      lng,
      post_url: (row.post_url as string | null) ?? null,
      summary: (row.tone_description as string | null) ?? null,
      tone_keywords: Array.isArray(row.tone_keywords) ? (row.tone_keywords as string[]) : [],
      location_text: (row.location_text as string | null) ?? null,
      location_region: (row.location_region as string | null) ?? null,
      is_fake_job: (row.is_fake_job as boolean | null) ?? null,
      reported_at: (row.scraped_at as string | null) ?? (row.post_date as string | null) ?? null,
    })
  }
  return result
}

// Compatibility name used by the map layer copy in Home.
export async function fetchTrabajosOnMap(): Promise<FakeJobOnMap[]> {
  return fetchFakeJobsOnMap()
}
