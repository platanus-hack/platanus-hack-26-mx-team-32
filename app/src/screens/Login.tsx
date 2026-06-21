import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { AgentDot } from '../components/AgentDot'

export function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const done = localStorage.getItem('onboarding_complete')
    if (done) {
      navigate('/home')
    } else {
      navigate('/onboarding')
    }
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

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', marginTop: 4 }}
          >
            Iniciar sesión
          </button>
        </form>

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
