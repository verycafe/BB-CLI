import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import React, { startTransition, useEffect, useState } from "react";
import { Box, Newline, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { bindAccount, buildHeadersFromAccount, listAccounts, resolveAccount, } from "./lib/accounts.js";
import { parseCookieInput } from "./lib/cookies.js";
import { listKnownProviders, listRecommendedMedia, loadMediaSession, resolveMediaTarget, searchMedia, validateProviderAccountHeaders, } from "./lib/providers.js";
import { buildLaunchPlan, detectPlayerSupport, launchPlayer, } from "./lib/player.js";
import { ACCOUNT_CONNECTORS, LIBRARY_CONNECTORS, } from "./lib/workspace-catalog.js";
import { listLocalBooks, loadLocalBook, } from "./lib/local-library.js";
const HOME_TABS = [
    {
        id: "discover",
        label: "发现",
        summary: "推荐视频与内容入口。",
        items: [
            {
                id: "discover-bilibili-home",
                label: "哔哩哔哩首页推荐",
                note: "直接进入当前可用的推荐视频流。",
                status: "live",
                action: {
                    type: "open-workspace",
                    tab: "discover",
                },
            },
            {
                id: "discover-youtube-home",
                label: "YouTube 首页流",
                note: "后续会接订阅、Shorts 和首页推荐。",
                status: "planned",
                action: {
                    type: "planned",
                    message: "YouTube 首页流还在规划中，先用“发现”里的哔哩哔哩推荐。",
                },
            },
            {
                id: "discover-instagram-timeline",
                label: "Instagram 时间线",
                note: "后续会接创作者时间线和短视频入口。",
                status: "planned",
                action: {
                    type: "planned",
                    message: "Instagram 时间线还在规划中。",
                },
            },
        ],
    },
    {
        id: "search",
        label: "搜索",
        summary: "搜索视频、链接与未来多平台内容。",
        items: [
            {
                id: "search-keyword",
                label: "关键词搜索",
                note: "输入关键词后回车，查看哔哩哔哩结果。",
                status: "live",
                action: {
                    type: "open-workspace",
                    tab: "search",
                    message: "输入关键词后按回车搜索。",
                },
            },
            {
                id: "search-link",
                label: "粘贴链接直接打开",
                note: "粘贴哔哩哔哩视频链接后回车。",
                status: "live",
                action: {
                    type: "open-workspace",
                    tab: "search",
                    message: "粘贴链接后按回车，BBCLI 会优先尝试直接打开。",
                },
            },
            {
                id: "search-google",
                label: "Google 搜索",
                note: "后续会接网页搜索和快速跳转。",
                status: "planned",
                action: {
                    type: "planned",
                    message: "Google 搜索还在规划中，当前先支持哔哩哔哩搜索。",
                },
            },
        ],
    },
    {
        id: "library",
        label: "书库",
        summary: "阅读、本地文件与收藏内容。",
        items: [
            {
                id: "library-local-books",
                label: "本地书架",
                note: "扫描当前目录、Books、文稿和下载目录里的书籍。",
                status: "live",
                action: {
                    type: "open-workspace",
                    tab: "library",
                },
            },
            {
                id: "library-weread",
                label: "微信读书",
                note: "后续会接书架、进度和划线。",
                status: "planned",
                action: {
                    type: "planned",
                    message: "微信读书还在规划中，当前书库主要是结构入口。",
                },
            },
            {
                id: "library-saved-media",
                label: "已保存内容",
                note: "后续会接稍后再看、剪藏和离线媒体。",
                status: "planned",
                action: {
                    type: "planned",
                    message: "已保存内容还在规划中，当前先把本地书架做好。",
                },
            },
        ],
    },
    {
        id: "accounts",
        label: "账号",
        summary: "绑定平台账号与身份。",
        items: [
            {
                id: "accounts-bilibili",
                label: "绑定哔哩哔哩账号",
                note: "进入账号页，填写 Cookie 或 Cookie 文件。",
                status: "live",
                action: {
                    type: "open-workspace",
                    tab: "accounts",
                },
            },
            {
                id: "accounts-weread",
                label: "微信读书账号",
                note: "后续会接阅读身份和书架同步。",
                status: "planned",
                action: {
                    type: "planned",
                    message: "微信读书账号接入还在规划中。",
                },
            },
            {
                id: "accounts-youtube",
                label: "YouTube 账号",
                note: "后续会接订阅、播放列表和创作者身份。",
                status: "planned",
                action: {
                    type: "planned",
                    message: "YouTube 账号接入还在规划中。",
                },
            },
        ],
    },
];
const EMPTY_ACCOUNT_FORM = {
    activeField: "name",
    inputMode: "cookie",
    name: "main",
    value: "",
    note: "",
    makeDefault: true,
    busy: false,
    message: undefined,
    messageTone: undefined,
    existingAccounts: [],
    defaultAccount: undefined,
};
export default function App({ target, inspectOnly, preferredVo, useFastProfile, allowExternalPlayer, selectedAccountName, providerOverride }) {
    const { exit } = useApp();
    const { isRawModeSupported, setRawMode } = useStdin();
    const { stdout } = useStdout();
    const providerDescriptors = listKnownProviders();
    const accountProviderOptions = providerDescriptors.filter((provider) => provider.supportsAccounts);
    const accountProviderIdsKey = accountProviderOptions.map((provider) => provider.id).join(",");
    const defaultMediaProvider = providerDescriptors.find((provider) => provider.supportsMedia);
    const defaultAccountProvider = providerDescriptors.find((provider) => provider.supportsAccounts);
    const homeMediaProviderId = providerOverride ?? defaultMediaProvider?.id ?? "bilibili";
    const homeMediaProvider = providerDescriptors.find((provider) => provider.id === homeMediaProviderId);
    const [reloadKey, setReloadKey] = useState(0);
    const [homeDataKey, setHomeDataKey] = useState(0);
    const [recommendationKey, setRecommendationKey] = useState(0);
    const [libraryKey, setLibraryKey] = useState(0);
    const [activeTarget, setActiveTarget] = useState(target);
    const [launchInspectOnly, setLaunchInspectOnly] = useState(inspectOnly);
    const [launchVo, setLaunchVo] = useState(preferredVo);
    const [homeTab, setHomeTab] = useState("discover");
    const [homeView, setHomeView] = useState("menu");
    const [homeMenuIndex, setHomeMenuIndex] = useState(0);
    const [homeMenuItemIndex, setHomeMenuItemIndex] = useState(0);
    const [homeMenuMessage, setHomeMenuMessage] = useState();
    const [selectedAccountProviderId, setSelectedAccountProviderId] = useState(providerOverride ?? defaultAccountProvider?.id ?? homeMediaProviderId);
    const [providerSummaries, setProviderSummaries] = useState([]);
    const [recommendations, setRecommendations] = useState({
        loading: !target,
        items: [],
        selectedIndex: 0,
    });
    const [search, setSearch] = useState({
        query: "",
        loading: false,
        results: [],
        selectedIndex: 0,
    });
    const [library, setLibrary] = useState({
        loading: false,
        books: [],
        selectedIndex: 0,
        roots: [],
    });
    const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT_FORM);
    const [state, setState] = useState(() => (target ? { status: "loading" } : { status: "home" }));
    const [terminalSize, setTerminalSize] = useState(() => ({
        columns: stdout.columns ?? 100,
        rows: stdout.rows ?? 32,
    }));
    const homeAccountProviderId = selectedAccountProviderId;
    const homeAccountProvider = providerDescriptors.find((provider) => provider.id === homeAccountProviderId);
    useEffect(() => {
        if (providerOverride) {
            setSelectedAccountProviderId(providerOverride);
            return;
        }
        if (accountProviderOptions.some((provider) => provider.id === selectedAccountProviderId)) {
            return;
        }
        setSelectedAccountProviderId(defaultAccountProvider?.id ?? homeMediaProviderId);
    }, [accountProviderIdsKey, defaultAccountProvider?.id, homeMediaProviderId, providerOverride, selectedAccountProviderId]);
    useEffect(() => {
        function handleResize() {
            setTerminalSize({
                columns: stdout.columns ?? 100,
                rows: stdout.rows ?? 32,
            });
        }
        handleResize();
        stdout.on("resize", handleResize);
        return () => {
            stdout.off("resize", handleResize);
        };
    }, [stdout]);
    useEffect(() => {
        setHomeMenuItemIndex((current) => {
            const itemCount = HOME_TABS[homeMenuIndex]?.items.length ?? 0;
            if (itemCount <= 0) {
                return 0;
            }
            return Math.min(current, itemCount - 1);
        });
    }, [homeMenuIndex]);
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const summaries = await Promise.all(providerDescriptors.map(async (provider) => {
                const accounts = await listAccounts(provider.id);
                const defaultAccount = accounts.find((entry) => entry.isDefault);
                return {
                    id: provider.id,
                    label: provider.label,
                    supportsAccounts: provider.supportsAccounts,
                    detectionHint: provider.detectionHint,
                    example: provider.examples[0],
                    boundAccounts: accounts.length,
                    defaultAccount: defaultAccount?.name,
                };
            }));
            const accountEntries = await listAccounts(homeAccountProviderId);
            const defaultAccount = accountEntries.find((entry) => entry.isDefault);
            if (cancelled) {
                return;
            }
            startTransition(() => {
                setProviderSummaries(summaries);
                setAccountForm((current) => ({
                    ...current,
                    existingAccounts: accountEntries.map((entry) => entry.name),
                    defaultAccount: defaultAccount?.name,
                    makeDefault: current.name.length > 0 ? current.makeDefault : !defaultAccount,
                }));
            });
        })().catch((error) => {
            if (cancelled) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            startTransition(() => {
                setAccountForm((current) => ({
                    ...current,
                    message: message,
                    messageTone: "error",
                }));
            });
        });
        return () => {
            cancelled = true;
        };
    }, [homeAccountProviderId, homeDataKey]);
    useEffect(() => {
        let cancelled = false;
        startTransition(() => {
            setRecommendations((current) => ({
                ...current,
                loading: true,
                message: undefined,
            }));
        });
        void (async () => {
            const requestAccount = await resolveRequestAccount(homeMediaProviderId, selectedAccountName);
            const items = await listRecommendedMedia(homeMediaProviderId, requestAccount);
            if (cancelled) {
                return;
            }
            startTransition(() => {
                setRecommendations({
                    loading: false,
                    items,
                    selectedIndex: 0,
                    message: items.length === 0 ? "当前没有可用推荐内容。" : undefined,
                });
            });
        })().catch((error) => {
            if (cancelled) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            startTransition(() => {
                setRecommendations({
                    loading: false,
                    items: [],
                    selectedIndex: 0,
                    message,
                });
            });
        });
        return () => {
            cancelled = true;
        };
    }, [homeMediaProviderId, recommendationKey, selectedAccountName]);
    useEffect(() => {
        if (homeView !== "workspace" || homeTab !== "library") {
            return;
        }
        let cancelled = false;
        startTransition(() => {
            setLibrary((current) => ({
                ...current,
                loading: true,
                message: current.books.length > 0 ? "正在刷新本地书架..." : "正在扫描本地书架...",
            }));
        });
        void (async () => {
            const snapshot = await listLocalBooks();
            if (cancelled) {
                return;
            }
            startTransition(() => {
                setLibrary((current) => ({
                    loading: false,
                    books: snapshot.books,
                    roots: snapshot.roots,
                    selectedIndex: Math.min(current.selectedIndex, Math.max(0, snapshot.books.length - 1)),
                    message: snapshot.books.length === 0
                        ? "还没有找到本地书籍。可以把 EPUB、PDF、TXT、Markdown、HTML、DOCX 放到当前目录、Books、文稿、下载或桌面。"
                        : `已找到 ${snapshot.books.length} 本本地书，回车即可开始阅读。`,
                }));
            });
        })().catch((error) => {
            if (cancelled) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            startTransition(() => {
                setLibrary((current) => ({
                    ...current,
                    loading: false,
                    message,
                }));
            });
        });
        return () => {
            cancelled = true;
        };
    }, [homeTab, homeView, libraryKey]);
    useEffect(() => {
        if (!activeTarget) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const requestAccount = await resolveRequestAccount(activeTarget.providerId, selectedAccountName);
                const [session, support] = await Promise.all([
                    loadMediaSession(activeTarget, requestAccount),
                    Promise.resolve(detectPlayerSupport(launchVo)),
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
                        account: requestAccount,
                        message: launchInspectOnly ? "当前是检查模式，已禁用播放。" : undefined,
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
    }, [activeTarget, launchInspectOnly, launchVo, reloadKey, selectedAccountName]);
    useEffect(() => {
        const nextContentWidth = getReaderContentWidth(terminalSize.columns);
        setState((current) => {
            if (current.status !== "reader" || current.contentWidth === nextContentWidth) {
                return current;
            }
            const progress = current.wrappedLines.length > 1
                ? current.topLine / Math.max(1, current.wrappedLines.length - 1)
                : 0;
            const wrappedLines = wrapReaderText(current.document.text, nextContentWidth);
            const maxTopLine = Math.max(0, wrappedLines.length - getReaderPageSize(terminalSize.rows));
            return {
                ...current,
                contentWidth: nextContentWidth,
                wrappedLines,
                topLine: clamp(Math.round(progress * maxTopLine), 0, maxTopLine),
            };
        });
    }, [terminalSize.columns, terminalSize.rows]);
    function handleAppInput(inputKey, key) {
        if (state.status === "home") {
            handleHomeInput(inputKey, key);
            return;
        }
        if (state.status === "reader") {
            handleReaderInput(inputKey, key);
            return;
        }
        if (state.status === "error") {
            if (inputKey === "b" || inputKey === "h") {
                returnToHome(homeTab);
                return;
            }
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
        if (inputKey === "b" || inputKey === "h") {
            returnToHome(homeTab);
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
        if (launchInspectOnly) {
            if (key.return || inputKey === "p") {
                setState({
                    ...state,
                    message: "当前是检查模式。请不要使用 --inspect 重新运行，才能真正播放。",
                });
            }
            return;
        }
        if (key.return || inputKey === "p") {
            const variant = state.session.variants[state.selectedIndex];
            let plan;
            try {
                plan = buildLaunchPlan(state.session, variant, state.support, {
                    playerVo: launchVo,
                    useFastProfile,
                    allowExternalPlayer,
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setState({
                    ...state,
                    message,
                });
                return;
            }
            const currentSession = state.session;
            const currentSupport = state.support;
            const currentSelectedIndex = state.selectedIndex;
            const currentAccount = state.account;
            setState({
                status: "playing",
                session: currentSession,
                support: currentSupport,
                selectedIndex: currentSelectedIndex,
                account: currentAccount,
                message: plan.player === "mpv"
                    ? `正在使用 ${launchVo === "auto" ? currentSupport.preferredVo : launchVo} 输出模式启动 mpv...`
                    : "正在以单独窗口启动 ffplay...",
            });
            void (async () => {
                try {
                    setRawMode(false);
                    await pause(30);
                    const code = await launchPlayer(plan);
                    process.stdout.write("\x1Bc");
                    setState({
                        status: "ready",
                        session: currentSession,
                        support: currentSupport,
                        selectedIndex: currentSelectedIndex,
                        account: currentAccount,
                        lastPlan: plan,
                        message: `${plan.player} 已退出，退出码为 ${code}。你现在已经回到 BBCLI；按 b 可返回上一层列表。`,
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    process.stdout.write("\x1Bc");
                    setState({
                        status: "ready",
                        session: currentSession,
                        support: currentSupport,
                        selectedIndex: currentSelectedIndex,
                        account: currentAccount,
                        lastPlan: plan,
                        message: `播放器启动失败：${message}`,
                    });
                }
                finally {
                    setRawMode(true);
                }
            })();
        }
    }
    function handleHomeInput(inputKey, key) {
        if (inputKey === "q") {
            exit();
            return;
        }
        if (homeView === "menu") {
            handleHomeMenuInput(inputKey, key);
            return;
        }
        if (inputKey === "b" || inputKey === "h") {
            setHomeView("menu");
            return;
        }
        if (inputKey === "/") {
            openHomeWorkspace("search");
            setSearch((current) => ({
                ...current,
                message: "输入关键词，或粘贴哔哩哔哩链接后按回车。",
            }));
            return;
        }
        if (inputKey === "i") {
            setLaunchInspectOnly((value) => !value);
            return;
        }
        if (inputKey === "v") {
            setLaunchVo((value) => nextVo(value));
            return;
        }
        if (homeTab !== "search" && homeTab !== "accounts" && isPlainTextInput(inputKey, key)) {
            openHomeWorkspace("search");
            setSearch((current) => ({
                ...current,
                query: current.query + inputKey.replace(/[\r\n]+/g, ""),
                message: undefined,
            }));
            return;
        }
        if (homeTab === "discover") {
            handleRecommendationInput(inputKey, key);
            return;
        }
        if (homeTab === "search") {
            handleSearchInput(inputKey, key);
            return;
        }
        if (homeTab === "library") {
            handleLibraryInput(inputKey, key);
            return;
        }
        handleAccountInput(inputKey, key);
    }
    function handleHomeMenuInput(inputKey, key) {
        if (key.leftArrow || inputKey === "h") {
            setHomeMenuIndex((current) => (current - 1 + HOME_TABS.length) % HOME_TABS.length);
            setHomeMenuItemIndex(0);
            setHomeMenuMessage(undefined);
            return;
        }
        if (key.rightArrow || inputKey === "l") {
            setHomeMenuIndex((current) => (current + 1) % HOME_TABS.length);
            setHomeMenuItemIndex(0);
            setHomeMenuMessage(undefined);
            return;
        }
        if (key.upArrow || inputKey === "k") {
            setHomeMenuItemIndex((current) => Math.max(0, current - 1));
            setHomeMenuMessage(undefined);
            return;
        }
        if (key.downArrow || inputKey === "j") {
            const itemCount = HOME_TABS[homeMenuIndex]?.items.length ?? 0;
            setHomeMenuItemIndex((current) => Math.min(Math.max(0, itemCount - 1), current + 1));
            setHomeMenuMessage(undefined);
            return;
        }
        if (key.return) {
            const nextItem = HOME_TABS[homeMenuIndex]?.items[homeMenuItemIndex];
            if (nextItem) {
                runHomeMenuItem(nextItem);
            }
            return;
        }
        if (inputKey === "/") {
            openHomeWorkspace("search");
            setSearch((current) => ({
                ...current,
                message: "输入关键词，或粘贴哔哩哔哩链接后按回车。",
            }));
            setHomeMenuMessage(undefined);
            return;
        }
        if (isPlainTextInput(inputKey, key)) {
            openHomeWorkspace("search");
            setSearch((current) => ({
                ...current,
                query: current.query + inputKey.replace(/[\r\n]+/g, ""),
                message: undefined,
            }));
            setHomeMenuMessage(undefined);
        }
    }
    function runHomeMenuItem(item) {
        const action = item.action;
        if (action.type === "planned") {
            setHomeMenuMessage(action.message);
            return;
        }
        setHomeMenuMessage(undefined);
        openHomeWorkspace(action.tab);
        if (action.tab === "search") {
            setSearch((current) => ({
                ...current,
                query: action.query ?? "",
                lastRunQuery: undefined,
                results: [],
                selectedIndex: 0,
                message: action.message,
            }));
        }
    }
    function openHomeWorkspace(tab) {
        setHomeTab(tab);
        const nextIndex = HOME_TABS.findIndex((item) => item.id === tab);
        if (nextIndex >= 0) {
            setHomeMenuIndex(nextIndex);
        }
        setHomeMenuMessage(undefined);
        setHomeView("workspace");
    }
    function handleRecommendationInput(inputKey, key) {
        if (key.upArrow || inputKey === "k") {
            setRecommendations((current) => ({
                ...current,
                selectedIndex: Math.max(0, current.selectedIndex - 1),
            }));
            return;
        }
        if (key.downArrow || inputKey === "j") {
            setRecommendations((current) => ({
                ...current,
                selectedIndex: Math.min(Math.max(0, current.items.length - 1), current.selectedIndex + 1),
            }));
            return;
        }
        if (inputKey === "r") {
            setRecommendationKey((value) => value + 1);
            return;
        }
        if (key.return) {
            const item = recommendations.items[recommendations.selectedIndex];
            if (item) {
                openTargetFromInput(item.targetInput);
            }
        }
    }
    function handleSearchInput(inputKey, key) {
        if (key.upArrow || inputKey === "k") {
            setSearch((current) => ({
                ...current,
                selectedIndex: Math.max(0, current.selectedIndex - 1),
            }));
            return;
        }
        if (key.downArrow || inputKey === "j") {
            setSearch((current) => ({
                ...current,
                selectedIndex: Math.min(Math.max(0, current.results.length - 1), current.selectedIndex + 1),
            }));
            return;
        }
        if (key.escape) {
            setSearch((current) => ({
                ...current,
                query: "",
                results: [],
                selectedIndex: 0,
                message: undefined,
                lastRunQuery: undefined,
            }));
            setHomeView("menu");
            return;
        }
        if (key.backspace || key.delete) {
            setSearch((current) => ({
                ...current,
                query: current.query.slice(0, -1),
                message: undefined,
            }));
            return;
        }
        if (key.ctrl && inputKey === "u") {
            setSearch((current) => ({
                ...current,
                query: "",
                message: undefined,
            }));
            return;
        }
        if (inputKey === "r") {
            const trimmed = search.query.trim();
            if (trimmed) {
                void runSearch(trimmed);
            }
            return;
        }
        if (key.return) {
            const trimmed = search.query.trim();
            if (!trimmed) {
                setSearch((current) => ({
                    ...current,
                    message: "请输入关键词，或粘贴哔哩哔哩链接后按回车。",
                }));
                return;
            }
            try {
                const target = resolveMediaTarget(trimmed, providerOverride);
                openTarget(target);
                return;
            }
            catch {
                // Treat as search input.
            }
            if (search.lastRunQuery === trimmed && search.results.length > 0) {
                const item = search.results[search.selectedIndex];
                if (item) {
                    openTargetFromInput(item.targetInput);
                }
                return;
            }
            void runSearch(trimmed);
            return;
        }
        if (isPlainTextInput(inputKey, key)) {
            setSearch((current) => ({
                ...current,
                query: current.query + inputKey.replace(/[\r\n]+/g, ""),
                message: undefined,
            }));
        }
    }
    function handleLibraryInput(inputKey, key) {
        if (key.escape) {
            setHomeView("menu");
            return;
        }
        if (library.loading) {
            if (inputKey === "r") {
                setLibraryKey((value) => value + 1);
            }
            return;
        }
        if (key.upArrow || inputKey === "k") {
            setLibrary((current) => ({
                ...current,
                selectedIndex: Math.max(0, current.selectedIndex - 1),
            }));
            return;
        }
        if (key.downArrow || inputKey === "j") {
            setLibrary((current) => ({
                ...current,
                selectedIndex: Math.min(Math.max(0, current.books.length - 1), current.selectedIndex + 1),
            }));
            return;
        }
        if (inputKey === "r") {
            setLibraryKey((value) => value + 1);
            return;
        }
        if (key.return) {
            const book = library.books[library.selectedIndex];
            if (book) {
                void openLocalBookInReader(book);
            }
        }
    }
    function handleAccountInput(inputKey, key) {
        if (inputKey === "[" && !providerOverride) {
            cycleAccountProvider(-1);
            return;
        }
        if (inputKey === "]" && !providerOverride) {
            cycleAccountProvider(1);
            return;
        }
        if (inputKey === "m") {
            setAccountForm((current) => ({
                ...current,
                inputMode: current.inputMode === "cookie" ? "cookieFile" : "cookie",
                message: undefined,
                messageTone: undefined,
            }));
            return;
        }
        if (inputKey === "d") {
            setAccountForm((current) => ({
                ...current,
                makeDefault: !current.makeDefault,
                message: undefined,
                messageTone: undefined,
            }));
            return;
        }
        if (key.upArrow) {
            setAccountForm((current) => ({
                ...current,
                activeField: previousAccountField(current.activeField),
                message: undefined,
                messageTone: undefined,
            }));
            return;
        }
        if (key.downArrow) {
            setAccountForm((current) => ({
                ...current,
                activeField: nextAccountField(current.activeField),
                message: undefined,
                messageTone: undefined,
            }));
            return;
        }
        if (key.tab) {
            setAccountForm((current) => ({
                ...current,
                activeField: nextAccountField(current.activeField),
                message: undefined,
                messageTone: undefined,
            }));
            return;
        }
        if (key.escape) {
            setHomeView("menu");
            return;
        }
        if (key.backspace || key.delete) {
            setAccountForm((current) => updateAccountField(current, current.activeField, getAccountFieldValue(current, current.activeField).slice(0, -1)));
            return;
        }
        if (key.ctrl && inputKey === "u") {
            setAccountForm((current) => updateAccountField(current, current.activeField, ""));
            return;
        }
        if (key.return) {
            void runAccountBind();
            return;
        }
        if (isPlainTextInput(inputKey, key)) {
            setAccountForm((current) => updateAccountField(current, current.activeField, getAccountFieldValue(current, current.activeField) + inputKey.replace(/[\r\n]+/g, "")));
        }
    }
    function handleReaderInput(inputKey, key) {
        if (state.status !== "reader") {
            return;
        }
        const pageSize = getReaderPageSize(terminalSize.rows);
        const maxTopLine = Math.max(0, state.wrappedLines.length - pageSize);
        if (inputKey === "q" || key.escape || inputKey === "b") {
            returnToHome("library");
            return;
        }
        if (key.upArrow || inputKey === "k") {
            setState({
                ...state,
                topLine: clamp(state.topLine - 1, 0, maxTopLine),
            });
            return;
        }
        if (key.downArrow || inputKey === "j") {
            setState({
                ...state,
                topLine: clamp(state.topLine + 1, 0, maxTopLine),
            });
            return;
        }
        if (key.pageUp || inputKey === "u") {
            setState({
                ...state,
                topLine: clamp(state.topLine - pageSize, 0, maxTopLine),
            });
            return;
        }
        if (key.pageDown || inputKey === " " || inputKey === "f") {
            setState({
                ...state,
                topLine: clamp(state.topLine + pageSize, 0, maxTopLine),
            });
            return;
        }
        if (key.home || inputKey === "g") {
            setState({
                ...state,
                topLine: 0,
            });
            return;
        }
        if (key.end || inputKey === "G") {
            setState({
                ...state,
                topLine: maxTopLine,
            });
        }
    }
    function cycleAccountProvider(direction) {
        if (accountProviderOptions.length <= 1) {
            return;
        }
        const currentIndex = Math.max(0, accountProviderOptions.findIndex((provider) => provider.id === homeAccountProviderId));
        const nextIndex = (currentIndex + direction + accountProviderOptions.length) % accountProviderOptions.length;
        const nextProvider = accountProviderOptions[nextIndex];
        if (!nextProvider) {
            return;
        }
        setSelectedAccountProviderId(nextProvider.id);
        setAccountForm((current) => ({
            ...current,
            value: "",
            note: "",
            message: undefined,
            messageTone: undefined,
        }));
    }
    async function runSearch(query) {
        setSearch((current) => ({
            ...current,
            loading: true,
            message: `正在搜索 ${homeMediaProvider?.label ?? homeMediaProviderId}...`,
        }));
        try {
            const requestAccount = await resolveRequestAccount(homeMediaProviderId, selectedAccountName);
            const results = await searchMedia(query, homeMediaProviderId, requestAccount);
            setSearch({
                query,
                loading: false,
                lastRunQuery: query,
                results,
                selectedIndex: 0,
                message: results.length === 0 ? "没有找到匹配的视频。" : `找到 ${results.length} 个结果，按回车打开当前选中项。`,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setSearch((current) => ({
                ...current,
                loading: false,
                message,
            }));
        }
    }
    async function runAccountBind() {
        const providerId = homeAccountProviderId;
        const accountName = accountForm.name.trim();
        const accountValue = accountForm.value.trim();
        if (!accountName) {
            setAccountForm((current) => ({
                ...current,
                message: "请先输入账号名称。",
                messageTone: "warning",
            }));
            return;
        }
        if (!accountValue) {
            setAccountForm((current) => ({
                ...current,
                message: current.inputMode === "cookie" ? "请先粘贴 Cookie。" : "请先输入 Cookie 文件路径。",
                messageTone: "warning",
            }));
            return;
        }
        setAccountForm((current) => ({
            ...current,
            busy: true,
            message: current.inputMode === "cookie" ? "正在根据粘贴的 Cookie 绑定账号..." : "正在根据 Cookie 文件绑定账号...",
            messageTone: "info",
        }));
        try {
            const cookieValue = accountForm.inputMode === "cookie"
                ? parseCookieInput(accountValue)
                : parseCookieInput(await readFile(accountValue, "utf8"));
            const headers = { Cookie: cookieValue };
            validateProviderAccountHeaders(providerId, headers);
            const result = await bindAccount({
                provider: providerId,
                name: accountName,
                note: accountForm.note.trim() || undefined,
                headers,
                makeDefault: accountForm.makeDefault,
            });
            setAccountForm((current) => ({
                ...current,
                busy: false,
                value: "",
                note: "",
                activeField: "name",
                message: `已绑定 ${result.account.provider}:${result.account.name}。`,
                messageTone: "success",
            }));
            setHomeDataKey((value) => value + 1);
            setRecommendationKey((value) => value + 1);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setAccountForm((current) => ({
                ...current,
                busy: false,
                message,
                messageTone: "error",
            }));
        }
    }
    async function openLocalBookInReader(book) {
        setLibrary((current) => ({
            ...current,
            loading: true,
            message: `正在打开《${book.title}》...`,
        }));
        try {
            const document = await loadLocalBook(book);
            const contentWidth = getReaderContentWidth(terminalSize.columns);
            const wrappedLines = wrapReaderText(document.text, contentWidth);
            setState({
                status: "reader",
                document,
                wrappedLines,
                contentWidth,
                topLine: 0,
                message: `${book.formatLabel} 读取完成。按 Esc 返回书库。`,
            });
            setLibrary((current) => ({
                ...current,
                loading: false,
                message: `正在阅读《${book.title}》。`,
            }));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLibrary((current) => ({
                ...current,
                loading: false,
                message,
            }));
        }
    }
    function openTargetFromInput(input) {
        const target = resolveMediaTarget(input, providerOverride);
        openTarget(target);
    }
    function openTarget(target) {
        setActiveTarget(target);
        setState({ status: "loading" });
    }
    function returnToHome(tab) {
        setActiveTarget(undefined);
        setHomeTab(tab);
        setHomeView("workspace");
        setState({ status: "home" });
        if (tab === "discover") {
            setRecommendationKey((value) => value + 1);
        }
    }
    if (state.status === "home") {
        return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsx(HomeScreen, { view: homeView, tab: homeTab, menuIndex: homeMenuIndex, menuItemIndex: homeMenuItemIndex, menuMessage: homeMenuMessage, providerLabel: homeMediaProvider?.label ?? homeMediaProviderId, inspectOnly: launchInspectOnly, providers: providerSummaries, recommendations: recommendations, search: search, library: library, accountForm: accountForm, accountProviderId: homeAccountProviderId, accountProviderLabel: homeAccountProvider?.label ?? homeAccountProviderId, isInteractive: isRawModeSupported })] }));
    }
    if (state.status === "loading") {
        return _jsx(LoadingScreen, { target: activeTarget });
    }
    if (state.status === "error") {
        return _jsx(ErrorScreen, { error: state.error });
    }
    if (state.status === "playing") {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: state.message }), _jsx(Text, { dimColor: true, children: "\u64AD\u653E\u5668\u73B0\u5728\u76F4\u63A5\u63A5\u7BA1\u952E\u76D8\u3002\u7528 mpv \u81EA\u5DF1\u7684\u6309\u952E\u6682\u505C\u3001\u7EE7\u7EED\u548C\u9000\u51FA\uFF1B\u9000\u51FA\u540E\u4F1A\u56DE\u5230 BBCLI\u3002" })] }));
    }
    if (state.status === "reader") {
        return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsx(ReaderScreen, { state: state, columns: terminalSize.columns, rows: terminalSize.rows })] }));
    }
    return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsx(Dashboard, { session: state.session, support: state.support, selectedIndex: state.selectedIndex, inspectOnly: launchInspectOnly, allowExternalPlayer: allowExternalPlayer, target: activeTarget, account: state.account, message: state.message, lastPlan: state.lastPlan })] }));
}
function InputController({ onInput }) {
    useInput(onInput);
    return null;
}
function HomeScreen({ view, tab, menuIndex, menuItemIndex, menuMessage, providerLabel, inspectOnly, providers, recommendations, search, library, accountForm, accountProviderId, accountProviderLabel, isInteractive, }) {
    const activeLaneLabel = view === "menu"
        ? "首页菜单"
        : tab === "accounts"
            ? accountProviderLabel
            : tab === "library"
                ? "个人书架"
                : providerLabel;
    const activeMenu = HOME_TABS[menuIndex];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(BrandHeader, { activeTab: view === "menu" ? undefined : tab, providerLabel: activeLaneLabel, inspectOnly: view === "workspace" ? inspectOnly : false }), _jsx(Newline, {}), view === "menu" ? _jsx(MenuScreen, { selectedIndex: menuIndex, selectedItemIndex: menuItemIndex, message: menuMessage }) : null, view === "workspace" ? _jsx(WorkspaceHeader, { tab: tab, providerLabel: activeLaneLabel }) : null, view === "workspace" ? _jsx(Newline, {}) : null, view === "workspace" && tab === "discover" ? _jsx(RecommendationPanel, { state: recommendations }) : null, view === "workspace" && tab === "search" ? _jsx(SearchPanel, { state: search }) : null, view === "workspace" && tab === "library" ? _jsx(LibraryPanel, { state: library, providers: providers }) : null, view === "workspace" && tab === "accounts" ? _jsx(AccountPanel, { state: accountForm, providerLabel: accountProviderLabel, accountProviderId: accountProviderId, providers: providers }) : null, _jsx(Newline, {}), !isInteractive ? _jsx(Text, { dimColor: true, children: "\u5F53\u524D\u7EC8\u7AEF\u4E0D\u652F\u6301\u4EA4\u4E92\u8F93\u5165\uFF0C\u8BF7\u5728\u6B63\u5E38\u7EC8\u7AEF\u91CC\u8FD0\u884C BBCLI\u3002" }) : null, isInteractive && view === "menu" ? _jsx(Text, { dimColor: true, children: `${activeMenu?.label ?? "菜单"}  ·  ← → 切分类  ·  ↑↓ 选入口  ·  Enter 进入  ·  直接输入可搜索` }) : null, isInteractive && view === "workspace" && tab === "discover" ? _jsx(Text, { dimColor: true, children: "\u2191\u2193 \u9009\u89C6\u9891  \u00B7  Enter \u6253\u5F00  \u00B7  r \u5237\u65B0  \u00B7  b \u8FD4\u56DE" }) : null, isInteractive && view === "workspace" && tab === "search" ? _jsx(Text, { dimColor: true, children: "\u8F93\u5165\u540E\u56DE\u8F66  \u00B7  \u2191\u2193 \u9009\u7ED3\u679C  \u00B7  Esc \u8FD4\u56DE" }) : null, isInteractive && view === "workspace" && tab === "library" ? _jsx(Text, { dimColor: true, children: "\u2191\u2193 \u9009\u4E66  \u00B7  Enter \u9605\u8BFB  \u00B7  r \u5237\u65B0  \u00B7  Esc \u8FD4\u56DE" }) : null, isInteractive && view === "workspace" && tab === "accounts" ? _jsx(Text, { dimColor: true, children: '[ ] 平台  ·  ↑↓ / Tab 字段  ·  m 模式  ·  d 默认  ·  Enter 保存  ·  Esc 返回' }) : null] }));
}
function MenuScreen({ selectedIndex, selectedItemIndex, message, }) {
    const activeItem = HOME_TABS[selectedIndex];
    const activeMenuItem = activeItem.items[selectedItemIndex];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { children: HOME_TABS.map((item, index) => {
                    const selected = index === selectedIndex;
                    return (_jsxs(React.Fragment, { children: [_jsx(Text, { backgroundColor: selected ? "cyan" : undefined, color: selected ? "black" : "gray", bold: selected, children: selected ? ` ${item.label} ` : item.label }), index < HOME_TABS.length - 1 ? _jsx(Text, { children: "  " }) : null] }, item.id));
                }) }), _jsx(Newline, {}), _jsx(Text, { bold: true, children: activeItem.summary }), _jsx(Newline, {}), _jsx(Box, { flexDirection: "column", borderStyle: "round", borderColor: "gray", paddingX: 1, children: activeItem.items.map((item, index) => {
                    const selected = index === selectedItemIndex;
                    return (_jsxs(Box, { flexDirection: "column", marginBottom: index < activeItem.items.length - 1 ? 1 : 0, children: [_jsxs(Box, { children: [_jsx(Text, { color: selected ? "yellow" : "gray", children: selected ? ">" : " " }), _jsx(Text, { children: " " }), _jsx(Text, { backgroundColor: selected ? "cyan" : undefined, color: selected ? "black" : undefined, bold: selected, children: ` ${item.label} ` }), _jsx(Text, { children: " " }), _jsx(InlinePill, { label: item.status === "live" ? "可用" : "规划中", tone: item.status === "live" ? "green" : "gray" })] }), _jsx(Text, { dimColor: true, children: `  ${item.note}` })] }, item.id));
                }) }), message ? (_jsxs(_Fragment, { children: [_jsx(Newline, {}), _jsx(Text, { color: "yellow", children: message })] })) : activeMenuItem ? (_jsxs(_Fragment, { children: [_jsx(Newline, {}), _jsx(Text, { dimColor: true, children: `当前入口：${activeMenuItem.label}` })] })) : null] }));
}
function WorkspaceHeader({ tab, providerLabel }) {
    return (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "\u2190 \u83DC\u5355" }), _jsx(Text, { dimColor: true, children: "  /  " }), _jsx(Text, { bold: true, children: formatHomeTab(tab) }), _jsx(Text, { dimColor: true, children: `  /  ${providerLabel}` })] }));
}
function BrandHeader({ activeTab, providerLabel, inspectOnly, }) {
    const mascotLines = [
        "  (\\_/)",
        "  (='.'=)",
        '  (")_(")',
    ];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Box, { flexDirection: "column", marginRight: 2, children: mascotLines.map((line) => (_jsx(Text, { color: "yellow", children: line }, line))) }), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "cyan", bold: true, children: "BBCLI" }), _jsx(Text, { bold: true, children: "\u7EC8\u7AEF\u91CC\u7684\u5185\u5BB9\u5154\u5154\u5DE5\u5177\u7BB1" }), _jsx(Text, { dimColor: true, children: activeTab ? `页面：${formatHomeTab(activeTab)}  ·  通道：${providerLabel}  ·  模式：${inspectOnly ? "检查" : "播放"}` : "选择一个入口开始。" })] })] }), _jsx(Text, { dimColor: true, children: "-".repeat(78) })] }));
}
function ReaderScreen({ state, columns, rows, }) {
    const pageSize = getReaderPageSize(rows);
    const maxTopLine = Math.max(0, state.wrappedLines.length - pageSize);
    const startLine = clamp(state.topLine, 0, maxTopLine);
    const visibleLines = state.wrappedLines.slice(startLine, startLine + pageSize);
    const contentPadding = " ".repeat(Math.max(2, Math.floor((columns - state.contentWidth) / 2)));
    const progress = state.wrappedLines.length > 0
        ? Math.round(((startLine + visibleLines.length) / state.wrappedLines.length) * 100)
        : 0;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "cyan", children: "\u4E66\u5E93 / \u9605\u8BFB\u5668" }), _jsx(Text, { bold: true, children: state.document.book.title }), _jsx(Text, { dimColor: true, children: `${state.document.book.formatLabel}  ·  ${basename(state.document.book.path)}  ·  进度 ${progress}%` }), _jsx(Text, { dimColor: true, children: truncatePath(state.document.book.path, Math.max(40, columns - 8)) }), _jsx(Text, { dimColor: true, children: "-".repeat(Math.max(32, Math.min(columns - 2, state.contentWidth + 4))) }), visibleLines.map((line, index) => (_jsx(Text, { children: `${contentPadding}${line}` }, `${startLine}-${index}`))), _jsx(Text, { dimColor: true, children: "-".repeat(Math.max(32, Math.min(columns - 2, state.contentWidth + 4))) }), _jsx(Text, { dimColor: true, children: "\u2191\u2193 \u5FAE\u8C03  \u00B7  \u7A7A\u683C / PgDn \u4E0B\u9875  \u00B7  u / PgUp \u4E0A\u9875  \u00B7  g / G \u9996\u5C3E  \u00B7  Esc \u8FD4\u56DE\u4E66\u5E93" }), state.message ? _jsx(Text, { color: "yellow", children: state.message }) : null] }));
}
function RecommendationPanel({ state }) {
    return (_jsxs(Box, { flexDirection: "column", children: [!state.loading && state.items.length > 0 ? _jsx(Text, { dimColor: true, children: `共 ${state.items.length} 条推荐` }) : null, !state.loading && state.items.length > 0 ? _jsx(Newline, {}) : null, state.loading ? _jsx(Text, { dimColor: true, children: "\u6B63\u5728\u52A0\u8F7D\u9996\u9875\u63A8\u8350..." }) : null, !state.loading && state.items.length === 0 ? _jsx(Text, { dimColor: true, children: state.message ?? "当前还没有推荐内容。" }) : null, state.items.slice(0, 8).map((item, index) => {
                return _jsx(MediaListItem, { item: item, selected: index === state.selectedIndex }, `${item.pageUrl}-${index}`);
            }), state.message && state.items.length > 0 ? _jsx(Text, { color: "yellow", children: state.message }) : null] }));
}
function SearchPanel({ state }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: `> ${state.query || "输入关键词或粘贴视频链接"}` }), !state.loading && state.results.length > 0 ? _jsx(Text, { dimColor: true, children: `结果 ${state.results.length} 条` }) : null, !state.loading && state.results.length > 0 ? _jsx(Newline, {}) : null, state.loading ? _jsx(Text, { dimColor: true, children: "\u6B63\u5728\u641C\u7D22..." }) : null, state.message ? _jsx(Text, { color: "yellow", children: state.message }) : null, state.results.map((item, index) => {
                return _jsx(MediaListItem, { item: item, selected: index === state.selectedIndex }, `${item.pageUrl}-${index}`);
            })] }));
}
function LibraryPanel({ state, providers, }) {
    const connected = providers.filter((provider) => provider.boundAccounts > 0);
    const rootLabels = state.roots.map((root) => root.split(" · ")[0] ?? root);
    const currentDirectory = state.roots
        .find((root) => root.startsWith("当前目录 · "))
        ?.replace("当前目录 · ", "");
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(CompactConnectorRow, { items: LIBRARY_CONNECTORS, activeId: "local-books" }), _jsx(Text, { dimColor: true, children: state.roots.length > 0 ? `扫描位置：${rootLabels.join(" / ")}` : "正在准备本地书架..." }), currentDirectory ? _jsx(Text, { dimColor: true, children: `当前目录：${truncatePath(currentDirectory, 72)}` }) : null, _jsx(Newline, {}), state.loading ? _jsx(Text, { dimColor: true, children: "\u6B63\u5728\u6574\u7406\u4F60\u7684\u672C\u5730\u4E66\u67B6..." }) : null, !state.loading && state.books.length === 0 ? _jsx(Text, { dimColor: true, children: state.message ?? "暂时没有找到可阅读的本地书。" }) : null, !state.loading && state.books.length > 0 ? (_jsxs(_Fragment, { children: [state.books.slice(0, 10).map((book, index) => (_jsx(BookListItem, { book: book, selected: index === state.selectedIndex }, book.id))), _jsx(Text, { dimColor: true, children: `当前已展示 ${Math.min(10, state.books.length)} / ${state.books.length} 本。` })] })) : null, state.message && state.books.length > 0 ? (_jsxs(_Fragment, { children: [_jsx(Newline, {}), _jsx(Text, { color: "yellow", children: state.message })] })) : null, _jsx(Newline, {}), _jsx(Text, { dimColor: true, children: "\u5DF2\u8FDE\u63A5\u8D26\u53F7" }), connected.length > 0 ? connected.map((provider) => (_jsx(Text, { children: `${provider.label}  |  账号 ${provider.boundAccounts}${provider.defaultAccount ? `  |  默认 ${provider.defaultAccount}` : ""}` }, provider.id))) : _jsx(Text, { dimColor: true, children: "\u4E66\u5E93\u9605\u8BFB\u4E0D\u4F9D\u8D56\u8D26\u53F7\uFF1B\u5982\u679C\u540E\u7EED\u9700\u8981\u540C\u6B65\u4E66\u67B6\uFF0C\u518D\u53BB\u201C\u8D26\u53F7\u201D\u91CC\u7ED1\u5B9A\u5E73\u53F0\u3002" })] }));
}
function AccountPanel({ state, providerLabel, accountProviderId, providers, }) {
    const liveConnectors = providers
        .filter((provider) => provider.supportsAccounts)
        .map((provider) => ({
        id: provider.id,
        label: provider.label,
        status: "live",
        note: provider.boundAccounts > 0
            ? `已绑定 ${provider.boundAccounts} 个账号${provider.defaultAccount ? `，默认账号为 ${provider.defaultAccount}` : ""}。`
            : "已可开始绑定。",
    }));
    const plannedConnectors = ACCOUNT_CONNECTORS.filter((connector) => !liveConnectors.some((provider) => provider.id === connector.id));
    const accountConnectors = [...liveConnectors, ...plannedConnectors];
    const activeConnector = accountConnectors.find((connector) => connector.id === accountProviderId);
    const hasAccounts = state.existingAccounts.length > 0;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(CompactConnectorRow, { items: accountConnectors, activeId: accountProviderId }), activeConnector?.note ? _jsx(Text, { dimColor: true, children: activeConnector.note }) : null, _jsx(Newline, {}), _jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: "green", paddingX: 1, children: [_jsx(Text, { color: "green", children: `绑定账号  ·  ${providerLabel}` }), _jsx(Text, { dimColor: true, children: "\u628A\u767B\u5F55\u6001\u4FDD\u5B58\u5728\u8FD9\u91CC\uFF0C\u540E\u7EED\u89C6\u9891\u3001\u9605\u8BFB\u548C\u641C\u7D22\u80FD\u529B\u90FD\u80FD\u76F4\u63A5\u590D\u7528\u3002" })] }), _jsx(Newline, {}), _jsx(FieldGroup, { title: "\u5DF2\u7ED1\u5B9A", children: hasAccounts ? (_jsx(Box, { children: state.existingAccounts.map((accountName, index) => (_jsxs(React.Fragment, { children: [_jsx(InlinePill, { label: state.defaultAccount === accountName ? `${accountName} · 默认` : accountName, tone: state.defaultAccount === accountName ? "green" : "cyan" }), index < state.existingAccounts.length - 1 ? _jsx(Text, { children: " " }) : null] }, accountName))) })) : (_jsx(Text, { dimColor: true, children: "\u5F53\u524D\u8FD8\u6CA1\u6709\u5DF2\u7ED1\u5B9A\u8D26\u53F7\u3002" })) }), _jsx(Newline, {}), _jsx(FieldGroup, { title: "\u5F00\u5173", children: _jsxs(Box, { children: [_jsx(InlinePill, { label: "\u7C98\u8D34 Cookie", tone: state.inputMode === "cookie" ? "cyan" : "gray" }), _jsx(Text, { children: " " }), _jsx(InlinePill, { label: "Cookie \u6587\u4EF6", tone: state.inputMode === "cookieFile" ? "cyan" : "gray" }), _jsx(Text, { children: " " }), _jsx(InlinePill, { label: state.makeDefault ? "设为默认" : "不设默认", tone: state.makeDefault ? "green" : "gray" })] }) }), _jsx(Newline, {}), _jsxs(FieldGroup, { title: "\u7ED1\u5B9A\u8868\u5355", children: [_jsx(FormField, { label: "\u8D26\u53F7\u540D", value: state.name, placeholder: "main", hint: "\u7ED9\u8FD9\u4E2A\u8EAB\u4EFD\u8D77\u4E00\u4E2A\u597D\u8BB0\u7684\u540D\u5B57\u3002", selected: state.activeField === "name" }), _jsx(FormField, { label: state.inputMode === "cookie" ? "Cookie" : "Cookie 文件", value: state.value, placeholder: state.inputMode === "cookie" ? "在这里粘贴 Cookie" : "./bilibili.cookies", hint: state.inputMode === "cookie" ? "直接粘贴浏览器里的 Cookie 字符串。" : "填本地 Cookie 文件路径，支持 Netscape 格式。", selected: state.activeField === "value", displayValue: formatAccountValue(state.inputMode, state.value) }), _jsx(FormField, { label: "\u5907\u6CE8", value: state.note, placeholder: "\u53EF\u9009", hint: "\u6BD4\u5982\u5DE5\u4F5C\u53F7\u3001\u4E3B\u8D26\u53F7\u3001\u6D4B\u8BD5\u53F7\u3002", selected: state.activeField === "note" })] }), state.message ? _jsx(Text, { color: formatAccountMessageColor(state.messageTone), children: state.message }) : null] }));
}
function MediaListItem({ item, selected, }) {
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { backgroundColor: selected ? "cyan" : undefined, color: selected ? "black" : undefined, bold: selected, children: `${selected ? " 当前 " : "  "}${item.title}` }), _jsx(Text, { dimColor: true, children: `${selected ? "  " : "    "}${item.ownerName}  ·  ${formatDuration(item.durationSeconds ?? 0)}  ·  ${formatCount(item.viewCount)}` })] }));
}
function BookListItem({ book, selected, }) {
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { backgroundColor: selected ? "cyan" : undefined, color: selected ? "black" : undefined, bold: selected, children: `${selected ? " 当前 " : "  "}${book.title}` }), _jsx(Text, { dimColor: true, children: `${selected ? "  " : "    "}${book.formatLabel}  ·  ${book.sourceLabel}  ·  ${formatFileSize(book.sizeBytes)}  ·  ${formatDate(book.modifiedAt)}` }), _jsx(Text, { dimColor: true, children: `${selected ? "  " : "    "}${truncatePath(book.path, 72)}` })] }));
}
function FieldGroup({ title, children }) {
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: "gray", paddingX: 1, children: [_jsx(Text, { dimColor: true, children: title }), _jsx(Newline, {}), children] }));
}
function FormField({ label, value, displayValue, placeholder, hint, selected, }) {
    const shownValue = displayValue ?? value;
    const empty = value.length === 0;
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: selected ? "cyan" : "gray", paddingX: 1, marginBottom: 1, children: [_jsx(Text, { color: selected ? "cyan" : "gray", children: `${selected ? "当前字段" : "字段"} · ${label}` }), _jsx(Text, { color: empty ? "gray" : selected ? "yellow" : undefined, bold: selected && !empty, children: shownValue || placeholder }), _jsx(Text, { dimColor: true, children: hint })] }));
}
function InlinePill({ label, tone, }) {
    return (_jsx(Text, { backgroundColor: tone === "gray" ? undefined : tone, color: tone === "gray" ? "gray" : "black", dimColor: tone === "gray", children: ` ${label} ` }));
}
function CompactConnectorRow({ items, activeId, }) {
    return (_jsx(Box, { children: items.map((item, index) => {
            const active = item.id === activeId;
            const label = active ? ` ${item.label} ` : item.status === "planned" ? `${item.label}·规划中` : item.label;
            return (_jsxs(React.Fragment, { children: [_jsx(Text, { backgroundColor: active ? "cyan" : undefined, color: active ? "black" : item.status === "planned" ? "gray" : undefined, bold: active, children: label }), index < items.length - 1 ? _jsx(Text, { children: "  " }) : null] }, item.id));
        }) }));
}
function formatHomeTab(tab) {
    if (tab === "discover") {
        return "发现";
    }
    if (tab === "search") {
        return "搜索";
    }
    if (tab === "library") {
        return "书库";
    }
    return "账号";
}
function LoadingScreen({ target }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "yellow", children: `正在加载 ${target.providerLabel} 页面数据...` }), _jsx(Text, { dimColor: true, children: target.originalInput }), _jsx(Text, { dimColor: true, children: "\u6B63\u5728\u6293\u53D6 `window.__playinfo__` \u548C `window.__INITIAL_STATE__`\u3002" })] }));
}
function ErrorScreen({ error }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "red", children: "\u52A0\u8F7D\u89C6\u9891\u5931\u8D25" }), _jsx(Text, { children: error }), _jsx(Text, { dimColor: true, children: "\u6309 `b` \u8FD4\u56DE\u4E0A\u4E00\u9875\uFF0C\u6216\u6309 `Enter`\u3001`Esc`\u3001`q` \u9000\u51FA\u3002" })] }));
}
function Dashboard({ session, support, selectedIndex, inspectOnly, allowExternalPlayer, target, account, message, lastPlan, }) {
    const selectedVariant = session.variants[selectedIndex];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "cyan", children: "BBCLI" }), _jsx(Text, { bold: true, children: session.title }), _jsxs(Text, { dimColor: true, children: [session.ownerName, "  |  ", formatDuration(session.durationSeconds), "  |  ", session.bvid] }), target ? _jsx(Text, { dimColor: true, children: `平台：${target.providerLabel}` }) : null, account ? _jsx(Text, { dimColor: true, children: `账号：${account.provider}:${account.name}` }) : null, _jsx(Newline, {}), _jsx(Text, { color: "green", children: "\u64AD\u653E" }), _jsxs(Text, { children: ["\u64AD\u653E\u5668\uFF1A", support.mpvInstalled
                        ? "mpv 终端模式"
                        : support.ffplayInstalled && allowExternalPlayer
                            ? "ffplay 外部窗口（手动允许）"
                            : support.ffplayInstalled
                                ? "缺少 mpv，已禁用外部窗口回退"
                                : "缺失"] }), _jsxs(Text, { children: ["\u7EC8\u7AEF\uFF1A", support.detectedTerminal, "  |  \u5F53\u524D VO\uFF1A", support.preferredVo] }), !support.mpvInstalled && support.ffplayInstalled && !allowExternalPlayer ? (_jsx(Text, { color: "yellow", children: "BBCLI \u9ED8\u8BA4\u4E0D\u518D\u81EA\u52A8\u5F39\u51FA ffplay \u7A97\u53E3\u3002\u8BF7\u5B89\u88C5 `mpv`\uFF1B\u53EA\u6709\u4F60\u660E\u786E\u63A5\u53D7\u5916\u90E8\u7A97\u53E3\u65F6\uFF0C\u624D\u5E94\u4F7F\u7528 `--external-player`\u3002" })) : null, support.notes.map((note, index) => (_jsxs(Text, { dimColor: true, children: ["- ", note] }, `${note}-${index}`))), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "\u7801\u6D41" }), session.variants.map((variant, index) => {
                const selected = index === selectedIndex;
                return (_jsxs(Text, { color: selected ? "yellow" : undefined, children: [selected ? ">" : " ", " ", variant.label, "  |  ", variant.codecLabel, "  |  ", formatBitrate(variant.videoBandwidth)] }, variant.quality));
            }), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "\u5F53\u524D\u9009\u4E2D\u7F51\u7EDC\u4FE1\u606F" }), _jsxs(Text, { children: ["\u4E3B\u673A\uFF1A", selectedVariant.host] }), _jsxs(Text, { children: ["\u7F16\u7801\uFF1A", selectedVariant.codecLabel] }), _jsxs(Text, { children: ["\u89C6\u9891\u7801\u7387\uFF1A", formatBitrate(selectedVariant.videoBandwidth), "  |  \u97F3\u9891\u7801\u7387\uFF1A", formatBitrate(selectedVariant.audioBandwidth)] }), _jsxs(Text, { children: ["\u7B7E\u540D URL \u8FC7\u671F\u65F6\u95F4\uFF1A", selectedVariant.expiresAt ?? "未知"] }), _jsxs(Text, { dimColor: true, children: ["Referer\uFF1A", session.pageUrl] }), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "\u7EDF\u8BA1" }), _jsxs(Text, { children: ["\u64AD\u653E ", formatCount(session.stats.views), "  \u70B9\u8D5E ", formatCount(session.stats.likes), "  \u5F39\u5E55 ", formatCount(session.stats.danmaku)] }), _jsxs(Text, { children: ["\u6295\u5E01 ", formatCount(session.stats.coins), "  \u6536\u85CF ", formatCount(session.stats.favorites), "  \u5206\u4EAB ", formatCount(session.stats.shares)] }), session.parts.length > 1 ? (_jsxs(_Fragment, { children: [_jsx(Newline, {}), _jsx(Text, { color: "green", children: "\u5206 P" }), session.parts.slice(0, 5).map((part) => (_jsxs(Text, { children: ["P", part.page, "  ", part.part] }, part.cid)))] })) : null, _jsx(Newline, {}), _jsx(Text, { color: "green", children: "\u64CD\u4F5C\u63D0\u793A" }), _jsx(Text, { children: inspectOnly ? "用 `j/k` 或上下方向键切换清晰度，`r` 重新加载，`b` 返回首页，`q` 退出。" : "用 `j/k` 或上下方向键切换清晰度，回车或 `p` 播放，`r` 重新加载，`b` 返回首页，`q` 退出。" }), message ? _jsx(Text, { color: "yellow", children: message }) : null, lastPlan ? (_jsxs(Text, { dimColor: true, children: ["\u4E0A\u6B21\u547D\u4EE4\uFF1A", lastPlan.command, " ", lastPlan.args.join(" ")] })) : null] }));
}
async function resolveRequestAccount(providerId, selectedAccountName) {
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
function isPlainTextInput(inputKey, key) {
    return !key.ctrl && !key.meta && !key.return && !key.tab && !key.escape && inputKey.length > 0;
}
function nextAccountField(field) {
    if (field === "name") {
        return "value";
    }
    if (field === "value") {
        return "note";
    }
    return "name";
}
function previousAccountField(field) {
    if (field === "name") {
        return "note";
    }
    if (field === "value") {
        return "name";
    }
    return "value";
}
function getAccountFieldValue(state, field) {
    if (field === "name") {
        return state.name;
    }
    if (field === "value") {
        return state.value;
    }
    return state.note;
}
function updateAccountField(state, field, value) {
    if (field === "name") {
        return {
            ...state,
            name: value,
            message: undefined,
            messageTone: undefined,
        };
    }
    if (field === "value") {
        return {
            ...state,
            value: value,
            message: undefined,
            messageTone: undefined,
        };
    }
    return {
        ...state,
        note: value,
        message: undefined,
        messageTone: undefined,
    };
}
function formatAccountValue(mode, value) {
    if (!value) {
        return mode === "cookie" ? "" : "";
    }
    if (mode === "cookieFile") {
        return value;
    }
    if (value.length <= 12) {
        return "*".repeat(value.length);
    }
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
function formatAccountMessageColor(tone) {
    if (tone === "success") {
        return "green";
    }
    if (tone === "error") {
        return "red";
    }
    if (tone === "warning") {
        return "yellow";
    }
    return "cyan";
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
        return "无";
    }
    return `${(value / 1000).toFixed(0)} kbps`;
}
function formatCount(value) {
    if (value === undefined) {
        return "无";
    }
    return new Intl.NumberFormat("zh-CN").format(value);
}
function nextVo(value) {
    if (value === "auto") {
        return "kitty";
    }
    if (value === "kitty") {
        return "sixel";
    }
    if (value === "sixel") {
        return "tct";
    }
    return "auto";
}
function formatFileSize(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDate(value) {
    try {
        return new Intl.DateTimeFormat("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(value));
    }
    catch {
        return value;
    }
}
function truncatePath(filePath, limit) {
    if (filePath.length <= limit) {
        return filePath;
    }
    const fileName = basename(filePath);
    const head = Math.max(10, limit - fileName.length - 4);
    return `${filePath.slice(0, head)}.../${fileName}`;
}
function getReaderContentWidth(columns) {
    return clamp(Math.min(86, columns - 10), 32, 86);
}
function getReaderPageSize(rows) {
    return Math.max(8, rows - 9);
}
function wrapReaderText(text, width) {
    const paragraphs = text.split(/\n{2,}/);
    const lines = [];
    for (const paragraph of paragraphs) {
        const normalized = paragraph.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
        if (!normalized) {
            lines.push("");
            continue;
        }
        lines.push(...wrapParagraph(normalized, width));
        lines.push("");
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines.length > 0 ? lines : ["没有可显示的正文。"];
}
function wrapParagraph(text, width) {
    const segments = segmentReadableText(text);
    const lines = [];
    let currentLine = "";
    let currentWidth = 0;
    for (const segment of segments) {
        const printableSegment = segment === "\t" ? "    " : segment;
        const segmentWidth = measureDisplayWidth(printableSegment);
        if (segmentWidth > width) {
            const pieces = splitSegmentByWidth(printableSegment, width);
            for (const piece of pieces) {
                if (currentLine) {
                    lines.push(currentLine.trimEnd());
                    currentLine = "";
                    currentWidth = 0;
                }
                lines.push(piece.trimEnd());
            }
            continue;
        }
        if (currentWidth + segmentWidth > width && currentLine.trim().length > 0) {
            lines.push(currentLine.trimEnd());
            currentLine = printableSegment.trimStart();
            currentWidth = measureDisplayWidth(currentLine);
            continue;
        }
        currentLine += printableSegment;
        currentWidth += segmentWidth;
    }
    if (currentLine.trim().length > 0) {
        lines.push(currentLine.trimEnd());
    }
    return lines.length > 0 ? lines : [text];
}
function segmentReadableText(text) {
    const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    return [...segmenter.segment(text)].map((entry) => entry.segment);
}
function splitSegmentByWidth(text, width) {
    const pieces = [];
    let current = "";
    let currentWidth = 0;
    for (const character of text) {
        const charWidth = measureDisplayWidth(character);
        if (currentWidth + charWidth > width && current) {
            pieces.push(current);
            current = character;
            currentWidth = charWidth;
            continue;
        }
        current += character;
        currentWidth += charWidth;
    }
    if (current) {
        pieces.push(current);
    }
    return pieces;
}
function measureDisplayWidth(text) {
    let width = 0;
    for (const character of text) {
        width += /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(character) ? 2 : 1;
    }
    return width;
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function pause(durationMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs);
    });
}
