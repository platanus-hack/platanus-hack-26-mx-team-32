import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserCircle, Home as HomeIcon, User, MessageCircle } from 'lucide-react'
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF } from '@react-google-maps/api'
import { GlassCard } from '../components/GlassCard'
import { AgentDot } from '../components/AgentDot'
import { ChatDrawer } from '../components/ChatDrawer'
import { getMyVinculo } from '../features/profile/api'
import { fullName, type VinculoOut } from '../features/profile/types'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' }
const MAP_CENTER = { lat: 19.5665, lng: -101.7068 }
const MAP_ZOOM = 8

type FilterKey = 'fosas' | 'desaparicion' | 'trabajos'

const FILTER_LABELS: Record<FilterKey, string> = {
  fosas: 'Posibles fosas',
  desaparicion: 'Puntos de desaparición',
  trabajos: 'Puntos de encuentro trabajos falsos',
}

const MARKER_COLORS: Record<FilterKey, string> = {
  fosas: '#C53030',
  desaparicion: '#F2921D',
  trabajos: '#DD6B20',
}

interface MarkerData {
  id: number
  lat: number
  lng: number
  type: FilterKey
  name: string
  date: string
}

const MARKERS: MarkerData[] = [
  { id: 1, lat: 19.74, lng: -101.19, type: 'fosas', name: 'Cerro de la Garza, Zamora', date: '14 feb 2024' },
  { id: 2, lat: 19.50, lng: -102.08, type: 'fosas', name: 'Rancho El Nance, Apatzingán', date: '3 ene 2024' },
  { id: 3, lat: 19.31, lng: -101.96, type: 'fosas', name: 'Camino Aguililla-Buenavista', date: '27 nov 2023' },
  { id: 4, lat: 19.72, lng: -101.20, type: 'desaparicion', name: 'Centro Histórico, Zamora', date: '20 mar 2024' },
  { id: 5, lat: 19.68, lng: -101.15, type: 'desaparicion', name: 'Blvd. Luis Donaldo Colosio, Jacona', date: '12 mar 2023' },
  { id: 6, lat: 19.56, lng: -101.70, type: 'trabajos', name: 'Oferta Tlalpujahua – Pátzcuaro', date: '18 abr 2024' },
]

function pinIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z" fill="${color}" opacity="0.9"/><circle cx="12" cy="12" r="5" fill="white" opacity="0.9"/></svg>`
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(24, 36),
    anchor: new google.maps.Point(12, 36),
  }
}

function Map({ markers }: { markers: MarkerData[] }) {
  const [selected, setSelected] = useState<MarkerData | null>(null)

  return (
    <GoogleMap
      mapContainerStyle={MAP_CONTAINER_STYLE}
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
    >
      {markers.map(m => (
        <MarkerF
          key={m.id}
          position={{ lat: m.lat, lng: m.lng }}
          icon={pinIcon(MARKER_COLORS[m.type])}
          onClick={() => setSelected(m)}
        />
      ))}
      {selected && (
        <InfoWindowF
          position={{ lat: selected.lat, lng: selected.lng }}
          onCloseClick={() => setSelected(null)}
        >
          <div style={{ fontFamily: 'var(--font-family)', minWidth: 160 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{selected.name}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{FILTER_LABELS[selected.type]}</div>
            <div style={{ fontSize: 11, color: 'var(--color-primary)', fontWeight: 500 }}>{selected.date}</div>
          </div>
        </InfoWindowF>
      )}
    </GoogleMap>
  )
}

const NOTIFICATIONS = [
  {
    id: 1,
    title: 'Nueva coincidencia detectada',
    desc: 'Un reporte en Morelia coincide con la descripción física registrada en el perfil.',
    time: 'hace 23 min',
  },
  {
    id: 2,
    title: 'Alerta zona noreste',
    desc: 'Se identificaron 2 nuevos puntos de interés en Zamora con características similares.',
    time: 'hace 1 h',
  },
  {
    id: 3,
    title: 'Cruce de señas confirmado',
    desc: 'Las señas particulares del reporte #4821 presentan un 82% de coincidencia con el perfil.',
    time: 'hace 3 h',
  },
  {
    id: 4,
    title: 'Nuevo registro disponible',
    desc: 'El RNPDNO publicó 14 nuevos registros para Michoacán. El agente los está analizando.',
    time: 'ayer',
  },
]

export function Home() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    fosas: true,
    desaparicion: true,
    trabajos: true,
  })
  const [vinculo, setVinculo] = useState<VinculoOut | null>(null)
  const [chatOpen, setChatOpen] = useState(false)

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  })

  // Case chat becomes available once another family joins/updates the case.
  useEffect(() => {
    getMyVinculo().then(setVinculo).catch(() => setVinculo(null))
  }, [])

  const chatReady = !!vinculo?.chat_unlocked && !!vinculo?.persona

  function toggleFilter(key: FilterKey) {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const visibleMarkers = MARKERS.filter(m => filters[m.type])

  return (
    <div
      className="min-h-screen w-full flex flex-col"
      style={{ background: 'var(--page-gradient)' }}
    >
      {/* Navbar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          height: 58,
          background: 'var(--glass-bg-strong)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--glass-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AgentDot size={22} pulse />
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
            Rastro de Luz
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Agent status pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: 'rgba(242,146,29,0.08)',
            border: '1px solid rgba(242,146,29,0.2)',
            borderRadius: 40,
            padding: '5px 11px',
          }}>
            <div
              className="anim-breath"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'radial-gradient(circle, #F5E850 0%, #F2921D 100%)',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>Agente activo</span>
          </div>

          <button
            onClick={() => navigate('/profile')}
            aria-label="Ir al perfil"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
          >
            <UserCircle size={28} color="var(--color-primary)" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, padding: '16px 16px 80px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Row 1: Map + sidebar */}
        <div
          className="map-row"
          style={{ display: 'flex', gap: 12, height: 'clamp(280px, 50vh, 420px)' }}
        >
          {/* Left sidebar */}
          <GlassCard
            className="hidden md:flex"
            style={{
              width: 192,
              flexShrink: 0,
              padding: '16px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
              Filtros del agente
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(Object.keys(FILTER_LABELS) as FilterKey[]).map(key => (
                <button
                  key={key}
                  onClick={() => toggleFilter(key)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 40,
                    fontSize: 12,
                    fontWeight: filters[key] ? 500 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'var(--font-family)',
                    textAlign: 'left',
                    background: filters[key] ? '#F2921D' : 'rgba(255,255,255,0.65)',
                    color: filters[key] ? '#2D2D2D' : '#6B6B6B',
                    border: filters[key] ? 'none' : '1px solid rgba(242,195,133,0.3)',
                  }}
                >
                  {FILTER_LABELS[key]}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(242,195,133,0.25)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AgentDot size={8} breath />
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Agente activo</span>
            </div>
          </GlassCard>

          {/* Map */}
          <div style={{ flex: 1, position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--glass-border-strong)' }}>
            {isLoaded ? (
              <Map markers={visibleMarkers} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>Cargando mapa…</span>
              </div>
            )}

            {/* Map legend */}
            <div style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 1000,
              background: 'var(--glass-bg-strong)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(242,195,133,0.4)',
              borderRadius: 12,
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}>
              {(Object.keys(FILTER_LABELS) as FilterKey[]).map(key => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: MARKER_COLORS[key], flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family)' }}>{FILTER_LABELS[key]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile filter chips (below map on small screens) */}
        <div
          className="md:hidden"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          {(Object.keys(FILTER_LABELS) as FilterKey[]).map(key => (
            <button
              key={key}
              onClick={() => toggleFilter(key)}
              style={{
                padding: '6px 14px',
                borderRadius: 40,
                fontSize: 12,
                fontWeight: filters[key] ? 500 : 400,
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontFamily: 'var(--font-family)',
                background: filters[key] ? '#F2921D' : 'rgba(255,255,255,0.65)',
                color: filters[key] ? '#2D2D2D' : '#6B6B6B',
                border: filters[key] ? 'none' : '1px solid rgba(242,195,133,0.3)',
              }}
            >
              {FILTER_LABELS[key]}
            </button>
          ))}
        </div>

        {/* Row 2: Notifications + AI Summary */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {/* Left: Notifications */}
          <div style={{ flex: '0 0 auto', width: 'min(100%, 55%)', minWidth: 280 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
              Notificaciones recientes
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {NOTIFICATIONS.map(n => (
                <div
                  key={n.id}
                  className="glass"
                  style={{
                    padding: '14px 18px',
                    borderLeft: '3px solid var(--color-primary)',
                    borderRadius: '0 16px 16px 0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                    <AgentDot size={20} pulse style={{ marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                        {n.title}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                        {n.desc}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{n.time}</span>
                    <button className="btn-ghost" style={{ padding: '5px 14px', fontSize: 12, color: 'var(--color-primary)' }}>
                      Ver detalle →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: AI Summary */}
          <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
            {/* Aura glow */}
            <div
              className="absolute pointer-events-none"
              style={{
                width: '120%',
                height: '120%',
                top: '-10%',
                left: '-10%',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(242,146,29,0.10) 0%, transparent 68%)',
                zIndex: 0,
              }}
            />

            <GlassCard
              strong
              style={{ padding: 0, overflow: 'hidden', position: 'relative', zIndex: 1 }}
            >
              {/* Header */}
              <div style={{
                padding: '18px 22px 14px',
                borderBottom: '1px solid var(--divider)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <AgentDot size={28} pulse />
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  Análisis del agente IA
                </span>

                {/* AI match badge */}
                <div style={{
                  marginLeft: 'auto',
                  padding: '4px 10px',
                  borderRadius: 40,
                  background: 'linear-gradient(rgba(245,232,80,0.14), rgba(242,146,29,0.14))',
                  border: '1px solid rgba(242,146,29,0.38)',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}>
                  Coincidencia IA
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: '18px 22px', background: 'var(--surface-card)' }}>
                <p style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.70, marginBottom: 18, textWrap: 'pretty' as 'pretty' }}>
                  Con base en los 12 reportes cruzados esta semana, la zona noreste del estado de Michoacán — particularmente los municipios de Zamora y Jacona — muestra la mayor concentración de coincidencias. Se han identificado 3 posibles fosas en un radio de 8 km y 2 puntos de desaparición reportados en los últimos 30 días con características similares al perfil registrado.
                </p>

                {/* Confidence bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Nivel de confianza del análisis</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)' }}>78%</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 40, background: 'rgba(242,195,133,0.30)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: '78%',
                        background: 'linear-gradient(90deg, #F2C185, #F2921D)',
                        borderRadius: 40,
                        animation: 'confFill 1.3s ease-out forwards',
                        ['--conf-width' as string]: '78%',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{
                padding: '11px 22px',
                background: 'var(--surface-card)',
                borderTop: '1px solid var(--divider)',
              }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Última actualización: hace 14 minutos</span>
              </div>
            </GlassCard>
          </div>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 200,
          height: 60,
          background: 'var(--glass-bg-strong)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid var(--glass-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
        }}
      >
        <button
          onClick={() => navigate('/home')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: 'var(--color-primary)' }}
        >
          <HomeIcon size={22} color="var(--color-primary)" />
          <span style={{ fontSize: 10, fontFamily: 'var(--font-family)', color: 'var(--color-primary)', fontWeight: 500 }}>Inicio</span>
        </button>
        <button
          onClick={() => navigate('/profile')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
        >
          <User size={22} color="var(--color-text-secondary)" />
          <span style={{ fontSize: 10, fontFamily: 'var(--font-family)', color: 'var(--color-text-secondary)' }}>Perfil</span>
        </button>
      </nav>

      {/* Case-chat bubble — only once the chat has been unlocked */}
      {chatReady && !chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          aria-label="Abrir chat del caso"
          style={{
            position: 'fixed',
            right: 18,
            bottom: 76,
            zIndex: 250,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(145deg, #F2921D, #DD6B20)',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(242,146,29,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MessageCircle size={24} color="#ffffff" />
          {/* presence dot */}
          <span
            className="anim-breath"
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#F5E850',
              border: '2px solid #fff',
            }}
          />
        </button>
      )}

      {chatReady && vinculo?.persona && (
        <ChatDrawer
          personaVictimaId={vinculo.vinculo.persona_victima_id}
          personaNombre={fullName(vinculo.persona)}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  )
}
