import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { bindAccount, buildHeadersFromAccount, buildAccountStorePath, getAccount, listAccounts, redactAccount, removeAccount, setDefaultAccount, } from "./accounts.js";
import { parseCookieInput } from "./cookies.js";
import { checkProviderAccountRemotely, getBuiltInProvider, inspectProviderAccountHeaders, validateProviderAccountHeaders, } from "./providers.js";
export async function runAccountCommand(command, input, flags) {
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
            throw new Error(`不支持的账号子命令：${command}`);
    }
}
function printAccountUsage(providerId) {
    console.log("账号命令：");
    console.log("  bbcli account bind <provider> --name <name> [--cookie ... | --cookie-file 路径 | --token ... | --header 'K: V']");
    console.log("  bbcli account list [provider]");
    console.log("  bbcli account show <provider> <name>");
    console.log("  bbcli account use <provider> <name>");
    console.log("  bbcli account remove <provider> <name>");
    console.log("  bbcli account check <provider> <name> [--remote]");
    console.log("");
    if (providerId) {
        const provider = getBuiltInProvider(providerId);
        if (provider) {
            console.log(`平台：${provider.descriptor.label} (${provider.descriptor.id})`);
            console.log(`认证说明：${provider.descriptor.authHint}`);
            if (provider.descriptor.accountFields.length > 0) {
                console.log("账号字段：");
                for (const field of provider.descriptor.accountFields) {
                    console.log(`  - ${field.key}${field.required ? "（必填）" : ""}`);
                    console.log(`    ${field.description}`);
                }
            }
            console.log("");
        }
    }
    console.log(`账号存储：${buildAccountStorePath()}`);
}
async function runBind(input, flags) {
    const provider = input[0] ?? flags.provider;
    const name = flags.name;
    if (!provider || !name) {
        printAccountUsage(provider);
        throw new Error("`account bind` 需要提供 <provider> 和 --name。");
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
    console.log(`已绑定账号：${result.account.provider}:${result.account.name}`);
    console.log(`请求头：${Object.keys(result.account.headers).join(", ")}`);
    if (headers.Cookie) {
        console.log(`Cookie 项数：${Array.from(parseCookieInput(headers.Cookie).split(";")).length}`);
    }
    if (result.isDefault) {
        console.log("默认账号：是");
    }
    return 0;
}
async function runList(input) {
    const provider = input[0];
    const accounts = await listAccounts(provider);
    if (accounts.length === 0) {
        console.log("还没有绑定任何账号。");
        console.log(`账号存储：${buildAccountStorePath()}`);
        return 0;
    }
    for (const account of accounts) {
        console.log(`${account.isDefault ? "*" : " "} ${account.provider}:${account.name}`);
        console.log(`  请求头：${account.headerNames.join(", ") || "无"}`);
        console.log(`  更新于：${account.updatedAt}`);
        if (account.note) {
            console.log(`  备注：${account.note}`);
        }
    }
    return 0;
}
async function runShow(input) {
    const provider = input[0];
    const name = input[1];
    if (!provider || !name) {
        printAccountUsage(provider);
        throw new Error("`account show` 需要提供 <provider> <name>。");
    }
    const result = await getAccount(provider, name);
    if (!result) {
        throw new Error(`没有找到账号：${provider}:${name}。`);
    }
    const account = redactAccount(result.account);
    printJson({
        ...account,
        isDefault: result.isDefault,
    });
    return 0;
}
async function runUse(input, flags) {
    const provider = input[0] ?? flags.provider;
    const name = input[1] ?? flags.name;
    if (!provider || !name) {
        printAccountUsage(provider);
        throw new Error("`account use` 需要提供 <provider> <name>。");
    }
    await setDefaultAccount(provider, name);
    console.log(`已将 ${provider} 的默认账号切换为 ${name}。`);
    return 0;
}
async function runRemove(input, flags) {
    const provider = input[0] ?? flags.provider;
    const name = input[1] ?? flags.name;
    if (!provider || !name) {
        printAccountUsage(provider);
        throw new Error("`account remove` 需要提供 <provider> <name>。");
    }
    const removed = await removeAccount(provider, name);
    if (!removed) {
        throw new Error(`没有找到账号：${provider}:${name}。`);
    }
    console.log(`已删除账号：${provider}:${name}。`);
    return 0;
}
async function runCheck(input, flags) {
    const provider = input[0] ?? flags.provider;
    const name = input[1] ?? flags.name;
    if (!provider || !name) {
        printAccountUsage(provider);
        throw new Error("`account check` 需要提供 <provider> <name>。");
    }
    const result = await getAccount(provider, name);
    if (!result) {
        throw new Error(`没有找到账号：${provider}:${name}。`);
    }
    const diagnostics = inspectProviderAccountHeaders(provider, result.account.headers);
    console.log(`账号检查：${result.account.provider}:${result.account.name}`);
    console.log(`默认账号：${result.isDefault ? "是" : "否"}`);
    console.log(`请求头：${Object.keys(result.account.headers).join(", ") || "无"}`);
    console.log("本地诊断：");
    if (diagnostics.length === 0) {
        console.log("当前平台没有提供额外的本地诊断。");
    }
    else {
        let hasError = false;
        for (const diagnostic of diagnostics) {
            if (diagnostic.level === "error") {
                hasError = true;
            }
            const prefix = formatDiagnosticPrefix(diagnostic.level);
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
        console.log("远程探针：");
        console.log("提醒：当前平台暂时没有远程登录探针。");
        return diagnostics.some((item) => item.level === "error") ? 1 : 0;
    }
    console.log("远程探针：");
    for (const line of remote.summaryLines ?? []) {
        console.log(`信息：${line}`);
    }
    let hasError = diagnostics.some((item) => item.level === "error");
    for (const diagnostic of remote.diagnostics) {
        if (diagnostic.level === "error") {
            hasError = true;
        }
        const prefix = formatDiagnosticPrefix(diagnostic.level);
        console.log(`${prefix}: ${diagnostic.message}`);
    }
    return hasError ? 1 : 0;
}
function parseHeader(raw) {
    const separatorIndex = raw.indexOf(":");
    if (separatorIndex === -1) {
        throw new Error(`请求头格式必须是 "Key: Value"，当前收到的是 "${raw}"。`);
    }
    const key = raw.slice(0, separatorIndex).trim();
    const value = raw.slice(separatorIndex + 1).trim();
    if (!key || !value) {
        throw new Error(`请求头格式必须是 "Key: Value"，当前收到的是 "${raw}"。`);
    }
    return [key, value];
}
async function readStdinSecret() {
    return new Promise((resolve, reject) => {
        let value = "";
        stdin.setEncoding("utf8");
        stdin.on("data", (chunk) => {
            value += chunk;
        });
        stdin.on("end", () => {
            const trimmed = value.trim();
            if (!trimmed) {
                reject(new Error("标准输入里没有读到任何密钥内容。"));
                return;
            }
            resolve(trimmed);
        });
        stdin.on("error", reject);
    });
}
function formatDiagnosticPrefix(level) {
    if (level === "ok") {
        return "通过";
    }
    if (level === "warning") {
        return "提醒";
    }
    return "错误";
}
function printJson(value) {
    console.log(JSON.stringify(value, null, 2));
}
