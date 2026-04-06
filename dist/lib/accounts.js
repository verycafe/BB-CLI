import { chmod, mkdir, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export const ACCOUNTS_STORE_VERSION = 1;
export async function bindAccount(input) {
    validateProvider(input.provider);
    validateAccountName(input.name);
    if (Object.keys(input.headers).length === 0) {
        throw new Error("绑定账号时至少要提供一个请求头、Cookie 或 Token。");
    }
    return withStoreLock(async () => {
        const store = await loadAccountsStore();
        const now = new Date().toISOString();
        const provider = input.provider.toLowerCase();
        const name = input.name;
        const existingIndex = store.accounts.findIndex((account) => account.provider === provider && account.name === name);
        const account = existingIndex === -1
            ? {
                provider,
                name,
                note: input.note,
                createdAt: now,
                updatedAt: now,
                headers: normalizeHeaders(input.headers),
            }
            : {
                ...store.accounts[existingIndex],
                note: input.note ?? store.accounts[existingIndex].note,
                updatedAt: now,
                headers: normalizeHeaders(input.headers),
            };
        if (existingIndex === -1) {
            store.accounts.push(account);
        }
        else {
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
export async function listAccounts(provider) {
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
export async function getAccount(provider, name) {
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
export async function resolveAccount(provider, name) {
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
export async function setDefaultAccount(provider, name) {
    validateProvider(provider);
    validateAccountName(name);
    await withStoreLock(async () => {
        const store = await loadAccountsStore();
        const normalizedProvider = provider.toLowerCase();
        const account = store.accounts.find((entry) => entry.provider === normalizedProvider && entry.name === name);
        if (!account) {
            throw new Error(`平台 "${normalizedProvider}" 下不存在名为 "${name}" 的账号。`);
        }
        store.defaults[normalizedProvider] = name;
        await saveAccountsStore(store);
    });
}
export async function removeAccount(provider, name) {
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
export function buildHeadersFromAccount(account) {
    return { ...account.headers };
}
export function redactAccount(account) {
    return {
        ...account,
        headers: Object.fromEntries(Object.entries(account.headers).map(([key, value]) => [key, redactValue(value)])),
    };
}
export function buildAccountStorePath() {
    const configRoot = process.env.XDG_CONFIG_HOME
        ? join(process.env.XDG_CONFIG_HOME, "bbcli")
        : join(homedir(), ".config", "bbcli");
    return join(configRoot, "accounts.json");
}
async function loadAccountsStore() {
    const storePath = buildAccountStorePath();
    try {
        const raw = await readFile(storePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== ACCOUNTS_STORE_VERSION || !Array.isArray(parsed.accounts) || typeof parsed.defaults !== "object" || parsed.defaults === null) {
            throw new Error(`账号存储格式不受支持：${storePath}。`);
        }
        return {
            version: ACCOUNTS_STORE_VERSION,
            defaults: { ...parsed.defaults },
            accounts: parsed.accounts.map((account) => ({
                ...account,
                provider: account.provider.toLowerCase(),
                headers: normalizeHeaders(account.headers ?? {}),
            })),
        };
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return {
                version: ACCOUNTS_STORE_VERSION,
                defaults: {},
                accounts: [],
            };
        }
        throw error;
    }
}
async function withStoreLock(callback) {
    const storePath = buildAccountStorePath();
    const lockPath = `${storePath}.lock`;
    const startedAt = Date.now();
    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    while (true) {
        try {
            const handle = await open(lockPath, "wx", 0o600);
            try {
                return await callback();
            }
            finally {
                await handle.close();
                await unlink(lockPath).catch((error) => {
                    if (error.code !== "ENOENT") {
                        throw error;
                    }
                });
            }
        }
        catch (error) {
            const errno = error;
            if (errno.code !== "EEXIST") {
                throw error;
            }
            if (Date.now() - startedAt > 5000) {
                throw new Error(`等待账号存储锁超时：${lockPath}。`);
            }
            await sleep(50);
        }
    }
}
async function saveAccountsStore(store) {
    const storePath = buildAccountStorePath();
    await mkdir(dirname(storePath), { recursive: true, mode: 0o700 });
    await writeFile(storePath, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    await chmod(storePath, 0o600);
}
function normalizeHeaders(headers) {
    return Object.fromEntries(Object.entries(headers)
        .filter(([, value]) => value.trim().length > 0)
        .map(([key, value]) => [normalizeHeaderName(key), value.trim()]));
}
function normalizeHeaderName(value) {
    return value
        .split("-")
        .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
        .join("-");
}
function validateProvider(provider) {
    if (!/^[a-z][a-z0-9_-]{1,31}$/i.test(provider)) {
        throw new Error("平台 ID 必须是 2 到 32 个字符，只能包含字母、数字、下划线或连字符。");
    }
}
function validateAccountName(name) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
        throw new Error("账号名必须是 1 到 64 个字符，只能包含字母、数字、点、下划线或连字符。");
    }
}
function redactValue(value) {
    if (value.length <= 8) {
        return "*".repeat(value.length);
    }
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
export async function resetAccountsStoreForTests() {
    const storePath = buildAccountStorePath();
    await rm(storePath, { force: true });
}
