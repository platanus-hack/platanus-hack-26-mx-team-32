import { useState, useEffect, useMemo, useRef } from 'react'
import { MessageCircle, X, Send, MapPin, Calendar, Clock, Plus, Image, User, Loader2 } from 'lucide-react'
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF, Circle } from '@react-google-maps/api'
import { MarkerClusterer, GridAlgorithm } from '@googlemaps/markerclusterer'
import { GlassCard } from '../components/GlassCard'
import { AppHeader } from '../components/AppHeader'
import { ChatDrawer } from '../components/ChatDrawer'
import { NewsAnalysisWidget } from '../components/NewsAnalysisWidget'
import { useTheme } from '../features/theme'
import { getMyVinculo } from '../features/profile/api'
import { fullName, type PersonaSummary, type VinculoOut } from '../features/profile/types'
import { fetchPersonDetail, fetchPersonsOnMap, parseFiliacion, parseSenas, type PersonDetail, type PersonOnMap } from '../features/landing/api'
import { addMexicoBorders } from '../lib/mexico-borders'
import { matchPreview, notifyMatch } from '../features/matching/api'
import type { PreviewCandidate } from '../features/matching/types'
import { useNotifications } from '../features/notifications'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' }
const MAP_CENTER = { lat: 19.5665, lng: -101.7068 }
const MAP_ZOOM = 8

const MAP_STYLE_LIGHT: google.maps.MapTypeStyle[] = [
  { featureType: 'all', elementType: 'labels.text', stylers: [{ color: '#878787' }] },
  { featureType: 'all', elementType: 'labels.text.stroke', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'all', stylers: [{ color: '#f9f5ed' }] },
  { featureType: 'road.highway', elementType: 'all', stylers: [{ color: '#f5f5f5' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#c9c9c9' }] },
  { featureType: 'water', elementType: 'all', stylers: [{ color: '#aee0f4' }] },
]

const MAP_STYLE_DARK: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#757575' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#181818' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { featureType: 'poi.park', elementType: 'labels.text.stroke', stylers: [{ color: '#1b1b1b' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#373737' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c3c3c' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry', stylers: [{ color: '#4e4e4e' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d3d3d' }] },
]

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

function dotIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="#EF4444" opacity="0.9"/></svg>`
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(22, 22),
    anchor: new google.maps.Point(11, 11),
  }
}

function personDotIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#EF4444" opacity="0.9"/></svg>`
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(20, 20),
    anchor: new google.maps.Point(10, 10),
  }
}

// Big "Lugar de desaparición" callout: a labelled box on top, a vertical
// stick pointing down, and a small dot at the actual map location.
function bigPinIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="100" viewBox="0 0 260 100">
    <defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.30"/></filter></defs>
    <g filter="url(#sh)">
      <rect x="45" y="8" width="170" height="30" rx="15" fill="#DC2626"/>
      <text x="130" y="28" text-anchor="middle" fill="#fff" font-size="13" font-weight="700" font-family="system-ui, -apple-system, sans-serif">Lugar de desaparición</text>
      <line x1="130" y1="38" x2="130" y2="86" stroke="#DC2626" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="130" cy="88" r="5" fill="#DC2626" stroke="#fff" stroke-width="2"/>
    </g>
  </svg>`
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(260, 100),
    anchor: new google.maps.Point(130, 88),
  }
}

interface MapProps {
  staticMarkers: StaticMarker[]
  persons: PersonOnMap[]
  showPersons: boolean
  filters: Record<FilterKey, boolean>
  selectedCoords: { lat: number; lng: number } | null
  theme: 'light' | 'dark'
}

function Map({ staticMarkers, persons, showPersons, filters, selectedCoords, theme }: MapProps) {
  const [selectedStatic, setSelectedStatic] = useState<StaticMarker | null>(null)
  const [hoveredPerson, setHoveredPerson] = useState<PersonOnMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const personIcon = useMemo(() => personDotIcon(), [])
  const pinIcon = useMemo(() => bigPinIcon(), [])

  const fosaMarkers = staticMarkers.filter(m => m.type === 'fosas' && filters.fosas)
  const trabajosMarkers = staticMarkers.filter(m => m.type === 'trabajos' && filters.trabajos)

  // Imperative clustering + Mexico borders.
  useEffect(() => {
    if (!mapReady) return

    if (!showPersons || persons.length === 0) {
      markersRef.current.forEach(m => { google.maps.event.clearInstanceListeners(m); m.setMap(null) })
      markersRef.current = []
      clustererRef.current?.setMap(null)
      clustererRef.current = null
      return
    }

    const map = mapRef.current
    if (!map) return

    const markers = persons.map(p => {
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map,
        icon: personIcon,
        title: fullName(p),
      })
      marker.addListener('mouseover', () => setHoveredPerson(p))
      marker.addListener('mouseout', () => setHoveredPerson(prev => (prev?.id === p.id ? null : prev)))
      return marker
    })
    markersRef.current = markers

    const clusterer = new MarkerClusterer({
      markers,
      map,
      algorithm: new GridAlgorithm({ gridSize: 10, maxZoom: 18 }),
      renderer: {
        render({ count, position }) {
          const size = Math.min(72, 32 + Math.sqrt(count) * 6)
          const svg = encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="#EF4444" opacity="0.7"/></svg>`
          )
          return new google.maps.Marker({
            position,
            icon: {
              url: `data:image/svg+xml;utf8,${svg}`,
              scaledSize: new google.maps.Size(size, size),
            },
            label: {
              text: String(count),
              color: '#fff',
              fontSize: '13px',
              fontWeight: 'bold',
            },
            zIndex: 100,
          })
        },
      },
    })
    clustererRef.current = clusterer

    return () => {
      markers.forEach(m => { google.maps.event.clearInstanceListeners(m); m.setMap(null) })
      clusterer.setMap(null)
      markersRef.current = []
      clustererRef.current = null
    }
  }, [mapReady, persons, showPersons, personIcon])

  // Recenter on the selected person's disappearance location.
  useEffect(() => {
    if (mapReady && selectedCoords && mapRef.current) {
      mapRef.current.panTo(selectedCoords)
      if ((mapRef.current.getZoom() ?? 0) < 11) mapRef.current.setZoom(11)
    }
  }, [mapReady, selectedCoords])

  // Thick Mexico state borders, re-styled when the theme flips.
  useEffect(() => {
    if (mapReady && mapRef.current) {
      addMexicoBorders(mapRef.current, theme)
    }
  }, [mapReady, theme])

  return (
    <GoogleMap
      mapContainerStyle={MAP_CONTAINER_STYLE}
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      onLoad={map => { mapRef.current = map; setMapReady(true) }}
      options={{
        styles: theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
        fullscreenControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        zoomControl: false,
        rotateControl: false,
        scaleControl: false,
        panControl: false,
        gestureHandling: 'greedy',
      }}
      onClick={() => setSelectedStatic(null)}
    >
      {fosaMarkers.map(m => (
        <Circle
          key={`area-${m.id}`}
          center={{ lat: m.lat, lng: m.lng }}
          radius={6000}
          options={{
            fillColor: '#EF4444',
            fillOpacity: 0.18,
            strokeColor: '#EF4444',
            strokeOpacity: 0,
            strokeWeight: 0,
            clickable: true,
          }}
          onClick={() => setSelectedStatic(m)}
        />
      ))}

      {trabajosMarkers.map(m => (
        <MarkerF
          key={m.id}
          position={{ lat: m.lat, lng: m.lng }}
          icon={dotIcon()}
          onClick={() => setSelectedStatic(m)}
        />
      ))}

      {selectedCoords && (
        <MarkerF position={selectedCoords} icon={pinIcon} zIndex={200} />
      )}

      {selectedStatic && (
        <InfoWindowF
          position={{ lat: selectedStatic.lat, lng: selectedStatic.lng }}
          onCloseClick={() => setSelectedStatic(null)}
        >
          <div style={{ fontFamily: 'var(--font-family)', minWidth: 160, padding: '10px 12px' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, lineHeight: 1.35 }}>{selectedStatic.name}</div>
            <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 6, lineHeight: 1.45 }}>{FILTER_LABELS[selectedStatic.type]}</div>
            <div style={{ fontSize: 11, color: MARKER_COLORS[selectedStatic.type], fontWeight: 500, lineHeight: 1.45 }}>{selectedStatic.date}</div>
          </div>
        </InfoWindowF>
      )}

      {hoveredPerson && (
        <InfoWindowF
          position={{ lat: hoveredPerson.lat, lng: hoveredPerson.lng }}
          options={{ pixelOffset: new google.maps.Size(0, -8) }}
          onCloseClick={() => setHoveredPerson(null)}
          zIndex={50}
        >
          <div
            data-testid="home-person-hover"
            style={{ fontFamily: 'var(--font-family)', minWidth: 200, maxWidth: 260, padding: '12px 14px', color: 'var(--color-text-primary)' }}
            onMouseEnter={() => setHoveredPerson(prev => prev?.id === hoveredPerson.id ? hoveredPerson : prev)}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, lineHeight: 1.35 }}>{fullName(hoveredPerson)}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              {[hoveredPerson.edad_actual && `${hoveredPerson.edad_actual} años`, hoveredPerson.municipio, hoveredPerson.estado]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {hoveredPerson.fecha_hechos && (
              <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 500, lineHeight: 1.45 }}>
                {new Date(hoveredPerson.fecha_hechos).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            )}
            {hoveredPerson.estatus_victima && (
              <div style={{ fontSize: 10, marginTop: 8, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.45 }}>
                {hoveredPerson.estatus_victima}
              </div>
            )}
          </div>
        </InfoWindowF>
      )}
    </GoogleMap>
  )
}

// ── Panel: datos detallados de la persona seleccionada ──────────────────────────

interface PanelPerson {
  nombre: string | null
  primer_apellido: string | null
  segundo_apellido: string | null
  edad_actual: number | null
  edad_hechos: number | null
  estado: string | null
  municipio: string | null
  fecha_hechos: string | null
  estatus_victima: string | null
}

function fmtDate(d: string | null) {
  if (!d) return 'Fecha no registrada'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return 'Fecha no registrada'
  return dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fixDataUri(raw: string | null): string | null {
  if (!raw) return null
  const comma = raw.indexOf(',')
  if (comma < 0) return null
  const b64 = raw.slice(comma + 1).replace(/\s/g, '')
  if (!b64) return null
  const mime = b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${b64}`
}

const panelItem: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.55 }

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--divider)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: 5 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function PersonDetailPanel({ person, detail }: { person: PanelPerson | null; detail: PersonDetail | null }) {
  if (!person) {
    return (
      <div
        className="anim-fade-in"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          bottom: 12,
          width: 320,
          maxWidth: 'calc(100% - 24px)',
          zIndex: 5,
          borderRadius: 16,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 10,
          background: 'var(--color-bg)',
          border: '1px solid var(--surface-card-border)',
        }}
      >
        <User size={28} color="var(--color-primary)" />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          No se ha seleccionado ninguna persona.<br />Completa el onboarding para ver su información.
        </span>
      </div>
    )
  }

  const name = fullName(person)
  const age = person.edad_actual ?? person.edad_hechos
  const loc = [person.municipio, person.estado].filter(Boolean).join(', ') || 'Ubicación no registrada'
  const photo = detail ? fixDataUri(detail.imagen) : null
  const senas = detail ? parseSenas(detail.sana_particular) : []
  const filiacion = detail ? parseFiliacion(detail.media_filiacion) : {}

  return (
    <div
      className="anim-fade-in"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        bottom: 12,
        width: 320,
        maxWidth: 'calc(100% - 24px)',
        zIndex: 5,
        borderRadius: 16,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        border: '1px solid var(--surface-card-border)',
      }}
    >
      {photo ? (
        <img
          src={photo}
          alt={name}
          style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: '16px 16px 0 0', background: 'var(--color-photo-bg)' }}
        />
      ) : (
        <div style={{ width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--glass-bg)', borderRadius: '16px 16px 0 0' }}>
          <User size={40} color="var(--color-primary)" />
        </div>
      )}

      <div style={{ padding: '16px 18px', flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.3, marginBottom: 6 }}>{name}</div>

        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 2 }}>
          {age ? `${age} años` : 'Edad no registrada'}{detail?.sexo ? ` · ${detail.sexo}` : ''}
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{loc}</div>
        <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, marginBottom: 8 }}>
          Desaparecida {fmtDate(person.fecha_hechos)}
        </div>

        <span style={{
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: 40,
          background: 'rgba(220,38,38,0.10)',
          border: '1px solid rgba(220,38,38,0.3)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: '#DC2626',
          marginBottom: 4,
        }}>
          {person.estatus_victima ?? 'Estatus no registrado'}
        </span>

        {!detail && (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>Cargando detalles…</div>
        )}

        {detail && (
          <>
            {senas.length > 0 && (
              <PanelSection title="Señas particulares">
                {senas.map((s, i) => <div key={i} style={panelItem}>· {s}</div>)}
              </PanelSection>
            )}

            {detail.prendas_de_vestir && (
              <PanelSection title="Vestimenta">
                <div style={panelItem}>{detail.prendas_de_vestir.replace(/<br\s*\/?>/gi, ', ')}</div>
              </PanelSection>
            )}

            {Object.keys(filiacion).length > 0 && (
              <PanelSection title="Media filiación">
                {Object.entries(filiacion).map(([k, v], i) => (
                  <div key={i} style={panelItem}><b style={{ fontWeight: 500 }}>{k}:</b> {v}</div>
                ))}
              </PanelSection>
            )}

            {detail.nacionalidad && (
              <PanelSection title="Nacionalidad">
                <div style={panelItem}>{detail.nacionalidad}</div>
              </PanelSection>
            )}

            {detail.tiene_discapacidad && detail.tipo_discapacidad && (
              <PanelSection title="Discapacidad">
                <div style={panelItem}>{detail.tipo_discapacidad}</div>
              </PanelSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Modales de evidencia y chat ───────────────────────────────────────────────

interface ChatMsg { id: number; from: 'me' | 'other'; text: string }

function ChatSimModal({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  function send() {
    const text = input.trim()
    if (!text) return
    setMsgs(prev => [...prev, { id: Date.now(), from: 'me', text }])
    setInput('')
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
  // Only render the photo block when an actual attachment exists; otherwise the
  // broken <img> shows the alt text and looks worse than no photo at all.
  const photoUrl: string | null = null

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
              {photoUrl && (
                <>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 8 }}>
                    Evidencia fotográfica
                  </label>
                  <img
                    src={photoUrl}
                    alt="Evidencia fotográfica"
                    style={{ width: '100%', borderRadius: 12, objectFit: 'cover', maxHeight: 280, display: 'block', border: '1px solid rgba(242,195,133,0.3)' }}
                  />
                </>
              )}

              {/* Metadatos del hallazgo */}
              <div style={{ marginTop: photoUrl ? 12 : 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
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

const MX_ESTADOS = [
  'AGUASCALIENTES', 'BAJA CALIFORNIA', 'BAJA CALIFORNIA SUR', 'CAMPECHE', 'CHIAPAS', 'CHIHUAHUA',
  'CIUDAD DE MEXICO', 'COAHUILA', 'COLIMA', 'DURANGO', 'GUANAJUATO', 'GUERRERO', 'HIDALGO',
  'JALISCO', 'MEXICO', 'MICHOACAN', 'MORELOS', 'NAYARIT', 'NUEVO LEON', 'OAXACA', 'PUEBLA',
  'QUERETARO', 'QUINTANA ROO', 'SAN LUIS POTOSI', 'SINALOA', 'SONORA', 'TABASCO', 'TAMAULIPAS',
  'TLAXCALA', 'VERACRUZ', 'YUCATAN', 'ZACATECAS',
]

const evLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 6 }

// Remove the native select chevron and draw a clean custom one (glass-input is built for text inputs).
const evSelect: React.CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2.5 4.5l3.5 3.5 3.5-3.5' fill='none' stroke='%236B6B6B' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 14px center',
  paddingRight: 34,
}

function UploadEvidenceModal({ onClose, onMatch }: { onClose: () => void; onMatch: (c: PreviewCandidate) => void }) {
  const [desc, setDesc] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [sexo, setSexo] = useState('')
  const [estado, setEstado] = useState('')
  const [edadMin, setEdadMin] = useState('')
  const [edadMax, setEdadMax] = useState('')
  const [estatura, setEstatura] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<PreviewCandidate[] | null>(null)

  const hasInput = !!(desc.trim() || sexo || estado || edadMin || edadMax || estatura)
  const edadInvalid = !!(edadMin && edadMax && Number(edadMin) > Number(edadMax))

  // Build a structured CuerpoQuery from the form and run the matcher
  // (embed → retrieve → score → verify → ranked personas). All fields optional.
  async function run() {
    if (!hasInput) return
    if (edadInvalid) {
      setError('La edad mínima no puede ser mayor que la máxima')
      return
    }
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const query = {
        sexo: sexo || undefined,
        estado: estado || undefined,
        edad_min: edadMin ? Number(edadMin) : undefined,
        edad_max: edadMax ? Number(edadMax) : undefined,
        estatura_cm: estatura ? Number(estatura) : undefined,
        senas: desc.trim() ? [desc.trim()] : undefined,
      }
      console.debug('[match] → /match/preview query:', query)
      const res = await matchPreview(query)
      console.debug(`[match] ← ${res.candidatos.length} candidate(s), via ${res.via}; top:`,
        res.candidatos[0] ? `${res.candidatos[0].nombre} ${(res.candidatos[0].score * 100).toFixed(0)}%` : '(none)')
      setResults(res.candidatos)
      // Strong match → local card on my screen + notify the families linked to that persona.
      const top = res.candidatos[0]
      if (top && top.score >= NOTIFY_THRESHOLD) {
        onMatch(top)
        console.debug(`[notify] top score ${(top.score * 100).toFixed(0)}% ≥ ${NOTIFY_THRESHOLD * 100}% → notifying families of ${top.persona_victima_id}`)
        try {
          const r = await notifyMatch(top.persona_victima_id, top.nombre, top.score, top.tier)
          console.debug(`[notify] ✓ backend notified ${r.notified} linked family(ies)`)
        } catch (e) {
          console.error('[notify] ✗ /match/notify failed:', e instanceof Error ? e.message : e)
        }
      } else {
        console.debug(`[notify] top score below threshold (${NOTIFY_THRESHOLD * 100}%) → no cross-user notification`)
      }
    } catch (e) {
      console.error('[match] ✗ /match/preview failed:', e instanceof Error ? e.message : e)
      setError(e instanceof Error ? e.message : 'No se pudo procesar la evidencia')
    } finally {
      setLoading(false)
    }
  }

  const TIER_COLOR: Record<string, string> = { alta: '#2F855A', media: '#B7791F', baja: '#9C9C9C' }

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
          {/* Datos del hallazgo (estructurados, opcionales) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={evLabel}>Sexo</label>
              <select className="glass-input" style={evSelect} value={sexo} onChange={e => setSexo(e.target.value)}>
                <option value="">Cualquiera</option>
                <option value="HOMBRE">Hombre</option>
                <option value="MUJER">Mujer</option>
              </select>
            </div>
            <div>
              <label style={evLabel}>Estado</label>
              <select className="glass-input" style={evSelect} value={estado} onChange={e => setEstado(e.target.value)}>
                <option value="">Cualquiera</option>
                {MX_ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={evLabel}>Edad mín.</label>
              <input className="glass-input" type="text" inputMode="numeric" maxLength={3} value={edadMin} onChange={e => setEdadMin(e.target.value.replace(/\D/g, ''))} placeholder="—" />
            </div>
            <div>
              <label style={evLabel}>Edad máx.</label>
              <input className="glass-input" type="text" inputMode="numeric" maxLength={3} value={edadMax} onChange={e => setEdadMax(e.target.value.replace(/\D/g, ''))} placeholder="—" />
            </div>
            <div>
              <label style={evLabel}>Estatura (cm)</label>
              <input className="glass-input" type="text" inputMode="numeric" maxLength={3} value={estatura} onChange={e => setEstatura(e.target.value.replace(/\D/g, ''))} placeholder="—" />
            </div>
            {edadInvalid && (
              <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12, color: '#c0392b' }}>
                ⚠ La edad mínima no puede ser mayor que la máxima.
              </p>
            )}
          </div>

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

          {/* Señas / descripción */}
          <div>
            <label style={evLabel}>Señas particulares y descripción</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              className="glass-input"
              placeholder="Tatuajes, cicatrices, ropa, complexión, dónde y cuándo…"
              style={{ minHeight: 110, resize: 'vertical', lineHeight: 1.6, fontSize: 13 }}
            />
          </div>

          {error && <p style={{ fontSize: 13, color: '#c0392b', margin: 0 }}>⚠ {error}</p>}

          <button
            className="btn-primary"
            style={{ width: '100%', padding: '12px', fontSize: 14, opacity: loading || !hasInput || edadInvalid ? 0.6 : 1 }}
            onClick={run}
            disabled={loading || !hasInput || edadInvalid}
          >
            {loading ? 'Buscando coincidencias…' : 'Buscar coincidencias'}
          </button>

          {results && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B6B6B' }}>
                {results.length > 0 ? `${results.length} posibles coincidencias` : 'Sin coincidencias por ahora'}
              </div>
              {results.map(c => (
                <div key={c.persona_victima_id} style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(242,195,133,0.3)', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: TIER_COLOR[c.tier] ?? '#6B6B6B', background: (TIER_COLOR[c.tier] ?? '#6B6B6B') + '20', border: `1px solid ${(TIER_COLOR[c.tier] ?? '#6B6B6B')}55`, padding: '2px 8px', borderRadius: 40 }}>{c.tier}</span>
                    <strong style={{ fontSize: 14, color: '#1A1A1A' }}>{c.nombre ?? '—'}</strong>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6B6B6B', fontVariantNumeric: 'tabular-nums' }}>{(c.score * 100).toFixed(0)}%</span>
                  </div>
                  {c.evidencia.length > 0 && (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12, color: '#2F855A' }}>
                      {c.evidencia.map((e, j) => <li key={j}>{e}</li>)}
                    </ul>
                  )}
                  {c.contradicciones.length > 0 && (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12, color: '#c0392b' }}>
                      {c.contradicciones.map((e, j) => <li key={j}>{e}</li>)}
                    </ul>
                  )}
                  {c.razonamiento && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6B6B6B', fontStyle: 'italic' }}>{c.razonamiento}</p>}
                </div>
              ))}
            </div>
          )}
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

type Notif = { id: number | string; title: string; desc: string; time: string; isNew?: boolean; ts?: number }

// Relative "time ago" in Spanish from an epoch-ms timestamp. Recomputed on each
// render (the Home component ticks `now` every 30s) so cards age live.
function timeAgo(ts: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - ts) / 1000))
  if (secs < 60) return 'ahora'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'ayer' : `hace ${days} d`
}

// Score at/above which a candidate is worth notifying the user about.
const NOTIFY_THRESHOLD = 0.6

function readStoredPersona(): PersonaSummary | null {
  try {
    const raw = localStorage.getItem('selected_persona')
    if (!raw) return null
    return JSON.parse(raw) as PersonaSummary
  } catch {
    return null
  }
}

export function Home() {
  const { theme } = useTheme()
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    fosas: true,
    desaparicion: true,
    trabajos: true,
  })
  const [vinculo, setVinculo] = useState<VinculoOut | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [persons, setPersons] = useState<PersonOnMap[]>([])
  const [detail, setDetail] = useState<PersonDetail | null>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notif[]>(NOTIFICATIONS)

  // Emulates the AI agent doing initial research on mount so the
  // "Notificaciones" and "Análisis del agente IA" panels show shimmering
  // skeletons for a moment before the content reveals.
  const [loadingContent, setLoadingContent] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLoadingContent(false), 1700)
    return () => clearTimeout(t)
  }, [])

  // Ticks every 30s so relative timestamps ("ahora" → "hace 1 min" → …) age live.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(i)
  }, [])

  // A real match (score ≥ threshold) prepends a live card to "Notificaciones recientes".
  function addMatchNotif(c: PreviewCandidate) {
    setNotifs(prev => [
      {
        id: Date.now(),
        title: 'Nueva coincidencia detectada',
        desc: `Coincidencia ${c.tier} con ${c.nombre ?? 'un registro'} — ${(c.score * 100).toFixed(0)}% de similitud.`,
        time: 'ahora',
        ts: Date.now(),
        isNew: true,
      },
      ...prev,
    ])
  }

  // Realtime: cross-user match notifications (e.g. someone reports a finding for
  // the person YOU are linked to). RLS scopes rows to this user; live via Supabase.
  const { items: liveNotifs } = useNotifications(!!vinculo)
  const liveMatchNotifs: Notif[] = liveNotifs
    .filter(n => n.tipo === 'match')
    .map(n => {
      const p = (n.payload ?? {}) as { tier?: string; nombre?: string | null; score?: number }
      return {
        id: n.id,
        title: 'Nueva coincidencia detectada',
        desc: `Coincidencia ${p.tier ?? ''} con ${p.nombre ?? 'un registro'} — ${Math.round((p.score ?? 0) * 100)}% de similitud.`,
        time: 'ahora',
        ts: new Date(n.created_at).getTime(),
        isNew: true,
      }
    })
  const allNotifs: Notif[] = [...liveMatchNotifs, ...notifs]

  // The single selected person — from the backend vinculo, or the onboarding
  // selection persisted to localStorage as a fallback.
  const selectedId = useMemo<number | null>(() => {
    if (vinculo?.persona?.id != null) return vinculo.persona.id
    return readStoredPersona()?.id ?? null
  }, [vinculo])

  const selectedPersonOnMap = useMemo(
    () => persons.find(p => p.id === selectedId) ?? null,
    [persons, selectedId]
  )

  const selectedCoords = useMemo(
    () => (selectedPersonOnMap ? { lat: selectedPersonOnMap.lat, lng: selectedPersonOnMap.lng } : null),
    [selectedPersonOnMap]
  )

  // Background desaparición dots — everyone except the selected person (who gets
  // the big pin) so they aren't double-marked.
  const backgroundPersons = useMemo(
    () => persons.filter(p => p.id !== selectedId),
    [persons, selectedId]
  )

  // Normalize the panel data from whichever source we have.
  const panelPerson = useMemo<PanelPerson | null>(() => {
    if (selectedPersonOnMap) {
      const p = selectedPersonOnMap
      return {
        nombre: p.nombre, primer_apellido: p.primer_apellido, segundo_apellido: p.segundo_apellido,
        edad_actual: p.edad_actual, edad_hechos: p.edad_hechos,
        estado: p.estado, municipio: p.municipio,
        fecha_hechos: p.fecha_hechos, estatus_victima: p.estatus_victima,
      }
    }
    const vp = vinculo?.persona
    if (vp) {
      return {
        nombre: vp.nombre, primer_apellido: vp.primer_apellido, segundo_apellido: vp.segundo_apellido,
        edad_actual: vp.edad_actual ? Number(vp.edad_actual) || null : null, edad_hechos: null,
        estado: vp.estado, municipio: vp.municipio,
        fecha_hechos: vp.fecha_hechos, estatus_victima: vp.estatus_victima,
      }
    }
    const sp = readStoredPersona()
    if (sp) {
      return {
        nombre: sp.nombre, primer_apellido: sp.primer_apellido, segundo_apellido: sp.segundo_apellido,
        edad_actual: sp.edad_actual ? Number(sp.edad_actual) || null : null, edad_hechos: null,
        estado: sp.estado, municipio: sp.municipio,
        fecha_hechos: null, estatus_victima: sp.estatus_victima,
      }
    }
    return null
  }, [selectedPersonOnMap, vinculo])

  // Fetch the full detail for the selected person (public Supabase read).
  useEffect(() => {
    if (selectedId == null) return
    let on = true
    fetchPersonDetail(selectedId)
      .then(d => { if (on) setDetail(d) })
      .catch(() => { if (on) setDetail(null) })
    return () => { on = false }
  }, [selectedId])

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
        overflowX: 'hidden',
      }}
    >
      <AppHeader />

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
          <div style={{ flex: 1, position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--glass-border-strong)' }}>
            {isLoaded ? (
              <Map
                staticMarkers={STATIC_MARKERS}
                persons={backgroundPersons}
                showPersons={filters.desaparicion}
                filters={filters}
                selectedCoords={selectedCoords}
                theme={theme}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>Cargando mapa…</span>
              </div>
            )}

            {/* Panel de la persona seleccionada (lado derecho del mapa) */}
            <PersonDetailPanel person={panelPerson} detail={detail} />

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
              {loadingContent
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={`skel-${i}`}
                      style={{
                        padding: '14px 18px',
                        borderLeft: '3px solid #F2921D',
                        borderRadius: '0 16px 16px 0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div className="skeleton" style={{ height: 12, width: '60%' }} />
                      <div className="skeleton" style={{ height: 10, width: '92%' }} />
                      <div className="skeleton" style={{ height: 10, width: '78%' }} />
                    </div>
                  ))
                : allNotifs.map(n => (
                    <div
                      key={n.id}
                      className={n.isNew ? 'glass anim-fade-in' : 'glass'}
                      style={{
                        padding: '14px 18px',
                        borderLeft: '3px solid #F2921D',
                        borderRadius: '0 16px 16px 0',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                          {n.title}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                          {n.desc}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{n.ts != null ? timeAgo(n.ts, now) : n.time}</span>
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

          <div style={{ flex: 1, minWidth: 260, position: 'relative', overflow: 'hidden' }}>
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

              <div style={{ padding: '18px 22px', background: 'var(--surface-card)' }}>
                {loadingContent ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="skeleton" style={{ height: 12, width: '95%' }} />
                    <div className="skeleton" style={{ height: 12, width: '88%' }} />
                    <div className="skeleton" style={{ height: 12, width: '92%' }} />
                    <div className="skeleton" style={{ height: 12, width: '70%' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                      <div className="skeleton" style={{ height: 7, flex: 1 }} />
                      <div className="skeleton" style={{ height: 11, width: 36 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <Loader2 size={12} className="anim-breath" color="var(--color-primary)" />
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Analizando reportes cruzados…</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.70, marginBottom: 18, textWrap: 'pretty' as const }}>
                      Michelle Itzayana Fuentes Calderón, de 15 años, fue reportada como desaparecida en Yautepec, Morelos, el 24 de mayo de 2026. El perfil describe a una adolescente de complexión robusta, 1.50 m de estatura y 60 kg, con cabello castaño claro corto y liso, ojos negros pequeños, nariz recta, boca pequeña y labios medianos. Al momento de su desaparición vestía pantalón azul, sudadera azul y tenis negro con blanco. Hasta el momento no se han identificado fosas cercanas, puntos de desaparición ni puntos de encuentro falsos que coincidan con su media filiación. La zona oriente de Morelos — particularmente los municipios cercanos a Yautepec como Cuautla, Emiliano Zapata y Jiutepec — se mantiene bajo monitoreo activo, y cualquier pista nueva será contrastada de inmediato con el perfil registrado.
                    </p>

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
                  </>
                )}
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

        {/* Firecrawl news analysis for the selected person */}
        <NewsAnalysisWidget
          id_victimadirecta={vinculo?.persona?.id_victimadirecta ?? readStoredPersona()?.id_victimadirecta ?? null}
          personName={panelPerson ? fullName(panelPerson) : ''}
        />
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

      {uploadOpen && <UploadEvidenceModal onClose={() => setUploadOpen(false)} onMatch={addMatchNotif} />}
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
