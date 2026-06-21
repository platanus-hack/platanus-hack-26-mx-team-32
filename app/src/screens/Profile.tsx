import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Eye, X, Info, ArrowLeft, LogOut } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { getMyVinculo } from '../features/profile/api'
import { fullName, type PersonaDetail, type VinculoOut } from '../features/profile/types'
import { API_URL } from '../lib/http'
import { supabase } from '../lib/supabase'

function fotoUrl(p: PersonaDetail): string | null {
  return p.id_victimadirecta ? `${API_URL}/personas/${p.id_victimadirecta}/foto?size=320` : null
}

/** Round photo with graceful fallback to a User icon. */
function PersonaPhoto({ persona, size }: { persona: PersonaDetail; size: number }) {
  const [err, setErr] = useState(false)
  const url = fotoUrl(persona)
  if (!url || err) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: '#F2E3D5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <User size={size * 0.45} color="#6B6B6B" />
      </div>
    )
  }
  return (
    <img
      src={url}
      onError={() => setErr(true)}
      alt=""
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#F2E3D5' }}
    />
  )
}

/** A labeled value cell (hidden when empty). */
function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B6B6B', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: '#1A1A1A', lineHeight: 1.4, whiteSpace: 'pre-line' }}>{value}</div>
    </div>
  )
}

const sectionStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.55)',
  border: '1px solid rgba(242,195,133,0.30)',
  borderRadius: 14,
  padding: '14px 16px',
  marginBottom: 12,
}
const LABELS: Record<string, string> = {
  sexo: 'Sexo',
  fecha_nacimiento: 'Fecha de nacimiento',
  edad_actual: 'Edad actual',
  edad_hechos: 'Edad al desaparecer',
  nacionalidad: 'Nacionalidad',
  estado_nacimiento: 'Estado de nacimiento',
  lugar_nacimiento: 'Lugar de nacimiento',
  habla_espaniol: 'Habla español',
  estatus_victima: 'Estatus',
  fecha_hechos: 'Fecha de hechos',
  fecha_percato: 'Fecha de percato',
  estado: 'Estado',
  municipio: 'Municipio',
  nombre_asentamiento: 'Asentamiento',
  calle: 'Calle',
  no_exterior: 'No. exterior',
  no_interior: 'No. interior',
  codigo_postal: 'Código postal',
  estado_hecho: 'Estado (del hecho)',
  municipio_hecho: 'Municipio (del hecho)',
  tiene_discapacidad: 'Discapacidad',
  tipo_discapacidad: 'Tipo de discapacidad',
  prendas_de_vestir: 'Prendas de vestir',
  dependencia_origen: 'Dependencia de origen',
}

const SECTIONS: { title: string; color: string; keys: string[] }[] = [
  { title: 'Datos generales', color: '#DD6B20', keys: ['sexo', 'fecha_nacimiento', 'edad_actual', 'edad_hechos', 'nacionalidad', 'estado_nacimiento', 'lugar_nacimiento', 'habla_espaniol'] },
  { title: 'Desaparición', color: '#C53030', keys: ['estatus_victima', 'fecha_hechos', 'fecha_percato', 'estado', 'municipio', 'nombre_asentamiento', 'calle', 'no_exterior', 'no_interior', 'codigo_postal', 'estado_hecho', 'municipio_hecho'] },
  { title: 'Otros datos', color: '#B7791F', keys: ['prendas_de_vestir', 'tiene_discapacidad', 'tipo_discapacidad', 'dependencia_origen'] },
]

// Internal ids, duplicates, blobs and flags never shown in the catch-all.
const HIDDEN = new Set<string>([
  'id', 'id_victimadirecta', 'id_reporte', 'id_dependencia_origen', 'id_vinculacion',
  'estatus_victimadirecta_num', 'publicar_ficha_num', 'fotografia', 'ffecha_hechos',
  'ffecha_percato', 'archivo_migracion', 'fecha_captura', 'pertenencia_dependencia_origen',
  'pertenencia_por_canalizacion', 'cantidad_registros', 'imagen', 'latitud', 'longitud',
  'inicio', 'solo_busqueda', 'publicar_ficha', 'edad_anios', 'edad_meses', 'edad_dias',
  'nombre', 'primer_apellido', 'segundo_apellido', 'media_filiacion', 'sana_particular',
])

function clean(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s || s.toUpperCase() === 'SIN DATO' || s.toLowerCase() === 'null') return null
  return s
}

function parseList(raw: string | null): string[] {
  return (raw || '').split('<br>').map(s => s.trim()).filter(Boolean).filter(s => s.toUpperCase() !== 'NINGUNA')
}

function parseFiliacion(raw: string | null): [string, string][] {
  const out: [string, string][] = []
  for (const part of (raw || '').split('<br>')) {
    const i = part.indexOf(':')
    if (i > 0) {
      const k = part.slice(0, i).trim()
      const v = part.slice(i + 1).trim()
      if (k && v) out.push([k, v])
    }
  }
  return out
}

function prettify(key: string): string {
  return LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Parse the literal Y-M-D[ H:M] parts (no timezone conversion) into es-MX text. */
function formatDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(raw)
  if (!m) return raw
  const [, y, mo, d, h, mi] = m
  const monthName = MESES[Number(mo) - 1] ?? mo
  const base = `${Number(d)} de ${monthName} de ${y}`
  if (h != null && !(h === '00' && mi === '00')) return `${base}, ${h}:${mi}`
  return base
}

/** Humanize a cleaned value: booleans → Sí/No, dates → readable. */
function formatValue(key: string, value: string): string {
  const low = value.toLowerCase()
  if (low === 'true') return 'Sí'
  if (low === 'false') return 'No'
  if (key.includes('fecha')) return formatDate(value)
  // <br>-delimited blobs (e.g. prendas_de_vestir) → real line breaks
  return value.replace(/<br\s*\/?>/gi, '\n')
}

/**
 * The stored `imagen` data URIs are malformed: the declared MIME is wrong
 * (says png, bytes are jpeg) and many contain stray whitespace after `base64,`,
 * which makes the browser reject them. Strip whitespace and set the MIME from
 * the actual magic bytes (/9j/ = JPEG, iVBOR = PNG).
 */
function fixDataUri(raw: string | null): string | null {
  if (!raw) return null
  const comma = raw.indexOf(',')
  if (comma < 0) return null
  const b64 = raw.slice(comma + 1).replace(/\s/g, '')
  if (!b64) return null
  const mime = b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${b64}`
}

// Colored tag per section title — adds a bit of color to the modal.
function SectionTitle({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color,
        background: color + '18',
        border: `1px solid ${color}55`,
        padding: '4px 10px',
        borderRadius: 40,
        marginBottom: 12,
      }}
    >
      {children}
    </span>
  )
}

type Row = Record<string, unknown>

function Modal({ personaVictimaId, onClose }: { personaVictimaId: string; onClose: () => void }) {
  const [row, setRow] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    let on = true
    supabase
      .from('personas_desaparecidas')
      .select('*')
      .eq('id_victimadirecta', personaVictimaId)
      .maybeSingle()
      .then(({ data }) => {
        if (!on) return
        setRow(data as Row | null)
        setLoading(false)
      })
    return () => { on = false }
  }, [personaVictimaId])

  const imagen = fixDataUri(row ? clean(row.imagen) : null)
  const senas = row ? parseList(clean(row.sana_particular)) : []
  const filiacion = row ? parseFiliacion(clean(row.media_filiacion)) : []
  const shownInSections = new Set(SECTIONS.flatMap(s => s.keys))
  const name = row
    ? [clean(row.nombre), clean(row.primer_apellido), clean(row.segundo_apellido)].filter(Boolean).join(' ') || 'Sin nombre'
    : ''

  function renderFields(keys: string[]) {
    const fields = keys.map(k => [k, row ? clean(row[k]) : null] as const).filter(([, v]) => v)
    if (fields.length === 0) return null
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px 16px' }}>
        {fields.map(([k, v]) => <Field key={k} label={prettify(k)} value={formatValue(k, v!)} />)}
      </div>
    )
  }

  const otrosKeys = row
    ? Object.keys(row).filter(k => !HIDDEN.has(k) && !shownInSections.has(k) && clean(row[k]))
    : []

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass-strong anim-fade-in" style={{ maxWidth: 760, width: '100%', padding: 28, position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
        <button onClick={onClose} aria-label="Cerrar" style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#6B6B6B', display: 'flex', padding: 4 }}>
          <X size={20} />
        </button>

        {loading ? (
          <p style={{ fontSize: 14, color: '#6B6B6B', padding: '24px 0', textAlign: 'center' }}>Cargando información…</p>
        ) : !row ? (
          <p style={{ fontSize: 14, color: '#6B6B6B', padding: '24px 0', textAlign: 'center' }}>No se encontró la información.</p>
        ) : (
          <>
            {/* Header with the person's real photo */}
            <div style={{ display: 'flex', gap: 18, marginBottom: 20 }}>
              {imagen && !imgError ? (
                <img src={imagen} alt="" onError={() => setImgError(true)} style={{ width: 110, height: 138, objectFit: 'cover', borderRadius: 12, flexShrink: 0, background: '#F2E3D5' }} />
              ) : (
                <div style={{ width: 110, height: 138, borderRadius: 12, background: '#F2E3D5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <User size={44} color="#6B6B6B" />
                </div>
              )}
              <div style={{ minWidth: 0, paddingTop: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: '#1A1A1A', lineHeight: 1.25 }}>{name}</div>
                {clean(row.fecha_hechos) && (
                  <div style={{ fontSize: 13, color: '#6B6B6B', marginTop: 6 }}>Desaparecido el {formatDate(clean(row.fecha_hechos)!)}</div>
                )}
                {clean(row.estatus_victima) && (
                  <span style={{ display: 'inline-block', marginTop: 10, padding: '3px 10px', borderRadius: 40, background: 'rgba(242,146,29,0.12)', border: '1px solid rgba(242,146,29,0.35)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#9A5B12' }}>
                    {clean(row.estatus_victima)}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
            {SECTIONS.map(sec => {
              const content = renderFields(sec.keys)
              if (!content) return null
              return (
                <div key={sec.title} style={sectionStyle}>
                  <SectionTitle color={sec.color}>{sec.title}</SectionTitle>
                  {content}
                </div>
              )
            })}

            {filiacion.length > 0 && (
              <div style={sectionStyle}>
                <SectionTitle color="#2B6CB0">Media filiación</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px 16px' }}>
                  {filiacion.map(([k, v]) => <Field key={k} label={k} value={v} />)}
                </div>
              </div>
            )}

            {senas.length > 0 && (
              <div style={sectionStyle}>
                <SectionTitle color="#2F855A">Señas particulares</SectionTitle>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {senas.map((s, i) => (
                    <span key={i} style={{ padding: '5px 11px', borderRadius: 40, background: 'rgba(242,146,29,0.10)', border: '1px solid rgba(242,146,29,0.28)', fontSize: 12, color: '#9A5B12' }}>{s}</span>
                  ))}
                </div>
              </div>
            )}

            {otrosKeys.length > 0 && (
              <div style={sectionStyle}>
                <SectionTitle color="#805AD5">Información adicional</SectionTitle>
                {renderFields(otrosKeys)}
              </div>
            )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function Profile() {
  const navigate = useNavigate()
  const [modalOpen, setModalOpen] = useState(false)
  const [vinculo, setVinculo] = useState<VinculoOut | null>(null)

  useEffect(() => {
    getMyVinculo().then(setVinculo).catch(() => setVinculo(null))
  }, [])

  const persona = vinculo?.persona ?? null

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: 'linear-gradient(160deg, #FDFAF7 0%, #F2E3D5 45%, rgba(242,195,133,0.35) 100%)' }}
    >
      {/* Navbar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          height: 58,
          background: 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(242,195,133,0.35)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          gap: 12,
        }}
      >
        <button
          onClick={() => navigate('/home')}
          aria-label="Volver"
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6B6B6B' }}
        >
          <ArrowLeft size={20} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 500, color: '#1A1A1A' }}>Mi perfil</span>

        <button
          onClick={() => {
            localStorage.removeItem('onboarding_complete')
            navigate('/login')
          }}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#6B6B6B', fontSize: 13, fontFamily: 'var(--font-family)' }}
        >
          <LogOut size={16} />
          Cerrar sesión
        </button>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '32px 16px 40px' }}>

        {/* Section 1: Identity */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          {/* Avatar */}
          <div style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: '#F2C185',
            color: '#2D2D2D',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            fontWeight: 600,
            fontFamily: 'var(--font-family)',
            marginBottom: 12,
          }}>
            MG
          </div>

          <div style={{ fontSize: 18, fontWeight: 500, color: '#1A1A1A', marginBottom: 10 }}>
            María González
          </div>

          {/* Privacy pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 40,
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(242,195,133,0.4)',
          }}>
            <Info size={13} color="#6B6B6B" />
            <span style={{ fontSize: 12, color: '#6B6B6B' }}>
              Tu nombre no es visible para otros usuarios en la plataforma.
            </span>
          </div>
        </div>

        {/* Section 2: Familiares */}
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#6B6B6B', marginBottom: 14, letterSpacing: '-0.005em' }}>
            Familiares buscados
          </p>

          <GlassCard style={{ padding: '16px 20px' }}>
            {persona ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <PersonaPhoto persona={persona} size={48} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#1A1A1A' }}>{fullName(persona)}</div>
                  {persona.fecha_hechos && (
                    <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 3 }}>
                      Desaparecido el {formatDate(persona.fecha_hechos)}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setModalOpen(true)}
                  aria-label="Ver información del familiar"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', color: '#F2921D', borderRadius: 8, transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(242,146,29,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <Eye size={20} color="#F2921D" />
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#6B6B6B' }}>
                Aún no has vinculado a un familiar.
              </div>
            )}
          </GlassCard>
        </div>

      </main>

      {modalOpen && vinculo?.persona && (
        <Modal personaVictimaId={vinculo.vinculo.persona_victima_id} onClose={() => setModalOpen(false)} />
      )}
    </div>
  )
}
