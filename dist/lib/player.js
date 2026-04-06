import { spawn, spawnSync } from "node:child_process";
export function detectPlayerSupport(preferredVo = "auto") {
    const mpvInstalled = hasCommand("mpv");
    const ffplayInstalled = hasCommand("ffplay");
    const detectedTerminal = detectTerminalLabel();
    const notes = [];
    let resolvedVo = "tct";
    if (preferredVo !== "auto") {
        resolvedVo = preferredVo;
        notes.push(`VO forced to ${preferredVo}.`);
    }
    else if (looksLikeKittyProtocolTerminal()) {
        resolvedVo = "kitty";
        notes.push("Detected a kitty-protocol capable terminal.");
    }
    else if (looksLikeSixelTerminal()) {
        resolvedVo = "sixel";
        notes.push("Detected a terminal that may support sixel.");
    }
    else {
        resolvedVo = "tct";
        notes.push("Falling back to the Unicode TCT renderer.");
    }
    if (!mpvInstalled) {
        notes.push("mpv is not installed, so terminal-native playback is unavailable.");
    }
    if (!ffplayInstalled) {
        notes.push("ffplay is not installed, so there is no windowed fallback player.");
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
    throw new Error("Neither mpv nor ffplay is available on this machine.");
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
    return parts.join(" / ") || "unknown";
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
