export const source_formats = {
  pdf: { tool: "parse_pdf", location: "page" },
  ppt: { tool: "parse_ppt", location: "slide" },
  pptx: { tool: "parse_pptx", location: "slide" },
  csv: { tool: "parse_csv", location: "CSV row" },
} as const;

export const source_limits = {
  bytes: 8 * 1024 * 1024,
  pages: 120,
  characters: 32_000,
  timeout_ms: 15_000,
} as const;

// Public reports read during research: national statistics and annual reports run to hundreds of pages.
export const research_pdf_limits = {
  bytes: 30 * 1024 * 1024,
  pages: 400,
  characters: 1_500_000,
  timeout_ms: 25_000,
} as const;

export type TSourceLimits = { bytes: number; pages: number; characters: number; timeout_ms: number };
