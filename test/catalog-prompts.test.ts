import { describe, expect, it } from "vitest";
import { resolvePromptedValue } from "../packages/cli/src/catalog-prompts.js";

describe("catalog prompt defaults", () => {
  it("falls back to the default when the prompt answer is blank", () => {
    expect(resolvePromptedValue("", "https://api.example.com")).toBe("https://api.example.com");
    expect(resolvePromptedValue("   ", "https://api.example.com")).toBe("https://api.example.com");
  });

  it("keeps explicit prompt input", () => {
    expect(resolvePromptedValue(" https://override.example.com ", "https://api.example.com")).toBe(
      "https://override.example.com"
    );
  });
});
