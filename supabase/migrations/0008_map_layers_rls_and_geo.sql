-- 0008_map_layers_rls_and_geo.sql
-- Make the 3 map layers readable by the public (anon) key and mappable.
--
-- Context: the map layers read Supabase with the publishable/anon key.
--   · personas_desaparecidas → already had "Enable read for all" (works)
--   · facebook_patterns ("trabajos falsos") → RLS enabled but NO select policy
--       ⇒ anon read returned 0 rows (layer empty). Rows are scam job ads from
--         public FB groups (not PII), so public read is acceptable.
--   · social_risk_events ("fosas") → was blocked for anon (anon_no_*, qual=false)
--       and had no coordinates. We geocode estado/municipio to MUNICIPIO
--       CENTROIDS (not exact grave locations — privacy-preserving) and expose read.
--
-- NOTE: the coordinate VALUES are populated by a one-off data script against prod
-- (geocoded via Google), not by this migration. This file captures only the schema
-- + RLS so the change is reproducible/reviewable.

-- trabajos: allow anon read
drop policy if exists "anon_read_facebook_patterns" on public.facebook_patterns;
create policy "anon_read_facebook_patterns"
  on public.facebook_patterns for select to public using (true);

-- fosas: add centroid coords + allow anon read
alter table public.social_risk_events add column if not exists latitud  numeric;
alter table public.social_risk_events add column if not exists longitud numeric;

drop policy if exists "anon_no_social_risk_events"   on public.social_risk_events;
drop policy if exists "anon_read_social_risk_events" on public.social_risk_events;
create policy "anon_read_social_risk_events"
  on public.social_risk_events for select to public using (true);
