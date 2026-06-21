from pydantic import BaseModel


class CandidatoOut(BaseModel):
    cuerpo_id: str
    cuerpo_codigo: str | None = None
    score: float
    tier: str
    evidencia: list[str] = []
    contradicciones: list[str] = []
    razonamiento: str | None = None
    estado: str
    cuerpo_sexo: str | None = None
    cuerpo_estado: str | None = None
    cuerpo_senas: str | None = None


class PersonaCandidatos(BaseModel):
    persona_victima_id: str
    candidatos: list[CandidatoOut]


class CuerpoQuery(BaseModel):
    """A new unidentified body to match live (preview — nothing is persisted)."""
    sexo: str | None = None
    edad_min: int | None = None
    edad_max: int | None = None
    estatura_cm: int | None = None
    senas: str | list[str] | None = None
    media_filiacion: str | None = None
    estado: str | None = None
    fecha_hallazgo: str | None = None


class PreviewCandidate(BaseModel):
    persona_victima_id: str
    nombre: str | None = None
    score: float
    tier: str
    evidencia: list[str] = []
    contradicciones: list[str] = []
    razonamiento: str | None = None


class PreviewResult(BaseModel):
    retrieved: int
    via: str  # "vector" | "brute"
    candidatos: list[PreviewCandidate]


class NotifyMatchIn(BaseModel):
    """Reporter found a strong match for a persona → notify families linked to it."""
    persona_victima_id: str
    nombre: str | None = None
    score: float
    tier: str
