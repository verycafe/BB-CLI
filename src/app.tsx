import React, {startTransition, useEffect, useState} from "react";
import {Box, Newline, Text, useApp, useInput} from "ink";

import type {RequestAccount, VideoSession} from "./lib/media-types.js";
import {loadMediaSession, type MediaTarget} from "./lib/providers.js";
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
  account?: RequestAccount;
};

type AppState =
  | {status: "idle"}
  | {status: "loading"}
  | {status: "ready"; session: VideoSession; support: PlayerSupport; selectedIndex: number; lastPlan?: LaunchPlan; message?: string}
  | {status: "playing"; session: VideoSession; support: PlayerSupport; selectedIndex: number; message: string}
  | {status: "error"; error: string};

export default function App({target, inspectOnly, preferredVo, useFastProfile, account}: Props) {
  const {exit} = useApp();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<AppState>(() => {
    if (!target) {
      return {status: "idle"};
    }

    return {status: "loading"};
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
      setState({status: "loading"});
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
      const variant = state.session.variants[state.selectedIndex]!;
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
        } catch (error) {
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
    return <IdleScreen />;
  }

  if (state.status === "loading") {
    return <LoadingScreen target={target!} />;
  }

  if (state.status === "error") {
    return <ErrorScreen error={state.error} />;
  }

  if (state.status === "playing") {
    return (
      <Box flexDirection="column">
        <Text color="green">{state.message}</Text>
        <Text dimColor>Return here after the player exits.</Text>
      </Box>
    );
  }

  return (
    <Dashboard
      session={state.session}
      support={state.support}
      selectedIndex={state.selectedIndex}
      inspectOnly={inspectOnly}
      target={target}
      account={account}
      message={state.message}
      lastPlan={state.lastPlan}
    />
  );
}

function IdleScreen() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">BBCLI</Text>
      <Text>{"Usage: bbcli <bilibili-url-or-bvid>"}</Text>
      <Text dimColor>Example: `bbcli BV17PYqerEtA`</Text>
      <Text dimColor>Try `bbcli providers` or `bbcli account list`.</Text>
      <Text dimColor>Press `q` to quit.</Text>
    </Box>
  );
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
      <Text dimColor>Press `Enter`, `Esc`, or `q` to quit.</Text>
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
        <Text key={index} dimColor>
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
      <Text>{inspectOnly ? "j/k or arrows to change quality, r to reload, q to quit." : "j/k or arrows to change quality, Enter/p to play, r to reload, q to quit."}</Text>
      {message ? <Text color="yellow">{message}</Text> : null}
      {lastPlan ? (
        <Text dimColor>
          Last command: {lastPlan.command} {lastPlan.args.join(" ")}
        </Text>
      ) : null}
    </Box>
  );
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
