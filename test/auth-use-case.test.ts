import { beforeEach, describe, expect, it, vi } from "vitest";

const readApiKeyFromStdinMock = vi.fn();
const promptForProfileDefaultsMock = vi.fn();
const upsertProfileMock = vi.fn();
const refreshModelsCatalogMock = vi.fn();

vi.mock("../packages/cli/src/catalog-prompts.js", () => ({
  readApiKeyFromStdin: readApiKeyFromStdinMock,
  promptForProfileDefaults: promptForProfileDefaultsMock
}));

vi.mock("../packages/cli/src/profile-upsert.js", () => ({
  upsertProfile: upsertProfileMock
}));

vi.mock("@mono/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mono/config")>();
  return {
    ...actual,
    refreshModelsCatalog: refreshModelsCatalogMock
  };
});

describe("auth use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a Gemini default model for google when logging in with an API key", async () => {
    readApiKeyFromStdinMock.mockResolvedValue("test-key");
    upsertProfileMock.mockResolvedValue(undefined);

    const { runAuthLogin } = await import("../packages/cli/src/use-cases/auth.js");

    await runAuthLogin({
      provider: "google",
      withApiKey: true
    });

    expect(upsertProfileMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: "google",
      model: "gemini-2.5-pro",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "test-key"
    }));
  });
});
