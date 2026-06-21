import { apiPost } from '../../lib/http'
import type { CuerpoQuery, PreviewResult } from './types'

export const matchPreview = (q: CuerpoQuery) =>
  apiPost<PreviewResult>('/match/preview', q)

// Notify the families linked to a matched persona (cross-user realtime alert).
export const notifyMatch = (persona_victima_id: string, nombre: string | null, score: number, tier: string) =>
  apiPost<{ notified: number }>('/match/notify', { persona_victima_id, nombre, score, tier })
