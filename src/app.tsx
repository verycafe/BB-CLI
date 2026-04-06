import {readFile} from "node:fs/promises";

import React, {startTransition, useEffect, useState} from "react";
import {Box, Newline, Text, useApp, useInput, useStdin, type Key} from "ink";

import {
  bindAccount,
  buildHeadersFromAccount,
  listAccounts,
  resolveAccount,
} from "./lib/accounts.js";
import {parseCookieInput} from "./lib/cookies.js";
import type {MediaSearchResult, RequestAccount, VideoSession} from "./lib/media-types.js";
import {
  listKnownProviders,
  listRecommendedMedia,
  loadMediaSession,
  resolveMediaTarget,
  searchMedia,
  validateProviderAccountHeaders,
  type MediaTarget,
} from "./lib/providers.js";
import {
  buildLaunchPlan,
  detectPlayerSupport,
  launchPlayer,
  type LaunchPlan,
  type PlayerSupport,
  type PlayerVo,
} from "./lib/player.js";
import {
  ACCOUNT_CONNECTORS,
  LIBRARY_CONNECTORS,
  type WorkspaceConnector,
} from "./lib/workspace-catalog.js";

type Props = {
  target?: MediaTarget;
  inspectOnly: boolean;
  preferredVo: PlayerVo;
  useFastProfile: boolean;
  allowExternalPlayer: boolean;
  selectedAccountName?: string;
  providerOverride?: string;
};

type AppState =
  | {status: "home"}
  | {status: "loading"}
  | {status: "ready"; session: VideoSession; support: PlayerSupport; selectedIndex: number; account?: RequestAccount; lastPlan?: LaunchPlan; message?: string}
  | {status: "playing"; session: VideoSession; support: PlayerSupport; selectedIndex: number; account?: RequestAccount; message: string}
  | {status: "error"; error: string};

type HomeTab = "discover" | "search" | "library" | "accounts";
type HomeView = "menu" | "workspace";

type HomeProviderSummary = {
  id: string;
  label: string;
  supportsAccounts: boolean;
  detectionHint: string;
  example?: string;
  boundAccounts: number;
  defaultAccount?: string;
};

type RecommendationState = {
  loading: boolean;
  items: MediaSearchResult[];
  selectedIndex: number;
  message?: string;
};

type SearchState = {
  query: string;
  loading: boolean;
  lastRunQuery?: string;
  results: MediaSearchResult[];
  selectedIndex: number;
  message?: string;
};

type AccountField = "name" | "value" | "note";
type AccountInputMode = "cookie" | "cookieFile";

type AccountFormState = {
  activeField: AccountField;
  inputMode: AccountInputMode;
  name: string;
  value: string;
  note: string;
  makeDefault: boolean;
  busy: boolean;
  message?: string;
  existingAccounts: string[];
  defaultAccount?: string;
};

const HOME_TABS: Array<{
  id: HomeTab;
  label: string;
  summary: string;
}> = [
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

const EMPTY_ACCOUNT_FORM: AccountFormState = {
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

export default function App({target, inspectOnly, preferredVo, useFastProfile, allowExternalPlayer, selectedAccountName, providerOverride}: Props) {
  const {exit} = useApp();
  const {isRawModeSupported} = useStdin();
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
  const [activeTarget, setActiveTarget] = useState<MediaTarget | undefined>(target);
  const [launchInspectOnly, setLaunchInspectOnly] = useState(inspectOnly);
  const [launchVo, setLaunchVo] = useState<PlayerVo>(preferredVo);
  const [homeTab, setHomeTab] = useState<HomeTab>("discover");
  const [homeView, setHomeView] = useState<HomeView>("menu");
  const [homeMenuIndex, setHomeMenuIndex] = useState(0);
  const [selectedAccountProviderId, setSelectedAccountProviderId] = useState(
    providerOverride ?? defaultAccountProvider?.id ?? homeMediaProviderId,
  );
  const [providerSummaries, setProviderSummaries] = useState<HomeProviderSummary[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationState>({
    loading: !target,
    items: [],
    selectedIndex: 0,
  });
  const [search, setSearch] = useState<SearchState>({
    query: "",
    loading: false,
    results: [],
    selectedIndex: 0,
  });
  const [accountForm, setAccountForm] = useState<AccountFormState>(EMPTY_ACCOUNT_FORM);
  const [state, setState] = useState<AppState>(() => (target ? {status: "loading"} : {status: "home"}));
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
      const summaries = await Promise.all(
        providerDescriptors.map(async (provider) => {
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
          } satisfies HomeProviderSummary;
        }),
      );
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
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        startTransition(() => {
          setState({status: "error", error: message});
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTarget, launchInspectOnly, launchVo, reloadKey, selectedAccountName]);

  function handleAppInput(inputKey: string, key: Key): void {
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
      setState({status: "loading"});
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
      const variant = state.session.variants[state.selectedIndex]!;
      let plan: LaunchPlan;

      try {
        plan = buildLaunchPlan(state.session, variant, state.support, {
          playerVo: launchVo,
          useFastProfile,
          allowExternalPlayer,
        });
      } catch (error) {
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
        } catch (error) {
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

  function handleHomeInput(inputKey: string, key: Key): void {
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

  function handleHomeMenuInput(inputKey: string, key: Key): void {
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

  function openHomeWorkspace(tab: HomeTab): void {
    setHomeTab(tab);
    const nextIndex = HOME_TABS.findIndex((item) => item.id === tab);
    if (nextIndex >= 0) {
      setHomeMenuIndex(nextIndex);
    }
    setHomeView("workspace");
  }

  function handleRecommendationInput(inputKey: string, key: Key): void {
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

  function handleSearchInput(inputKey: string, key: Key): void {
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
      } catch {
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

  function handleAccountInput(inputKey: string, key: Key): void {
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

  function cycleAccountProvider(direction: -1 | 1): void {
    if (accountProviderOptions.length <= 1) {
      return;
    }

    const currentIndex = Math.max(
      0,
      accountProviderOptions.findIndex((provider) => provider.id === homeAccountProviderId),
    );
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

  async function runSearch(query: string): Promise<void> {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSearch((current) => ({
        ...current,
        loading: false,
        message,
      }));
    }
  }

  async function runAccountBind(): Promise<void> {
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
      const headers = {Cookie: cookieValue};
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAccountForm((current) => ({
        ...current,
        busy: false,
        message,
      }));
    }
  }

  function openTargetFromInput(input: string): void {
    const target = resolveMediaTarget(input, providerOverride);
    openTarget(target);
  }

  function openTarget(target: MediaTarget): void {
    setActiveTarget(target);
    setState({status: "loading"});
  }

  function returnToHome(tab: HomeTab): void {
    setActiveTarget(undefined);
    setHomeTab(tab);
    setHomeView("workspace");
    setState({status: "home"});
    if (tab === "discover") {
      setRecommendationKey((value) => value + 1);
    }
  }

  if (state.status === "home") {
    return (
      <>
        {isRawModeSupported ? <InputController onInput={handleAppInput} /> : null}
        <HomeScreen
          view={homeView}
          tab={homeTab}
          menuIndex={homeMenuIndex}
          providerLabel={homeMediaProvider?.label ?? homeMediaProviderId}
          inspectOnly={launchInspectOnly}
          providers={providerSummaries}
          recommendations={recommendations}
          search={search}
          accountForm={accountForm}
          accountProviderId={homeAccountProviderId}
          accountProviderLabel={homeAccountProvider?.label ?? homeAccountProviderId}
          isInteractive={isRawModeSupported}
        />
      </>
    );
  }

  if (state.status === "loading") {
    return <LoadingScreen target={activeTarget!} />;
  }

  if (state.status === "error") {
    return <ErrorScreen error={state.error} />;
  }

  if (state.status === "playing") {
    return (
      <>
        {isRawModeSupported ? <InputController onInput={handleAppInput} /> : null}
        <Box flexDirection="column">
          <Text color="green">{state.message}</Text>
          <Text dimColor>播放器退出后会回到这里。</Text>
        </Box>
      </>
    );
  }

  return (
    <>
      {isRawModeSupported ? <InputController onInput={handleAppInput} /> : null}
      <Dashboard
        session={state.session}
        support={state.support}
        selectedIndex={state.selectedIndex}
        inspectOnly={launchInspectOnly}
        allowExternalPlayer={allowExternalPlayer}
        target={activeTarget}
        account={state.account}
        message={state.message}
        lastPlan={state.lastPlan}
      />
    </>
  );
}

function InputController({onInput}: {onInput: (inputKey: string, key: Key) => void}) {
  useInput(onInput);
  return null;
}

function HomeScreen({
  view,
  tab,
  menuIndex,
  providerLabel,
  inspectOnly,
  providers,
  recommendations,
  search,
  accountForm,
  accountProviderId,
  accountProviderLabel,
  isInteractive,
}: {
  view: HomeView;
  tab: HomeTab;
  menuIndex: number;
  providerLabel: string;
  inspectOnly: boolean;
  providers: HomeProviderSummary[];
  recommendations: RecommendationState;
  search: SearchState;
  accountForm: AccountFormState;
  accountProviderId: string;
  accountProviderLabel: string;
  isInteractive: boolean;
}) {
  const activeLaneLabel = view === "menu"
    ? "首页菜单"
    : tab === "accounts"
      ? accountProviderLabel
      : tab === "library"
        ? "个人书架"
        : providerLabel;
  const activeMenu = HOME_TABS[menuIndex];

  return (
    <Box flexDirection="column">
      <BrandHeader
        activeTab={view === "menu" ? undefined : tab}
        providerLabel={activeLaneLabel}
        inspectOnly={view === "workspace" ? inspectOnly : false}
      />
      <Newline />

      {view === "menu" ? <MenuScreen selectedIndex={menuIndex} /> : null}
      {view === "workspace" ? <WorkspaceHeader tab={tab} providerLabel={activeLaneLabel} /> : null}
      {view === "workspace" ? <Newline /> : null}
      {view === "workspace" && tab === "discover" ? <RecommendationPanel state={recommendations} /> : null}
      {view === "workspace" && tab === "search" ? <SearchPanel state={search} /> : null}
      {view === "workspace" && tab === "library" ? <LibraryPanel providers={providers} /> : null}
      {view === "workspace" && tab === "accounts" ? <AccountPanel state={accountForm} providerLabel={accountProviderLabel} accountProviderId={accountProviderId} providers={providers} /> : null}

      <Newline />
      {!isInteractive ? <Text dimColor>当前终端不支持交互输入，请在正常终端里运行 BBCLI。</Text> : null}
      {isInteractive && view === "menu" ? <Text dimColor>{`${activeMenu?.label ?? "菜单"}  ·  ↑↓ 选择  ·  Enter 进入  ·  直接输入搜索`}</Text> : null}
      {isInteractive && view === "workspace" && tab === "discover" ? <Text dimColor>↑↓ 选择  ·  Enter 打开  ·  r 刷新  ·  b 返回</Text> : null}
      {isInteractive && view === "workspace" && tab === "search" ? <Text dimColor>Enter 搜索或打开  ·  ↑↓ 选择  ·  Esc / b 返回</Text> : null}
      {isInteractive && view === "workspace" && tab === "library" ? <Text dimColor>b 返回</Text> : null}
      {isInteractive && view === "workspace" && tab === "accounts" ? <Text dimColor>{'[`] 切平台  ·  Tab 切字段  ·  Enter 绑定  ·  b 返回'}</Text> : null}
    </Box>
  );
}

function MenuScreen({selectedIndex}: {selectedIndex: number}) {
  return (
    <Box flexDirection="column">
      {HOME_TABS.map((item, index) => {
        const selected = index === selectedIndex;
        return (
          <Text key={item.id} color={selected ? "yellow" : undefined}>
            {`${selected ? ">" : " "} ${item.label}  ·  ${item.summary}`}
          </Text>
        );
      })}
    </Box>
  );
}

function WorkspaceHeader({tab, providerLabel}: {tab: HomeTab; providerLabel: string}) {
  return (
    <Box>
      <Text dimColor>← 菜单</Text>
      <Text dimColor>  /  </Text>
      <Text bold>{formatHomeTab(tab)}</Text>
      <Text dimColor>{`  /  ${providerLabel}`}</Text>
    </Box>
  );
}

function BrandHeader({
  activeTab,
  providerLabel,
  inspectOnly,
}: {
  activeTab?: HomeTab;
  providerLabel: string;
  inspectOnly: boolean;
}) {
  const mascotLines = [
    "  (\\_/)",
    "  (='.'=)",
    '  (")_(")',
  ];

  return (
    <Box flexDirection="column">
      <Box>
        <Box flexDirection="column" marginRight={2}>
          {mascotLines.map((line) => (
            <Text key={line} color="yellow">
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text color="cyan" bold>
            BBCLI
          </Text>
          <Text bold>终端里的内容兔兔工具箱</Text>
          <Text dimColor>{activeTab ? `当前页面：${formatHomeTab(activeTab)}  |  当前通道：${providerLabel}  |  模式：${inspectOnly ? "检查" : "播放"}` : "选择一个入口开始。"}</Text>
        </Box>
      </Box>
      <Text dimColor>{"-".repeat(78)}</Text>
    </Box>
  );
}

function RecommendationPanel({state}: {state: RecommendationState}) {
  return (
    <Box flexDirection="column">
      {!state.loading && state.items.length > 0 ? <Text dimColor>{`共 ${state.items.length} 条推荐`}</Text> : null}
      {!state.loading && state.items.length > 0 ? <Newline /> : null}
      {state.loading ? <Text dimColor>正在加载首页推荐...</Text> : null}
      {!state.loading && state.items.length === 0 ? <Text dimColor>{state.message ?? "当前还没有推荐内容。"}</Text> : null}
      {state.items.slice(0, 8).map((item, index) => {
        const selected = index === state.selectedIndex;
        return (
          <Box key={`${item.pageUrl}-${index}`} flexDirection="column" marginBottom={1}>
            <Text color={selected ? "yellow" : undefined}>{`${selected ? ">" : " "} ${item.title}`}</Text>
            <Text dimColor>{`${item.ownerName}  |  ${formatDuration(item.durationSeconds ?? 0)}  |  ${formatCount(item.viewCount)}`}</Text>
          </Box>
        );
      })}
      {state.message && state.items.length > 0 ? <Text color="yellow">{state.message}</Text> : null}
    </Box>
  );
}

function SearchPanel({state}: {state: SearchState}) {
  return (
    <Box flexDirection="column">
      <Text>{`> ${state.query || "输入关键词，或粘贴视频链接..."}`}</Text>
      {!state.loading && state.results.length > 0 ? <Text dimColor>{`结果 ${state.results.length} 条`}</Text> : null}
      {state.loading ? <Text dimColor>正在搜索...</Text> : null}
      {state.message ? <Text color="yellow">{state.message}</Text> : null}
      {state.results.map((item, index) => {
        const selected = index === state.selectedIndex;
        return (
          <Box key={`${item.pageUrl}-${index}`} flexDirection="column" marginBottom={1}>
            <Text color={selected ? "yellow" : undefined}>{`${selected ? ">" : " "} ${item.title}`}</Text>
            <Text dimColor>{`${item.ownerName}  |  ${formatDuration(item.durationSeconds ?? 0)}  |  ${formatCount(item.viewCount)}`}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function LibraryPanel({providers}: {providers: HomeProviderSummary[]}) {
  const connected = providers.filter((provider) => provider.boundAccounts > 0);

  return (
    <Box flexDirection="column">
      <CompactConnectorRow items={LIBRARY_CONNECTORS} />
      <Newline />
      <Text dimColor>当前连接</Text>
      {connected.length > 0 ? connected.map((provider) => (
        <Text key={provider.id}>{`${provider.label}  |  账号 ${provider.boundAccounts}${provider.defaultAccount ? `  |  默认 ${provider.defaultAccount}` : ""}`}</Text>
      )) : <Text dimColor>目前还没有连接任何书库来源，可以先去“账号”工作区绑定平台。</Text>}
    </Box>
  );
}

function AccountPanel({
  state,
  providerLabel,
  accountProviderId,
  providers,
}: {
  state: AccountFormState;
  providerLabel: string;
  accountProviderId: string;
  providers: HomeProviderSummary[];
}) {
  const liveConnectors: WorkspaceConnector[] = providers
    .filter((provider) => provider.supportsAccounts)
    .map((provider) => ({
      id: provider.id,
      label: provider.label,
      status: "live",
      note: provider.boundAccounts > 0
        ? `已绑定 ${provider.boundAccounts} 个账号${provider.defaultAccount ? `，默认账号为 ${provider.defaultAccount}` : ""}。`
        : "已可开始绑定。",
    }));
  const plannedConnectors = ACCOUNT_CONNECTORS.filter(
    (connector) => !liveConnectors.some((provider) => provider.id === connector.id),
  );
  const accountConnectors = [...liveConnectors, ...plannedConnectors];

  return (
    <Box flexDirection="column">
      <CompactConnectorRow items={accountConnectors} activeId={accountProviderId} />
      <Newline />
      <Text>{`绑定 ${providerLabel} 账号`}</Text>
      <Text dimColor>{state.existingAccounts.length > 0 ? `已有账号：${state.existingAccounts.join(", ")}${state.defaultAccount ? `  |  默认 ${state.defaultAccount}` : ""}` : "当前还没有已绑定账号。"}</Text>
      <Newline />
      <Text color={state.activeField === "name" ? "yellow" : undefined}>{`${state.activeField === "name" ? ">" : " "} 账号名：${state.name || "main"}`}</Text>
      <Text dimColor>{`  输入模式：${state.inputMode === "cookie" ? "粘贴 Cookie" : "Cookie 文件路径"}  |  设为默认：${state.makeDefault ? "是" : "否"}`}</Text>
      <Text color={state.activeField === "value" ? "yellow" : undefined}>{`${state.activeField === "value" ? ">" : " "} ${state.inputMode === "cookie" ? "Cookie" : "Cookie 文件"}：${formatAccountValue(state.inputMode, state.value)}`}</Text>
      <Text color={state.activeField === "note" ? "yellow" : undefined}>{`${state.activeField === "note" ? ">" : " "} 备注：${state.note || "可选"}`}</Text>
      {state.busy ? <Text dimColor>处理中...</Text> : null}
      {state.message ? <Text color="yellow">{state.message}</Text> : null}
    </Box>
  );
}

function CompactConnectorRow({
  items,
  activeId,
}: {
  items: WorkspaceConnector[];
  activeId?: string;
}) {
  return (
    <Box>
      {items.map((item, index) => {
        const active = item.id === activeId;
        const label = active ? `[${item.label}]` : item.status === "planned" ? `${item.label}·规划中` : item.label;
        return (
          <React.Fragment key={item.id}>
            <Text color={active ? "yellow" : item.status === "planned" ? "gray" : undefined}>{label}</Text>
            {index < items.length - 1 ? <Text>  </Text> : null}
          </React.Fragment>
        );
      })}
    </Box>
  );
}

function formatHomeTab(tab: HomeTab): string {
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

function LoadingScreen({target}: {target: MediaTarget}) {
  return (
    <Box flexDirection="column">
      <Text color="yellow">{`正在加载 ${target.providerLabel} 页面数据...`}</Text>
      <Text dimColor>{target.originalInput}</Text>
      <Text dimColor>正在抓取 `window.__playinfo__` 和 `window.__INITIAL_STATE__`。</Text>
    </Box>
  );
}

function ErrorScreen({error}: {error: string}) {
  return (
    <Box flexDirection="column">
      <Text color="red">加载视频失败</Text>
      <Text>{error}</Text>
      <Text dimColor>按 `b` 返回上一页，或按 `Enter`、`Esc`、`q` 退出。</Text>
    </Box>
  );
}

function Dashboard({
  session,
  support,
  selectedIndex,
  inspectOnly,
  allowExternalPlayer,
  target,
  account,
  message,
  lastPlan,
}: {
  session: VideoSession;
  support: PlayerSupport;
  selectedIndex: number;
  inspectOnly: boolean;
  allowExternalPlayer: boolean;
  target?: MediaTarget;
  account?: RequestAccount;
  message?: string;
  lastPlan?: LaunchPlan;
}) {
  const selectedVariant = session.variants[selectedIndex]!;

  return (
    <Box flexDirection="column">
      <Text color="cyan">BBCLI</Text>
      <Text bold>{session.title}</Text>
      <Text dimColor>
        {session.ownerName}  |  {formatDuration(session.durationSeconds)}  |  {session.bvid}
      </Text>
      {target ? <Text dimColor>{`平台：${target.providerLabel}`}</Text> : null}
      {account ? <Text dimColor>{`账号：${account.provider}:${account.name}`}</Text> : null}
      <Newline />

      <Text color="green">播放</Text>
      <Text>
        播放器：{
          support.mpvInstalled
            ? "mpv 终端模式"
            : support.ffplayInstalled && allowExternalPlayer
              ? "ffplay 外部窗口（手动允许）"
              : support.ffplayInstalled
                ? "缺少 mpv，已禁用外部窗口回退"
                : "缺失"
        }
      </Text>
      <Text>
        终端：{support.detectedTerminal}  |  当前 VO：{support.preferredVo}
      </Text>
      {!support.mpvInstalled && support.ffplayInstalled && !allowExternalPlayer ? (
        <Text color="yellow">BBCLI 默认不再自动弹出 ffplay 窗口。请安装 `mpv`；只有你明确接受外部窗口时，才应使用 `--external-player`。</Text>
      ) : null}
      {support.notes.map((note, index) => (
        <Text key={`${note}-${index}`} dimColor>
          - {note}
        </Text>
      ))}

      <Newline />
      <Text color="green">码流</Text>
      {session.variants.map((variant, index) => {
        const selected = index === selectedIndex;
        return (
          <Text key={variant.quality} color={selected ? "yellow" : undefined}>
            {selected ? ">" : " "} {variant.label}  |  {variant.codecLabel}  |  {formatBitrate(variant.videoBandwidth)}
          </Text>
        );
      })}

      <Newline />
      <Text color="green">当前选中网络信息</Text>
      <Text>主机：{selectedVariant.host}</Text>
      <Text>编码：{selectedVariant.codecLabel}</Text>
      <Text>
        视频码率：{formatBitrate(selectedVariant.videoBandwidth)}  |  音频码率：{formatBitrate(selectedVariant.audioBandwidth)}
      </Text>
      <Text>签名 URL 过期时间：{selectedVariant.expiresAt ?? "未知"}</Text>
      <Text dimColor>Referer：{session.pageUrl}</Text>

      <Newline />
      <Text color="green">统计</Text>
      <Text>
        播放 {formatCount(session.stats.views)}  点赞 {formatCount(session.stats.likes)}  弹幕 {formatCount(session.stats.danmaku)}
      </Text>
      <Text>
        投币 {formatCount(session.stats.coins)}  收藏 {formatCount(session.stats.favorites)}  分享 {formatCount(session.stats.shares)}
      </Text>

      {session.parts.length > 1 ? (
        <>
          <Newline />
          <Text color="green">分 P</Text>
          {session.parts.slice(0, 5).map((part) => (
            <Text key={part.cid}>
              P{part.page}  {part.part}
            </Text>
          ))}
        </>
      ) : null}

      <Newline />
      <Text color="green">操作提示</Text>
      <Text>{inspectOnly ? "用 `j/k` 或上下方向键切换清晰度，`r` 重新加载，`b` 返回首页，`q` 退出。" : "用 `j/k` 或上下方向键切换清晰度，回车或 `p` 播放，`r` 重新加载，`b` 返回首页，`q` 退出。"}</Text>
      {message ? <Text color="yellow">{message}</Text> : null}
      {lastPlan ? (
        <Text dimColor>
          上次命令：{lastPlan.command} {lastPlan.args.join(" ")}
        </Text>
      ) : null}
    </Box>
  );
}

async function resolveRequestAccount(providerId: string, selectedAccountName?: string): Promise<RequestAccount | undefined> {
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

function isPlainTextInput(inputKey: string, key: Key): boolean {
  return !key.ctrl && !key.meta && !key.return && !key.tab && !key.escape && inputKey.length > 0;
}

function nextAccountField(field: AccountField): AccountField {
  if (field === "name") {
    return "value";
  }

  if (field === "value") {
    return "note";
  }

  return "name";
}

function getAccountFieldValue(state: AccountFormState, field: AccountField): string {
  if (field === "name") {
    return state.name;
  }

  if (field === "value") {
    return state.value;
  }

  return state.note;
}

function updateAccountField(state: AccountFormState, field: AccountField, value: string): AccountFormState {
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

function formatAccountValue(mode: AccountInputMode, value: string): string {
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

function formatDuration(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatBitrate(value?: number): string {
  if (!value) {
    return "无";
  }

  return `${(value / 1000).toFixed(0)} kbps`;
}

function formatCount(value?: number): string {
  if (value === undefined) {
    return "无";
  }

  return new Intl.NumberFormat("zh-CN").format(value);
}

function nextVo(value: PlayerVo): PlayerVo {
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
