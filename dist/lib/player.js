import { spawn, spawnSync } from "node:child_process";
export function detectPlayerSupport(preferredVo = "auto") {
    const mpvInstalled = hasCommand("mpv");
    const ffplayInstalled = hasCommand("ffplay");
    const detectedTerminal = detectTerminalLabel();
    const notes = [];
    let resolvedVo = "tct";
    if (preferredVo !== "auto") {
        resolvedVo = preferredVo;
        notes.push(`已强制使用 ${preferredVo} 输出模式。`);
    }
    else if (looksLikeKittyProtocolTerminal()) {
        resolvedVo = "kitty";
        notes.push("检测到支持 kitty 协议的终端。");
    }
    else if (looksLikeSixelTerminal()) {
        resolvedVo = "sixel";
        notes.push("检测到可能支持 sixel 的终端。");
    }
    else {
        resolvedVo = "tct";
        notes.push("已回退到 Unicode TCT 渲染器。");
    }
    if (!mpvInstalled) {
        notes.push("未安装 mpv，因此无法使用终端原生播放。");
    }
    if (!ffplayInstalled) {
        notes.push("未安装 ffplay，因此没有外部窗口回退播放器。");
    }
    return {
        mpvInstalled,
        ffplayInstalled,
        preferredVo: resolvedVo,
        detectedTerminal,
        notes,
    };
}
export function buildLaunchPlan(session, variant, support, options) {
    if (support.mpvInstalled) {
        const vo = options.playerVo === "auto" ? support.preferredVo : options.playerVo;
        const args = [
            `--force-window=no`,
            `--vo=${vo}`,
            `--title=bbcli: ${session.title}`,
            `--user-agent=${session.userAgent}`,
            `--referrer=${session.pageUrl}`,
            `--http-header-fields=Origin: ${session.sourceOrigin}`,
            "--really-quiet",
            "--keep-open=no",
            "--osc=no",
            "--osd-level=1",
            "--msg-level=all=error",
        ];
        if (options.useFastProfile) {
            args.push("--profile=sw-fast");
        }
        args.push(variant.videoUrl, `--audio-file=${variant.audioUrl}`);
        return {
            player: "mpv",
            command: "mpv",
            args,
        };
    }
    if (support.ffplayInstalled) {
        if (!options.allowExternalPlayer) {
            throw new Error("终端内播放必须依赖 mpv。请先安装 mpv；如果你明确接受弹出单独窗口，再使用 --external-player 允许 ffplay 回退。");
        }
        return {
            player: "ffplay",
            command: "ffplay",
            args: [
                "-loglevel",
                "error",
                "-window_title",
                `bbcli: ${session.title}`,
                "-headers",
                `Referer: ${session.pageUrl}\r\nOrigin: ${session.sourceOrigin}\r\nUser-Agent: ${session.userAgent}\r\n`,
                variant.videoUrl,
            ],
        };
    }
    throw new Error("终端内播放必须依赖 mpv，而且当前机器上也没有可用的回退播放器。");
}
export async function launchPlayer(plan) {
    return new Promise((resolve, reject) => {
        const child = spawn(plan.command, plan.args, {
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("close", (code) => {
            resolve(code ?? 0);
        });
    });
}
function hasCommand(command) {
    const result = spawnSync("zsh", ["-lc", `command -v ${command}`], {
        stdio: "pipe",
    });
    return result.status === 0;
}
function detectTerminalLabel() {
    const parts = [
        process.env.TERM_PROGRAM,
        process.env.TERM,
        process.env.COLORTERM,
    ].filter(Boolean);
    return parts.join(" / ") || "未知";
}
function looksLikeKittyProtocolTerminal() {
    const term = process.env.TERM?.toLowerCase() ?? "";
    const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
    return (Boolean(process.env.KITTY_WINDOW_ID) ||
        term.includes("kitty") ||
        termProgram.includes("wezterm") ||
        termProgram.includes("ghostty") ||
        termProgram.includes("konsole"));
}
function looksLikeSixelTerminal() {
    const term = process.env.TERM?.toLowerCase() ?? "";
    const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
    const xtermVersion = process.env.XTERM_VERSION?.toLowerCase() ?? "";
    return (term.includes("mlterm") ||
        term.includes("xterm") ||
        termProgram.includes("xterm") ||
        xtermVersion.length > 0);
}
