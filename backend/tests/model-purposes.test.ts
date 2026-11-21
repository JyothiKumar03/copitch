import { expect, test } from "bun:test";
import { configured_models_for } from "../src/services/model-config";

test("purpose routing prioritizes dedicated entries and preserves the order of compatible fallbacks", () => {
  const base = { provider: "openai", max_output_tokens: 500 };
  const config = JSON.stringify([
    { ...base, model: "general" },
    { ...base, model: "quick", purposes: ["interview", "live"] },
    { ...base, model: "synthesis", purposes: ["research"] },
  ]);
  expect(configured_models_for("interview", config).map(entry => entry.model)).toEqual(["quick", "general"]);
  expect(configured_models_for("research", config).map(entry => entry.model)).toEqual(["synthesis", "general"]);
  expect(configured_models_for("planning", config).map(entry => entry.model)).toEqual(["general"]);
  expect(configured_models_for("research", JSON.stringify([{ ...base, model: "quick", purposes: ["live"] }]))).toEqual([]);
});
