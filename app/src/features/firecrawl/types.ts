export type NewsStatus = 'found_dead' | 'found_alive' | 'not_found'

export interface RelatedPerson {
  person_name: string
  person_status: string
  status_enum: NewsStatus
  related_people: RelatedPerson[]
}

export interface NewsAnalysis {
  person_status: string
  status_enum: NewsStatus
  related_people: RelatedPerson[]
}

export interface NewsSource {
  url: string | null
  title: string | null
  snippet: string | null
}

export interface NewsResponse {
  query: string
  sources: NewsSource[]
  analysis: NewsAnalysis
}
