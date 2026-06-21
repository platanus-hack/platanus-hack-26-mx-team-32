import { useNavigate } from 'react-router-dom'
import { UserCircle, LogOut, Moon, Sun } from 'lucide-react'
import { AgentDot } from './AgentDot'
import { useTheme } from '../features/theme'
import { signOut } from '../features/auth'

interface AppHeaderProps {
  /** Optional left-side node to render before the brand (e.g. a back button). */
  leftExtra?: React.ReactNode
  /** Hide the profile avatar (e.g. on the profile page itself). */
  hideProfile?: boolean
}

export function AppHeader({ leftExtra, hideProfile = false }: AppHeaderProps) {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: 58,
        background: 'var(--glass-bg-strong)',
        backdropFilter: 'var(--glass-blur-strong)',
        WebkitBackdropFilter: 'var(--glass-blur-strong)',
        borderBottom: '1px solid var(--glass-border-strong)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {leftExtra}
        <AgentDot size={22} pulse />
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          Sendero
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          onClick={toggle}
          aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
          style={{
            background: 'none',
            border: '1px solid var(--glass-border)',
            borderRadius: '50%',
            width: 34,
            height: 34,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary)',
            transition: 'all 0.2s',
          }}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <button
          onClick={async () => {
            await signOut()
            localStorage.removeItem('onboarding_complete')
            localStorage.removeItem('selected_persona')
            navigate('/login')
          }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: 13, fontFamily: 'var(--font-family)' }}
        >
          <LogOut size={16} />
          Cerrar sesión
        </button>
        {!hideProfile && (
          <button
            onClick={() => navigate('/profile')}
            aria-label="Ir al perfil"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
          >
            <UserCircle size={28} color="var(--color-primary)" />
          </button>
        )}
      </div>
    </header>
  )
}
