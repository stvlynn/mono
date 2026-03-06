import { describe, expect, it } from "vitest";
import { getMonoConfigPaths } from "../packages/config/src/paths.js";

describe("config paths", () => {
  it("uses ~/.mono as the primary config directory and .agents as legacy compatibility", () => {
    const paths = getMonoConfigPaths("/tmp/example-workspace");
    expect(paths.globalDir.endsWith("/.mono")).toBe(true);
    expect(paths.projectDir).toBe("/tmp/example-workspace/.mono");
    expect(paths.legacyGlobalDir.endsWith("/.agents")).toBe(true);
    expect(paths.legacyProjectDir).toBe("/tmp/example-workspace/.agents");
  });
});
