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

test("models default in code with prices, and an unpriced env entry takes its known price", () => {
  const browse = configured_models_for("browse", "");
  expect(browse[0]).toMatchObject({ model: "gpt-5.6-luna", pricing: { input: 0.20, cached_input: 0.02, output: 1.20 } });
  expect(configured_models_for("interview", "[]").map(entry => entry.model)).toEqual(["gpt-5.4-mini"]);
  const env = JSON.stringify([{ provider: "openai", model: "gpt-5.4-mini", max_output_tokens: 4096 }]);
  expect(configured_models_for("research", env)[0].pricing).toMatchObject({ input: 0.75, cached_input: 0.075, output: 4.50 });
  const custom = JSON.stringify([{ provider: "openai", model: "unknown-model", max_output_tokens: 100 }]);
  expect(configured_models_for("research", custom)[0].pricing).toBeUndefined();
});

test("the default planning model has an 8000 token cap while research and browsing retain 4096", () => {
  expect(configured_models_for("planning", "[]")[0]?.max_output_tokens).toBe(8000);
  expect(configured_models_for("research", "[]")[0]?.max_output_tokens).toBe(4096);
  expect(configured_models_for("browse", "[]")[0]?.max_output_tokens).toBe(4096);
});

test("models default in code with prices, and an unpriced env entry takes its known price", () => {
  const browse = configured_models_for("browse", "");
  expect(browse[0]).toMatchObject({ model: "gpt-5.6-luna", pricing: { input: 0.20, cached_input: 0.02, output: 1.20 } });
  expect(configured_models_for("interview", "[]").map(entry => entry.model)).toEqual(["gpt-5.4-mini"]);
  const env = JSON.stringify([{ provider: "openai", model: "gpt-5.4-mini", max_output_tokens: 4096 }]);
  expect(configured_models_for("research", env)[0].pricing).toMatchObject({ input: 0.75, cached_input: 0.075, output: 4.50 });
  const custom = JSON.stringify([{ provider: "openai", model: "unknown-model", max_output_tokens: 100 }]);
  expect(configured_models_for("research", custom)[0].pricing).toBeUndefined();
});
