import { apiPost } from '../../lib/http'
import type { NewsResponse } from './types'

export function fetchPersonNews(body: { id_victimadirecta?: string; fullname?: string }): Promise<NewsResponse> {
  return apiPost<NewsResponse>('/firecrawl/news', body)
}

export type { NewsResponse, NewsAnalysis, RelatedPerson, NewsSource, NewsStatus } from './types'
