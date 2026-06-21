from supabase import AsyncClient

TABLE = "personas_desaparecidas"

LIST_COLS = (
    "id,id_victimadirecta,nombre,primer_apellido,segundo_apellido,sexo,"
    "edad_actual,estado,municipio,estatus_victima"
)
DETAIL_COLS = (
    LIST_COLS + ",fecha_hechos,fecha_percato,sana_particular,media_filiacion,fotografia"
)


def parse_filiacion(raw: str | None) -> dict[str, str]:
    """media_filiacion is a '<br>'-delimited 'KEY: value' blob."""
    out: dict[str, str] = {}
    for part in (raw or "").split("<br>"):
        if ":" in part:
            key, value = part.split(":", 1)
            if key.strip():
                out[key.strip()] = value.strip()
    return out


def parse_senas(raw: str | None) -> list[str]:
    """sana_particular is '<br>'-delimited; 'NINGUNA' means no marks."""
    items = [s.strip() for s in (raw or "").split("<br>") if s.strip()]
    return [s for s in items if s.upper() != "NINGUNA"]


def build_detail(row: dict) -> dict:
    """Shape a raw personas row into the PersonaDetail field set (parsed señas +
    filiación). Returned as a dict so callers can hand it to PersonaDetail(**...)."""
    fields = (
        "id", "id_victimadirecta", "nombre", "primer_apellido", "segundo_apellido",
        "sexo", "edad_actual", "estado", "municipio", "estatus_victima",
        "fecha_hechos", "fecha_percato", "fotografia",
    )
    return {
        **{k: row.get(k) for k in fields},
        "senas": parse_senas(row.get("sana_particular")),
        "filiacion": {
            "raw": row.get("media_filiacion"),
            "parsed": parse_filiacion(row.get("media_filiacion")),
        },
    }


async def list_personas(
    sb: AsyncClient,
    *,
    estado: str | None,
    sexo: str | None,
    q: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    query = sb.table(TABLE).select(LIST_COLS, count="exact")
    if estado:
        query = query.ilike("estado", f"%{estado}%")
    if sexo:
        query = query.eq("sexo", sexo)
    if q:
        # Each whitespace-delimited word must match (AND) in any of the three
        # name columns (OR). PostgREST's top-level filters are ANDed together,
        # so chaining one .or_() per word gives us word-AND × field-OR.
        for word in q.split():
            if not word:
                continue
            pat = f"%{word}%"
            query = query.or_(
                f"nombre.ilike.{pat},"
                f"primer_apellido.ilike.{pat},"
                f"segundo_apellido.ilike.{pat}"
            )
    query = query.order("id").range(offset, offset + limit - 1)
    res = await query.execute()
    return res.data, res.count or 0


async def get_persona(sb: AsyncClient, persona_id: int) -> dict | None:
    res = (
        await sb.table(TABLE)
        .select(DETAIL_COLS)
        .eq("id", persona_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def get_persona_by_victima(sb: AsyncClient, victima_id: str) -> dict | None:
    """Full detail row keyed by the stable natural key id_victimadirecta."""
    res = (
        await sb.table(TABLE)
        .select(DETAIL_COLS)
        .eq("id_victimadirecta", victima_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def get_imagen_by_victima(sb: AsyncClient, victima_id: str) -> str | None:
    """The raw `data:image/...;base64,...` URI for a persona, by stable victima id."""
    res = (
        await sb.table(TABLE)
        .select("imagen")
        .eq("id_victimadirecta", victima_id)
        .limit(1)
        .execute()
    )
    return res.data[0]["imagen"] if res.data else None
