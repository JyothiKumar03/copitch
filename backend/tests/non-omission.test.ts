import { expect, test } from "bun:test";
import { is_non_omission } from "../src/services/slide-content";

test("placeholder omissions from a reviewer are not treated as gaps", () => {
  // Seen on the deployed run of 2026-11-22.
  expect(is_non_omission("No omission to report; the supported slides cover the requested self-introduction content for Jyothi Kumar.")).toBe(true);
  expect(is_non_omission("No omissions identified for the requested objective.")).toBe(true);
  expect(is_non_omission("None")).toBe(true);
  expect(is_non_omission("Nothing is missing from the objective.")).toBe(true);
  // Real gaps stay.
  expect(is_non_omission("The deck omits the 2024 revenue figure the host asked for.")).toBe(false);
  expect(is_non_omission("No comparison between enterprise and overall conversion is shown.")).toBe(false);
});
