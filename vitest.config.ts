import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mono/agent-core": resolve(__dirname, "packages/agent-core/src/index.ts"),
      "@mono/config": resolve(__dirname, "packages/config/src/index.ts"),
      "@mono/shared": resolve(__dirname, "packages/shared/src/index.ts"),
      "@mono/prompts": resolve(__dirname, "packages/prompts/src/index.ts"),
      "@mono/im-platform": resolve(__dirname, "packages/im-platform/src/index.ts"),
      "@mono/telegram-control": resolve(__dirname, "packages/telegram-control/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
