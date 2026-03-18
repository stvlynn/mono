import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("docker entrypoint", () => {
  it("builds and runs the mounted workspace when available", () => {
    const source = readFileSync("docker/entrypoint.sh", "utf8");

    expect(source).toContain('WORKSPACE_ROOT="/workspace"');
    expect(source).toContain('path.join(root, "node_modules", "@mono")');
    expect(source).toContain('exec tsx packages/cli/src/bin.ts "$@"');
    expect(source).toContain('ln -s "$APP_ROOT/node_modules" "$WORKSPACE_ROOT/node_modules"');
    expect(source).toContain('exec node "$APP_ROOT/packages/cli/dist/bin.js" "$@"');
  });

  it("mounts the workspace docker scripts into /app/docker for compose runs", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");

    expect(compose).toContain("./docker:/app/docker:ro");
  });
});
