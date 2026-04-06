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
      throw new Error(`未知的内置平台：${providerId}。`);
    }

    const providerAccounts = await listAccounts(provider.descriptor.id);
    const defaultAccount = providerAccounts.find((account) => account.isDefault);

    console.log(`${provider.descriptor.label} (${provider.descriptor.id})`);
    console.log(`支持媒体：${provider.descriptor.supportsMedia ? "是" : "否"}`);
    console.log(`支持账号绑定：${provider.descriptor.supportsAccounts ? "是" : "否"}`);
    console.log(`识别规则：${provider.descriptor.detectionHint}`);
    console.log(`认证说明：${provider.descriptor.authHint}`);
    console.log(`已绑定账号：${providerAccounts.length}`);
    if (defaultAccount) {
      console.log(`默认账号：${defaultAccount.name}`);
    }

    if (provider.descriptor.accountFields.length > 0) {
      console.log("账号字段：");
      for (const field of provider.descriptor.accountFields) {
        console.log(`- ${field.key}${field.required ? "（必填）" : ""}${field.secret ? " [敏感]" : ""}`);
        console.log(`  ${field.description}`);
      }
    }

    if (provider.descriptor.examples.length > 0) {
      console.log("示例：");
      for (const example of provider.descriptor.examples) {
        console.log(`- ${example}`);
      }
    }

    console.log(`账号存储：${buildAccountStorePath()}`);
    return;
  }

  console.log("BBCLI 当前内置平台：");
  for (const provider of BUILT_IN_PROVIDERS) {
    const providerAccounts = await listAccounts(provider.descriptor.id);
    const defaultAccount = providerAccounts.find((account) => account.isDefault);
    console.log(`- ${provider.descriptor.id} (${provider.descriptor.label})`);
    console.log(`  支持媒体：${provider.descriptor.supportsMedia ? "是" : "否"}`);
    console.log(`  支持账号绑定：${provider.descriptor.supportsAccounts ? "是" : "否"}`);
    console.log(`  识别规则：${provider.descriptor.detectionHint}`);
    console.log(`  认证说明：${provider.descriptor.authHint}`);
    console.log(`  已绑定账号：${providerAccounts.length}`);
    if (defaultAccount) {
      console.log(`  默认账号：${defaultAccount.name}`);
    }
  }

  console.log("");
  console.log("用 `bbcli providers <id>` 可以查看某个平台的账号字段和示例。");
  console.log("账号存储也允许未来接入自定义平台 ID。");
  console.log(`账号存储：${buildAccountStorePath()}`);
}

export function resolveMediaTarget(input: string, overrideProvider?: string): MediaTarget {
  const explicitProvider = overrideProvider ? getBuiltInProvider(overrideProvider) : undefined;
  if (overrideProvider && !explicitProvider) {
    throw new Error(`平台 "${overrideProvider}" 还不是当前支持的媒体平台。`);
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
    throw new Error("无法从输入里识别出支持的平台。可以先运行 `bbcli providers` 查看。");
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
    throw new Error(`平台 "${target.providerId}" 还没有实现媒体加载能力。`);
  }

  return provider.loadSession(target.normalizedInput, account);
}

export async function searchMedia(query: string, providerId?: string, account?: RequestAccount): Promise<MediaSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("请输入搜索关键词。");
  }

  if (providerId) {
    const provider = getBuiltInProvider(providerId);
    if (!provider) {
      throw new Error(`未知的内置平台：${providerId}。`);
    }

    if (!provider.search) {
      throw new Error(`平台 "${providerId}" 暂时还不支持搜索。`);
    }

    return provider.search(trimmed, account);
  }

  const searchableProvider = BUILT_IN_PROVIDERS.find((provider) => provider.search);
  if (!searchableProvider) {
    throw new Error("当前还没有可搜索的平台。");
  }

  return searchableProvider.search!(trimmed, account);
}

export async function listRecommendedMedia(providerId?: string, account?: RequestAccount): Promise<MediaSearchResult[]> {
  if (providerId) {
    const provider = getBuiltInProvider(providerId);
    if (!provider) {
      throw new Error(`未知的内置平台：${providerId}。`);
    }

    if (!provider.getRecommendations) {
      throw new Error(`平台 "${providerId}" 暂时还没有推荐流。`);
    }

    return provider.getRecommendations(account);
  }

  const provider = BUILT_IN_PROVIDERS.find((entry) => entry.getRecommendations);
  if (!provider) {
    throw new Error("当前还没有任何平台提供推荐流。");
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
