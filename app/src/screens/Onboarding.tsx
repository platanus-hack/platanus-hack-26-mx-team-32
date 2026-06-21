import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, User, Shield, Bell } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { AgentDot } from '../components/AgentDot'
import { createVinculo, searchPersonas } from '../features/profile/api'
import { fullName, type PersonaSummary } from '../features/profile/types'

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
            background: i === current ? '#F2921D' : 'rgba(242,146,29,0.25)',
            transition: 'all 0.3s ease',
          }}
        />
      ))}
    </div>
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
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonaSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Debounced real search against the RNPDNO dataset (matches name + apellidos).
  useEffect(() => {
    const term = query.trim()
    if (selected || term.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await searchPersonas(term)
        if (active) setResults(res.items)
      } catch {
        if (active) setResults([])
      } finally {
        if (active) setLoading(false)
      }
    }, 250)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [query, selected])

  function handleSelect(person: PersonaSummary) {
    onSelect(person)
    setQuery(fullName(person))
    setDropdownOpen(false)
  }

  return (
    <div className="anim-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      <AgentDot size={60} pulse className="mb-6" />

      <h2 style={{ fontSize: 22, fontWeight: 500, textAlign: 'center', color: '#1A1A1A', marginBottom: 12, letterSpacing: '-0.015em' }}>
        Tu búsqueda tiene un aliado
      </h2>
      <p style={{ fontSize: 15, color: '#6B6B6B', textAlign: 'center', lineHeight: 1.65, marginBottom: 28, textWrap: 'pretty' as 'pretty' }}>
        Este sistema analiza información de cientos de reportes para encontrar pistas del paradero de tus seres queridos. No estás sola en esto.
      </p>

      <div style={{ width: '100%', position: 'relative', marginBottom: 12 }}>
        <label
          htmlFor="busqueda"
          style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B6B6B', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}
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
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            onKeyDown={e => { if (e.key === 'Escape') setDropdownOpen(false) }}
            placeholder="Escribe el nombre..."
            autoComplete="off"
          />
          <Search size={16} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#6B6B6B', pointerEvents: 'none' }} />
        </div>

        {dropdownOpen && !selected && (loading || results.length > 0) && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 50,
              marginTop: 4,
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(242,195,133,0.5)',
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            }}
          >
            {loading && results.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 13, color: '#6B6B6B' }}>Buscando…</div>
            )}
            {results.map(person => (
              <button
                key={person.id}
                onClick={() => handleSelect(person)}
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
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(242,146,29,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: '#F2E3D5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <User size={18} color="#6B6B6B" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#1A1A1A' }}>{fullName(person)}</div>
                  <div style={{ fontSize: 12, color: '#6B6B6B' }}>{personaMeta(person) || 'Persona desaparecida'}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        className="btn-text"
        style={{ alignSelf: 'flex-start', marginBottom: 24, textDecoration: 'none', fontSize: 14, color: '#1A1A1A', fontWeight: 500 }}
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
        <Shield size={28} color="#F2921D" />
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 500, textAlign: 'center', color: '#1A1A1A', marginBottom: 12, letterSpacing: '-0.015em' }}>
        Tu información está protegida
      </h2>
      <p style={{ fontSize: 15, color: '#6B6B6B', textAlign: 'center', lineHeight: 1.65, marginBottom: 20, textWrap: 'pretty' as 'pretty' }}>
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
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F2921D' }} />
            </div>
            <span style={{ fontSize: 13, color: '#1A1A1A', lineHeight: 1.55 }}>{item}</span>
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
        <Bell size={28} color="#F2921D" />
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 500, textAlign: 'center', color: '#1A1A1A', marginBottom: 12, letterSpacing: '-0.015em' }}>
        Recibe alertas del agente
      </h2>
      <p style={{ fontSize: 15, color: '#6B6B6B', textAlign: 'center', lineHeight: 1.65, marginBottom: 28, textWrap: 'pretty' as 'pretty' }}>
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
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>Agente IA activado</div>
          <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 2 }}>Monitoreando 847 reportes activos en Michoacán</div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: '#c0392b', marginBottom: 12, textAlign: 'center' }}>⚠ {error}</p>
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

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #FDFAF7 0%, #F2E3D5 40%, rgba(242,195,133,0.5) 70%, rgba(242,146,29,0.22) 100%)' }}
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
