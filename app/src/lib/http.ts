import { supabase } from './supabase'

// Vite's built-in DEV is true only under `vite dev` and false in `vite build`,
// so production deploys never point at localhost. (The old `VITE_DEV` env var was
// committed as `true` in app/.env, leaking http://localhost:8000 into the prod
// bundle and breaking every backend call on the live site.) Local dev still hits
// localhost:8000; prod uses VITE_API_URL or the deployed backend.
export const API_URL = import.meta.env.DEV
  ? 'http://localhost:8000'
  : import.meta.env.VITE_API_URL || 'https://sendero-backend.paoloose.site'

async function headers(extra?: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: await headers() })
  return handle<T>(res)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: await headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  return handle<T>(res)
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: await headers(),
  })
  await handle<void>(res)
}
