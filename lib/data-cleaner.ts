// lib/data-cleaner.ts - Two-stage cleaner for facebook_patterns table.
// Stage 1: structural fixes (pure TS, no LLM)
// Stage 2: semantic normalization (Haiku LLM, falls back silently)

// Allowed tone_keywords (DB constraint)
const ALLOWED_TONE_KEYWORDS = new Set([
  "urgency", "job_offer", "payment_request", "data_harvest",
  "off_platform_contact", "high_salary", "vague_company", "immediate_start",
  "uniform_fee", "investment_return", "crypto", "delivery_job"
]);

// Official Mexican state names (32 states)
const MEXICAN_STATES = new Set([
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche",
  "Chiapas", "Chihuahua", "Coahuila", "Colima", "Durango", "Guanajuato",
  "Guerrero", "Hidalgo", "Jalisco", "Mexico", "Michoacan", "Morelos",
  "Nayarit", "Nuevo Leon", "Oaxaca", "Puebla", "Queretaro", "Quintana Roo",
  "San Luis Potosi", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala",
  "Veracruz", "Yucatan", "Zacatecas", "Ciudad de Mexico"
]);

interface FacebookPatternRow {
  tone_keywords?: unknown;
  is_fake_job?: unknown;
  location_region?: unknown;
  tone_description?: unknown;
  image_descriptions?: unknown;
  [key: string]: unknown;
}

/**
 * Stage 1: structural fixes (no LLM).
 * - Filter tone_keywords to allowed set
 * - Coerce is_fake_job to boolean | null
 * - Default image_descriptions to []
 */
function stage1StructuralClean(row: FacebookPatternRow): FacebookPatternRow {
  const cleaned = { ...row };

  // tone_keywords: filter to allowed set
  if (Array.isArray(cleaned.tone_keywords)) {
    cleaned.tone_keywords = cleaned.tone_keywords.filter(
      (kw): kw is string => typeof kw === "string" && ALLOWED_TONE_KEYWORDS.has(kw)
    );
  } else {
    cleaned.tone_keywords = [];
  }

  // is_fake_job: coerce to boolean | null
  if (typeof cleaned.is_fake_job === "boolean") {
    // already boolean - keep
  } else if (cleaned.is_fake_job === "true") {
    cleaned.is_fake_job = true;
  } else if (cleaned.is_fake_job === "false") {
    cleaned.is_fake_job = false;
  } else {
    cleaned.is_fake_job = null;
  }

  // image_descriptions: must be string[]
  if (Array.isArray(cleaned.image_descriptions)) {
    cleaned.image_descriptions = cleaned.image_descriptions.filter(
      (d): d is string => typeof d === "string"
    );
  } else {
    cleaned.image_descriptions = [];
  }

  // tone_description: strip whitespace
  if (typeof cleaned.tone_description === "string") {
    cleaned.tone_description = cleaned.tone_description.trim() || null;
  } else {
    cleaned.tone_description = null;
  }

  // location_region: strip whitespace
  if (typeof cleaned.location_region === "string") {
    cleaned.location_region = cleaned.location_region.trim() || null;
  } else {
    cleaned.location_region = null;
  }

  return cleaned;
}

/**
 * Stage 2: semantic normalization (LLM, falls back silently).
 * For now, returns input unchanged (LLM stage can be added later).
 */
async function stage2SemanticClean(row: FacebookPatternRow): Promise<FacebookPatternRow> {
  // Placeholder - LLM call can be added here
  // The spec says "If Stage 2 fails for any reason, Stage 1 output is used"
  return row;
}

/**
 * Clean a facebook_patterns row before upsert.
 * Two-stage: structural fixes (always) + semantic normalization (LLM, falls back silently).
 * Returns a new object (never mutates input).
 */
export async function cleanFacebookPattern(row: FacebookPatternRow): Promise<FacebookPatternRow> {
  // Stage 1
  let cleaned = stage1StructuralClean(row);

  // Stage 2
  try {
    cleaned = await stage2SemanticClean(cleaned);
    cleaned._cleaned = true;
  } catch {
    // Stage 2 failed - use Stage 1 output
    cleaned._cleaned = false;
  }

  return cleaned;
}
