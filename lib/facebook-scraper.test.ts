import { describe, it, expect } from "vitest";
import { filterJobPosts, JOB_KEYWORDS, buildJobToneDescription } from "./facebook-scraper.js";
import type { ScrapedPost } from "./facebook-scraper.js";

function makePost(content: string): ScrapedPost {
  return { url: "https://facebook.com/groups/test#post-0", content, imageBase64: [] };
}

describe("filterJobPosts", () => {
  it("keeps posts that contain a job keyword", () => {
    const post = makePost("Se busca candidato para vacante de repartidor, buen sueldo");
    expect(filterJobPosts([post])).toHaveLength(1);
  });

  it("drops posts with no job keywords", () => {
    const post = makePost("Vendo refrigerador en buen estado, llama al 5512345678");
    expect(filterJobPosts([post])).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const post = makePost("OFERTA DE EMPLEO disponible hoy");
    expect(filterJobPosts([post])).toHaveLength(1);
  });

  it("returns empty array when given empty array", () => {
    expect(filterJobPosts([])).toHaveLength(0);
  });

  it("matches keyword 'whatsapp' as recruitment contact signal", () => {
    const post = makePost("Manda mensaje por WhatsApp al 5512345678 para más info");
    expect(filterJobPosts([post])).toHaveLength(1);
  });

  it("matches keyword 'uniforme' as upfront-fee signal", () => {
    const post = makePost("Debes pagar tu uniforme antes de empezar");
    expect(filterJobPosts([post])).toHaveLength(1);
  });

  it("JOB_KEYWORDS contains expected core keywords", () => {
    const kws = JOB_KEYWORDS as readonly string[];
    expect(kws).toContain("trabajo");
    expect(kws).toContain("vacante");
    expect(kws).toContain("uniforme");
    expect(kws).toContain("depósito");
  });
});

describe("buildJobToneDescription", () => {
  it("returns full structured prefix when all fields present", () => {
    const result = buildJobToneDescription({
      tone_description: "WhatsApp recruitment scam",
      tone_keywords: ["job_offer", "uniform_fee"],
      image_descriptions: [],
      location_text: "Colonia Roma Norte",
      job_title: "Delivery driver",
      company_name: "Empresa XYZ",
      salary_mentioned: "$500/día",
      upfront_fee: "$300 MXN uniforme",
      contact_method: "WhatsApp 5512345678",
    });
    expect(result).toBe("[Delivery driver @ Empresa XYZ — $300 MXN uniforme fee] WhatsApp recruitment scam");
  });

  it("omits prefix parts that are null", () => {
    const result = buildJobToneDescription({
      tone_description: "Fake job via WhatsApp",
      tone_keywords: [],
      image_descriptions: [],
      location_text: null,
      job_title: "Promotor",
      company_name: null,
      salary_mentioned: null,
      upfront_fee: null,
      contact_method: null,
    });
    expect(result).toBe("[Promotor] Fake job via WhatsApp");
  });

  it("returns tone_description only when no prefix fields are set", () => {
    const result = buildJobToneDescription({
      tone_description: "Generic recruitment scam",
      tone_keywords: [],
      image_descriptions: [],
      location_text: null,
      job_title: null,
      company_name: null,
      salary_mentioned: null,
      upfront_fee: null,
      contact_method: null,
    });
    expect(result).toBe("Generic recruitment scam");
  });

  it("returns null when tone_description is null and no prefix fields", () => {
    const result = buildJobToneDescription({
      tone_description: null,
      tone_keywords: [],
      image_descriptions: [],
      location_text: null,
      job_title: null,
      company_name: null,
      salary_mentioned: null,
      upfront_fee: null,
      contact_method: null,
    });
    expect(result).toBeNull();
  });
});
