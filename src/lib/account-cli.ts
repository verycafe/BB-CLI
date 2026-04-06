import {readFile} from "node:fs/promises";
import {stdin} from "node:process";

import {
  bindAccount,
  buildHeadersFromAccount,
  buildAccountStorePath,
  getAccount,
  listAccounts,
  redactAccount,
  removeAccount,
  setDefaultAccount,
  type StoredAccount,
} from "./accounts.js";
import {parseCookieInput} from "./cookies.js";
import {
  checkProviderAccountRemotely,
  getBuiltInProvider,
  inspectProviderAccountHeaders,
  validateProviderAccountHeaders,
} from "./providers.js";

export type AccountCommand = "bind" | "list" | "show" | "use" | "remove" | "check";

export type AccountCliFlags = {
  name?: string;
  provider?: string;
  cookie?: string;
  cookieFile?: string;
  cookieStdin: boolean;
  remote: boolean;
  token?: string;
  tokenStdin: boolean;
  header: string[];
  note?: string;
  default: boolean;
};

export async function runAccountCommand(command: AccountCommand, input: string[], flags: AccountCliFlags): Promise<number> {
  switch (command) {
    case "bind":
      return runBind(input, flags);
    case "list":
      return runList(input);
    case "show":
      return runShow(input);
    case "use":
      return runUse(input, flags);
    case "remove":
      return runRemove(input, flags);
    case "check":
      return runCheck(input, flags);
    default:
      throw new Error(`Unsupported account command: ${command satisfies never}`);
  }
}

function printAccountUsage(providerId?: string): void {
  console.log("Account commands:");
  console.log("  bbcli account bind <provider> --name <name> [--cookie ... | --cookie-file path | --token ... | --header 'K: V']");
  console.log("  bbcli account list [provider]");
  console.log("  bbcli account show <provider> <name>");
  console.log("  bbcli account use <provider> <name>");
  console.log("  bbcli account remove <provider> <name>");
  console.log("  bbcli account check <provider> <name> [--remote]");
  console.log("");
  if (providerId) {
    const provider = getBuiltInProvider(providerId);
    if (provider) {
      console.log(`Provider: ${provider.descriptor.label} (${provider.descriptor.id})`);
      console.log(`Auth: ${provider.descriptor.authHint}`);
      if (provider.descriptor.accountFields.length > 0) {
        console.log("Expected account fields:");
        for (const field of provider.descriptor.accountFields) {
          console.log(`  - ${field.key}${field.required ? " (required)" : ""}`);
          console.log(`    ${field.description}`);
        }
      }
      console.log("");
    }
  }
  console.log(`Store path: ${buildAccountStorePath()}`);
}

async function runBind(input: string[], flags: AccountCliFlags): Promise<number> {
  const provider = input[0] ?? flags.provider;
  const name = flags.name;
  if (!provider || !name) {
    printAccountUsage(provider);
    throw new Error("`account bind` requires <provider> and --name.");
  }

  const headers = Object.fromEntries(flags.header.map(parseHeader));

  if (flags.cookie) {
    headers.Cookie = flags.cookie;
  }

  if (flags.cookieFile) {
    headers.Cookie = parseCookieInput(await readFile(flags.cookieFile, "utf8"));
  }

  if (flags.cookieStdin) {
    headers.Cookie = parseCookieInput(await readStdinSecret());
  }

  if (flags.token) {
    headers.Authorization = `Bearer ${flags.token}`;
  }

  if (flags.tokenStdin) {
    headers.Authorization = `Bearer ${await readStdinSecret()}`;
  }

  validateProviderAccountHeaders(provider, headers);

  const result = await bindAccount({
    provider,
    name,
    note: flags.note,
    headers,
    makeDefault: flags.default,
  });

  console.log(`Bound account ${result.account.provider}:${result.account.name}`);
  console.log(`Headers: ${Object.keys(result.account.headers).join(", ")}`);
  if (headers.Cookie) {
    console.log(`Cookie keys: ${Array.from(parseCookieInput(headers.Cookie).split(";")).length}`);
  }
  if (result.isDefault) {
    console.log("Default: yes");
  }

  return 0;
}

async function runList(input: string[]): Promise<number> {
  const provider = input[0];
  const accounts = await listAccounts(provider);
  if (accounts.length === 0) {
    console.log("No accounts bound yet.");
    console.log(`Store path: ${buildAccountStorePath()}`);
    return 0;
  }

  for (const account of accounts) {
    console.log(`${account.isDefault ? "*" : " "} ${account.provider}:${account.name}`);
    console.log(`  headers: ${account.headerNames.join(", ") || "none"}`);
    console.log(`  updated: ${account.updatedAt}`);
    if (account.note) {
      console.log(`  note: ${account.note}`);
    }
  }

  return 0;
}

async function runShow(input: string[]): Promise<number> {
  const provider = input[0];
  const name = input[1];
  if (!provider || !name) {
    printAccountUsage(provider);
    throw new Error("`account show` requires <provider> <name>.");
  }

  const result = await getAccount(provider, name);
  if (!result) {
    throw new Error(`No account found for ${provider}:${name}.`);
  }

  const account = redactAccount(result.account);
  printJson({
    ...account,
    isDefault: result.isDefault,
  });
  return 0;
}

async function runUse(input: string[], flags: AccountCliFlags): Promise<number> {
  const provider = input[0] ?? flags.provider;
  const name = input[1] ?? flags.name;
  if (!provider || !name) {
    printAccountUsage(provider);
    throw new Error("`account use` requires <provider> <name>.");
  }

  await setDefaultAccount(provider, name);
  console.log(`Default account for ${provider} is now ${name}.`);
  return 0;
}

async function runRemove(input: string[], flags: AccountCliFlags): Promise<number> {
  const provider = input[0] ?? flags.provider;
  const name = input[1] ?? flags.name;
  if (!provider || !name) {
    printAccountUsage(provider);
    throw new Error("`account remove` requires <provider> <name>.");
  }

  const removed = await removeAccount(provider, name);
  if (!removed) {
    throw new Error(`No account found for ${provider}:${name}.`);
  }

  console.log(`Removed ${provider}:${name}.`);
  return 0;
}

async function runCheck(input: string[], flags: AccountCliFlags): Promise<number> {
  const provider = input[0] ?? flags.provider;
  const name = input[1] ?? flags.name;
  if (!provider || !name) {
    printAccountUsage(provider);
    throw new Error("`account check` requires <provider> <name>.");
  }

  const result = await getAccount(provider, name);
  if (!result) {
    throw new Error(`No account found for ${provider}:${name}.`);
  }

  const diagnostics = inspectProviderAccountHeaders(provider, result.account.headers);
  console.log(`Account check: ${result.account.provider}:${result.account.name}`);
  console.log(`Default: ${result.isDefault ? "yes" : "no"}`);
  console.log(`Headers: ${Object.keys(result.account.headers).join(", ") || "none"}`);
  console.log("Local diagnostics:");

  if (diagnostics.length === 0) {
    console.log("No provider-specific diagnostics are available for this account.");
  } else {
    let hasError = false;
    for (const diagnostic of diagnostics) {
      if (diagnostic.level === "error") {
        hasError = true;
      }

      const prefix = diagnostic.level === "ok" ? "OK" : diagnostic.level === "warning" ? "WARN" : "ERR";
      console.log(`${prefix}: ${diagnostic.message}`);
    }

    if (!flags.remote) {
      return hasError ? 1 : 0;
    }
  }

  if (!flags.remote) {
    return 0;
  }

  const remote = await checkProviderAccountRemotely(provider, {
    provider: result.account.provider,
    name: result.account.name,
    headers: buildHeadersFromAccount(result.account),
  });

  if (!remote) {
    console.log("Remote probe:");
    console.log("WARN: No remote provider probe is available for this provider.");
    return diagnostics.some((item) => item.level === "error") ? 1 : 0;
  }

  console.log("Remote probe:");
  for (const line of remote.summaryLines ?? []) {
    console.log(`INFO: ${line}`);
  }

  let hasError = diagnostics.some((item) => item.level === "error");
  for (const diagnostic of remote.diagnostics) {
    if (diagnostic.level === "error") {
      hasError = true;
    }

    const prefix = diagnostic.level === "ok" ? "OK" : diagnostic.level === "warning" ? "WARN" : "ERR";
    console.log(`${prefix}: ${diagnostic.message}`);
  }

  return hasError ? 1 : 0;
}

function parseHeader(raw: string): [string, string] {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex === -1) {
    throw new Error(`Header must look like "Key: Value", got "${raw}".`);
  }

  const key = raw.slice(0, separatorIndex).trim();
  const value = raw.slice(separatorIndex + 1).trim();
  if (!key || !value) {
    throw new Error(`Header must look like "Key: Value", got "${raw}".`);
  }

  return [key, value];
}

async function readStdinSecret(): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      value += chunk;
    });
    stdin.on("end", () => {
      const trimmed = value.trim();
      if (!trimmed) {
        reject(new Error("Expected secret content on stdin, but stdin was empty."));
        return;
      }

      resolve(trimmed);
    });
    stdin.on("error", reject);
  });
}

function printJson(value: StoredAccount & {isDefault: boolean}): void {
  console.log(JSON.stringify(value, null, 2));
}
