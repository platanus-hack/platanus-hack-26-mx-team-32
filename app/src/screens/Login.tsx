import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { AgentDot } from '../components/AgentDot'
import { signInWithEmail, signInWithGoogle, useSession } from '../features/auth'

export function Login() {
  const navigate = useNavigate()
  const { session, loading } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Once authenticated (email or Google OAuth redirect), route onward.
  useEffect(() => {
    if (!session) return
    const done = localStorage.getItem('onboarding_complete')
    navigate(done ? '/home' : '/onboarding', { replace: true })
  }, [session, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await signInWithEmail(email, password)
    if (error) setError(error.message)
    setBusy(false)
    // success → onAuthStateChange updates `session` → effect navigates
  }

  async function handleGoogle() {
    setError(null)
    const { error } = await signInWithGoogle()
    if (error) setError(error.message)
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #FDFAF7 0%, #F2E3D5 40%, rgba(242,195,133,0.5) 70%, rgba(242,146,29,0.22) 100%)' }}
    >
      {/* Ambient aura blobs */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(242,146,29,0.10) 0%, transparent 68%)',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,232,80,0.07) 0%, transparent 68%)',
          bottom: '5%',
          right: '20%',
        }}
      />

      {/* Logo */}
      <div className="flex flex-col items-center mb-8 z-10">
        <div className="flex items-center gap-3 mb-1">
          <AgentDot size={26} pulse />
          <span
            style={{
              fontFamily: 'var(--font-family)',
              fontSize: 22,
              fontWeight: 600,
              color: '#1A1A1A',
              letterSpacing: '-0.02em',
            }}
          >
            Sendero
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: '#F2921D',
          }}
        >
          Plataforma de búsqueda
        </span>
      </div>

      {/* Card */}
      <GlassCard
        strong
        className="w-full z-10"
        style={{ maxWidth: 400, padding: 40, margin: '0 16px' }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: '#1A1A1A',
            marginBottom: 6,
            letterSpacing: '-0.015em',
          }}
        >
          Bienvenida
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B6B', marginBottom: 28 }}>
          Inicia sesión para continuar tu búsqueda
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label
              htmlFor="email"
              style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B6B6B', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              className="glass-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B6B6B', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              Contraseña
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPass ? 'text' : 'password'}
                className="glass-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6B6B6B',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0,
                }}
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: '#c0392b', margin: 0 }}>⚠ {error}</p>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={busy || loading}
            style={{ width: '100%', marginTop: 4, opacity: busy || loading ? 0.7 : 1 }}
          >
            {busy ? 'Entrando…' : 'Iniciar sesión'}
          </button>
        </form>

        {/* divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.10)' }} />
          <span style={{ fontSize: 12, color: '#6B6B6B' }}>o</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.10)' }} />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="glass-input"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            cursor: 'pointer',
            fontWeight: 600,
            color: '#1A1A1A',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          Continuar con Google
        </button>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: '#6B6B6B' }}>
          ¿Primera vez aquí?{' '}
          <button
            className="btn-text"
            onClick={() => navigate('/onboarding')}
            style={{ fontSize: 14 }}
          >
            Crear cuenta
          </button>
        </p>
      </GlassCard>
    </div>
  )
}
