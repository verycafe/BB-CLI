#!/usr/bin/env node
import { jsx as _jsx } from "react/jsx-runtime";
import { render } from "ink";
import meow from "meow";
import App from "./app.js";
import { runAccountCommand } from "./lib/account-cli.js";
import { buildHeadersFromAccount, resolveAccount } from "./lib/accounts.js";
import { loadMediaSession, printProvidersSummary, resolveMediaTarget } from "./lib/providers.js";
const cli = meow(`
  用法
    $ bbcli
    $ bbcli <bilibili-链接或 BV 号>
    $ bbcli providers [id]
    $ bbcli account <bind|list|show|use|remove|check> ...

  选项
    --inspect     只加载页面数据，不启动播放器
    --vo          强制指定 mpv 输出模式：auto | kitty | sixel | tct
    --no-fast     禁用 mpv 的 --profile=sw-fast
    --external-player  当 mpv 不可用时，允许 ffplay 以单独窗口打开
    --account     选择当前平台要使用的账号名
    --provider    为媒体或账号命令指定平台名
    --name        为账号命令指定账号名
    --cookie      将原始 Cookie 请求头绑定到账号
    --cookie-file 从文件导入 Cookie 文本或 Netscape 格式的 Cookie 文件
    --cookie-stdin 从标准输入读取 Cookie
    --remote      在支持时执行平台远程登录探测
    --token       将 Bearer Token 绑定到账号
    --token-stdin 从标准输入读取 Bearer Token
    --header      绑定额外请求头，可重复使用，格式：'Key: Value'
    --note        账号备注
    --default     将该账号设为平台默认账号

  示例
    $ bbcli
    $ bbcli BV17PYqerEtA
    $ bbcli https://www.bilibili.com/video/BV17PYqerEtA/
    $ bbcli BV17PYqerEtA --vo=kitty
    $ bbcli BV17PYqerEtA --inspect
    $ bbcli account bind bilibili --name main --cookie-stdin < bilibili.cookie
    $ bbcli account bind bilibili --name main --cookie-file ./cookies.txt
    $ bbcli account check bilibili main
    $ bbcli account list
    $ bbcli providers
    $ bbcli providers bilibili
`, {
    importMeta: import.meta,
    flags: {
        inspect: {
            type: "boolean",
            default: false,
        },
        vo: {
            type: "string",
            default: "auto",
        },
        fast: {
            type: "boolean",
            default: true,
        },
        externalPlayer: {
            type: "boolean",
            default: false,
        },
        account: {
            type: "string",
        },
        provider: {
            type: "string",
        },
        name: {
            type: "string",
        },
        cookie: {
            type: "string",
        },
        cookieFile: {
            type: "string",
        },
        cookieStdin: {
            type: "boolean",
            default: false,
        },
        remote: {
            type: "boolean",
            default: false,
        },
        token: {
            type: "string",
        },
        tokenStdin: {
            type: "boolean",
            default: false,
        },
        header: {
            type: "string",
            isMultiple: true,
            default: [],
        },
        note: {
            type: "string",
        },
        default: {
            type: "boolean",
            default: false,
        },
    },
});
const vo = parseVo(cli.flags.vo);
try {
    await main();
}
catch (error) {
    handleCliError(error);
}
async function main() {
    if (cli.input[0] === "account") {
        const command = cli.input[1];
        if (!command) {
            throw new Error("缺少 account 子命令。");
        }
        const exitCode = await runAccountCommand(command, cli.input.slice(2), {
            name: cli.flags.name,
            provider: cli.flags.provider,
            cookie: cli.flags.cookie,
            cookieFile: cli.flags.cookieFile,
            cookieStdin: cli.flags.cookieStdin,
            remote: cli.flags.remote,
            token: cli.flags.token,
            tokenStdin: cli.flags.tokenStdin,
            header: cli.flags.header,
            note: cli.flags.note,
            default: cli.flags.default,
        });
        process.exitCode = exitCode;
        return;
    }
    if (cli.input[0] === "providers") {
        await printProvidersSummary(cli.input[1]);
        return;
    }
    const mediaInput = cli.input[0];
    if (!mediaInput && !process.stdin.isTTY) {
        printNonInteractiveHelp();
        return;
    }
    const target = mediaInput ? resolveMediaTarget(mediaInput, cli.flags.provider) : undefined;
    if (target && !process.stdin.isTTY) {
        await printNonInteractiveSession(target, cli.flags.account, cli.flags.inspect);
        return;
    }
    render(_jsx(App, { target: target, inspectOnly: cli.flags.inspect, preferredVo: vo, useFastProfile: cli.flags.fast, allowExternalPlayer: cli.flags.externalPlayer, selectedAccountName: cli.flags.account, providerOverride: cli.flags.provider }));
}
function parseVo(value) {
    if (value === "auto" || value === "kitty" || value === "sixel" || value === "tct") {
        return value;
    }
    throw new Error(`不支持的 --vo 参数值：${value}`);
}
function handleCliError(error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`bbcli: ${message}`);
    process.exit(1);
}
function printNonInteractiveHelp() {
    console.log("BBCLI");
    console.log("请在可交互终端中运行 `bbcli`，进入发现 / 搜索 / 书库 / 账号 启动器。");
    console.log("");
    console.log("直接打开：");
    console.log("  bbcli BV17PYqerEtA");
    console.log("  bbcli https://www.bilibili.com/video/BV17PYqerEtA/");
    console.log("");
    console.log("常用命令：");
    console.log("  bbcli");
    console.log("  bbcli account list");
}
async function printNonInteractiveSession(target, selectedAccountName, inspectOnly) {
    const account = await buildRequestAccount(target.providerId, selectedAccountName);
    const session = await loadMediaSession(target, account);
    const selectedVariant = session.variants[0];
    console.log("BBCLI");
    console.log(session.title);
    console.log(`${session.ownerName} | ${session.bvid} | ${formatDuration(session.durationSeconds)}`);
    console.log(`平台：${target.providerLabel}`);
    if (account) {
        console.log(`账号：${account.provider}:${account.name}`);
    }
    console.log(`推荐码流：${selectedVariant?.label ?? "无"} | ${selectedVariant?.codecLabel ?? "无"}`);
    console.log(`页面：${session.pageUrl}`);
    if (!inspectOnly) {
        console.log("当前不是交互式终端，因此已跳过播放。");
    }
}
async function buildRequestAccount(providerId, selectedAccountName) {
    const resolved = await resolveAccount(providerId, selectedAccountName);
    if (!resolved) {
        return undefined;
    }
    return {
        provider: resolved.account.provider,
        name: resolved.account.name,
        headers: buildHeadersFromAccount(resolved.account),
    };
}
function formatDuration(seconds) {
    const total = Math.max(0, seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = total % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
