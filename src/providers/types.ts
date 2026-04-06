import type {MediaSearchResult, RequestAccount, VideoSession} from "../lib/media-types.js";

export type ProviderAccountField = {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  description: string;
};

export type ProviderAccountDiagnostic = {
  level: "ok" | "warning" | "error";
  message: string;
};

export type ProviderAccountCheckResult = {
  diagnostics: ProviderAccountDiagnostic[];
  summaryLines?: string[];
};

export type ProviderDescriptor = {
  id: string;
  label: string;
  supportsMedia: boolean;
  supportsAccounts: boolean;
  authHint: string;
  detectionHint: string;
  accountFields: ProviderAccountField[];
  examples: string[];
};

export type MediaTarget = {
  providerId: string;
  providerLabel: string;
  normalizedInput: string;
  originalInput: string;
};

export type MediaProvider = {
  descriptor: ProviderDescriptor;
  detect(input: string): boolean;
  normalizeInput(input: string): string;
  loadSession(normalizedInput: string, account?: RequestAccount): Promise<VideoSession>;
  search?(query: string, account?: RequestAccount): Promise<MediaSearchResult[]>;
  getRecommendations?(account?: RequestAccount): Promise<MediaSearchResult[]>;
  validateAccountHeaders?(headers: Record<string, string>): void;
  inspectAccountHeaders?(headers: Record<string, string>): ProviderAccountDiagnostic[];
  checkAccountRemotely?(account: RequestAccount): Promise<ProviderAccountCheckResult>;
};
