import { supabase } from '../../lib/supabase'

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
