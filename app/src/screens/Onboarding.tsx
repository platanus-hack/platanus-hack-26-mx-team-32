import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, User, Shield, Bell, Loader2, Database } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { AgentDot } from '../components/AgentDot'
import { createVinculo, listPersonas, searchPersonas } from '../features/profile/api'
import { fullName, type PersonaSummary } from '../features/profile/types'
import { useTheme } from '../features/theme'
import { API_URL } from '../lib/http'

const PAGE_SIZE = 20

function personaMeta(p: PersonaSummary): string {
  return [p.sexo, p.edad_actual && `${p.edad_actual} años`, p.estado]
    .filter(Boolean)
    .join(' · ')
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 32 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? 24 : 8,
            height: 8,
            borderRadius: 40,
            background: i === current ? 'var(--color-primary)' : 'var(--divider)',
            transition: 'all 0.3s ease',
          }}
        />
      ))}
    </div>
  )
}

function PersonaRow({
  person,
  hoverBg,
  onSelect,
}: {
  person: PersonaSummary
  hoverBg: string
  onSelect: (p: PersonaSummary) => void
}) {
  return (
    <button
      onClick={() => onSelect(person)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s',
        fontFamily: 'var(--font-family)',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>{fullName(person)}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{personaMeta(person) || 'Persona desaparecida'}</div>
      </div>
      {person.id_victimadirecta ? (
        <img
          src={`${API_URL}/personas/${person.id_victimadirecta}/foto?size=96`}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden'
          }}
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            objectFit: 'cover',
            background: 'var(--color-photo-bg)',
            flexShrink: 0,
            border: '1px solid var(--surface-card-border)',
          }}
        />
      ) : (
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: 'var(--color-photo-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          border: '1px solid var(--surface-card-border)',
        }}>
          <User size={18} color="var(--color-text-secondary)" />
        </div>
      )}
    </button>
  )
}

function Step1({
  onNext,
  selected,
  onSelect,
}: {
  onNext: () => void
  selected: PersonaSummary | null
  onSelect: (p: PersonaSummary | null) => void
}) {
  const { theme } = useTheme()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PersonaSummary[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // Browse mode: paginated list of the full table. Shows on mount so the user
  // gets a feel for the size of the database.
  const [browseItems, setBrowseItems] = useState<PersonaSummary[]>([])
  const [browseOffset, setBrowseOffset] = useState(0)
  const [browseTotal, setBrowseTotal] = useState(0)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const isSearching = query.trim().length >= 2

  // Initial browse: first page when the input gains focus (so we don't fetch
  // until the user is actually going to interact with the dropdown).
  async function loadFirstPage() {
    if (browseItems.length > 0 || browseLoading) return
    setBrowseLoading(true)
    try {
      const res = await listPersonas(PAGE_SIZE, 0)
      setBrowseItems(res.items)
      setBrowseTotal(res.total)
      setBrowseOffset(res.items.length)
    } catch {
      // Soft-fail: leave the dropdown empty rather than blocking the user.
    } finally {
      setBrowseLoading(false)
    }
  }

  async function loadMore() {
    if (browseLoadingMore || browseOffset >= browseTotal) return
    setBrowseLoadingMore(true)
    try {
      const res = await listPersonas(PAGE_SIZE, browseOffset)
      setBrowseItems(prev => [...prev, ...res.items])
      setBrowseOffset(prev => prev + res.items.length)
    } catch {
      // ignore
    } finally {
      setBrowseLoadingMore(false)
    }
  }

  // Debounced real search against the RNPDNO dataset.
  useEffect(() => {
    if (selected) return
    if (!isSearching) {
      void Promise.resolve().then(() => {
        setSearchResults([])
        setSearchLoading(false)
      })
      return
    }
    let active = true
    void Promise.resolve().then(() => setSearchLoading(true))
    const t = setTimeout(async () => {
      try {
        const res = await searchPersonas(query.trim())
        if (active) setSearchResults(res.items)
      } catch {
        if (active) setSearchResults([])
      } finally {
        if (active) setSearchLoading(false)
      }
    }, 250)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [query, selected, isSearching])

  function handleSelect(person: PersonaSummary) {
    onSelect(person)
    setQuery(fullName(person))
    setDropdownOpen(false)
  }

  const hoverBg = theme === 'dark' ? 'rgba(242,146,29,0.10)' : 'rgba(242,146,29,0.06)'

  // What the dropdown should show right now.
  const showBrowse = !isSearching
  const visibleItems = showBrowse ? browseItems : searchResults
  const isLoading = showBrowse ? browseLoading : searchLoading
  const canLoadMore = showBrowse && !browseLoadingMore && browseOffset < browseTotal

  return (
    <div className="anim-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      <AgentDot size={60} pulse className="mb-6" />

      <h2 style={{ fontSize: 22, fontWeight: 500, textAlign: 'center', color: 'var(--color-text-primary)', marginBottom: 12, letterSpacing: '-0.015em' }}>
        Tu búsqueda tiene un aliado
      </h2>
      <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center', lineHeight: 1.65, marginBottom: 28, textWrap: 'pretty' as const }}>
        Este sistema analiza información de cientos de reportes para encontrar pistas del paradero de tus seres queridos. No estás sola en esto.
      </p>

      <div style={{ width: '100%', position: 'relative', marginBottom: 12 }}>
        <label
          htmlFor="busqueda"
          style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}
        >
          Agrega a un familiar desaparecido
        </label>
        <div style={{ position: 'relative' }}>
          <input
            id="busqueda"
            type="text"
            className="glass-input"
            value={query}
            onChange={e => { setQuery(e.target.value); onSelect(null); setDropdownOpen(true) }}
            onFocus={() => { setDropdownOpen(true); void loadFirstPage() }}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            onKeyDown={e => { if (e.key === 'Escape') setDropdownOpen(false) }}
            placeholder="Busca por nombre o apellido..."
            autoComplete="off"
          />
          <Search size={16} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
        </div>

        {dropdownOpen && !selected && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 50,
              marginTop: 4,
              background: 'var(--color-bg)',
              border: '1px solid var(--surface-card-border)',
              borderRadius: 12,
              maxHeight: 320,
              overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            }}
          >
            {/* Header: shows whether we're browsing the full DB or filtering. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 14px',
                borderBottom: '1px solid var(--surface-card-border)',
                background: showBrowse ? 'rgba(242,146,29,0.06)' : 'transparent',
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              {showBrowse ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    <Database size={12} color="var(--color-primary)" />
                    <span>Base de datos</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {browseTotal > 0 ? `${browseItems.length.toLocaleString('es-MX')} / ${browseTotal.toLocaleString('es-MX')}` : 'Cargando…'}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {searchLoading ? 'Buscando…' : `${searchResults.length.toLocaleString('es-MX')} resultado${searchResults.length === 1 ? '' : 's'}`}
                </span>
              )}
            </div>

            {isLoading && visibleItems.length === 0 && (
              <div style={{ padding: '20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--color-text-secondary)', fontSize: 12 }}>
                <Loader2 size={14} className="anim-breath" color="var(--color-primary)" />
                <span>{showBrowse ? 'Cargando base de datos…' : 'Buscando…'}</span>
              </div>
            )}

            {!isLoading && visibleItems.length === 0 && (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 12 }}>
                {showBrowse
                  ? 'Aún no hay fichas disponibles.'
                  : `Sin resultados para “${query.trim()}”.`}
              </div>
            )}

            {visibleItems.map(person => (
              <PersonaRow key={person.id} person={person} hoverBg={hoverBg} onSelect={handleSelect} />
            ))}

            {showBrowse && canLoadMore && (
              <button
                onMouseDown={e => e.preventDefault() /* don't blur the input */}
                onClick={() => void loadMore()}
                disabled={browseLoadingMore}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderTop: '1px solid var(--surface-card-border)',
                  color: 'var(--color-primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: browseLoadingMore ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  fontFamily: 'var(--font-family)',
                }}
              >
                {browseLoadingMore ? (
                  <>
                    <Loader2 size={12} className="anim-breath" />
                    <span>Cargando…</span>
                  </>
                ) : (
                  <span>Ver más ({browseTotal - browseOffset} restantes)</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      <button
        className="btn-text"
        style={{ alignSelf: 'flex-start', marginBottom: 24, textDecoration: 'none', fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 500 }}
      >
        + Agregar
      </button>

      <button
        className="btn-primary"
        style={{ width: '100%', opacity: selected ? 1 : 0.5 }}
        onClick={onNext}
        disabled={!selected}
      >
        Siguiente
      </button>
    </div>
  )
}

function Step2({ onNext }: { onNext: () => void }) {
  return (
    <div className="anim-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      <div style={{
        width: 60,
        height: 60,
        borderRadius: '50%',
        background: 'rgba(242,146,29,0.12)',
        border: '1px solid rgba(242,146,29,0.30)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
      }}>
        <Shield size={28} color="var(--color-primary)" />
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 500, textAlign: 'center', color: 'var(--color-text-primary)', marginBottom: 12, letterSpacing: '-0.015em' }}>
        Tu información está protegida
      </h2>
      <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center', lineHeight: 1.65, marginBottom: 20, textWrap: 'pretty' as const }}>
        Los datos que registras son confidenciales y solo son utilizados para cruzar reportes con bases de datos oficiales. Tu nombre no es visible para otros usuarios.
      </p>

      <GlassCard
        className="w-full"
        style={{ padding: '16px 20px', marginBottom: 28 }}
      >
        {[
          'Los datos se cruzan con registros del RNPDNO',
          'La IA analiza señas particulares para encontrar coincidencias',
          'Solo tú tienes acceso a los detalles del perfil',
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: i < 2 ? 12 : 0 }}>
            <div style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'rgba(242,146,29,0.15)',
              border: '1px solid rgba(242,146,29,0.30)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: 1,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-primary)' }} />
            </div>
            <span style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.55 }}>{item}</span>
          </div>
        ))}
      </GlassCard>

      <button className="btn-primary" style={{ width: '100%' }} onClick={onNext}>
        Siguiente
      </button>
    </div>
  )
}

function Step3({
  onFinish,
  saving,
  error,
}: {
  onFinish: () => void
  saving: boolean
  error: string | null
}) {
  return (
    <div className="anim-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      <div style={{
        width: 60,
        height: 60,
        borderRadius: '50%',
        background: 'rgba(242,146,29,0.12)',
        border: '1px solid rgba(242,146,29,0.30)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
      }}>
        <Bell size={28} color="var(--color-primary)" />
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 500, textAlign: 'center', color: 'var(--color-text-primary)', marginBottom: 12, letterSpacing: '-0.015em' }}>
        Recibe alertas del agente
      </h2>
      <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center', lineHeight: 1.65, marginBottom: 28, textWrap: 'pretty' as const }}>
        El agente IA monitoreará de forma continua los nuevos reportes y te notificará cuando encuentre coincidencias con el perfil que registraste. Estarás al tanto de cualquier avance.
      </p>

      <div style={{
        width: '100%',
        padding: '18px 20px',
        borderRadius: 16,
        background: 'rgba(242,146,29,0.06)',
        border: '1px solid rgba(242,146,29,0.22)',
        marginBottom: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        <AgentDot size={36} pulse />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Agente IA activado</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>Monitoreando 847 reportes activos en Michoacán</div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: 'var(--color-error)', marginBottom: 12, textAlign: 'center' }}>⚠ {error}</p>
      )}

      <button
        className="btn-primary"
        style={{ width: '100%', opacity: saving ? 0.7 : 1 }}
        onClick={onFinish}
        disabled={saving}
      >
        {saving ? 'Vinculando…' : 'Comenzar búsqueda'}
      </button>
    </div>
  )
}

export function Onboarding() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<PersonaSummary | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const TOTAL = 3

  async function finish() {
    setError(null)
    if (selected?.id_victimadirecta) {
      setSaving(true)
      try {
        await createVinculo(selected.id_victimadirecta)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo crear el vínculo')
        setSaving(false)
        return
      }
    }
    localStorage.setItem('onboarding_complete', '1')
    navigate('/home')
  }

  const pageBg = theme === 'dark'
    ? 'linear-gradient(160deg, #0d0d0d 0%, #141414 40%, rgba(242,146,29,0.05) 70%, rgba(242,146,29,0.10) 100%)'
    : 'linear-gradient(160deg, #FDFAF7 0%, #F2E3D5 40%, rgba(242,195,133,0.5) 70%, rgba(242,146,29,0.22) 100%)'

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: pageBg }}
    >
      {/* Ambient aura */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(242,146,29,0.10) 0%, transparent 68%)',
          top: '5%',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />

      <GlassCard
        strong
        className="w-full z-10"
        style={{ maxWidth: 440, padding: '36px 40px', margin: '0 16px' }}
      >
        <StepDots current={step} total={TOTAL} />

        {step === 0 && <Step1 onNext={() => setStep(1)} selected={selected} onSelect={setSelected} />}
        {step === 1 && <Step2 onNext={() => setStep(2)} />}
        {step === 2 && <Step3 onFinish={finish} saving={saving} error={error} />}
      </GlassCard>
    </div>
  )
}
