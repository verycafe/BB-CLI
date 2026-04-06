import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { readFile } from "node:fs/promises";
import { startTransition, useEffect, useState } from "react";
import { Box, Newline, Text, useApp, useInput, useStdin } from "ink";
import { bindAccount, buildAccountStorePath, buildHeadersFromAccount, listAccounts, resolveAccount, } from "./lib/accounts.js";
import { parseCookieInput } from "./lib/cookies.js";
import { listKnownProviders, listRecommendedMedia, loadMediaSession, resolveMediaTarget, searchMedia, validateProviderAccountHeaders, } from "./lib/providers.js";
import { buildLaunchPlan, detectPlayerSupport, launchPlayer, } from "./lib/player.js";
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
export default function App({ target, inspectOnly, preferredVo, useFastProfile, selectedAccountName, providerOverride }) {
    const { exit } = useApp();
    const { isRawModeSupported } = useStdin();
    const providerDescriptors = listKnownProviders();
    const defaultMediaProvider = providerDescriptors.find((provider) => provider.supportsMedia);
    const defaultAccountProvider = providerDescriptors.find((provider) => provider.supportsAccounts);
    const homeMediaProviderId = providerOverride ?? defaultMediaProvider?.id ?? "bilibili";
    const homeAccountProviderId = providerOverride ?? defaultAccountProvider?.id ?? homeMediaProviderId;
    const homeMediaProvider = providerDescriptors.find((provider) => provider.id === homeMediaProviderId);
    const homeAccountProvider = providerDescriptors.find((provider) => provider.id === homeAccountProviderId);
    const [reloadKey, setReloadKey] = useState(0);
    const [homeDataKey, setHomeDataKey] = useState(0);
    const [recommendationKey, setRecommendationKey] = useState(0);
    const [activeTarget, setActiveTarget] = useState(target);
    const [launchInspectOnly, setLaunchInspectOnly] = useState(inspectOnly);
    const [launchVo, setLaunchVo] = useState(preferredVo);
    const [homeTab, setHomeTab] = useState("recommend");
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
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const summaries = await Promise.all(providerDescriptors.map(async (provider) => {
                const accounts = await listAccounts(provider.id);
                const defaultAccount = accounts.find((entry) => entry.isDefault);
                return {
                    id: provider.id,
                    label: provider.label,
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
                    message: items.length === 0 ? "No recommendations are available right now." : undefined,
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
                        message: launchInspectOnly ? "Inspect mode enabled. Playback is disabled." : undefined,
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
                returnToHome("recommend");
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
            returnToHome("recommend");
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
                    message: "Inspect mode is active. Re-run without --inspect to launch playback.",
                });
            }
            return;
        }
        if (key.return || inputKey === "p") {
            const variant = state.session.variants[state.selectedIndex];
            const plan = buildLaunchPlan(state.session, variant, state.support, {
                playerVo: launchVo,
                useFastProfile,
            });
            setState({
                status: "playing",
                session: state.session,
                support: state.support,
                selectedIndex: state.selectedIndex,
                account: state.account,
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
                        account: state.account,
                        lastPlan: plan,
                        message: `${plan.player} exited with code ${code}. Press b to return to recommendations.`,
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
                        message: `Player launch failed: ${message}`,
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
        if (inputKey === "1") {
            setHomeTab("recommend");
            return;
        }
        if (inputKey === "2" || inputKey === "/") {
            setHomeTab("search");
            if (inputKey === "/") {
                setSearch((current) => ({
                    ...current,
                    message: "Type keywords, or paste a Bilibili link and press Enter.",
                }));
            }
            return;
        }
        if (inputKey === "3" || inputKey === "a") {
            setHomeTab("account");
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
        if (homeTab !== "search" && isPlainTextInput(inputKey, key)) {
            setHomeTab("search");
            setSearch((current) => ({
                ...current,
                query: current.query + inputKey.replace(/[\r\n]+/g, ""),
                message: undefined,
            }));
            return;
        }
        if (homeTab === "recommend") {
            handleRecommendationInput(inputKey, key);
            return;
        }
        if (homeTab === "search") {
            handleSearchInput(inputKey, key);
            return;
        }
        handleAccountInput(inputKey, key);
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
            setHomeTab("recommend");
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
                    message: "Enter keywords, or paste a Bilibili link and press Enter.",
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
            setHomeTab("recommend");
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
    async function runSearch(query) {
        setSearch((current) => ({
            ...current,
            loading: true,
            message: `Searching ${homeMediaProvider?.label ?? homeMediaProviderId}...`,
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
                message: results.length === 0 ? "No videos matched that query." : `Found ${results.length} videos. Press Enter to open the selected one.`,
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
                message: "Enter an account name first.",
            }));
            return;
        }
        if (!accountValue) {
            setAccountForm((current) => ({
                ...current,
                message: current.inputMode === "cookie" ? "Paste the Cookie header first." : "Enter a cookie file path first.",
            }));
            return;
        }
        setAccountForm((current) => ({
            ...current,
            busy: true,
            message: current.inputMode === "cookie" ? "Binding account from pasted Cookie..." : "Binding account from cookie file...",
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
                message: `Bound ${result.account.provider}:${result.account.name}.`,
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
        setState({ status: "home" });
        if (tab === "recommend") {
            setRecommendationKey((value) => value + 1);
        }
    }
    if (state.status === "home") {
        return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsx(HomeScreen, { tab: homeTab, providerLabel: homeMediaProvider?.label ?? homeMediaProviderId, inspectOnly: launchInspectOnly, preferredVo: launchVo, providers: providerSummaries, recommendations: recommendations, search: search, accountForm: accountForm, accountProviderLabel: homeAccountProvider?.label ?? homeAccountProviderId, isInteractive: isRawModeSupported })] }));
    }
    if (state.status === "loading") {
        return _jsx(LoadingScreen, { target: activeTarget });
    }
    if (state.status === "error") {
        return _jsx(ErrorScreen, { error: state.error });
    }
    if (state.status === "playing") {
        return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: state.message }), _jsx(Text, { dimColor: true, children: "Return here after the player exits." })] })] }));
    }
    return (_jsxs(_Fragment, { children: [isRawModeSupported ? _jsx(InputController, { onInput: handleAppInput }) : null, _jsx(Dashboard, { session: state.session, support: state.support, selectedIndex: state.selectedIndex, inspectOnly: launchInspectOnly, target: activeTarget, account: state.account, message: state.message, lastPlan: state.lastPlan })] }));
}
function InputController({ onInput }) {
    useInput(onInput);
    return null;
}
function HomeScreen({ tab, providerLabel, inspectOnly, preferredVo, providers, recommendations, search, accountForm, accountProviderLabel, isInteractive, }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "cyan", children: "BBCLI" }), _jsx(Text, { bold: true, children: `${providerLabel} home is ready. Search first, or open something from recommendations.` }), _jsx(Text, { dimColor: true, children: `Mode: ${inspectOnly ? "inspect" : "play"}  |  Preferred VO: ${preferredVo}` }), _jsx(Newline, {}), _jsxs(Box, { children: [_jsx(TabLabel, { label: "1 Recommend", selected: tab === "recommend" }), _jsx(Text, { children: "  " }), _jsx(TabLabel, { label: "2 Search", selected: tab === "search" }), _jsx(Text, { children: "  " }), _jsx(TabLabel, { label: "3 Bind Account", selected: tab === "account" })] }), _jsx(Newline, {}), tab === "recommend" ? _jsx(RecommendationPanel, { state: recommendations }) : null, tab === "search" ? _jsx(SearchPanel, { state: search, providerLabel: providerLabel }) : null, tab === "account" ? _jsx(AccountPanel, { state: accountForm, providerLabel: accountProviderLabel }) : null, _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Controls" }), isInteractive ? (_jsxs(_Fragment, { children: [_jsx(Text, { children: "1/2/3 switch views. i toggles inspect, v cycles VO, q quits." }), tab === "recommend" ? _jsx(Text, { children: "Recommend: j/k or arrows move, Enter opens, r refreshes, typing jumps into search." }) : null, tab === "search" ? _jsx(Text, { children: "Search: type keywords or paste a Bilibili link, Enter searches or opens, j/k selects results, Esc returns." }) : null, tab === "account" ? _jsx(Text, { children: "Account: type to edit the active field, Tab switches field, m toggles cookie/file mode, d toggles default, Enter binds." }) : null] })) : (_jsx(Text, { children: "Interactive input is not available in this terminal session. Run BBCLI in a normal terminal." })), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Providers" }), providers.map((provider) => (_jsxs(Text, { children: [provider.label, "  |  accounts ", provider.boundAccounts, provider.defaultAccount ? `  |  default ${provider.defaultAccount}` : "", provider.example ? `  |  ${provider.example}` : ""] }, provider.id))), _jsx(Text, { dimColor: true, children: `Account store: ${buildAccountStorePath()}` })] }));
}
function RecommendationPanel({ state }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: "Bilibili Recommendations" }), state.loading ? _jsx(Text, { dimColor: true, children: "Loading homepage recommendations..." }) : null, !state.loading && state.items.length === 0 ? _jsx(Text, { dimColor: true, children: state.message ?? "No recommendations yet." }) : null, state.items.slice(0, 8).map((item, index) => {
                const selected = index === state.selectedIndex;
                return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { color: selected ? "yellow" : undefined, children: `${selected ? ">" : " "} ${item.title}` }), _jsx(Text, { dimColor: true, children: `${item.ownerName}  |  ${formatDuration(item.durationSeconds ?? 0)}  |  ${formatCount(item.viewCount)}` })] }, `${item.pageUrl}-${index}`));
            }), state.message && state.items.length > 0 ? _jsx(Text, { color: "yellow", children: state.message }) : null] }));
}
function SearchPanel({ state, providerLabel }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: `Search ${providerLabel}` }), _jsx(Text, { children: `> ${state.query || "Type keywords or paste a video link..."}` }), state.loading ? _jsx(Text, { dimColor: true, children: "Searching..." }) : null, state.message ? _jsx(Text, { color: "yellow", children: state.message }) : null, state.results.map((item, index) => {
                const selected = index === state.selectedIndex;
                return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { color: selected ? "yellow" : undefined, children: `${selected ? ">" : " "} ${item.title}` }), _jsx(Text, { dimColor: true, children: `${item.ownerName}  |  ${formatDuration(item.durationSeconds ?? 0)}  |  ${formatCount(item.viewCount)}` })] }, `${item.pageUrl}-${index}`));
            })] }));
}
function AccountPanel({ state, providerLabel }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: `Bind ${providerLabel} Account` }), _jsx(Text, { dimColor: true, children: state.existingAccounts.length > 0 ? `Existing: ${state.existingAccounts.join(", ")}${state.defaultAccount ? `  |  default ${state.defaultAccount}` : ""}` : "No accounts bound yet." }), _jsx(Newline, {}), _jsx(Text, { color: state.activeField === "name" ? "yellow" : undefined, children: `${state.activeField === "name" ? ">" : " "} Account name: ${state.name || "main"}` }), _jsx(Text, { dimColor: true, children: `  Input mode: ${state.inputMode === "cookie" ? "Paste Cookie" : "Cookie File Path"}  |  Default: ${state.makeDefault ? "yes" : "no"}` }), _jsx(Text, { color: state.activeField === "value" ? "yellow" : undefined, children: `${state.activeField === "value" ? ">" : " "} ${state.inputMode === "cookie" ? "Cookie" : "Cookie file"}: ${formatAccountValue(state.inputMode, state.value)}` }), _jsx(Text, { color: state.activeField === "note" ? "yellow" : undefined, children: `${state.activeField === "note" ? ">" : " "} Note: ${state.note || "optional"}` }), state.busy ? _jsx(Text, { dimColor: true, children: "Working..." }) : null, state.message ? _jsx(Text, { color: "yellow", children: state.message }) : null] }));
}
function TabLabel({ label, selected }) {
    return _jsx(Text, { color: selected ? "yellow" : "gray", children: label });
}
function LoadingScreen({ target }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "yellow", children: `Loading ${target.providerLabel} page data...` }), _jsx(Text, { dimColor: true, children: target.originalInput }), _jsx(Text, { dimColor: true, children: "Fetching `window.__playinfo__` and `window.__INITIAL_STATE__`." })] }));
}
function ErrorScreen({ error }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "red", children: "Failed to load video" }), _jsx(Text, { children: error }), _jsx(Text, { dimColor: true, children: "Press `b` to return to recommendations, or `Enter`, `Esc`, `q` to quit." })] }));
}
function Dashboard({ session, support, selectedIndex, inspectOnly, target, account, message, lastPlan, }) {
    const selectedVariant = session.variants[selectedIndex];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "cyan", children: "BBCLI" }), _jsx(Text, { bold: true, children: session.title }), _jsxs(Text, { dimColor: true, children: [session.ownerName, "  |  ", formatDuration(session.durationSeconds), "  |  ", session.bvid] }), target ? _jsx(Text, { dimColor: true, children: `Provider: ${target.providerLabel}` }) : null, account ? _jsx(Text, { dimColor: true, children: `Account: ${account.provider}:${account.name}` }) : null, _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Playback" }), _jsxs(Text, { children: ["Player: ", support.mpvInstalled ? "mpv terminal mode" : support.ffplayInstalled ? "ffplay fallback (non-terminal)" : "missing"] }), _jsxs(Text, { children: ["Terminal: ", support.detectedTerminal, "  |  Preferred VO: ", support.preferredVo] }), support.notes.map((note, index) => (_jsxs(Text, { dimColor: true, children: ["- ", note] }, `${note}-${index}`))), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Streams" }), session.variants.map((variant, index) => {
                const selected = index === selectedIndex;
                return (_jsxs(Text, { color: selected ? "yellow" : undefined, children: [selected ? ">" : " ", " ", variant.label, "  |  ", variant.codecLabel, "  |  ", formatBitrate(variant.videoBandwidth)] }, variant.quality));
            }), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Selected Network Info" }), _jsxs(Text, { children: ["Host: ", selectedVariant.host] }), _jsxs(Text, { children: ["Codec: ", selectedVariant.codecLabel] }), _jsxs(Text, { children: ["Video bitrate: ", formatBitrate(selectedVariant.videoBandwidth), "  |  Audio bitrate: ", formatBitrate(selectedVariant.audioBandwidth)] }), _jsxs(Text, { children: ["Signed URL expires: ", selectedVariant.expiresAt ?? "unknown"] }), _jsxs(Text, { dimColor: true, children: ["Referer: ", session.pageUrl] }), _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Stats" }), _jsxs(Text, { children: ["Views ", formatCount(session.stats.views), "  Likes ", formatCount(session.stats.likes), "  Danmaku ", formatCount(session.stats.danmaku)] }), _jsxs(Text, { children: ["Coins ", formatCount(session.stats.coins), "  Favorites ", formatCount(session.stats.favorites), "  Shares ", formatCount(session.stats.shares)] }), session.parts.length > 1 ? (_jsxs(_Fragment, { children: [_jsx(Newline, {}), _jsx(Text, { color: "green", children: "Parts" }), session.parts.slice(0, 5).map((part) => (_jsxs(Text, { children: ["P", part.page, "  ", part.part] }, part.cid)))] })) : null, _jsx(Newline, {}), _jsx(Text, { color: "green", children: "Controls" }), _jsx(Text, { children: inspectOnly ? "j/k or arrows to change quality, r to reload, b to return home, q to quit." : "j/k or arrows to change quality, Enter/p to play, r to reload, b to return home, q to quit." }), message ? _jsx(Text, { color: "yellow", children: message }) : null, lastPlan ? (_jsxs(Text, { dimColor: true, children: ["Last command: ", lastPlan.command, " ", lastPlan.args.join(" ")] })) : null] }));
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
        return mode === "cookie" ? "paste your Cookie header here" : "./bilibili.cookies";
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
