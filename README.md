# BBCLI

`BBCLI` is a `Node + Ink` terminal client for public and account-backed media workflows.

It currently does these things:

- opens an interactive `bbcli` home screen with a branded header and workspace shell
- lands on `Discover` by default instead of forcing site-specific subcommands
- shows Bilibili homepage recommendations in `Discover`
- searches Bilibili videos from inside the `Search` workspace
- reserves a first-class `Library` workspace for future reading and local-file flows
- keeps `Accounts` as a unified connection surface for future providers
- opens selected videos and extracts `window.__playinfo__` and `window.__INITIAL_STATE__`
- launches playback through `mpv` terminal video outputs with the priority `kitty -> sixel -> tct`
- binds provider-scoped accounts from the same Ink launcher or through CLI commands

## Requirements

- Node 20+
- `mpv` for terminal-native playback
- `ffplay` is optional and used only as a fallback when `mpv` is unavailable

## Install

Recommended global install from the GitHub tarball today:

```bash
npm install -g https://github.com/verycafe/BB-CLI/archive/main.tar.gz
```

Run it once without keeping a global install:

```bash
npm exec --yes github:verycafe/BB-CLI -- providers
```

One-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/verycafe/BB-CLI/main/install.sh | bash
```

Pin a specific ref with the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/verycafe/BB-CLI/main/install.sh | BBCLI_INSTALL_REF=v0.1.0 bash
```

Install from a GitHub Release asset when a tagged release publishes the packed `.tgz` file:

```bash
npm install -g https://github.com/verycafe/BB-CLI/releases/download/v0.1.0/verycafe-bb-cli-0.1.0.tgz
```

The installer above prefers the latest Release asset automatically and falls back to the main-branch GitHub tarball when no installable Release package is attached yet.

Local development install:

```bash
npm install
```

## Run

```bash
npm run dev
bbcli
```

Or build first:

```bash
npm run build
npm start --
```

The primary flow is now:

```bash
bbcli
```

From there you can:

- browse `Discover`
- type to jump straight into `Search`
- press `3` to inspect the future `Library` shelf
- press `4` to bind a Bilibili account inside the Ink UI
- press `Enter` on a selected result to open it

The top-level workspaces are:

- `Discover`: recommendation feeds and future connected provider timelines
- `Search`: cross-provider search lane, currently wired to Bilibili
- `Library`: future home for WeRead, local EPUB/PDF/text files, saved sessions, and reading progress
- `Accounts`: provider connection and credential management

## Useful flags

```bash
bbcli
bbcli BV17PYqerEtA --inspect
bbcli BV17PYqerEtA --vo=kitty
bbcli BV17PYqerEtA --vo=sixel
bbcli BV17PYqerEtA --vo=tct
bbcli BV17PYqerEtA --no-fast
bbcli BV17PYqerEtA --account=main
bbcli BV17PYqerEtA --provider=bilibili
```

## Account binding

Accounts are stored per provider and per name in a local config file:

```bash
~/.config/bbcli/accounts.json
```

The easiest path is now inside the launcher:

```bash
bbcli
```

Then press `3` and fill in:
Then press `4` and fill in:

- account name
- Cookie text or cookie file path
- optional note

You can still bind accounts from the command line too.

Bind a Bilibili account from an existing cookie string:

```bash
bbcli account bind bilibili --name main --cookie 'SESSDATA=...; bili_jct=...'
```

If you do not want the cookie in shell history:

```bash
pbpaste | bbcli account bind bilibili --name main --cookie-stdin --default
```

You can also import a raw Cookie string or a Netscape cookie jar from a file:

```bash
bbcli account bind bilibili --name main --cookie-file ./bilibili.cookies
```

List and inspect accounts:

```bash
bbcli account list
bbcli account show bilibili main
bbcli account check bilibili main
bbcli account check bilibili main --remote
bbcli account use bilibili main
bbcli account remove bilibili main
```

For future providers, the same account layer can store any auth headers:

```bash
bbcli account bind github --name work --header 'Authorization: Bearer ghp_xxx'
```

Inspect the currently known provider integrations:

```bash
bbcli providers
bbcli providers bilibili
```

## Notes

- Bilibili stream URLs are signed and expire, so the CLI resolves them fresh from the page each run.
- `bbcli` now treats recommendations and search as the main Bilibili entry path. BV ids and direct URLs still work, but they are no longer the only practical way in.
- `kitty` and `sixel` need a terminal that supports those graphics protocols.
- `tct` is the Unicode fallback when no graphics protocol is detected.
- The one-line installer understands `BBCLI_INSTALL_MODE=auto|release|archive`, `BBCLI_INSTALL_REF`, and `BBCLI_PREFIX`.
- Prefer GitHub tarball installs over `github:owner/repo` git installs for global usage. In this project, tarball installs have been more reliable in real npm tests.
- The current account layer is provider-agnostic. It stores named header bundles and lets each provider decide how to use them.
- Right now Bilibili is the only built-in media provider. Other provider ids can already be stored in the account layer and wired into media support later.
- `account check` performs local provider-aware validation by default. With `--remote`, providers can also run a live login probe. For Bilibili this uses [`x/web-interface/nav`](https://api.bilibili.com/x/web-interface/nav) to check whether the stored cookies still represent a logged-in session.
