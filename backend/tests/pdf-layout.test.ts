import { expect, test } from "bun:test";
import { pdf_page_text } from "../src/services/pdf-layout";

const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({
  str, transform: [10, 0, 0, 10, x, y], width, height: 10, hasEOL,
});

test("uses projected PDF positions to reconnect numeric data with stacked column headers", () => {
  const text = pdf_page_text([
    item("Example sector", 40, 88, 66), item("(Values in millions)", 171, 122, 92), item("% Change", 338, 122, 48),
    item("APR–", 211, 110, 24), item("APR–", 378, 110, 24),
    item("OCT", 159, 100, 21), item("OCT", 212, 100, 21), item("OCT", 329, 100, 21), item("OCT", 379, 100, 21),
    item("1022.77", 151, 88, 31), item("13.32", 380, 88, 22), item("5523.20", 205, 88, 31), item("13.76", 330, 88, 22),
    item("Other sector", 40, 76, 60), item("99.20", 160, 76, 22), item("205.30", 209, 76, 27),
    item("8.20", 334, 76, 18), item("11.15", 380, 76, 22),
  ]);
  expect(text).toContain("Columns: (Values in millions) OCT | (Values in millions) APR– OCT | % Change OCT | % Change APR– OCT\n" +
    "Example sector | 1022.77 | 5523.20 | 13.76 | 13.32\nOther sector | 99.20 | 205.30 | 8.20 | 11.15");
});

test("preserves the native text order of prose in separate reading columns", () => {
  const prose = pdf_page_text([
    item("First paragraph starts here.", 30, 100, 140, true), item("It continues here.", 30, 88, 80, true),
    item("The next paragraph starts here.", 300, 100, 170, true),
  ]);
  expect(prose.trim()).toBe("First paragraph starts here.\nIt continues here.\nThe next paragraph starts here.");
});
