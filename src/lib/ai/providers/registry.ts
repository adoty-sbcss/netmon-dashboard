/**
 * The provider list + config-aware selection. Add a model = add an adapter and
 * one line in ALL_PROVIDERS. Whether a provider actually runs is decided from
 * its resolved settings (enabled + has the fields it needs), not hardcoded.
 *
 * Relative imports + no `server-only` so the AI cron Job can import this under
 * tsx (it pulls config from the DB via ../settings).
 */
import type { AiProvider, ResolvedProviderConfig } from "../types";
import { resolveAllProviderConfigs } from "../settings";
import { azureOpenAiProvider } from "./azure-openai";
import { openAiProvider } from "./openai";
import { anthropicProvider } from "./anthropic";

export const ALL_PROVIDERS: AiProvider[] = [
  azureOpenAiProvider,
  openAiProvider,
  anthropicProvider,
];

export function getProvider(id: string): AiProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id);
}

export interface ActiveProvider {
  provider: AiProvider;
  config: ResolvedProviderConfig;
}

/** Providers that are ENABLED and have the config they need — these actually run. */
export async function activeProviders(): Promise<ActiveProvider[]> {
  const configs = await resolveAllProviderConfigs();
  const out: ActiveProvider[] = [];
  for (const p of ALL_PROVIDERS) {
    const config = configs[p.id];
    if (config && config.enabled && p.isConfigured(config)) {
      out.push({ provider: p, config });
    }
  }
  return out;
}

export interface ProviderDescriptor {
  id: string;
  label: string;
  /** Has a key + required fields. */
  configured: boolean;
  /** Admin enable toggle. */
  enabled: boolean;
}

/** Serializable descriptors for client components / the comparison UI. */
export async function providerDescriptors(): Promise<ProviderDescriptor[]> {
  const configs = await resolveAllProviderConfigs();
  return ALL_PROVIDERS.map((p) => {
    const config = configs[p.id];
    return {
      id: p.id,
      label: p.label,
      configured: Boolean(config && p.isConfigured(config)),
      enabled: Boolean(config?.enabled),
    };
  });
}
