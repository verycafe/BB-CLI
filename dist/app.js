import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { readFile } from "node:fs/promises";
import React, { startTransition, useEffect, useState } from "react";
import { Box, Newline, Text, useApp, useInput, useStdin } from "ink";
import { bindAccount, buildHeadersFromAccount, listAccounts, resolveAccount, } from "./lib/accounts.js";
import { parseCookieInput } from "./lib/cookies.js";
import { listKnownProviders, listRecommendedMedia, loadMediaSession, resolveMediaTarget, searchMedia, validateProviderAccountHeaders, } from "./lib/providers.js";
import { buildLaunchPlan, detectPlayerSupport, launchPlayer, } from "./lib/player.js";
import { ACCOUNT_CONNECTORS, LIBRARY_CONNECTORS, } from "./lib/workspace-catalog.js";
const HOME_TABS = [
    {
        id: "discover",
        label: "发现",
        summary: "推荐视频与内容入口。",
    },
    {
        id: "search",
        label: "搜索",
        summary: "搜索视频、链接与未来多平台内容。",
    },
    {
        id: "library",
        label: "书库",
        summary: "阅读、本地文件与收藏内容。",
    },
    {
        id: "accounts",
        label: "账号",
        summary: "绑定平台账号与身份。",
    },
];
const EMPTY_ACCOUNT_FORM = {
    activeField: "name",
    inputMode: "cookie",
    name: "",
    value: "",
    note: "",
    makeDefault: true,
    busy: false,
    message: undefined,
    existingAccounts: [],
    defaultAccount: undefined,
};
export default function App({ target, inspectOnly, preferredVo, useFastProfile, allowExternalPlayer, selectedAccountName, providerOverride }) {
    const { exit } = useApp();
    const { isRawModeSupported } = useStdin();
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
    const [activeTarget, setActiveTarget] = useState(target);
    const [launchInspectOnly, setLaunchInspectOnly] = useState(inspectOnly);
    const [launchVo, setLaunchVo] = useState(preferredVo);
    const [homeTab, setHomeTab] = useState("discover");
    const [homeView, setHomeView] = useState("menu");
    const [homeMenuIndex, setHomeMenuIndex] = useState(0);
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
    const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT_FORM);
    const [state, setState] = useState(() => (target ? { status: "loading" } : { status: "home" }));
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
    function handleAppInput(inputKey, key) {
        if (state.status === "home") {
            handleHomeInput(inputKey, key);
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
            setState({
                status: "playing",
                session: state.session,
                support: state.support,
                selectedIndex: state.selectedIndex,
                account: state.account,
                message: plan.player === "mpv"
                    ? `正在使用 ${launchVo === "auto" ? state.support.preferredVo : launchVo} 输出模式启动 mpv...`
                    : "正在以单独窗口启动 ffplay...",
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
                        account: state.account,
                        lastPlan: plan,
                        message: `${plan.player} 已退出，退出码为 ${code}。按 b 返回上一页。`,
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    setState({
                        status: "ready",
                        session: state.session,
                        support: state.support,
                        selectedIndex: state.selectedIndex,
                        account: state.account,
                        lastPlan: plan,
                        message: `播放器启动失败：${message}`,
                    });
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
                message: "输入关键词，或粘贴 Bilibili 链接后按回车。",
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
            if (inputKey === "r") {
                setRecommendationKey((value) => value + 1);
            }
            return;
        }
        handleAccountInput(inputKey, key);
    }
    function handleHomeMenuInput(inputKey, key) {
        if (key.upArrow || inputKey === "k") {
            setHomeMenuIndex((current) => Math.max(0, current - 1));
            return;
        }
        if (key.downArrow || inputKey === "j") {
            setHomeMenuIndex((current) => Math.min(HOME_TABS.length - 1, current + 1));
            return;
        }
        if (key.return) {
            const nextTab = HOME_TABS[homeMenuIndex]?.id;
            if (nextTab) {
                openHomeWorkspace(nextTab);
            }
            return;
        }
        if (inputKey === "/") {
            openHomeWorkspace("search");
            setSearch((current) => ({
                ...current,
                message: "输入关键词，或粘贴 Bilibili 链接后按回车。",
            }));
            return;
        }
        if (isPlainTextInput(inputKey, key)) {
            openHomeWorkspace("search");
            setSearch((current) => ({
                ...current,
                query: current.query + inputKey.replace(/[\r\n]+/g, ""),
                message: undefined,
            }));
        }
    }
    function openHomeWorkspace(tab) {
        setHomeTab(tab);
        const nextIndex = HOME_TABS.findIndex((item) => item.id === tab);
        if (nextIndex >= 0) {
            setHomeMenuIndex(nextIndex);
        }
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
                selectedIndex: Math.min(current.items.length - 1, current.selectedIndex + 1),
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
                selectedIndex: Math.min(current.results.length - 1, current.selectedIndex + 1),
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
                    message: "请输入关键词，或粘贴 Bilibili 链接后按回车。",
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
            }));
            return;
        }
        if (inputKey === "d") {
            setAccountForm((current) => ({
                ...current,
                makeDefault: !current.makeDefault,
                message: undefined,
            }));
            return;
        }
        if (key.tab) {
            setAccountForm((current) => ({
                ...current,
                activeField: nextAccountField(current.activeField),
                message: undefined,
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
            }));
            return;
        }
        if (!accountValue) {
            setAccountForm((current) => ({
                ...current,
                message: current.inputMode === "cookie" ? "请先粘贴 Cookie。" : "请先输入 Cookie 文件路径。",
            }));
            return;
        }
        setAccountForm((current) => ({
            ...current,
            busy: true,
            message: current.inputMode === "cookie" ? "正在根据粘贴的 Cookie 绑定账号..." : "正在根据 Cookie 文件绑定账号...",
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
        return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsx(HomeScreen, { view: homeView, tab: homeTab, menuIndex: homeMenuIndex, providerLabel: homeMediaProvider?.label ?? homeMediaProviderId, inspectOnly: launchInspectOnly, providers: providerSummaries, recommendations: recommendations, search: search, accountForm: accountForm, accountProviderId: homeAccountProviderId, accountProviderLabel: homeAccountProvider?.label ?? homeAccountProviderId, isInteractive: isRawModeSupported })] }));
    }
    if (state.status === "loading") {
        return _jsx(LoadingScreen, { target: activeTarget });
    }
    if (state.status === "error") {
        return _jsx(ErrorScreen, { error: state.error });
    }
    if (state.status === "playing") {
        return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: state.message }), _jsx(Text, { dimColor: true, children: "\u64AD\u653E\u5668\u9000\u51FA\u540E\u4F1A\u56DE\u5230\u8FD9\u91CC\u3002" })] })] }));
    }
    return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsx(Dashboard, { session: state.session, support: state.support, selectedIndex: state.selectedIndex, inspectOnly: launchInspectOnly, allowExternalPlayer: allowExternalPlayer, target: activeTarget, account: state.account, message: state.message, lastPlan: state.lastPlan })] }));
}
function InputController({ onInput }) {
    useInput(onInput);
    return null;
}
function HomeScreen({ view, tab, menuIndex, providerLabel, inspectOnly, providers, recommendations, search, accountForm, accountProviderId, accountProviderLabel, isInteractive, }) {
    const activeLaneLabel = view === "menu"
        ? "首页菜单"
        : tab === "accounts"
            ? accountProviderLabel
            : tab === "library"
                ? "个人书架"
                : providerLabel;
    const activeMenu = HOME_TABS[menuIndex];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(BrandHeader, { activeTab: view === "menu" ? undefined : tab, providerLabel: activeLaneLabel, inspectOnly: view === "workspace" ? inspectOnly : false }), _jsx(Newline, {}), view === "menu" ? _jsx(MenuScreen, { selectedIndex: menuIndex }) : null, view === "workspace" && tab === "discover" ? _jsx(RecommendationPanel, { state: recommendations, providerLabel: providerLabel }) : null, view === "workspace" && tab === "search" ? _jsx(SearchPanel, { state: search, providerLabel: providerLabel }) : null, view === "workspace" && tab === "library" ? _jsx(LibraryPanel, { providers: providers }) : null, view === "workspace" && tab === "accounts" ? _jsx(AccountPanel, { state: accountForm, providerLabel: accountProviderLabel, accountProviderId: accountProviderId, providers: providers }) : null, _jsx(Newline, {}), !isInteractive ? _jsx(Text, { dimColor: true, children: "\u5F53\u524D\u7EC8\u7AEF\u4E0D\u652F\u6301\u4EA4\u4E92\u8F93\u5165\uFF0C\u8BF7\u5728\u6B63\u5E38\u7EC8\u7AEF\u91CC\u8FD0\u884C BBCLI\u3002" }) : null, isInteractive && view === "menu" ? _jsx(Text, { dimColor: true, children: `${activeMenu?.label ?? "菜单"}：上下方向键选择，回车进入，直接输入可进入搜索，q 退出。` }) : null, isInteractive && view === "workspace" && tab === "discover" ? _jsx(Text, { dimColor: true, children: "\u4E0A\u4E0B\u65B9\u5411\u952E\u9009\u62E9\u89C6\u9891\uFF0C\u56DE\u8F66\u6253\u5F00\uFF0CEsc \u6216 b \u8FD4\u56DE\u83DC\u5355\u3002" }) : null, isInteractive && view === "workspace" && tab === "search" ? _jsx(Text, { dimColor: true, children: "\u8F93\u5165\u540E\u56DE\u8F66\u641C\u7D22\uFF0C\u6216\u5BF9\u7ED3\u679C\u56DE\u8F66\u6253\u5F00\uFF1BEsc \u6216 b \u8FD4\u56DE\u83DC\u5355\u3002" }) : null, isInteractive && view === "workspace" && tab === "library" ? _jsx(Text, { dimColor: true, children: "Esc \u6216 b \u8FD4\u56DE\u83DC\u5355\u3002" }) : null, isInteractive && view === "workspace" && tab === "accounts" ? _jsx(Text, { dimColor: true, children: '`[` 和 `]` 切换连接器，Tab 切字段，回车绑定，Esc 或 b 返回菜单。' }) : null] }));
}
function MenuScreen({ selectedIndex }) {
    return (_jsx(Box, { flexDirection: "column", children: HOME_TABS.map((item, index) => {
            const selected = index === selectedIndex;
            return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { color: selected ? "yellow" : undefined, children: `${selected ? ">" : " "} ${item.label}` }), _jsx(Text, { dimColor: true, children: item.summary })] }, item.id));
        }) }));
}
function BrandHeader({ activeTab, providerLabel, inspectOnly, }) {
    const mascotLines = [
        "  (\\_/)",
        "  (='.'=)",
        '  (")_(")',
    ];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Box, { flexDirection: "column", marginRight: 2, children: mascotLines.map((line) => (_jsx(Text, { color: "yellow", children: line }, line))) }), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "cyan", bold: true, children: "BBCLI" }), _jsx(Text, { bold: true, children: "\u7EC8\u7AEF\u91CC\u7684\u5185\u5BB9\u5154\u5154\u5DE5\u5177\u7BB1" }), _jsx(Text, { dimColor: true, children: activeTab ? `当前页面：${formatHomeTab(activeTab)}  |  当前通道：${providerLabel}  |  模式：${inspectOnly ? "检查" : "播放"}` : "选择一个入口开始。" })] })] }), _jsx(Text, { dimColor: true, children: "-".repeat(78) })] }));
}
function RecommendationPanel({ state, providerLabel, }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: "\u53D1\u73B0" }), _jsx(Text, { dimColor: true, children: `${providerLabel} 首页推荐` }), _jsx(Newline, {}), state.loading ? _jsx(Text, { dimColor: true, children: "\u6B63\u5728\u52A0\u8F7D\u9996\u9875\u63A8\u8350..." }) : null, !state.loading && state.items.length === 0 ? _jsx(Text, { dimColor: true, children: state.message ?? "当前还没有推荐内容。" }) : null, state.items.slice(0, 8).map((item, index) => {
                const selected = index === state.selectedIndex;
                return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { color: selected ? "yellow" : undefined, children: `${selected ? ">" : " "} ${item.title}` }), _jsx(Text, { dimColor: true, children: `${item.ownerName}  |  ${formatDuration(item.durationSeconds ?? 0)}  |  ${formatCount(item.viewCount)}` })] }, `${item.pageUrl}-${index}`));
            }), state.message && state.items.length > 0 ? _jsx(Text, { color: "yellow", children: state.message }) : null] }));
}
function SearchPanel({ state, providerLabel, }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: "\u641C\u7D22" }), _jsx(Text, { dimColor: true, children: `当前来源：${providerLabel}` }), _jsx(Newline, {}), _jsx(Text, { children: `> ${state.query || "输入关键词，或粘贴视频链接..."}` }), state.loading ? _jsx(Text, { dimColor: true, children: "\u6B63\u5728\u641C\u7D22..." }) : null, state.message ? _jsx(Text, { color: "yellow", children: state.message }) : null, state.results.map((item, index) => {
                const selected = index === state.selectedIndex;
                return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { color: selected ? "yellow" : undefined, children: `${selected ? ">" : " "} ${item.title}` }), _jsx(Text, { dimColor: true, children: `${item.ownerName}  |  ${formatDuration(item.durationSeconds ?? 0)}  |  ${formatCount(item.viewCount)}` })] }, `${item.pageUrl}-${index}`));
            })] }));
}
function LibraryPanel({ providers }) {
    const connected = providers.filter((provider) => provider.boundAccounts > 0);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: "\u4E66\u5E93" }), _jsx(Text, { dimColor: true, children: "\u5185\u5BB9\u6765\u6E90" }), _jsx(Newline, {}), _jsx(CompactConnectorRow, { items: LIBRARY_CONNECTORS }), _jsx(Newline, {}), _jsx(Text, { children: "\u5F53\u524D\u8FDE\u63A5\u72B6\u6001\uFF1A" }), connected.length > 0 ? connected.map((provider) => (_jsx(Text, { children: `${provider.label}  |  账号 ${provider.boundAccounts}${provider.defaultAccount ? `  |  默认 ${provider.defaultAccount}` : ""}` }, provider.id))) : _jsx(Text, { dimColor: true, children: "\u76EE\u524D\u8FD8\u6CA1\u6709\u8FDE\u63A5\u4EFB\u4F55\u4E66\u5E93\u6765\u6E90\uFF0C\u53EF\u4EE5\u5148\u53BB\u201C\u8D26\u53F7\u201D\u5DE5\u4F5C\u533A\u7ED1\u5B9A\u5E73\u53F0\u3002" })] }));
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
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: "\u8D26\u53F7" }), _jsx(Text, { dimColor: true, children: `当前平台：${providerLabel}` }), _jsx(Newline, {}), _jsx(CompactConnectorRow, { items: accountConnectors, activeId: accountProviderId }), _jsx(Newline, {}), _jsx(Text, { children: `绑定 ${providerLabel} 账号` }), _jsx(Text, { dimColor: true, children: state.existingAccounts.length > 0 ? `已有账号：${state.existingAccounts.join(", ")}${state.defaultAccount ? `  |  默认 ${state.defaultAccount}` : ""}` : "当前还没有已绑定账号。" }), _jsx(Newline, {}), _jsx(Text, { color: state.activeField === "name" ? "yellow" : undefined, children: `${state.activeField === "name" ? ">" : " "} 账号名：${state.name || "main"}` }), _jsx(Text, { dimColor: true, children: `  输入模式：${state.inputMode === "cookie" ? "粘贴 Cookie" : "Cookie 文件路径"}  |  设为默认：${state.makeDefault ? "是" : "否"}` }), _jsx(Text, { color: state.activeField === "value" ? "yellow" : undefined, children: `${state.activeField === "value" ? ">" : " "} ${state.inputMode === "cookie" ? "Cookie" : "Cookie 文件"}：${formatAccountValue(state.inputMode, state.value)}` }), _jsx(Text, { color: state.activeField === "note" ? "yellow" : undefined, children: `${state.activeField === "note" ? ">" : " "} 备注：${state.note || "可选"}` }), state.busy ? _jsx(Text, { dimColor: true, children: "\u5904\u7406\u4E2D..." }) : null, state.message ? _jsx(Text, { color: "yellow", children: state.message }) : null] }));
}
function CompactConnectorRow({ items, activeId, }) {
    return (_jsx(Box, { children: items.map((item, index) => {
            const active = item.id === activeId;
            const label = active ? `[${item.label}]` : item.status === "planned" ? `${item.label}·规划中` : item.label;
            return (_jsxs(React.Fragment, { children: [_jsx(Text, { color: active ? "yellow" : item.status === "planned" ? "gray" : undefined, children: label }), index < items.length - 1 ? _jsx(Text, { children: "  " }) : null] }, item.id));
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
        };
    }
    if (field === "value") {
        return {
            ...state,
            value: value,
            message: undefined,
        };
    }
    return {
        ...state,
        note: value,
        message: undefined,
    };
}
function formatAccountValue(mode, value) {
    if (!value) {
        return mode === "cookie" ? "在这里粘贴 Cookie" : "./bilibili.cookies";
    }
    if (mode === "cookieFile") {
        return value;
    }
    if (value.length <= 12) {
        return "*".repeat(value.length);
    }
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
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
