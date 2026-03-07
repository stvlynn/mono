import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mono/prompts": resolve(__dirname, "packages/prompts/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
