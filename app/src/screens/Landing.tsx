import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleMap, useJsApiLoader, InfoWindowF } from '@react-google-maps/api'
import { MarkerClusterer, GridAlgorithm } from '@googlemaps/markerclusterer'
import { AgentDot } from '../components/AgentDot'
import { useSession, signInWithGoogle } from '../features/auth'
import { useTheme } from '../features/theme'
import {
  fetchPersonsOnMap,
  fetchPersonDetail,
  parseSenas,
  parseFiliacion,
  type PersonOnMap,
  type PersonDetail,
} from '../features/landing/api'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

const MAP_CENTER = { lat: 23.6345, lng: -102.5528 }
const MAP_ZOOM = 5
const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' }
const MAP_STYLE_LIGHT: google.maps.MapTypeStyle[] = [
    {
        "featureType": "all",
        "elementType": "labels.text",
        "stylers": [
            {
                "color": "#878787"
            }
        ]
    },
    {
        "featureType": "all",
        "elementType": "labels.text.stroke",
        "stylers": [
            {
                "visibility": "off"
            }
        ]
    },
    {
        "featureType": "landscape",
        "elementType": "all",
        "stylers": [
            {
                "color": "#f9f5ed"
            }
        ]
    },
    {
        "featureType": "road.highway",
        "elementType": "all",
        "stylers": [
            {
                "color": "#f5f5f5"
            }
        ]
    },
    {
        "featureType": "road.highway",
        "elementType": "geometry.stroke",
        "stylers": [
            {
                "color": "#c9c9c9"
            }
        ]
    },
    {
        "featureType": "water",
        "elementType": "all",
        "stylers": [
            {
                "color": "#aee0f4"
            }
        ]
    }
];

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
];

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t)
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

const COLOR_OLD = hexToRgb('#f97316')
const COLOR_RECENT = hexToRgb('#dc2626')

function dateColor(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio))
  return rgbToHex(
    lerp(COLOR_OLD[0], COLOR_RECENT[0], t),
    lerp(COLOR_OLD[1], COLOR_RECENT[1], t),
    lerp(COLOR_OLD[2], COLOR_RECENT[2], t),
  )
}

function fullName(p: PersonOnMap) {
  return [p.nombre, p.primer_apellido, p.segundo_apellido].filter(Boolean).join(' ') || 'Sin nombre'
}

function formatDate(date: string | null) {
  if (!date) return 'Fecha no registrada'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return 'Fecha no registrada'
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ageText(p: PersonOnMap) {
  const age = p.edad_actual ?? p.edad_hechos
  return age ? `${age} años` : 'Edad no registrada'
}

function locationText(p: PersonOnMap) {
  return [p.municipio, p.estado].filter(Boolean).join(', ') || 'Ubicación no registrada'
}

function statusText(p: PersonOnMap) {
  return p.estatus_victima ?? 'Estatus no registrado'
}

function getMarkerIcon(color: string): google.maps.Icon {
  return {
    url: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="${color}"/></svg>`
    ),
    scaledSize: new google.maps.Size(20, 20),
    anchor: new google.maps.Point(10, 10),
  }
}

function HoverCard({ person }: { person: PersonOnMap }) {
  return (
    <div style={{ fontFamily: 'var(--font-family)', background: '#000', color: '#fff', padding: '8px 12px', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{fullName(person)}</div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 1 }}>
        {ageText(person)} · {locationText(person)}
      </div>
      <div style={{ fontSize: 10, color: '#fef08a' }}>
        {formatDate(person.fecha_hechos)}
      </div>
    </div>
  )
}

function DetailPanel({ person, detail }: {
  person: PersonOnMap
  detail?: PersonDetail
}) {
  const senas = detail ? parseSenas(detail.sana_particular) : []
  const filiacion = detail ? parseFiliacion(detail.media_filiacion) : {}
  const hasPhoto = !!detail?.imagen

  return (
    <div className="anim-fade-in" style={{
      position: 'absolute',
      top: 90,
      right: 16,
      bottom: 24,
      zIndex: 25,
      width: 320,
      maxWidth: 'calc(100vw - 32px)',
      borderRadius: 16,
      overflowY: 'auto',
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#1a1a1a',
      color: '#fff',
    }}>
      {detail && hasPhoto && (
        <img
          src={detail.imagen!}
          alt={fullName(person)}
          style={{ width: 'calc(100% - 24px)', height: 280, objectFit: 'contain', background: '#111', borderRadius: 12, margin: '12px 12px 0' }}
        />
      )}

      <div style={{ padding: '16px 18px', flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.3, marginBottom: 8 }}>
          {fullName(person)}
        </div>

        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 2 }}>
          {ageText(person)}{detail?.sexo ? ` · ${detail.sexo}` : ''}
        </div>
        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 2 }}>{locationText(person)}</div>
        <div style={{ fontSize: 12, color: '#fef08a', fontWeight: 500, marginBottom: 8 }}>
          Desaparecida {formatDate(person.fecha_hechos)}
        </div>

        <span style={{
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: 40,
          background: 'rgba(220,38,38,0.15)',
          border: '1px solid rgba(220,38,38,0.4)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: '#f87171',
          marginBottom: 12,
        }}>
          {statusText(person)}
        </span>

        {!detail && (
          <div style={{ fontSize: 12, color: '#9aa0a6' }}>Cargando detalles…</div>
        )}

        {detail && (
          <>
            {senas.length > 0 && (
              <Section title="Señas particulares">
                {senas.map((s, i) => <div key={i} style={itemStyle}>· {s}</div>)}
              </Section>
            )}

            {detail.prendas_de_vestir && (
              <Section title="Vestimenta">
                <div style={itemStyle}>{detail.prendas_de_vestir}</div>
              </Section>
            )}

            {Object.keys(filiacion).length > 0 && (
              <Section title="Media filiación">
                {Object.entries(filiacion).map(([k, v], i) => (
                  <div key={i} style={itemStyle}><b style={{ fontWeight: 500 }}>{k}:</b> {v}</div>
                ))}
              </Section>
            )}

            {detail.nacionalidad && (
              <Section title="Nacionalidad">
                <div style={itemStyle}>{detail.nacionalidad}</div>
              </Section>
            )}

            {detail.tiene_discapacidad && detail.tipo_discapacidad && (
              <Section title="Discapacidad">
                <div style={itemStyle}>{detail.tipo_discapacidad}</div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const itemStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#bbb',
  lineHeight: 1.5,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #222' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fef08a', marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

export function Landing() {
  const navigate = useNavigate()
  const { session } = useSession()
  const { theme } = useTheme()
  const [persons, setPersons] = useState<PersonOnMap[]>([])
  const [visibleCount, setVisibleCount] = useState(0)
  const [hovered, setHovered] = useState<PersonOnMap | null>(null)
  const [selected, setSelected] = useState<PersonOnMap | null>(null)
  const [details, setDetails] = useState<Record<number, PersonDetail>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const detailCache = useRef<Record<number, PersonDetail>>({})
  const fetchingRef = useRef<Set<number>>(new Set())

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  })

  useEffect(() => {
    fetchPersonsOnMap()
      .then((data: PersonOnMap[]) => {
        setPersons(data)
        setVisibleCount(data.length)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Error al cargar los datos')
        setLoading(false)
      })
  }, [])

  const updateVisible = useCallback(() => {
    const map = mapRef.current
    if (!map || persons.length === 0) return
    const bounds = map.getBounds()
    if (!bounds) return
    let count = 0
    for (let i = 0; i < persons.length; i++) {
      if (bounds.contains(new google.maps.LatLng(persons[i].lat, persons[i].lng))) count++
    }
    setVisibleCount(count)
  }, [persons])

  const { minTs, maxTs } = useMemo(() => {
    const ts = persons
      .map(p => p.fecha_hechos)
      .filter((d): d is string => !!d)
      .map(d => new Date(d).getTime())
      .filter(t => !Number.isNaN(t))
    if (ts.length === 0) return { minTs: 0, maxTs: 0 }
    return { minTs: Math.min(...ts), maxTs: Math.max(...ts) }
  }, [persons])

  const earliestDate = useMemo(() => minTs ? new Date(minTs) : null, [minTs])

  const NUM_BUCKETS = 20
  const iconBuckets = useMemo(() => {
    if (!isLoaded) return null
    return Array.from({ length: NUM_BUCKETS }, (_, i) => {
      const ratio = i / (NUM_BUCKETS - 1)
      return getMarkerIcon(dateColor(ratio))
    })
  }, [isLoaded])
  const noDateIcon = useMemo(() => isLoaded ? getMarkerIcon('#f97316') : null, [isLoaded])

  const markerColor = useCallback((p: PersonOnMap) => {
    if (!iconBuckets) return noDateIcon!
    const ts = new Date(p.fecha_hechos ?? '').getTime()
    if (Number.isNaN(ts) || !maxTs || !minTs || maxTs === minTs) return noDateIcon ?? iconBuckets[0]
    const span = maxTs - minTs
    const ratio = Math.log(ts - minTs + 1) / Math.log(span + 1)
    const idx = Math.min(NUM_BUCKETS - 1, Math.floor(ratio * NUM_BUCKETS))
    return iconBuckets[idx]
  }, [iconBuckets, noDateIcon, minTs, maxTs])

  const handleSelect = useCallback((p: PersonOnMap) => {
    setSelected(p)
    if (!detailCache.current[p.id] && !fetchingRef.current.has(p.id)) {
      fetchingRef.current.add(p.id)
      fetchPersonDetail(p.id)
        .then(d => {
          detailCache.current[p.id] = d
          setDetails(prev => ({ ...prev, [p.id]: d }))
        })
        .catch(() => {})
        .finally(() => { fetchingRef.current.delete(p.id) })
    }
  }, [])

  useEffect(() => {
    if (!isLoaded || !mapReady || persons.length === 0 || !iconBuckets) return
    const map = mapRef.current!
    const markers = persons.map(p => {
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map,
        icon: markerColor(p),
      })
      marker.set('person', p)
      marker.addListener('mouseover', () => setHovered(p))
      marker.addListener('mouseout', () => setHovered(null))
      marker.addListener('click', () => handleSelect(p))
      return marker
    })
    markersRef.current = markers
    const clusterer = new MarkerClusterer({
      markers,
      map,
      algorithm: new GridAlgorithm({ gridSize: 10, maxZoom: 18 }),
      renderer: {
        render({ count, position, markers: clusterMarkers }) {
          let avgRatio = 0
          let n = 0
          if (clusterMarkers && minTs && maxTs && maxTs !== minTs) {
            const span = maxTs - minTs
            for (const m of clusterMarkers) {
              const p = (m as google.maps.Marker).get('person') as PersonOnMap | undefined
              if (p?.fecha_hechos) {
                const ts = new Date(p.fecha_hechos).getTime()
                if (!Number.isNaN(ts)) {
                  avgRatio += Math.log(ts - minTs + 1) / Math.log(span + 1)
                  n++
                }
              }
            }
          }
          const color = n > 0 ? dateColor(avgRatio / n) : '#f97316'
          const size = Math.min(72, 32 + Math.sqrt(count) * 6)
          const svg = encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${color}" opacity="0.7"/></svg>`
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
  }, [isLoaded, mapReady, persons, iconBuckets, markerColor, handleSelect])

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden' }}>
      {/* Navbar */}
      <header className="glass-strong" style={{
        position: 'absolute',
        top: 16,
        left: 16,
        right: 16,
        zIndex: 20,
        height: 58,
        borderRadius: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AgentDot size={22} pulse />
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
            Sendero
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {session ? (
            <button className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }} onClick={() => navigate('/home')}>
              Ir al dashboard
            </button>
          ) : (
            <button className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }} onClick={() => signInWithGoogle()}>
              Continuar con Google
            </button>
          )}
        </div>
      </header>

      {/* Stats panel */}
      <div className="glass" style={{
        position: 'absolute',
        top: 90,
        left: 16,
        zIndex: 20,
        borderRadius: 16,
        padding: '16px 18px',
        minWidth: 180,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          Personas en el mapa
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Cargando…</div>
        ) : error ? (
          <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{error}</div>
        ) : (
          <>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>{persons.length.toLocaleString('es-MX')}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              {visibleCount.toLocaleString('es-MX')} visibles en esta vista
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="glass" style={{
        position: 'absolute',
        bottom: 24,
        left: 16,
        zIndex: 20,
        borderRadius: 16,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>
            {loading ? 'Personas desaparecidas' : `${persons.length.toLocaleString('es-MX')} personas desaparecidas`}
            {earliestDate && ` desde ${earliestDate.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>Más antiguo</span>
          <div style={{
            width: 100, height: 8, borderRadius: 4,
            background: 'linear-gradient(90deg, #f97316, #dc2626)',
          }} />
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>Más reciente</span>
        </div>
      </div>

      {/* Map */}
      {isLoaded ? (
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          center={MAP_CENTER}
          zoom={MAP_ZOOM}
          onLoad={map => {
            mapRef.current = map
            setMapReady(true)
            updateVisible()
          }}
          onIdle={updateVisible}
          onClick={() => setSelected(null)}
          options={{
            styles: theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
            fullscreenControl: false,
            mapTypeControl: false,
            streetViewControl: false,
            zoomControl: true,
          }}
        >
          {hovered && !selected && (
            <InfoWindowF
              position={{ lat: hovered.lat, lng: hovered.lng }}
              onCloseClick={() => setHovered(null)}
              options={{ maxWidth: 220 }}
            >
              <HoverCard person={hovered} />
            </InfoWindowF>
          )}
        </GoogleMap>
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Cargando mapa…</span>
        </div>
      )}

      {selected && (
        <DetailPanel
          person={selected}
          detail={details[selected.id]}
        />
      )}
    </div>
  )
}
