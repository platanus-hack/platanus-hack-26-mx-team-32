import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Notificacion } from './types'

/**
 * Live in-app notifications. RLS scopes rows to the current user; Realtime
 * pushes new ones instantly (drives the unread badge). Created server-side by
 * DB triggers on match / message / evidence — never inserted by the client.
 */
export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<Notificacion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!enabled) {
      console.debug('[notifs] disabled (no vínculo yet) — not subscribing')
      return
    }
    let cancelled = false
    console.debug('[notifs] loading history + subscribing to realtime…')

    supabase
      .from('notificaciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[notifs] history load failed:', error.message, error)
        else console.debug(`[notifs] loaded ${data?.length ?? 0} existing notification(s)`)
        setItems((data ?? []) as Notificacion[])
        setLoading(false)
      })

    const channel = supabase
      .channel('notificaciones')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificaciones' },
        (payload) => {
          console.debug('[notifs] ← realtime INSERT received:', payload.new)
          if (!cancelled) setItems((prev) => [payload.new as Notificacion, ...prev])
        },
      )
      .subscribe((status, err) => {
        console.debug('[notifs] realtime channel status:', status)
        if (err) console.error('[notifs] realtime channel error:', err)
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [enabled])

  const unread = items.filter((n) => !n.leida).length

  const markAllRead = useCallback(async () => {
    const ids = items.filter((n) => !n.leida).map((n) => n.id)
    if (ids.length === 0) return
    setItems((prev) => prev.map((n) => ({ ...n, leida: true })))
    await supabase.from('notificaciones').update({ leida: true }).in('id', ids)
  }, [items])

  return { items, unread, loading, markAllRead }
}
