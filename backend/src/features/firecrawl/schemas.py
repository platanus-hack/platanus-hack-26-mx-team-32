from typing import Literal

from pydantic import BaseModel, Field


class FirecrawlSearchRequest(BaseModel):
    query: str
    sources: list[str] = Field(default=["news", "web", "images"])
    limit: int = 10
    location: str = "Mexico"
    tbs: str | None = "qdr:w"


# ── /firecrawl/news ────────────────────────────────────────────────────────


class NewsRequest(BaseModel):
    """Trigger a Firecrawl news search for a victim and return an LLM analysis.

    The frontend sends the victim's `id_victimadirecta` (stable UUID); the
    backend looks the person up to build the Firecrawl query. As a fallback,
    `fullname` may be passed directly (useful for personas without a known
    UUID or for debugging).
    """

    id_victimadirecta: str | None = None
    fullname: str | None = None


# The status enum is shared by the root person and every node in the tree.
StatusEnum = Literal["found_dead", "found_alive", "not_found"]


class RelatedPerson(BaseModel):
    """A node in the related-people tree. Recursive."""

    person_name: str
    person_status: str
    status_enum: StatusEnum
    related_people: list["RelatedPerson"] = Field(default_factory=list)


# Resolve the forward reference so Pydantic can validate the recursive model.
RelatedPerson.model_rebuild()


class NewsAnalysis(BaseModel):
    """The structured output the LLM produces from the Firecrawl results."""

    person_status: str
    status_enum: StatusEnum
    related_people: list[RelatedPerson] = Field(default_factory=list)


class NewsResponse(BaseModel):
    """What the endpoint returns: the analysis plus the raw news sources."""

    query: str
    sources: list[dict] = Field(default_factory=list)
    analysis: NewsAnalysis
