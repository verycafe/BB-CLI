import {chmod, mkdir, open, readFile, rm, unlink, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, join} from "node:path";

export const ACCOUNTS_STORE_VERSION = 1;

export type StoredAccount = {
  provider: string;
  name: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  headers: Record<string, string>;
};

type AccountsStore = {
  version: number;
  defaults: Record<string, string>;
  accounts: StoredAccount[];
};

export type BindAccountInput = {
  provider: string;
  name: string;
  note?: string;
  headers: Record<string, string>;
  makeDefault: boolean;
};

export type ListedAccount = {
  provider: string;
  name: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  headerNames: string[];
  isDefault: boolean;
};

export type ResolvedAccount = {
  account: StoredAccount;
  isDefault: boolean;
};

export async function bindAccount(input: BindAccountInput): Promise<ResolvedAccount> {
  validateProvider(input.provider);
  validateAccountName(input.name);

  if (Object.keys(input.headers).length === 0) {
    throw new Error("Binding an account requires at least one header, cookie, or token.");
  }

  return withStoreLock(async () => {
    const store = await loadAccountsStore();
    const now = new Date().toISOString();
    const provider = input.provider.toLowerCase();
    const name = input.name;
    const existingIndex = store.accounts.findIndex((account) => account.provider === provider && account.name === name);

    const account: StoredAccount = existingIndex === -1
      ? {
          provider,
          name,
          note: input.note,
          createdAt: now,
          updatedAt: now,
          headers: normalizeHeaders(input.headers),
        }
      : {
          ...store.accounts[existingIndex]!,
          note: input.note ?? store.accounts[existingIndex]!.note,
          updatedAt: now,
          headers: normalizeHeaders(input.headers),
        };

    if (existingIndex === -1) {
      store.accounts.push(account);
    } else {
      store.accounts[existingIndex] = account;
    }

    if (input.makeDefault || !store.defaults[provider]) {
      store.defaults[provider] = name;
    }

    await saveAccountsStore(store);
    return {
      account,
      isDefault: store.defaults[provider] === name,
    };
  });
}

export async function listAccounts(provider?: string): Promise<ListedAccount[]> {
  const store = await loadAccountsStore();
  const normalizedProvider = provider?.toLowerCase();

  return store.accounts
    .filter((account) => !normalizedProvider || account.provider === normalizedProvider)
    .sort((left, right) => {
      if (left.provider === right.provider) {
        return left.name.localeCompare(right.name);
      }

      return left.provider.localeCompare(right.provider);
    })
    .map((account) => ({
      provider: account.provider,
      name: account.name,
      note: account.note,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      headerNames: Object.keys(account.headers).sort(),
      isDefault: store.defaults[account.provider] === account.name,
    }));
}

export async function getAccount(provider: string, name: string): Promise<ResolvedAccount | undefined> {
  validateProvider(provider);
  validateAccountName(name);

  const store = await loadAccountsStore();
  const normalizedProvider = provider.toLowerCase();
  const account = store.accounts.find((entry) => entry.provider === normalizedProvider && entry.name === name);
  if (!account) {
    return undefined;
  }

  return {
    account,
    isDefault: store.defaults[normalizedProvider] === account.name,
  };
}

export async function resolveAccount(provider: string, name?: string): Promise<ResolvedAccount | undefined> {
  validateProvider(provider);

  const store = await loadAccountsStore();
  const normalizedProvider = provider.toLowerCase();
  const targetName = name ?? store.defaults[normalizedProvider];
  if (!targetName) {
    return undefined;
  }

  const account = store.accounts.find((entry) => entry.provider === normalizedProvider && entry.name === targetName);
  if (!account) {
    return undefined;
  }

  return {
    account,
    isDefault: store.defaults[normalizedProvider] === account.name,
  };
}

export async function setDefaultAccount(provider: string, name: string): Promise<void> {
  validateProvider(provider);
  validateAccountName(name);

  await withStoreLock(async () => {
    const store = await loadAccountsStore();
    const normalizedProvider = provider.toLowerCase();
    const account = store.accounts.find((entry) => entry.provider === normalizedProvider && entry.name === name);
    if (!account) {
      throw new Error(`No account named "${name}" exists for provider "${normalizedProvider}".`);
    }

    store.defaults[normalizedProvider] = name;
    await saveAccountsStore(store);
  });
}

export async function removeAccount(provider: string, name: string): Promise<boolean> {
  validateProvider(provider);
  validateAccountName(name);

  return withStoreLock(async () => {
    const store = await loadAccountsStore();
    const normalizedProvider = provider.toLowerCase();
    const before = store.accounts.length;
    store.accounts = store.accounts.filter((account) => !(account.provider === normalizedProvider && account.name === name));

    if (store.accounts.length === before) {
      return false;
    }

    if (store.defaults[normalizedProvider] === name) {
      delete store.defaults[normalizedProvider];
      const replacement = store.accounts.find((account) => account.provider === normalizedProvider);
      if (replacement) {
        store.defaults[normalizedProvider] = replacement.name;
      }
    }

    await saveAccountsStore(store);
    return true;
  });
}

export function buildHeadersFromAccount(account: StoredAccount): Record<string, string> {
  return {...account.headers};
}

export function redactAccount(account: StoredAccount): StoredAccount {
  return {
    ...account,
    headers: Object.fromEntries(
      Object.entries(account.headers).map(([key, value]) => [key, redactValue(value)]),
    ),
  };
}

export function buildAccountStorePath(): string {
  const configRoot = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "bbcli")
    : join(homedir(), ".config", "bbcli");

  return join(configRoot, "accounts.json");
}

async function loadAccountsStore(): Promise<AccountsStore> {
  const storePath = buildAccountStorePath();

  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as AccountsStore;

    if (parsed.version !== ACCOUNTS_STORE_VERSION || !Array.isArray(parsed.accounts) || typeof parsed.defaults !== "object" || parsed.defaults === null) {
      throw new Error(`Unsupported account store format at ${storePath}.`);
    }

    return {
      version: ACCOUNTS_STORE_VERSION,
      defaults: {...parsed.defaults},
      accounts: parsed.accounts.map((account) => ({
        ...account,
        provider: account.provider.toLowerCase(),
        headers: normalizeHeaders(account.headers ?? {}),
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        version: ACCOUNTS_STORE_VERSION,
        defaults: {},
        accounts: [],
      };
    }

    throw error;
  }
}

async function withStoreLock<T>(callback: () => Promise<T>): Promise<T> {
  const storePath = buildAccountStorePath();
  const lockPath = `${storePath}.lock`;
  const startedAt = Date.now();
  await mkdir(dirname(lockPath), {recursive: true, mode: 0o700});

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        return await callback();
      } finally {
        await handle.close();
        await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        });
      }
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code !== "EEXIST") {
        throw error;
      }

      if (Date.now() - startedAt > 5000) {
        throw new Error(`Timed out waiting for account store lock at ${lockPath}.`);
      }

      await sleep(50);
    }
  }
}

async function saveAccountsStore(store: AccountsStore): Promise<void> {
  const storePath = buildAccountStorePath();
  await mkdir(dirname(storePath), {recursive: true, mode: 0o700});
  await writeFile(storePath, JSON.stringify(store, null, 2), {encoding: "utf8", mode: 0o600});
  await chmod(storePath, 0o600);
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value.trim().length > 0)
      .map(([key, value]) => [normalizeHeaderName(key), value.trim()]),
  );
}

function normalizeHeaderName(value: string): string {
  return value
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
}

function validateProvider(provider: string): void {
  if (!/^[a-z][a-z0-9_-]{1,31}$/i.test(provider)) {
    throw new Error("Provider must be 2-32 characters and contain only letters, digits, underscores, or hyphens.");
  }
}

function validateAccountName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
    throw new Error("Account name must be 1-64 characters and contain only letters, digits, dots, underscores, or hyphens.");
  }
}

function redactValue(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function resetAccountsStoreForTests(): Promise<void> {
  const storePath = buildAccountStorePath();
  await rm(storePath, {force: true});
}
