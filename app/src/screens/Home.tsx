import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserCircle, MessageCircle, X, Send, MapPin, Calendar, Clock, Plus, Image, LogOut } from 'lucide-react'
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF, Circle, MarkerClustererF } from '@react-google-maps/api'
import { GlassCard } from '../components/GlassCard'
import { AgentDot } from '../components/AgentDot'
import { ChatDrawer } from '../components/ChatDrawer'
import { getMyVinculo } from '../features/profile/api'
import { fullName, type VinculoOut } from '../features/profile/types'
import { fetchPersonsOnMap, type PersonOnMap } from '../features/landing/api'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' }
const MAP_CENTER = { lat: 19.5665, lng: -101.7068 }
const MAP_ZOOM = 8

const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'all', elementType: 'labels.text', stylers: [{ color: '#878787' }] },
  { featureType: 'all', elementType: 'labels.text.stroke', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'all', stylers: [{ color: '#f9f5ed' }] },
  { featureType: 'road.highway', elementType: 'all', stylers: [{ color: '#f5f5f5' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#c9c9c9' }] },
  { featureType: 'water', elementType: 'all', stylers: [{ color: '#aee0f4' }] },
]

const CLUSTER_ICON_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="rgba(220,38,38,0.5)"/></svg>`
)

type FilterKey = 'fosas' | 'desaparicion' | 'trabajos'

const FILTER_LABELS: Record<FilterKey, string> = {
  fosas: 'Posibles fosas',
  desaparicion: 'Puntos de desaparición',
  trabajos: 'Puntos de encuentro trabajos falsos',
}

const MARKER_COLORS: Record<FilterKey, string> = {
  fosas: '#3B82F6',
  desaparicion: '#EF4444',
  trabajos: '#F97316',
}

const CHIP_COLORS: Record<FilterKey, { activeBg: string; activeText: string; activeBorder: string }> = {
  fosas: { activeBg: '#DBEAFE', activeText: '#1D4ED8', activeBorder: '#93C5FD' },
  desaparicion: { activeBg: '#FEE2E2', activeText: '#DC2626', activeBorder: '#FCA5A5' },
  trabajos: { activeBg: '#FFEDD5', activeText: '#C2410C', activeBorder: '#FDBA74' },
}

interface StaticMarker {
  id: number
  lat: number
  lng: number
  type: 'fosas' | 'trabajos'
  name: string
  date: string
}

const STATIC_MARKERS: StaticMarker[] = [
  { id: 1, lat: 19.74, lng: -101.19, type: 'fosas', name: 'Cerro de la Garza, Zamora', date: '14 feb 2024' },
  { id: 2, lat: 19.50, lng: -102.08, type: 'fosas', name: 'Rancho El Nance, Apatzingán', date: '3 ene 2024' },
  { id: 3, lat: 19.31, lng: -101.96, type: 'fosas', name: 'Camino Aguililla-Buenavista', date: '27 nov 2023' },
  { id: 6, lat: 19.56, lng: -101.70, type: 'trabajos', name: 'Oferta Tlalpujahua – Pátzcuaro', date: '18 abr 2024' },
]

function dotIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="${color}" opacity="0.9" stroke="white" stroke-width="1.5"/></svg>`
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(14, 14),
    anchor: new google.maps.Point(7, 7),
  }
}

function personDotIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#EF4444" opacity="0.9" stroke="white" stroke-width="1"/></svg>`
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(12, 12),
    anchor: new google.maps.Point(6, 6),
  }
}

interface MapProps {
  staticMarkers: StaticMarker[]
  persons: PersonOnMap[]
  showPersons: boolean
  filters: Record<FilterKey, boolean>
}

function Map({ staticMarkers, persons, showPersons, filters }: MapProps) {
  const [selectedStatic, setSelectedStatic] = useState<StaticMarker | null>(null)
  const personIcon = useMemo(() => personDotIcon(), [])

  const fosaMarkers = staticMarkers.filter(m => m.type === 'fosas' && filters.fosas)
  const trabajosMarkers = staticMarkers.filter(m => m.type === 'trabajos' && filters.trabajos)

  return (
    <GoogleMap
      mapContainerStyle={MAP_CONTAINER_STYLE}
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      options={{
        styles: MAP_STYLE,
        fullscreenControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        zoomControl: true,
      }}
      onClick={() => setSelectedStatic(null)}
    >
      {fosaMarkers.map(m => (
        <Circle
          key={`area-${m.id}`}
          center={{ lat: m.lat, lng: m.lng }}
          radius={6000}
          options={{
            fillColor: '#3B82F6',
            fillOpacity: 0.18,
            strokeColor: '#3B82F6',
            strokeOpacity: 0.5,
            strokeWeight: 1.5,
            clickable: true,
          }}
          onClick={() => setSelectedStatic(m)}
        />
      ))}

      {trabajosMarkers.map(m => (
        <MarkerF
          key={m.id}
          position={{ lat: m.lat, lng: m.lng }}
          icon={dotIcon(MARKER_COLORS.trabajos)}
          onClick={() => setSelectedStatic(m)}
        />
      ))}

      {selectedStatic && (
        <InfoWindowF
          position={{ lat: selectedStatic.lat, lng: selectedStatic.lng }}
          onCloseClick={() => setSelectedStatic(null)}
        >
          <div style={{ fontFamily: 'var(--font-family)', minWidth: 160 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{selectedStatic.name}</div>
            <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 4 }}>{FILTER_LABELS[selectedStatic.type]}</div>
            <div style={{ fontSize: 11, color: MARKER_COLORS[selectedStatic.type], fontWeight: 500 }}>{selectedStatic.date}</div>
          </div>
        </InfoWindowF>
      )}

      {showPersons && persons.length > 0 && (
        <MarkerClustererF
          options={{
            maxZoom: 14,
            gridSize: 10,
            minimumClusterSize: 5,
            styles: [{
              textColor: '#fff',
              textSize: 13,
              url: CLUSTER_ICON_URL,
              height: 44,
              width: 44,
            }],
          }}
        >
          {(clusterer) => (
            <>
              {persons.map(p => (
                <MarkerF
                  key={p.id}
                  clusterer={clusterer}
                  position={{ lat: p.lat, lng: p.lng }}
                  icon={personIcon}
                />
              ))}
            </>
          )}
        </MarkerClustererF>
      )}
    </GoogleMap>
  )
}

// ── Modales de evidencia y chat ───────────────────────────────────────────────

interface ChatMsg { id: number; from: 'me' | 'other'; text: string }

const INITIAL_CHAT: ChatMsg[] = [
  { id: 1, from: 'other', text: 'Hola, encontré estas pertenencias cerca del mercado de Zamora. ¿Coinciden con algo del caso que buscas?' },
  { id: 2, from: 'me',    text: 'Sí, la mochila negra coincide con la descripción. ¿Podrías decirme exactamente dónde la encontraste?' },
  { id: 3, from: 'other', text: 'Fue en la calle Morelos, a una cuadra del parque. Las dejé en resguardo con la Cruz Roja local.' },
]

function ChatSimModal({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(INITIAL_CHAT)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  function send() {
    const text = input.trim()
    if (!text) return
    setMsgs(prev => [...prev, { id: Date.now(), from: 'me', text }])
    setInput('')
    setTimeout(() => {
      setMsgs(prev => [...prev, {
        id: Date.now() + 1,
        from: 'other',
        text: 'Gracias por tu mensaje. Te responderé en cuanto pueda.',
      }])
    }, 1200)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass-strong anim-fade-in" style={{ width: '100%', maxWidth: 420, borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(242,195,133,0.25)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1A1A' }}>Buscadora caso #849</div>
            <div style={{ fontSize: 11, color: '#6B6B6B', marginTop: 3 }}>Los datos personales de este usuario están ocultos por seguridad</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6B6B', padding: 2, flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {msgs.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.from === 'me' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '75%',
                padding: '9px 13px',
                borderRadius: m.from === 'me' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: m.from === 'me' ? '#F2921D' : 'rgba(255,255,255,0.80)',
                color: m.from === 'me' ? '#fff' : '#1A1A1A',
                fontSize: 13,
                lineHeight: 1.5,
                border: m.from === 'other' ? '1px solid rgba(242,195,133,0.3)' : 'none',
              }}>
                {m.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(242,195,133,0.2)', display: 'flex', gap: 8, background: 'rgba(255,255,255,0.6)' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }}
            placeholder="Escribe un mensaje…"
            style={{
              flex: 1,
              padding: '9px 14px',
              borderRadius: 40,
              border: '1px solid rgba(242,195,133,0.4)',
              background: 'rgba(255,255,255,0.85)',
              fontSize: 13,
              fontFamily: 'var(--font-family)',
              outline: 'none',
              color: '#1A1A1A',
            }}
          />
          <button
            onClick={send}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: '#F2921D', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Send size={16} color="#fff" />
          </button>
        </div>
      </div>
    </div>
  )
}

function EvidenceModal({ onClose }: { onClose: () => void }) {
  const [desc, setDesc] = useState(
    'Se encontraron pertenencias similares a las descritas en el caso: una mochila negra con correas naranjas, un morral color vino y una bolsa tipo duffle. Halladas en calle Morelos, col. Centro, Zamora, el 18 de junio de 2024. Actualmente en resguardo con Cruz Roja local.'
  )
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.40)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <div className="glass-strong anim-fade-in" style={{ width: '100%', maxWidth: 480, borderRadius: 20, overflow: 'hidden', maxHeight: '90vh', overflowY: 'auto' }}>
          {/* Header */}
          <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid rgba(242,195,133,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#1A1A1A' }}>Información de caso similar</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6B6B', padding: 2 }}>
              <X size={20} />
            </button>
          </div>

          <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Foto */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 8 }}>
                Evidencia fotográfica
              </label>
              <img
                src="/evidencia.jpg"
                alt="Evidencia fotográfica"
                style={{ width: '100%', borderRadius: 12, objectFit: 'cover', maxHeight: 280, display: 'block', border: '1px solid rgba(242,195,133,0.3)' }}
              />

              {/* Metadatos del hallazgo */}
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { icon: <MapPin size={14} color="#F2921D" />, label: 'Calle Morelos s/n, col. Centro, Zamora, Mich.' },
                  { icon: <Calendar size={14} color="#F2921D" />, label: '18 de junio de 2024' },
                  { icon: <Clock size={14} color="#F2921D" />, label: '14:35 hrs' },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ fontSize: 12, color: '#4B4B4B' }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Descripción */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 8 }}>
                Descripción del hallazgo
              </label>
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                className="glass-input"
                style={{ minHeight: 100, resize: 'vertical', lineHeight: 1.6, fontSize: 13 }}
              />
            </div>

            {/* CTA */}
            <button
              className="btn-primary"
              style={{ width: '100%', padding: '12px', fontSize: 14 }}
              onClick={() => setChatOpen(true)}
            >
              Contactar a buscadora
            </button>
          </div>
        </div>
      </div>

      {chatOpen && <ChatSimModal onClose={() => setChatOpen(false)} />}
    </>
  )
}

// ── Modal Subir Evidencia ─────────────────────────────────────────────────────

function UploadEvidenceModal({ onClose }: { onClose: () => void }) {
  const [desc, setDesc] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.40)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass-strong anim-fade-in" style={{ width: '100%', maxWidth: 480, borderRadius: 20, overflow: 'hidden', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid rgba(242,195,133,0.2)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1A1A1A', marginBottom: 4 }}>Subir evidencia</div>
            <div style={{ fontSize: 12, color: '#6B6B6B', lineHeight: 1.5, maxWidth: 360 }}>
              En este espacio puedes subir evidencia de algún hallazgo que pudiera dar una pista sobre el paradero de una persona desaparecida.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6B6B', padding: 2, flexShrink: 0 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Foto */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 8 }}>
              Evidencia fotográfica
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: '28px 20px',
                borderRadius: 12,
                border: '2px dashed rgba(242,146,29,0.4)',
                background: 'rgba(242,195,133,0.06)',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <Image size={28} color="#F2921D" strokeWidth={1.5} />
              <span style={{ fontSize: 13, color: '#6B6B6B', textAlign: 'center' }}>
                {fileName ?? 'Haz clic para seleccionar una foto'}
              </span>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => setFileName(e.target.files?.[0]?.name ?? null)}
              />
            </label>
          </div>

          {/* Descripción */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 8 }}>
              Descripción del hallazgo
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              className="glass-input"
              placeholder="Describe qué encontraste, dónde y cuándo…"
              style={{ minHeight: 120, resize: 'vertical', lineHeight: 1.6, fontSize: 13 }}
            />
          </div>

          <button className="btn-primary" style={{ width: '100%', padding: '12px', fontSize: 14 }} onClick={onClose}>
            Enviar evidencia
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Notificaciones ────────────────────────────────────────────────────────────

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
  const [persons, setPersons] = useState<PersonOnMap[]>([])
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  })

  useEffect(() => {
    getMyVinculo().then(setVinculo).catch(() => setVinculo(null))
    fetchPersonsOnMap().then(setPersons).catch(() => setPersons([]))
  }, [])

  const chatReady = !!vinculo?.chat_unlocked && !!vinculo?.persona

  function toggleFilter(key: FilterKey) {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col"
      style={{
        backgroundImage: 'url(/bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
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
          justifyContent: 'space-between',
          padding: '0 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AgentDot size={22} pulse />
          <span style={{ fontSize: 16, fontWeight: 600, color: '#1A1A1A', letterSpacing: '-0.01em' }}>
            Sendero
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => {
              localStorage.removeItem('onboarding_complete')
              navigate('/login')
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#6B6B6B', fontSize: 13, fontFamily: 'var(--font-family)' }}
          >
            <LogOut size={16} />
            Cerrar sesión
          </button>
          <button
            onClick={() => navigate('/profile')}
            aria-label="Ir al perfil"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
          >
            <UserCircle size={28} color="#F2921D" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Mapa — 70% de la altura de la pantalla */}
        <div style={{ display: 'flex', gap: 12, height: '70vh' }}>
          {/* Sidebar filtros */}
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
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#6B6B6B' }}>
              Filtros del agente
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(Object.keys(FILTER_LABELS) as FilterKey[]).map(key => {
                const c = CHIP_COLORS[key]
                return (
                  <button
                    key={key}
                    onClick={() => toggleFilter(key)}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 40,
                      fontSize: 12,
                      fontWeight: filters[key] ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontFamily: 'var(--font-family)',
                      textAlign: 'left',
                      background: filters[key] ? c.activeBg : 'rgba(255,255,255,0.65)',
                      color: filters[key] ? c.activeText : '#6B6B6B',
                      border: `1px solid ${filters[key] ? c.activeBorder : 'rgba(200,200,200,0.3)'}`,
                    }}
                  >
                    {FILTER_LABELS[key]}
                  </button>
                )
              })}
            </div>
          </GlassCard>

          {/* Mapa */}
          <div style={{ flex: 1, position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(242,195,133,0.35)' }}>
            {isLoaded ? (
              <Map
                staticMarkers={STATIC_MARKERS}
                persons={persons}
                showPersons={filters.desaparicion}
                filters={filters}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9f5ed' }}>
                <span style={{ color: '#6B6B6B', fontSize: 13 }}>Cargando mapa…</span>
              </div>
            )}

            {/* Leyenda */}
            <div style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 1000,
              background: 'rgba(255,255,255,0.90)',
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
                  <div style={{
                    width: key === 'fosas' ? 12 : 8,
                    height: key === 'fosas' ? 12 : 8,
                    borderRadius: '50%',
                    background: key === 'fosas' ? 'rgba(59,130,246,0.25)' : MARKER_COLORS[key],
                    border: key === 'fosas' ? '1.5px solid #3B82F6' : 'none',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 10, color: '#6B6B6B', fontFamily: 'var(--font-family)' }}>{FILTER_LABELS[key]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Notificaciones + AI Summary */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto', width: 'min(100%, 55%)', minWidth: 280, display: 'flex', flexDirection: 'column' }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#6B6B6B', marginBottom: 8 }}>
              Notificaciones recientes
            </p>
            <button className="btn-primary" style={{ padding: '6px 16px', fontSize: 12, marginBottom: 12, alignSelf: 'flex-start' }}>
              Buscar coincidencias
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {NOTIFICATIONS.map(n => (
                <div
                  key={n.id}
                  className="glass"
                  style={{
                    padding: '14px 18px',
                    borderLeft: '3px solid #F2921D',
                    borderRadius: '0 16px 16px 0',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 2 }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: 13, color: '#6B6B6B', lineHeight: 1.55 }}>
                      {n.desc}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{n.time}</span>
                    <button
                      className="btn-ghost"
                      style={{ padding: '5px 14px', fontSize: 12, color: 'var(--color-primary)' }}
                      onClick={() => setEvidenceOpen(true)}
                    >
                      Ver detalle →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
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

            <GlassCard strong style={{ padding: 0, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
              <div style={{
                padding: '18px 22px 14px',
                borderBottom: '1px solid rgba(242,195,133,0.18)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#1A1A1A' }}>
                  Análisis del agente IA
                </span>
              </div>

              <div style={{ padding: '18px 22px', background: 'rgba(242,227,213,0.22)' }}>
                <p style={{ fontSize: 14, color: '#1A1A1A', lineHeight: 1.70, marginBottom: 18, textWrap: 'pretty' as 'pretty' }}>
                  Con base en los 12 reportes cruzados esta semana, la zona noreste del estado de Michoacán — particularmente los municipios de Zamora y Jacona — muestra la mayor concentración de coincidencias. Se han identificado 3 posibles fosas en un radio de 8 km y 2 puntos de desaparición reportados en los últimos 30 días con características similares al perfil registrado.
                </p>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#6B6B6B' }}>Nivel de confianza del análisis</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#F2921D' }}>78%</span>
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

              <div style={{
                padding: '11px 22px',
                background: 'rgba(242,195,133,0.07)',
                borderTop: '1px solid rgba(242,195,133,0.18)',
              }}>
                <span style={{ fontSize: 11, color: '#6B6B6B' }}>Última actualización: hace 14 minutos</span>
              </div>
            </GlassCard>
          </div>
        </div>
      </main>

      {/* Botón flotante Subir evidencia */}
      <button
        onClick={() => setUploadOpen(true)}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 240,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 20px',
          borderRadius: 40,
          background: 'linear-gradient(135deg, #F2921D, #DD6B20)',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(242,146,29,0.40)',
          color: '#fff',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: 'var(--font-family)',
        }}
      >
        <Plus size={18} color="#fff" />
        Subir evidencia
      </button>

      {chatReady && !chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          aria-label="Abrir chat del caso"
          style={{
            position: 'fixed',
            right: 18,
            bottom: 80,
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
          <MessageCircle size={24} color="#fff" />
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

      {uploadOpen && <UploadEvidenceModal onClose={() => setUploadOpen(false)} />}
      {evidenceOpen && <EvidenceModal onClose={() => setEvidenceOpen(false)} />}

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
