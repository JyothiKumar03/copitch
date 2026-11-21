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
