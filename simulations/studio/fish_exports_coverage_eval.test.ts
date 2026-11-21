import { expect, test } from "bun:test";
import { mpeda_exports_url, revised_estimates_url, score_fish_exports } from "./fish_exports_coverage_eval";

const fiscal = [
  "# India's fish export market",
  "## Annual benchmark",
  "In FY 2025–26, India exported 19,72,018 MT of seafood worth US$8.46 billion. [^P1]",
  "Frozen shrimp accounted for 792,647 metric tonnes and USD 5,624.48 million. [^P1]",
  "In FY 2025–26, frozen fish reached 355,581 MT and USD 643.70 million. [^P1]",
  "Comparable calendar-year 2026 frozen-fish figures were unavailable in these records. [^P1]",
];
const cited_tail = [
  "## Talk track",
  "The official FY benchmark includes frozen fish at USD 643.70 million. [^P1]",
  "## Sources",
  `[^P1]: [MPEDA](<${mpeda_exports_url}>) (public).`,
  `[^P2]: [Quick Estimates](<${revised_estimates_url}>) (public).`,
];
const document_with = (row: string) => [...fiscal, "## Provisional marine products exports", row + " [^P2]", ...cited_tail].join("\n\n");

test("requires both correctly paired, cited table values in the approved URL scenario", () => {
  const variants = [
    "India's marine products exports reached USD 1,022.77 million in October 2026 and US$5,523.20 million in April–October 2026.",
    "October 2026: $1,022.77M; April through October 2026: $5,523.2M.",
    "Marine products for October 2026 and April–October 2026 were USD 1,022.77 million and USD 5,523.20 million, respectively.",
  ];
  for (const row of variants) {
    expect(score_fish_exports(document_with(row), true)).toMatchObject({ passed: true, october_value: true, april_october_value: true });
  }
  expect(score_fish_exports(document_with(variants[2]).replace(revised_estimates_url, "https://www.commerce.gov.in/ministryofcommerce/node/5280"), true).passed).toBe(false);
});

test("fails the observed month-as-year-to-date error and the swapped period pair", () => {
  for (const row of [
    "The Ministry of Commerce October 2026 quick estimates show marine products at $1,022.77 million for April–October 2026, up 13.32% versus April–October 2025.",
    "October 2026 exports were USD 5,523.20 million and April–October 2026 exports were USD 1,022.77 million.",
    "Marine products for October 2026 and April–October 2026 were USD 5,523.20 million and USD 1,022.77 million, respectively.",
    "October 2026 exports were USD 1,022.77 million; January–October 2026 exports were USD 5,523.20 million.",
  ]) {
    expect(score_fish_exports(document_with(row), true)).toMatchObject({ passed: false, periods_consistent: false });
    expect(score_fish_exports(document_with(row))).toMatchObject({ passed: false, periods_consistent: false });
  }
  const contradictory_talk = document_with("October 2026: $1,022.77M; April–October 2026: $5,523.20M.")
    .replace("The official FY benchmark includes frozen fish at USD 643.70 million. [^P1]",
      "Marine products reached USD 1,022.77 million in April–October 2026. [^P2]");
  expect(score_fish_exports(contradictory_talk, true)).toMatchObject({
    passed: false, periods_consistent: false, october_value: true, april_october_value: true,
  });
});

test("allows a supported fiscal benchmark when an autonomous search finds no comparable period data", () => {
  const benchmark = [...fiscal, ...cited_tail].join("\n\n");
  expect(score_fish_exports(benchmark)).toMatchObject({ passed: true, october_value: false, april_october_value: false });
  expect(score_fish_exports(benchmark, true).passed).toBe(false);
  expect(score_fish_exports(benchmark.replace("355,581 MT", "355,581 USD")).passed).toBe(false);
  expect(score_fish_exports(benchmark.replace("USD 643.70 million", "643.70 million")).passed).toBe(false);
});
