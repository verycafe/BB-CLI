import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { startTransition, useEffect, useState } from "react";
import { Box, Newline, Text, useApp, useInput } from "ink";
import { loadMediaSession } from "./lib/providers.js";
import { buildLaunchPlan, detectPlayerSupport, launchPlayer, } from "./lib/player.js";
export default function App({ target, inspectOnly, preferredVo, useFastProfile, account }) {
    const { exit } = useApp();
    const [reloadKey, setReloadKey] = useState(0);
    const [state, setState] = useState(() => {
        if (!target) {
            return { status: "idle" };
        }
        return { status: "loading" };
    });
    useEffect(() => {
        if (!target) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const [session, support] = await Promise.all([
                    loadMediaSession(target, account),
                    Promise.resolve(detectPlayerSupport(preferredVo)),
                ]);
                if (cancelled) {
                    return;
                }
                startTransition(() => {
                    setState({
                        status: "ready",
                        session,
                        support,
                        selectedIndex: 0,
                        message: inspectOnly ? "Inspect mode enabled. Playback is disabled." : undefined,
                    });
                });
            }
            catch (error) {
                if (cancelled) {
                    return;
                }
                const message = error instanceof Error ? error.message : String(error);
                startTransition(() => {
                    setState({ status: "error", error: message });
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [target, inspectOnly, preferredVo, reloadKey, account]);
    useInput((inputKey, key) => {
        if (state.status === "idle") {
            if (inputKey === "q") {
                exit();
            }
            return;
        }
        if (state.status === "error") {
            if (inputKey === "q" || key.escape || key.return) {
                exit();
            }
            return;
        }
        if (state.status === "loading") {
            if (inputKey === "q") {
                exit();
            }
            return;
        }
        if (state.status === "playing") {
            return;
        }
        if (key.upArrow || inputKey === "k") {
            setState({
                ...state,
                selectedIndex: Math.max(0, state.selectedIndex - 1),
            });
            return;
        }
        if (key.downArrow || inputKey === "j") {
            setState({
                ...state,
                selectedIndex: Math.min(state.session.variants.length - 1, state.selectedIndex + 1),
            });
            return;
        }
        if (inputKey === "q" || key.escape) {
            exit();
            return;
        }
        if (inputKey === "r") {
            setState({ status: "loading" });
            setReloadKey((value) => value + 1);
            return;
        }
        if (inspectOnly) {
            if (key.return || inputKey === "p") {
                setState({
                    ...state,
                    message: "Inspect mode is active. Re-run without --inspect to launch playback.",
                });
            }
            return;
        }
        if (key.return || inputKey === "p") {
            const variant = state.session.variants[state.selectedIndex];
            const plan = buildLaunchPlan(state.session, variant, state.support, {
                playerVo: preferredVo,
                useFastProfile,
            });
            setState({
                status: "playing",
                session: state.session,
                support: state.support,
                selectedIndex: state.selectedIndex,
                message: `Launching ${plan.player} with ${state.support.mpvInstalled ? state.support.preferredVo : "windowed"} output...`,
            });
            process.stdout.write("\x1Bc");
            void (async () => {
                try {
                    const code = await launchPlayer(plan);
                    setState({
                        status: "ready",
                        session: state.session,
                        support: state.support,
                        selectedIndex: state.selectedIndex,
                        lastPlan: plan,
                        message: `${plan.player} exited with code ${code}.`,
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    setState({
                        status: "ready",
                        session: state.session,
                        support: state.support,
                        selectedIndex: state.selectedIndex,
                        lastPlan: plan,
                        message: `Player launch failed: ${message}`,
                    });
                }
            })();
        }
    });
    if (state.status === "idle") {
        return _jsx(IdleScreen, {});
    }
    if (state.status === "loading") {
        return _jsx(LoadingScreen, { target: target });
    }
    if (state.status === "error") {
        return _jsx(ErrorScreen, { error: state.error });
    }
    if (state.status === "playing") {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: state.message }), _jsx(Text, { dimColor: true, children: "Return here after the player exits." })] }));
    }
    return (_jsx(Dashboard, { session: state.session, support: state.support, selectedIndex: state.selectedIndex, inspectOnly: inspectOnly, target: target, account: account, message: state.message, lastPlan: state.lastPlan }));
}
function IdleScreen() {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "cyan", children: "BBCLI" }), _jsx(Text, { children: "Usage: bbcli <bilibili-url-or-bvid>" }), _jsx(Text, { dimColor: true, children: "Example: `bbcli BV17PYqerEtA`" }), _jsx(Text, { dimColor: true, children: "Try `bbcli providers` or `bbcli account list`." }), _jsx(Text, { dimColor: true, children: "Press `q` to quit." })] }));
}
function LoadingScreen({ target }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "yellow", children: `Loading ${target.providerLabel} page data...` }), _jsx(Text, { dimColor: true, children: target.originalInput }), _jsx(Text, { dimColor: true, children: "Fetching `window.__playinfo__` and `window.__INITIAL_STATE__`." })] }));
}
function ErrorScreen({ error }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "red", children: "Failed to load video" }), _jsx(Text, { children: error }), _jsx(Text, { dimColor: true, children: "Press `Enter`, `Esc`, or `q` to quit." })] }));
}
function Dashboard({ session, support, selectedIndex, inspectOnly, target, account, message, lastPlan, }) {
    const selectedVariant = session.variants[selectedIndex];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "cyan", children: "BBCLI" }), _jsx(Text, { bold: true, children: session.title }), _jsxs(Text, { dimColor: true, children: [session.ownerName, "  |  ", formatDuration(session.durationSeconds), "  |  ", session.bvid] }), target ? _jsx(Text, { dimColor: true, children: `Provider: ${target.providerLabel}` }) : null, account ? _jsx(Text, { dimColor: true, children: `Account: ${account.provider}:${account.name}` }) : null, _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Playback" }), _jsxs(Text, { children: ["Player: ", support.mpvInstalled ? "mpv terminal mode" : support.ffplayInstalled ? "ffplay fallback (non-terminal)" : "missing"] }), _jsxs(Text, { children: ["Terminal: ", support.detectedTerminal, "  |  Preferred VO: ", support.preferredVo] }), support.notes.map((note, index) => (_jsxs(Text, { dimColor: true, children: ["- ", note] }, index))), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Streams" }), session.variants.map((variant, index) => {
                const selected = index === selectedIndex;
                return (_jsxs(Text, { color: selected ? "yellow" : undefined, children: [selected ? ">" : " ", " ", variant.label, "  |  ", variant.codecLabel, "  |  ", formatBitrate(variant.videoBandwidth)] }, variant.quality));
            }), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Selected Network Info" }), _jsxs(Text, { children: ["Host: ", selectedVariant.host] }), _jsxs(Text, { children: ["Codec: ", selectedVariant.codecLabel] }), _jsxs(Text, { children: ["Video bitrate: ", formatBitrate(selectedVariant.videoBandwidth), "  |  Audio bitrate: ", formatBitrate(selectedVariant.audioBandwidth)] }), _jsxs(Text, { children: ["Signed URL expires: ", selectedVariant.expiresAt ?? "unknown"] }), _jsxs(Text, { dimColor: true, children: ["Referer: ", session.pageUrl] }), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Stats" }), _jsxs(Text, { children: ["Views ", formatCount(session.stats.views), "  Likes ", formatCount(session.stats.likes), "  Danmaku ", formatCount(session.stats.danmaku)] }), _jsxs(Text, { children: ["Coins ", formatCount(session.stats.coins), "  Favorites ", formatCount(session.stats.favorites), "  Shares ", formatCount(session.stats.shares)] }), session.parts.length > 1 ? (_jsxs(_Fragment, { children: [_jsx(Newline, {}), _jsx(Text, { color: "green", children: "Parts" }), session.parts.slice(0, 5).map((part) => (_jsxs(Text, { children: ["P", part.page, "  ", part.part] }, part.cid)))] })) : null, _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Controls" }), _jsx(Text, { children: inspectOnly ? "j/k or arrows to change quality, r to reload, q to quit." : "j/k or arrows to change quality, Enter/p to play, r to reload, q to quit." }), message ? _jsx(Text, { color: "yellow", children: message }) : null, lastPlan ? (_jsxs(Text, { dimColor: true, children: ["Last command: ", lastPlan.command, " ", lastPlan.args.join(" ")] })) : null] }));
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
function formatBitrate(value) {
    if (!value) {
        return "n/a";
    }
    return `${(value / 1000).toFixed(0)} kbps`;
}
function formatCount(value) {
    if (value === undefined) {
        return "n/a";
    }
    return new Intl.NumberFormat("en-US").format(value);
}
