import { describe, it, expect } from "vitest";
import { filterJobPosts, JOB_KEYWORDS } from "./facebook-scraper.js";
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
