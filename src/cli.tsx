#!/usr/bin/env node
import React from "react";
import {render} from "ink";
import meow from "meow";

import App from "./app.js";
import {runAccountCommand, type AccountCommand} from "./lib/account-cli.js";
import {buildHeadersFromAccount, resolveAccount} from "./lib/accounts.js";
import type {PlayerVo} from "./lib/player.js";
import {printProvidersSummary, resolveMediaTarget} from "./lib/providers.js";

const cli = meow(
  `
  Usage
    $ bbcli <bilibili-url-or-bvid>
    $ bbcli providers [id]
    $ bbcli account <bind|list|show|use|remove|check> ...

  Options
    --inspect     Load page data without launching a player
    --vo          Force mpv output mode: auto | kitty | sixel | tct
    --no-fast     Disable mpv --profile=sw-fast
    --account     Select an account name for the active provider
    --provider    Provider name for account commands
    --name        Account name for account commands
    --cookie      Bind a raw Cookie header to an account
    --cookie-file Import Cookie text or a Netscape cookie jar from a file
    --cookie-stdin  Read the cookie value from stdin
    --remote      Run a provider-specific remote account probe when supported
    --token       Bind a bearer token to an account
    --token-stdin Read the bearer token from stdin
    --header      Bind an extra header, repeatable, format: 'Key: Value'
    --note        Optional note attached to an account
    --default     Make the bound account the provider default

  Examples
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
`,
  {
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
  },
);

const vo = parseVo(cli.flags.vo);

try {
  await main();
} catch (error) {
  handleCliError(error);
}

async function main(): Promise<void> {
  if (cli.input[0] === "account") {
    const command = cli.input[1] as AccountCommand | undefined;
    if (!command) {
      throw new Error("Missing account subcommand.");
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
  const target = mediaInput ? resolveMediaTarget(mediaInput, cli.flags.provider) : undefined;
  const selectedAccount = target
    ? await resolveAccount(target.providerId, cli.flags.account)
    : undefined;
  const requestAccount = selectedAccount
    ? {
        provider: selectedAccount.account.provider,
        name: selectedAccount.account.name,
        headers: buildHeadersFromAccount(selectedAccount.account),
      }
    : undefined;

  render(
    <App
      target={target}
      inspectOnly={cli.flags.inspect}
      preferredVo={vo}
      useFastProfile={cli.flags.fast}
      account={requestAccount}
    />,
  );
}

function parseVo(value: string): PlayerVo {
  if (value === "auto" || value === "kitty" || value === "sixel" || value === "tct") {
    return value;
  }

  throw new Error(`Unsupported --vo value: ${value}`);
}

function handleCliError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`bbcli: ${message}`);
  process.exit(1);
}
