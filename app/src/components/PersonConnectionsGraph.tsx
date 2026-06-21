import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { useTheme } from '../features/theme'
import type { RelatedPerson, NewsStatus } from '../features/firecrawl'

// react-force-graph-2d touches `window` / canvas — lazy-load it so the
// initial bundle stays small and SSR (if added later) won't break.
const ForceGraph2D = lazy(() => import('react-force-graph-2d'))

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

const STATUS_LABEL: Record<NewsStatus, string> = {
  found_dead: 'Localizada sin vida',
  found_alive: 'Localizada con vida',
  not_found: 'Sin información reciente',
}

function flatten(
  rootName: string,
  rootNarrative: string,
  people: RelatedPerson[]
): { nodes: FlatNode[]; links: FlatLink[]; narratives: Map<string, string> } {
  const narratives = new Map<string, string>()
  narratives.set('__root__', rootNarrative)

  const nodes: FlatNode[] = [
    { id: '__root__', name: rootName, status: 'not_found', isRoot: true, val: 14, color: '#F2921D' },
  ]
  const links: FlatLink[] = []

  function walk(p: RelatedPerson, parentId: string) {
    const id = p.person_name + '|' + parentId + '|' + nodes.length
    nodes.push({
      id,
      name: p.person_name,
      status: p.status_enum,
      val: 6,
      color: STATUS_COLOR[p.status_enum],
    })
    narratives.set(id, p.person_status || '')
    links.push({ source: parentId, target: id })
    for (const child of p.related_people) {
      walk(child, id)
    }
  }

  for (const p of people) {
    walk(p, '__root__')
  }

  // De-duplicate nodes that share the same name across branches (common with
  // "abuelos", "tíos" mentioned in multiple stories) by merging them into the
  // first occurrence and rewiring links.
  const seen = new Map<string, string>() // name -> first id
  const dedupNodes: FlatNode[] = []
  const dedupNarratives = new Map<string, string>(narratives)
  const remap = new Map<string, string>()
  for (const n of nodes) {
    const existing = seen.get(n.name)
    if (existing && n.id !== '__root__') {
      remap.set(n.id, existing)
    } else {
      dedupNodes.push(n)
      if (n.id !== '__root__') seen.set(n.name, n.id)
    }
  }
  const dedupLinks: FlatLink[] = []
  for (const l of links) {
    const s = remap.get(l.source) ?? l.source
    const t = remap.get(l.target) ?? l.target
    if (s !== t) dedupLinks.push({ source: s, target: t })
  }

  return { nodes: dedupNodes, links: dedupLinks, narratives: dedupNarratives }
}

interface Props {
  rootName: string
  rootNarrative: string
  relatedPeople: RelatedPerson[]
  height?: number
}

export function PersonConnectionsGraph({ rootName, rootNarrative, relatedPeople, height = 440 }: Props) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>(0)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Ref to the force-graph instance so we can tweak d3 forces (longer links,
  // stronger repulsion) after mount.
  const fgRef = useRef<{
    d3Force: (name: string) => { distance?: (n: number) => unknown; strength?: (n: number) => unknown } | undefined
    d3ReheatSimulation: () => void
  } | null>(null)

  const data = useMemo(
    () => flatten(rootName, rootNarrative, relatedPeople),
    [rootName, rootNarrative, relatedPeople]
  )

  // Measure the parent so the canvas resizes with the layout.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width
        if (w > 0) setWidth(w)
      }
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Once the graph has mounted, stretch the links and increase repulsion so
  // the tree has room to breathe (esp. with 3+ levels).
  useEffect(() => {
    if (width === 0) return
    // Defer one frame so the lazy component has a chance to register its ref.
    const t = setTimeout(() => {
      const fg = fgRef.current as unknown as {
        d3Force?: (name: string) => { distance?: (n: number) => unknown; strength?: (n: number) => unknown } | undefined
        d3ReheatSimulation?: () => void
      } | null
      if (!fg || !fg.d3Force) return
      const link = fg.d3Force('link')
      if (link && typeof link.distance === 'function') link.distance(270)
      const charge = fg.d3Force('charge')
      if (charge && typeof charge.strength === 'function') charge.strength(-400)
      if (typeof fg.d3ReheatSimulation === 'function') fg.d3ReheatSimulation()
    }, 50)
    return () => clearTimeout(t)
  }, [width, data])

  if (relatedPeople.length === 0) return null

  // Distinct, theme-aware canvas background so the graph reads as its own
  // "stage" — a warm sand in light mode, a warm-tinted dark in dark mode.
  const bg = theme === 'dark' ? '#1F1A14' : '#EDE3D2'
  const labelColor = theme === 'dark' ? '#f0f0f0' : '#1A1A1A'
  const panelBg = theme === 'dark' ? 'rgba(20,20,20,0.92)' : 'rgba(255,255,255,0.96)'
  const panelBorder = theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'var(--surface-card-border)'

  const hoveredNode = hoveredId ? data.nodes.find(n => n.id === hoveredId) ?? null : null
  const hoveredNarrative = hoveredId ? data.narratives.get(hoveredId) ?? '' : ''

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height,
        background: bg,
        borderRadius: 12,
        border: '1px solid var(--surface-card-border)',
        overflow: 'hidden',
      }}
    >
      {width > 0 && (
        <Suspense
          fallback={
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: 12 }}>
              Cargando grafo…
            </div>
          }
        >
          <ForceGraph2D
            ref={fgRef as unknown as React.ComponentProps<typeof ForceGraph2D>['ref']}
            graphData={data}
            width={width}
            height={height}
            backgroundColor={bg}
            nodeRelSize={5}
            nodeLabel={() => '' /* disabled — we use the right-side panel instead */}
            nodeColor={(n: unknown) => (n as FlatNode).color}
            nodeVal={(n: unknown) => (n as FlatNode).val}
            nodeCanvasObjectMode={() => 'after'}
            onNodeHover={(node: unknown) => setHoveredId(node ? (node as FlatNode).id : null)}
            linkColor={() => (theme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(26,26,26,0.25)')}
            linkWidth={1.2}
            linkDirectionalParticles={0}
            cooldownTicks={140}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            nodeCanvasObject={(node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const n = node as FlatNode & { x?: number; y?: number }
              if (n.x == null || n.y == null) return
              const label = n.name
              const fontSize = n.isRoot ? 14 / globalScale : 11 / globalScale
              ctx.font = `${n.isRoot ? 600 : 500} ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              const padding = 4 / globalScale
              const textWidth = ctx.measureText(label).width
              ctx.fillStyle = theme === 'dark' ? 'rgba(31,26,20,0.85)' : 'rgba(237,227,210,0.92)'
              ctx.fillRect(n.x - textWidth / 2 - padding, n.y + 8 / globalScale, textWidth + padding * 2, fontSize + padding)
              ctx.fillStyle = n.isRoot ? '#F2921D' : labelColor
              ctx.fillText(label, n.x, n.y + 8 / globalScale)
            }}
          />
        </Suspense>
      )}

      {/* Right-side hover detail panel */}
      {hoveredNode && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 240,
            maxHeight: height - 24,
            overflowY: 'auto',
            background: panelBg,
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: `1px solid ${panelBorder}`,
            borderRadius: 12,
            padding: '12px 14px',
            zIndex: 5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: hoveredNode.color,
                flexShrink: 0,
                border: hoveredNode.isRoot ? '2px solid #F2921D' : 'none',
                boxSizing: 'border-box',
              }}
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                lineHeight: 1.3,
                wordBreak: 'break-word',
                flex: 1,
              }}
            >
              {hoveredNode.name}
            </span>
          </div>
          <div
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 40,
              background: hoveredNode.isRoot ? 'rgba(242,146,29,0.12)' : `${hoveredNode.color}1A`,
              border: hoveredNode.isRoot ? '1px solid rgba(242,146,29,0.35)' : `1px solid ${hoveredNode.color}55`,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: hoveredNode.isRoot ? '#F2921D' : hoveredNode.color,
              marginBottom: 8,
            }}
          >
            {hoveredNode.isRoot ? 'Persona buscada' : STATUS_LABEL[hoveredNode.status]}
          </div>
          {hoveredNarrative && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}
            >
              {hoveredNarrative}
            </div>
          )}
          {!hoveredNarrative && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
              Sin descripción adicional en las notas consultadas.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
