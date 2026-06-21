from fastapi import APIRouter, Depends, HTTPException

from ...db import get_db
from ..auth.dependencies import get_current_user
from . import service
from .schemas import CuerpoQuery, NotifyMatchIn, PersonaCandidatos, PreviewResult

router = APIRouter(tags=["matching"])


@router.get("/personas/{persona_id}/candidatos", response_model=PersonaCandidatos)
def persona_candidatos(persona_id: int, db=Depends(get_db)):
    """Stored ranked cuerpo candidates for a persona (by integer id)."""
    uuid = service.persona_uuid(db, persona_id)
    if not uuid:
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    rows = service.candidatos_for_persona(db, uuid)
    return PersonaCandidatos(persona_victima_id=uuid, candidatos=rows)


@router.post("/match/preview", response_model=PreviewResult)
def match_preview(query: CuerpoQuery, db=Depends(get_db)):
    """A new body comes in → embed → retrieve → score → verify → ranked personas.
    Read-only: nothing is persisted."""
    retrieved, via, candidatos = service.preview_match(db, query.model_dump())
    return PreviewResult(retrieved=retrieved, via=via, candidatos=candidatos)


@router.post("/match/notify", status_code=201)
def notify_match(body: NotifyMatchIn, user=Depends(get_current_user), db=Depends(get_db)):
    """A reporter's finding strongly matched a persona → notify the families
    linked to that persona (realtime in-app alert). Excludes the reporter."""
    n = service.notify_linked_of_match(
        db, body.persona_victima_id, body.nombre, body.score, body.tier, user.id
    )
    return {"notified": n}
