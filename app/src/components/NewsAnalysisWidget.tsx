import { useEffect, useState, useRef } from 'react'
import { Loader2, Newspaper, ChevronRight, ChevronDown, ExternalLink, Link2, Search, Network, Globe } from 'lucide-react'
import { fetchPersonNews } from '../features/firecrawl'
import type { NewsResponse, NewsStatus, RelatedPerson } from '../features/firecrawl'
import { PersonConnectionsGraph } from './PersonConnectionsGraph'

const STATUS_META: Record<NewsStatus, { label: string; bg: string; border: string; text: string }> = {
  found_dead:  { label: 'Localizada sin vida', bg: 'rgba(220,38,38,0.10)', border: 'rgba(220,38,38,0.35)', text: '#DC2626' },
  found_alive: { label: 'Localizada con vida', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)', text: '#15803D' },
  not_found:   { label: 'Sin información reciente', bg: 'var(--color-cream)', border: 'var(--glass-border)', text: 'var(--color-text-secondary)' },
}

// Renders a small favicon for a source URL using Google's favicon service.
// Falls back to a Globe icon if the URL is missing or the image fails.
function SourceFavicon({ url, size = 14 }: { url: string | null; size?: number }) {
  const [err, setErr] = useState(false)
  if (!url || err) {
    return (
      <div style={{ width: size, height: size, borderRadius: 3, background: 'var(--color-photo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Globe size={Math.round(size * 0.7)} color="var(--color-text-secondary)" />
      </div>
    )
  }
  let host: string | null = null
  try {
    const parsed = new URL(url)
    if (parsed.hostname) host = parsed.hostname
  } catch {
    return null
  }
  if (!host) return null
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size * 2}`
  return (
    <img
      src={faviconUrl}
      alt=""
      width={size}
      height={size}
      onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: 3, objectFit: 'contain', background: 'var(--color-photo-bg)', flexShrink: 0 }}
    />
  )
}

function StatusBadge({ status }: { status: NewsStatus }) {
  const m = STATUS_META[status]
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 40,
      background: m.bg,
      border: `1px solid ${m.border}`,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: m.text,
      whiteSpace: 'nowrap',
    }}>{m.label}</span>
  )
}

function PersonNode({ person, depth }: { person: RelatedPerson; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = person.related_people.length > 0
  return (
    <div style={{
      borderLeft: depth > 0 ? '2px solid var(--glass-border)' : 'none',
      paddingLeft: depth > 0 ? 12 : 0,
      marginTop: depth === 0 ? 0 : 8,
    }}>
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--surface-card-border)',
        borderRadius: 10,
        padding: '10px 12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {hasChildren && (
              <button
                onClick={() => setOpen(!open)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-secondary)', display: 'flex' }}
                aria-label={open ? 'Contraer' : 'Expandir'}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{person.person_name}</span>
          </div>
          <StatusBadge status={person.status_enum} />
        </div>
        {person.person_status && (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{person.person_status}</div>
        )}
      </div>
      {hasChildren && open && (
        <div style={{ marginLeft: 8 }}>
          {person.related_people.map((child, i) => (
            <PersonNode key={`${depth}-${i}-${child.person_name}`} person={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  id_victimadirecta: string | null
  personName: string
}

export function NewsAnalysisWidget({ id_victimadirecta, personName }: Props) {
  const [data, setData] = useState<NewsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ranOnce = useRef(false)
  // Elapsed seconds while loading — shown in the loading skeleton.
  const [elapsed, setElapsed] = useState(0)

  async function run() {
    if (!id_victimadirecta && !personName) return
    setLoading(true)
    setError(null)
    setElapsed(0)
    try {
      const res = await fetchPersonNews({ id_victimadirecta: id_victimadirecta ?? undefined, fullname: id_victimadirecta ? undefined : personName })
      setData(res)
      ranOnce.current = true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al analizar las noticias')
    } finally {
      setLoading(false)
    }
  }

  // Auto-trigger the analysis once on mount, when a person is available.
  // This makes the widget feel alive: a research is happening as soon as
  // the user lands on Home with a linked victim.
  useEffect(() => {
    if (ranOnce.current) return
    if (!id_victimadirecta && !personName) return
    ranOnce.current = true
    // Defer to the next microtask so the setState calls inside `run()` are
    // not considered synchronous to this effect.
    void Promise.resolve().then(run)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id_victimadirecta, personName])

  // Tick the elapsed counter while loading so the skeleton shows live progress.
  useEffect(() => {
    if (!loading) return
    const start = Date.now()
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(t)
  }, [loading])

  // Show the "research active" indicator whenever a person is linked but we
  // don't yet have results (still loading, or never ran).
  const showResearchBadge = personName && (loading || !data) && !error
  const showResults = data && !loading

  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--surface-card-border)',
      borderRadius: 16,
      boxShadow: 'var(--shadow-card)',
      padding: '20px 20px 36px',
      marginBottom: 96,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Newspaper size={18} color="var(--color-primary)" />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Análisis de noticias</span>
              {showResearchBadge && (
                <span
                  title="Investigación en curso"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '2px 8px',
                    borderRadius: 40,
                    background: 'rgba(242, 146, 29, 0.10)',
                    border: '1px solid rgba(242, 146, 29, 0.32)',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--color-primary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--color-primary)',
                      animation: 'agentPulse 1.6s ease-in-out infinite',
                    }}
                  />
                  Investigación activa
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 1 }}>
              {personName ? `Noticias recientes sobre ${personName} (Firecrawl + IA)` : 'Selecciona una persona en el onboarding para analizar sus noticias.'}
            </div>
          </div>
        </div>
        <button
          className="btn-primary"
          style={{ padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, opacity: loading || !personName ? 0.6 : 1 }}
          disabled={loading || !personName}
          onClick={run}
        >
          {loading ? <Loader2 size={14} className="anim-breath" /> : <Search size={14} />}
          {loading ? 'Analizando…' : data ? 'Volver a analizar' : 'Analizar'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--color-error)' }}>{error}</div>
      )}

      {loading && !data && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Status card skeleton */}
          <div style={{
            background: 'var(--color-cream)',
            border: '1px solid var(--glass-border)',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="skeleton" style={{ height: 10, width: 60 }} />
              <div className="skeleton" style={{ height: 14, width: 100, borderRadius: 40 }} />
            </div>
            <div className="skeleton" style={{ height: 12, width: '95%' }} />
            <div className="skeleton" style={{ height: 12, width: '88%' }} />
            <div className="skeleton" style={{ height: 12, width: '70%' }} />
          </div>

          {/* Connections graph skeleton (radar / scanning effect) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Network size={13} color="var(--color-text-secondary)" />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                Red de conexiones
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 420,
                borderRadius: 12,
                border: '1px solid var(--surface-card-border)',
                background: 'var(--color-cream)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Scanning sweep */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(120deg, transparent 30%, rgba(242, 146, 29, 0.18) 50%, transparent 70%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 2.2s linear infinite',
                }}
              />
              {/* Centered status */}
              <div style={{ position: 'relative', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                <Loader2 size={28} className="anim-breath" color="var(--color-primary)" />
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  Rastreando notas periodísticas…
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  {elapsed > 0 ? `Buscando hace ${elapsed}s` : 'Iniciando…'}
                </div>
              </div>
            </div>
          </div>

          {/* Related-people list skeleton */}
          <div>
            <div className="skeleton" style={{ height: 10, width: 180, marginBottom: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--surface-card-border)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}>
                  <div className="skeleton" style={{ height: 11, width: '45%' }} />
                  <div className="skeleton" style={{ height: 10, width: '80%' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showResults && data && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Person status */}
          <div style={{
            background: 'var(--color-cream)',
            border: '1px solid var(--glass-border)',
            borderRadius: 12,
            padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Estado</span>
              <StatusBadge status={data.analysis.status_enum} />
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.6 }}>{data.analysis.person_status}</div>
          </div>

          {/* Connections graph (force-directed 2D) */}
          {data.analysis.related_people.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Network size={13} color="var(--color-text-secondary)" />
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                  Red de conexiones
                </span>
              </div>
              <PersonConnectionsGraph
                rootName={personName}
                rootNarrative={data.analysis.person_status}
                relatedPeople={data.analysis.related_people}
                height={420}
              />
            </div>
          )}

          {/* Related people tree (textual fallback / detail) */}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', userSelect: 'none' }}>
              Ver personas en lista ({data.analysis.related_people.length})
            </summary>
            <div style={{ marginTop: 8 }}>
              {data.analysis.related_people.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No se identificaron personas relacionadas en las notas consultadas.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.analysis.related_people.map((p, i) => (
                    <PersonNode key={`${i}-${p.person_name}`} person={p} depth={0} />
                  ))}
                </div>
              )}
            </div>
          </details>

          {/* Sources */}
          {data.sources.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Link2 size={12} />
                Fuentes consultadas ({data.sources.length})
              </summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      textDecoration: 'none',
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid var(--glass-border)',
                    }}
                  >
                    <div style={{ paddingTop: 1, flexShrink: 0 }}>
                      <SourceFavicon url={s.url} size={14} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        <span style={{ wordBreak: 'break-word' }}>{s.title || s.url}</span>
                        {s.url && <ExternalLink size={11} style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }} />}
                      </div>
                      {s.snippet && <div style={{ marginTop: 2, lineHeight: 1.5 }}>{s.snippet}…</div>}
                    </div>
                  </a>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
