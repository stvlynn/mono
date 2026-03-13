import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  canonicalizeProviderId,
  catalogModelToUnifiedModel,
  getCatalogProvider,
  listCatalogModels,
  listCatalogProviders,
  resolveApiKeyEnv,
  resolveBaseURL
} from "@mono/config";
import type { CatalogTransportCandidate } from "@mono/config";

interface CatalogChoice {
  value: string;
  label: string;
  description?: string;
}

export function resolvePromptedValue(answer: string | undefined, fallback: string): string {
  return answer?.trim() || fallback;
}

export async function readApiKeyFromStdin(): Promise<string> {
  let raw = "";
  for await (const chunk of input) {
    raw += chunk.toString();
  }
  const token = raw.trim();
  if (!token) {
    throw new Error("Expected API key on stdin, but input was empty");
  }
  return token;
}

export async function promptForProfileDefaults(options: {
  profile?: string;
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKeyEnv?: string;
  runtimeProviderKey?: string;
  refresh?: boolean;
}): Promise<{ profile: string; provider: string; model: string; baseURL: string; apiKeyEnv?: string; apiKey?: string; runtimeProviderKey?: string }> {
  const rl = createInterface({ input, output });
  try {
    const providers = await listCatalogProviders(process.cwd(), { refresh: options.refresh });
    const providerChoice = options.provider
      ? canonicalizeProviderId(options.provider)
      : await promptForCatalogChoice(
          rl,
          "Provider",
          providers.map((provider) => ({
            value: provider.id,
            label: provider.id,
            description: provider.name
          }))
        );
    const provider = providers.find((item) => item.id === providerChoice) ?? (await getCatalogProvider(process.cwd(), providerChoice));
    if (!provider) {
      throw new Error(`Provider not found in catalog: ${providerChoice}`);
    }
    if (!provider.supported) {
      throw new Error(
        `Provider ${provider.id} uses catalog transport ${provider.npm ?? "unknown"}, which mono cannot route`
      );
    }

    const models = await listCatalogModels(process.cwd(), provider.id, { refresh: options.refresh });
    const modelChoice = options.model
      ? options.model.includes("/") ? options.model.split("/").slice(1).join("/") : options.model
      : await promptForCatalogChoice(
          rl,
          `Model for ${provider.id}`,
          models.map((model) => ({
            value: model.id,
            label: model.id,
            description: model.name
          }))
        );
    const model = models.find((item) => item.id === modelChoice);
    if (!model) {
      throw new Error(`Model not found for provider ${provider.id}: ${modelChoice}`);
    }
    if (!model.supported) {
      throw new Error(
        `Model ${provider.id}/${model.id} uses catalog transport ${model.npm ?? provider.npm ?? "unknown"}, which mono cannot route`
      );
    }

    const supportedCandidates = (model.transportCandidates ?? provider.transportCandidates ?? [])
      .filter((candidate) => candidate.supportedByMono);
    const runtimeProviderKey = supportedCandidates.length > 1
      ? await promptForTransportCandidate(rl, provider.id, model.id, supportedCandidates, options.runtimeProviderKey)
      : supportedCandidates[0]?.runtimeProviderKey ?? options.runtimeProviderKey;
    const normalized = catalogModelToUnifiedModel(provider, model, {
      runtimeProviderKey
    });
    const defaultBaseURL = options.baseURL ?? normalized.baseURL ?? resolveBaseURL(provider.id);
    const promptedBaseURL = options.baseURL ?? (await rl.question(`Base URL [${defaultBaseURL}]: `));
    const baseURL = resolvePromptedValue(promptedBaseURL, defaultBaseURL);

    const useEnvAnswer = (await rl.question("Use an environment variable for the API key? [Y/n]: ")).trim().toLowerCase();
    const useEnv = useEnvAnswer === "" || useEnvAnswer === "y" || useEnvAnswer === "yes";
    const defaultApiKeyEnv = options.apiKeyEnv ?? provider.env[0] ?? normalized.apiKeyEnv ?? resolveApiKeyEnv(provider.id);
    const apiKeyEnv = useEnv
      ? (
          options.apiKeyEnv ??
          (await rl.question(`API key env var [${defaultApiKeyEnv ?? ""}]: `)) ??
          defaultApiKeyEnv ??
          undefined
        )?.trim() || undefined
      : undefined;
    const apiKey = !useEnv ? (await rl.question("API key: ")).trim() || undefined : undefined;
    const profile = (options.profile ?? (await rl.question("Profile name [default]: ")) ?? "default").trim() || "default";
    return { profile, provider: provider.id, model: model.id, baseURL, apiKeyEnv, apiKey, runtimeProviderKey: normalized.runtimeProviderKey };
  } finally {
    rl.close();
  }
}

function filterCatalogChoices(choices: CatalogChoice[], query: string): CatalogChoice[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return choices;
  }

  return choices.filter((choice) =>
    [choice.value, choice.label, choice.description ?? ""].some((field) => field.toLowerCase().includes(normalized))
  );
}

async function promptForTransportCandidate(
  rl: ReturnType<typeof createInterface>,
  providerId: string,
  modelId: string,
  candidates: CatalogTransportCandidate[],
  runtimeProviderKey?: string
): Promise<string | undefined> {
  if (runtimeProviderKey) {
    return runtimeProviderKey;
  }

  const indexedChoices = candidates.map((candidate, index) => {
    const value = candidate.runtimeProviderKey ?? `${candidate.kind}:${index}`;
    return {
      candidate,
      value,
      label: `${providerId}/${modelId}`,
      description: formatTransportCandidate(candidate)
    };
  });

  const selectedValue = await promptForCatalogChoice(
    rl,
    `Interface for ${providerId}/${modelId}`,
    indexedChoices.map(({ value, label, description }) => ({ value, label, description }))
  );
  return indexedChoices.find((choice) => choice.value === selectedValue)?.candidate.runtimeProviderKey;
}

function formatTransportCandidate(candidate: CatalogTransportCandidate): string {
  const parts: string[] = [candidate.kind];
  if (candidate.runtimeProviderKey) {
    parts.push(candidate.runtimeProviderKey);
  }
  if (candidate.api) {
    parts.push(candidate.api);
  }
  return parts.join(" · ");
}

async function promptForCatalogChoice(
  rl: ReturnType<typeof createInterface>,
  label: string,
  choices: CatalogChoice[],
  initialQuery?: string
): Promise<string> {
  let query = initialQuery?.trim() ?? "";

  while (true) {
    const matches = filterCatalogChoices(choices, query).slice(0, 12);
    if (matches.length === 0) {
      output.write(`No matches for "${query}". Try another search.\n`);
    } else {
      output.write(`${label} matches:\n`);
      for (const [index, choice] of matches.entries()) {
        output.write(`  ${index + 1}. ${choice.label}${choice.description ? ` — ${choice.description}` : ""}\n`);
      }
    }

    const answer = (await rl.question(`${label} (number, exact id, or search text): `)).trim();
    if (!answer && matches[0]) {
      return matches[0].value;
    }

    const exact = choices.find((choice) => choice.value === answer || choice.label === answer);
    if (exact) {
      return exact.value;
    }

    const numeric = Number(answer);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= matches.length) {
      return matches[numeric - 1].value;
    }

    query = answer;
  }
}
