"""Match service — reads stored candidatos and runs the live preview funnel."""
import json

from psycopg.rows import dict_row

from src.config import settings

from .embeddings import embed_one, embed_texts, record_text, to_vector_literal
from .engine import rank_personas_for_cuerpo
from .tuning import CONFIG
from .verify import verify_pair

_PERSONA_COLS = r"""
       p.id_victimadirecta::text as id_victimadirecta, p.nombre::text as nombre,
       p.sexo::text as sexo,
       nullif(regexp_replace(coalesce(p.edad_actual::text, ''), '\D', '', 'g'), '')::int as edad,
       p.sana_particular::text as sana_particular, p.media_filiacion::text as media_filiacion,
       p.estado::text as estado, p.fecha_percato::text as fecha_percato,
       p.fecha_hechos::text as fecha_hechos
"""

_RETRIEVE_SQL = f"""
select {_PERSONA_COLS}
from personas_desaparecidas p
join persona_embeddings pe on pe.persona_victima_id = p.id_victimadirecta::text
where pe.embedding is not null
order by pe.embedding <=> %s::vector
limit %s
"""

_ALL_PERSONAS_SQL = f"select {_PERSONA_COLS} from personas_desaparecidas p"

_CANDIDATOS_SQL = """
select ca.cuerpo_id::text as cuerpo_id, c.codigo as cuerpo_codigo,
       ca.score::float as score, ca.tier, ca.evidencia, ca.contradicciones,
       ca.razonamiento, ca.estado,
       c.sexo as cuerpo_sexo, c.estado as cuerpo_estado, c.sana_particular as cuerpo_senas
from candidatos ca
join cuerpos c on c.id = ca.cuerpo_id
where ca.persona_victima_id = %s
order by ca.score desc
"""


def backfill_embeddings(conn, force: bool = False) -> int:
    """Embed records that lack an embedding (or all, if force). Idempotent and
    safe to run anytime — this is how nothing ever stays un-embedded. Caller commits."""
    if not settings.gemini_api_key:
        return 0
    pjoin = (
        ""
        if force
        else "left join persona_embeddings pe on pe.persona_victima_id = p.id_victimadirecta::text "
        "where pe.persona_victima_id is null"
    )
    psql = (
        "select p.id_victimadirecta::text as id, p.sana_particular::text as sana_particular, "
        "p.media_filiacion::text as media_filiacion, p.sexo::text as sexo, p.estado::text as estado "
        f"from personas_desaparecidas p {pjoin}"
    )
    cwhere = "" if force else "where embedding is null"
    csql = f"select id::text as id, sana_particular, media_filiacion, sexo, estado from cuerpos {cwhere}"

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(psql)
        personas = cur.fetchall()
        cur.execute(csql)
        cuerpos = cur.fetchall()

    if not personas and not cuerpos:
        return 0

    pvecs = embed_texts([record_text(p) for p in personas]) if personas else []
    cvecs = embed_texts([record_text(c) for c in cuerpos]) if cuerpos else []
    with conn.cursor() as cur:
        for p, v in zip(personas, pvecs):
            cur.execute(
                """insert into persona_embeddings (persona_victima_id, embedding, updated_at)
                   values (%s, %s::vector, now())
                   on conflict (persona_victima_id)
                   do update set embedding = excluded.embedding, updated_at = now()""",
                (p["id"], to_vector_literal(v)),
            )
        for c, v in zip(cuerpos, cvecs):
            cur.execute(
                "update cuerpos set embedding = %s::vector where id = %s",
                (to_vector_literal(v), c["id"]),
            )
    return len(personas) + len(cuerpos)


def persona_uuid(conn, persona_id: int) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "select id_victimadirecta::text as u from personas_desaparecidas where id = %s",
            (persona_id,),
        )
        row = cur.fetchone()
    return row["u"] if row else None


def candidatos_for_persona(conn, persona_victima_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(_CANDIDATOS_SQL, (persona_victima_id,))
        return cur.fetchall()


def _senas_text(senas) -> str | None:
    if isinstance(senas, list):
        return "<br>".join(str(s) for s in senas)
    return senas


def notify_linked_of_match(
    conn, persona_victima_id: str, nombre: str | None, score: float, tier: str, exclude_user_id: str
) -> int:
    """Insert a 'match' notification for every family linked to this persona
    (except the reporter). Returns how many were notified."""
    payload = json.dumps(
        {"persona_victima_id": persona_victima_id, "nombre": nombre, "score": score, "tier": tier}
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into notificaciones (usuario_id, tipo, payload)
            select v.usuario_id, 'match', %s::jsonb
            from vinculos v
            where v.persona_victima_id = %s and v.usuario_id <> %s
            """,
            (payload, persona_victima_id, exclude_user_id),
        )
        n = cur.rowcount
    conn.commit()
    return n


def preview_match(conn, query: dict, k_retrieve: int | None = None, top_n: int | None = None) -> tuple[int, str, list[dict]]:
    k_retrieve = CONFIG.retrieve_k if k_retrieve is None else k_retrieve
    top_n = CONFIG.top_k if top_n is None else top_n
    cuerpo = {
        "sexo": query.get("sexo"),
        "edad_min": query.get("edad_min"),
        "edad_max": query.get("edad_max"),
        "estatura_cm": query.get("estatura_cm"),
        "sana_particular": _senas_text(query.get("senas")),
        "media_filiacion": query.get("media_filiacion"),
        "estado": query.get("estado"),
        "fecha_hallazgo": query.get("fecha_hallazgo"),
    }

    if settings.gemini_api_key:
        vec = embed_one(record_text(cuerpo))
        with conn.cursor() as cur:
            cur.execute(_RETRIEVE_SQL, (to_vector_literal(vec), k_retrieve))
            personas = cur.fetchall()
        via = "vector"
    else:
        with conn.cursor() as cur:
            cur.execute(_ALL_PERSONAS_SQL)
            personas = cur.fetchall()
        via = "brute"

    by_uuid = {p["id_victimadirecta"]: p for p in personas}
    out = []
    for i, r in enumerate(rank_personas_for_cuerpo(cuerpo, personas, top_k=top_n)):
        persona = by_uuid[r["persona_victima_id"]]
        v = verify_pair(persona, cuerpo, r, use_llm=i < CONFIG.llm_verify_top_n)
        out.append({
            "persona_victima_id": r["persona_victima_id"],
            "nombre": persona.get("nombre"),
            "score": r["score"],
            "tier": v["tier"],
            "evidencia": v["evidencia"],
            "contradicciones": v["contradicciones"],
            "razonamiento": v["razonamiento"],
        })
    return len(personas), via, out
