import { apiDelete, apiGet, apiPost } from '../../lib/http'
import type { PersonaList, VinculoOut } from './types'

export const searchPersonas = (q: string, limit = 15) =>
  apiGet<PersonaList>(`/personas?q=${encodeURIComponent(q)}&limit=${limit}`)

export const listPersonas = (limit = 20, offset = 0) =>
  apiGet<PersonaList>(`/personas?limit=${limit}&offset=${offset}`)

export const getMyVinculo = () => apiGet<VinculoOut | null>('/me/vinculo')

export const createVinculo = (persona_victima_id: string, parentesco?: string) =>
  apiPost<VinculoOut>('/me/vinculo', { persona_victima_id, parentesco })

export const deleteVinculo = () => apiDelete('/me/vinculo')
