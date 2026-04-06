import {readFile} from "node:fs/promises";

import React, {startTransition, useEffect, useState} from "react";
import {Box, Newline, Text, useApp, useInput, useStdin, type Key} from "ink";

import {
  bindAccount,
  buildAccountStorePath,
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

type Props = {
  target?: MediaTarget;
  inspectOnly: boolean;
  preferredVo: PlayerVo;
  useFastProfile: boolean;
  selectedAccountName?: string;
  providerOverride?: string;
};

type AppState =
  | {status: "home"}
  | {status: "loading"}
  | {status: "ready"; session: VideoSession; support: PlayerSupport; selectedIndex: number; account?: RequestAccount; lastPlan?: LaunchPlan; message?: string}
  | {status: "playing"; session: VideoSession; support: PlayerSupport; selectedIndex: number; account?: RequestAccount; message: string}
  | {status: "error"; error: string};

type HomeTab = "recommend" | "search" | "account";

type HomeProviderSummary = {
  id: string;
  label: string;
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

export default function App({target, inspectOnly, preferredVo, useFastProfile, selectedAccountName, providerOverride}: Props) {
  const {exit} = useApp();
  const {isRawModeSupported} = useStdin();
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
  const [activeTarget, setActiveTarget] = useState<MediaTarget | undefined>(target);
  const [launchInspectOnly, setLaunchInspectOnly] = useState(inspectOnly);
  const [launchVo, setLaunchVo] = useState<PlayerVo>(preferredVo);
  const [homeTab, setHomeTab] = useState<HomeTab>("recommend");
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
      setState({status: "loading"});
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
      const variant = state.session.variants[state.selectedIndex]!;
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
        } catch (error) {
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

  function handleHomeInput(inputKey: string, key: Key): void {
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

  async function runSearch(query: string): Promise<void> {
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
        message: `Bound ${result.account.provider}:${result.account.name}.`,
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
    setState({status: "home"});
    if (tab === "recommend") {
      setRecommendationKey((value) => value + 1);
    }
  }

  if (state.status === "home") {
    return (
      <>
        {isRawModeSupported ? <InputController onInput={handleAppInput} /> : null}
        <HomeScreen
          tab={homeTab}
          providerLabel={homeMediaProvider?.label ?? homeMediaProviderId}
          inspectOnly={launchInspectOnly}
          preferredVo={launchVo}
          providers={providerSummaries}
          recommendations={recommendations}
          search={search}
          accountForm={accountForm}
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
          <Text dimColor>Return here after the player exits.</Text>
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
  tab,
  providerLabel,
  inspectOnly,
  preferredVo,
  providers,
  recommendations,
  search,
  accountForm,
  accountProviderLabel,
  isInteractive,
}: {
  tab: HomeTab;
  providerLabel: string;
  inspectOnly: boolean;
  preferredVo: PlayerVo;
  providers: HomeProviderSummary[];
  recommendations: RecommendationState;
  search: SearchState;
  accountForm: AccountFormState;
  accountProviderLabel: string;
  isInteractive: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Text color="cyan">BBCLI</Text>
      <Text bold>{`${providerLabel} home is ready. Search first, or open something from recommendations.`}</Text>
      <Text dimColor>{`Mode: ${inspectOnly ? "inspect" : "play"}  |  Preferred VO: ${preferredVo}`}</Text>
      <Newline />

      <Box>
        <TabLabel label="1 Recommend" selected={tab === "recommend"} />
        <Text>  </Text>
        <TabLabel label="2 Search" selected={tab === "search"} />
        <Text>  </Text>
        <TabLabel label="3 Bind Account" selected={tab === "account"} />
      </Box>

      <Newline />
      {tab === "recommend" ? <RecommendationPanel state={recommendations} /> : null}
      {tab === "search" ? <SearchPanel state={search} providerLabel={providerLabel} /> : null}
      {tab === "account" ? <AccountPanel state={accountForm} providerLabel={accountProviderLabel} /> : null}

      <Newline />
      <Text color="green">Controls</Text>
      {isInteractive ? (
        <>
          <Text>1/2/3 switch views. i toggles inspect, v cycles VO, q quits.</Text>
          {tab === "recommend" ? <Text>Recommend: j/k or arrows move, Enter opens, r refreshes, typing jumps into search.</Text> : null}
          {tab === "search" ? <Text>Search: type keywords or paste a Bilibili link, Enter searches or opens, j/k selects results, Esc returns.</Text> : null}
          {tab === "account" ? <Text>Account: type to edit the active field, Tab switches field, m toggles cookie/file mode, d toggles default, Enter binds.</Text> : null}
        </>
      ) : (
        <Text>Interactive input is not available in this terminal session. Run BBCLI in a normal terminal.</Text>
      )}

      <Newline />
      <Text color="green">Providers</Text>
      {providers.map((provider) => (
        <Text key={provider.id}>
          {provider.label}  |  accounts {provider.boundAccounts}{provider.defaultAccount ? `  |  default ${provider.defaultAccount}` : ""}{provider.example ? `  |  ${provider.example}` : ""}
        </Text>
      ))}
      <Text dimColor>{`Account store: ${buildAccountStorePath()}`}</Text>
    </Box>
  );
}

function RecommendationPanel({state}: {state: RecommendationState}) {
  return (
    <Box flexDirection="column">
      <Text color="green">Bilibili Recommendations</Text>
      {state.loading ? <Text dimColor>Loading homepage recommendations...</Text> : null}
      {!state.loading && state.items.length === 0 ? <Text dimColor>{state.message ?? "No recommendations yet."}</Text> : null}
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

function SearchPanel({state, providerLabel}: {state: SearchState; providerLabel: string}) {
  return (
    <Box flexDirection="column">
      <Text color="green">{`Search ${providerLabel}`}</Text>
      <Text>{`> ${state.query || "Type keywords or paste a video link..."}`}</Text>
      {state.loading ? <Text dimColor>Searching...</Text> : null}
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

function AccountPanel({state, providerLabel}: {state: AccountFormState; providerLabel: string}) {
  return (
    <Box flexDirection="column">
      <Text color="green">{`Bind ${providerLabel} Account`}</Text>
      <Text dimColor>{state.existingAccounts.length > 0 ? `Existing: ${state.existingAccounts.join(", ")}${state.defaultAccount ? `  |  default ${state.defaultAccount}` : ""}` : "No accounts bound yet."}</Text>
      <Newline />
      <Text color={state.activeField === "name" ? "yellow" : undefined}>{`${state.activeField === "name" ? ">" : " "} Account name: ${state.name || "main"}`}</Text>
      <Text dimColor>{`  Input mode: ${state.inputMode === "cookie" ? "Paste Cookie" : "Cookie File Path"}  |  Default: ${state.makeDefault ? "yes" : "no"}`}</Text>
      <Text color={state.activeField === "value" ? "yellow" : undefined}>{`${state.activeField === "value" ? ">" : " "} ${state.inputMode === "cookie" ? "Cookie" : "Cookie file"}: ${formatAccountValue(state.inputMode, state.value)}`}</Text>
      <Text color={state.activeField === "note" ? "yellow" : undefined}>{`${state.activeField === "note" ? ">" : " "} Note: ${state.note || "optional"}`}</Text>
      {state.busy ? <Text dimColor>Working...</Text> : null}
      {state.message ? <Text color="yellow">{state.message}</Text> : null}
    </Box>
  );
}

function TabLabel({label, selected}: {label: string; selected: boolean}) {
  return <Text color={selected ? "yellow" : "gray"}>{label}</Text>;
}

function LoadingScreen({target}: {target: MediaTarget}) {
  return (
    <Box flexDirection="column">
      <Text color="yellow">{`Loading ${target.providerLabel} page data...`}</Text>
      <Text dimColor>{target.originalInput}</Text>
      <Text dimColor>Fetching `window.__playinfo__` and `window.__INITIAL_STATE__`.</Text>
    </Box>
  );
}

function ErrorScreen({error}: {error: string}) {
  return (
    <Box flexDirection="column">
      <Text color="red">Failed to load video</Text>
      <Text>{error}</Text>
      <Text dimColor>Press `b` to return to recommendations, or `Enter`, `Esc`, `q` to quit.</Text>
    </Box>
  );
}

function Dashboard({
  session,
  support,
  selectedIndex,
  inspectOnly,
  target,
  account,
  message,
  lastPlan,
}: {
  session: VideoSession;
  support: PlayerSupport;
  selectedIndex: number;
  inspectOnly: boolean;
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
      {target ? <Text dimColor>{`Provider: ${target.providerLabel}`}</Text> : null}
      {account ? <Text dimColor>{`Account: ${account.provider}:${account.name}`}</Text> : null}
      <Newline />

      <Text color="green">Playback</Text>
      <Text>
        Player: {support.mpvInstalled ? "mpv terminal mode" : support.ffplayInstalled ? "ffplay fallback (non-terminal)" : "missing"}
      </Text>
      <Text>
        Terminal: {support.detectedTerminal}  |  Preferred VO: {support.preferredVo}
      </Text>
      {support.notes.map((note, index) => (
        <Text key={`${note}-${index}`} dimColor>
          - {note}
        </Text>
      ))}

      <Newline />
      <Text color="green">Streams</Text>
      {session.variants.map((variant, index) => {
        const selected = index === selectedIndex;
        return (
          <Text key={variant.quality} color={selected ? "yellow" : undefined}>
            {selected ? ">" : " "} {variant.label}  |  {variant.codecLabel}  |  {formatBitrate(variant.videoBandwidth)}
          </Text>
        );
      })}

      <Newline />
      <Text color="green">Selected Network Info</Text>
      <Text>Host: {selectedVariant.host}</Text>
      <Text>Codec: {selectedVariant.codecLabel}</Text>
      <Text>
        Video bitrate: {formatBitrate(selectedVariant.videoBandwidth)}  |  Audio bitrate: {formatBitrate(selectedVariant.audioBandwidth)}
      </Text>
      <Text>Signed URL expires: {selectedVariant.expiresAt ?? "unknown"}</Text>
      <Text dimColor>Referer: {session.pageUrl}</Text>

      <Newline />
      <Text color="green">Stats</Text>
      <Text>
        Views {formatCount(session.stats.views)}  Likes {formatCount(session.stats.likes)}  Danmaku {formatCount(session.stats.danmaku)}
      </Text>
      <Text>
        Coins {formatCount(session.stats.coins)}  Favorites {formatCount(session.stats.favorites)}  Shares {formatCount(session.stats.shares)}
      </Text>

      {session.parts.length > 1 ? (
        <>
          <Newline />
          <Text color="green">Parts</Text>
          {session.parts.slice(0, 5).map((part) => (
            <Text key={part.cid}>
              P{part.page}  {part.part}
            </Text>
          ))}
        </>
      ) : null}

      <Newline />
      <Text color="green">Controls</Text>
      <Text>{inspectOnly ? "j/k or arrows to change quality, r to reload, b to return home, q to quit." : "j/k or arrows to change quality, Enter/p to play, r to reload, b to return home, q to quit."}</Text>
      {message ? <Text color="yellow">{message}</Text> : null}
      {lastPlan ? (
        <Text dimColor>
          Last command: {lastPlan.command} {lastPlan.args.join(" ")}
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
    return "n/a";
  }

  return `${(value / 1000).toFixed(0)} kbps`;
}

function formatCount(value?: number): string {
  if (value === undefined) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US").format(value);
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
