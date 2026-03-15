import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Dockerfile", () => {
  it("installs system CA certificates for TLS clients", () => {
    const source = readFileSync("Dockerfile", "utf8");

    expect(source).toContain("ca-certificates");
    expect(source).toContain("update-ca-certificates");
  });
});
