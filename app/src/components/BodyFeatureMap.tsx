import { useMemo } from 'react'
import { useTheme } from '../features/theme'
import type { RelatedPerson, NewsStatus } from '../features/firecrawl'

// Visual "body feature map": renders public/silhouette.png on the left and
// maps each related person's description to a body zone with a connector line
// pointing at the body center. Built from the LLM-derived tree.
//
// Note: this is a static "demonstration" visualisation for the Profile modal.
// The dynamic, LLM-driven version lives in PersonConnectionsGraph.tsx.

interface FlatNode {
  id: string
  name: string
  status: NewsStatus
  isRoot?: boolean
  val: number
  color: string
}

interface FlatLink {
  source: string
  target: string
}

const STATUS_COLOR: Record<NewsStatus, string> = {
  found_dead: '#DC2626',
  found_alive: '#16A34A',
  not_found: '#9CA3AF',
}

function flatten(rootName: string, people: RelatedPerson[]): { nodes: FlatNode[]; links: FlatLink[] } {
  const nodes: FlatNode[] = [
    { id: '__root__', name: rootName, status: 'not_found', isRoot: true, val: 14, color: '#F2921D' },
  ]
  const links: FlatLink[] = []
  function walk(p: RelatedPerson, parentId: string) {
    const id = p.person_name + '|' + parentId + '|' + nodes.length
    nodes.push({ id, name: p.person_name, status: p.status_enum, val: 6, color: STATUS_COLOR[p.status_enum] })
    links.push({ source: parentId, target: id })
    for (const child of p.related_people) walk(child, id)
  }
  for (const p of people) walk(p, '__root__')
  return { nodes, links }
}

interface Props {
  rootName: string
  relatedPeople: RelatedPerson[]
  height?: number
}

export function BodyFeatureMap({ rootName, relatedPeople, height = 440 }: Props) {
  const { theme } = useTheme()
  const data = useMemo(() => flatten(rootName, relatedPeople), [rootName, relatedPeople])

  if (relatedPeople.length === 0) return null

  const bg = theme === 'dark' ? '#1F1A14' : '#EDE3D2'
  const labelColor = theme === 'dark' ? '#f0f0f0' : '#1A1A1A'

  // Simple horizontal layout: silhouette on the left, related people stacked
  // on the right, with thin connector lines pointing at the body center.
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: height,
        background: bg,
        borderRadius: 12,
        border: '1px solid var(--surface-card-border)',
        padding: '16px 20px',
        display: 'flex',
        gap: 24,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: '0 0 160px', display: 'flex', justifyContent: 'center' }}>
        <img
          src="/silhouette.png"
          alt="Silueta corporal"
          style={{ height: height - 32, width: 'auto', maxWidth: 160, objectFit: 'contain', opacity: 0.9 }}
        />
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: height - 32 }}>
        {data.nodes.filter(n => n.id !== '__root__').map((n, i) => {
          const top = 10 + i * 36
          return (
            <div key={n.id} style={{ position: 'absolute', top, left: 0, right: 0 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 10px',
                  borderRadius: 40,
                  background: theme === 'dark' ? 'rgba(31,26,20,0.85)' : 'rgba(237,227,210,0.92)',
                  border: `1px solid ${n.color}55`,
                  color: labelColor,
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: n.color }} />
                <span>{n.name}</span>
                <span style={{ color: n.color, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {n.status === 'found_dead' ? 'Sin vida' : n.status === 'found_alive' ? 'Con vida' : 'Sin info'}
                </span>
              </div>
              {n.status === 'not_found' && (
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                  Sin descripción adicional.
                </div>
              )}
            </div>
          )
        })}
        {/* Connector lines from each chip to the body (drawn as a thin horizontal line) */}
        <svg
          width="100%"
          height={height - 32}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {data.nodes.filter(n => n.id !== '__root__').map((n, i) => {
            const y = 22 + i * 36
            return (
              <line
                key={n.id}
                x1={0}
                y1={y}
                x2={24}
                y2={y}
                stroke={n.color}
                strokeOpacity={0.5}
                strokeWidth={1.2}
                strokeDasharray="3 3"
              />
            )
          })}
        </svg>
      </div>
    </div>
  )
}
