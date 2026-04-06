import {buildAccountStorePath, listAccounts} from "./accounts.js";
import type {MediaSearchResult, RequestAccount, VideoSession} from "./media-types.js";
import {bilibiliProvider} from "../providers/bilibili.js";
import type {
  MediaProvider,
  MediaTarget,
  ProviderDescriptor,
  ProviderAccountCheckResult,
  ProviderAccountDiagnostic,
} from "../providers/types.js";

export type {
  MediaTarget,
  ProviderDescriptor,
  ProviderAccountCheckResult,
  ProviderAccountDiagnostic,
} from "../providers/types.js";

const BUILT_IN_PROVIDERS: MediaProvider[] = [bilibiliProvider];

export function listKnownProviders(): ProviderDescriptor[] {
  return BUILT_IN_PROVIDERS.map((provider) => provider.descriptor);
}

export function getBuiltInProvider(providerId: string): MediaProvider | undefined {
  return BUILT_IN_PROVIDERS.find((provider) => provider.descriptor.id === providerId.toLowerCase());
}

export async function printProvidersSummary(providerId?: string): Promise<void> {
  if (providerId) {
    const provider = getBuiltInProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown built-in provider "${providerId}".`);
    }

    const providerAccounts = await listAccounts(provider.descriptor.id);
    const defaultAccount = providerAccounts.find((account) => account.isDefault);

    console.log(`${provider.descriptor.label} (${provider.descriptor.id})`);
    console.log(`media: ${provider.descriptor.supportsMedia ? "yes" : "no"}`);
    console.log(`account binding: ${provider.descriptor.supportsAccounts ? "yes" : "no"}`);
    console.log(`detection: ${provider.descriptor.detectionHint}`);
    console.log(`auth: ${provider.descriptor.authHint}`);
    console.log(`bound accounts: ${providerAccounts.length}`);
    if (defaultAccount) {
      console.log(`default account: ${defaultAccount.name}`);
    }

    if (provider.descriptor.accountFields.length > 0) {
      console.log("account fields:");
      for (const field of provider.descriptor.accountFields) {
        console.log(`- ${field.key}${field.required ? " (required)" : ""}${field.secret ? " [secret]" : ""}`);
        console.log(`  ${field.description}`);
      }
    }

    if (provider.descriptor.examples.length > 0) {
      console.log("examples:");
      for (const example of provider.descriptor.examples) {
        console.log(`- ${example}`);
      }
    }

    console.log(`account store: ${buildAccountStorePath()}`);
    return;
  }

  console.log("Known BBCLI providers:");
  for (const provider of BUILT_IN_PROVIDERS) {
    const providerAccounts = await listAccounts(provider.descriptor.id);
    const defaultAccount = providerAccounts.find((account) => account.isDefault);
    console.log(`- ${provider.descriptor.id} (${provider.descriptor.label})`);
    console.log(`  media: ${provider.descriptor.supportsMedia ? "yes" : "no"}`);
    console.log(`  account binding: ${provider.descriptor.supportsAccounts ? "yes" : "no"}`);
    console.log(`  detection: ${provider.descriptor.detectionHint}`);
    console.log(`  auth: ${provider.descriptor.authHint}`);
    console.log(`  bound accounts: ${providerAccounts.length}`);
    if (defaultAccount) {
      console.log(`  default account: ${defaultAccount.name}`);
    }
  }

  console.log("");
  console.log("Use `bbcli providers <id>` to inspect a provider's account schema and examples.");
  console.log("Custom provider ids are also allowed in the account store for future integrations.");
  console.log(`Account store: ${buildAccountStorePath()}`);
}

export function resolveMediaTarget(input: string, overrideProvider?: string): MediaTarget {
  const explicitProvider = overrideProvider ? getBuiltInProvider(overrideProvider) : undefined;
  if (overrideProvider && !explicitProvider) {
    throw new Error(`Provider "${overrideProvider}" is not a supported media provider yet.`);
  }

  if (explicitProvider) {
    return {
      providerId: explicitProvider.descriptor.id,
      providerLabel: explicitProvider.descriptor.label,
      originalInput: input,
      normalizedInput: explicitProvider.normalizeInput(input),
    };
  }

  const detectedProvider = BUILT_IN_PROVIDERS.find((provider) => provider.detect(input));
  if (!detectedProvider) {
    throw new Error("Could not detect a supported media provider from the input. Try `bbcli providers`.");
  }

  return {
    providerId: detectedProvider.descriptor.id,
    providerLabel: detectedProvider.descriptor.label,
    originalInput: input,
    normalizedInput: detectedProvider.normalizeInput(input),
  };
}

export async function loadMediaSession(target: MediaTarget, account?: RequestAccount): Promise<VideoSession> {
  const provider = getBuiltInProvider(target.providerId);
  if (!provider) {
    throw new Error(`No media loader is implemented for provider "${target.providerId}".`);
  }

  return provider.loadSession(target.normalizedInput, account);
}

export async function searchMedia(query: string, providerId?: string, account?: RequestAccount): Promise<MediaSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Please enter a search query.");
  }

  if (providerId) {
    const provider = getBuiltInProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown built-in provider "${providerId}".`);
    }

    if (!provider.search) {
      throw new Error(`Provider "${providerId}" does not support media search yet.`);
    }

    return provider.search(trimmed, account);
  }

  const searchableProvider = BUILT_IN_PROVIDERS.find((provider) => provider.search);
  if (!searchableProvider) {
    throw new Error("No searchable provider is available yet.");
  }

  return searchableProvider.search!(trimmed, account);
}

export async function listRecommendedMedia(providerId?: string, account?: RequestAccount): Promise<MediaSearchResult[]> {
  if (providerId) {
    const provider = getBuiltInProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown built-in provider "${providerId}".`);
    }

    if (!provider.getRecommendations) {
      throw new Error(`Provider "${providerId}" does not expose recommendations yet.`);
    }

    return provider.getRecommendations(account);
  }

  const provider = BUILT_IN_PROVIDERS.find((entry) => entry.getRecommendations);
  if (!provider) {
    throw new Error("No provider exposes recommendations yet.");
  }

  return provider.getRecommendations!(account);
}

export function validateProviderAccountHeaders(providerId: string, headers: Record<string, string>): void {
  const provider = getBuiltInProvider(providerId);
  provider?.validateAccountHeaders?.(headers);
}

export function inspectProviderAccountHeaders(providerId: string, headers: Record<string, string>): ProviderAccountDiagnostic[] {
  const provider = getBuiltInProvider(providerId);
  return provider?.inspectAccountHeaders?.(headers) ?? [];
}

export async function checkProviderAccountRemotely(providerId: string, account: RequestAccount): Promise<ProviderAccountCheckResult | undefined> {
  const provider = getBuiltInProvider(providerId);
  if (!provider?.checkAccountRemotely) {
    return undefined;
  }

  return provider.checkAccountRemotely(account);
}
