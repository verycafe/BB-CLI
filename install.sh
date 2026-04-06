#!/usr/bin/env bash
set -euo pipefail

REPO_SLUG="verycafe/BB-CLI"
INSTALL_MODE="${BBCLI_INSTALL_MODE:-auto}"
INSTALL_REF="${BBCLI_INSTALL_REF:-latest}"
INSTALL_PREFIX="${BBCLI_PREFIX:-}"

log() {
  printf 'bbcli install: %s\n' "$*" >&2
}

fail() {
  printf 'bbcli install: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

read_json_field() {
  local expression="$1"
  JSON_EXPRESSION="$expression" node -e '
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const value = eval(process.env.JSON_EXPRESSION ?? "");
    if (typeof value === "string") {
      process.stdout.write(value);
    }
  } catch {
    process.exit(1);
  }
});
'
}

fetch_release_json() {
  local api_url

  if [ "$INSTALL_REF" = "latest" ]; then
    api_url="https://api.github.com/repos/${REPO_SLUG}/releases/latest"
  else
    api_url="https://api.github.com/repos/${REPO_SLUG}/releases/tags/${INSTALL_REF}"
  fi

  curl -fsSL -H 'Accept: application/vnd.github+json' "$api_url"
}

resolve_release_source() {
  local release_json asset_url tag_name

  if ! release_json="$(fetch_release_json 2>/dev/null)"; then
    return 1
  fi

  asset_url="$(
    printf '%s' "$release_json" | read_json_field '
      (() => {
        const release = JSON.parse(input);
        const asset = (release.assets || []).find((entry) => {
          return typeof entry?.name === "string"
            && entry.name.endsWith(".tgz")
            && typeof entry.browser_download_url === "string";
        });

        return asset?.browser_download_url ?? "";
      })()
    '
  )"

  if [ -z "$asset_url" ]; then
    return 1
  fi

  tag_name="$(
    printf '%s' "$release_json" | read_json_field '
      (() => {
        const release = JSON.parse(input);
        return typeof release.tag_name === "string" ? release.tag_name : "";
      })()
    '
  )"

  if [ -n "$tag_name" ]; then
    log "using GitHub Release asset from ${tag_name}"
  else
    log "using GitHub Release asset"
  fi

  printf '%s' "$asset_url"
}

resolve_git_source() {
  if [ "$INSTALL_REF" = "latest" ]; then
    printf 'github:%s' "$REPO_SLUG"
  else
    printf 'github:%s#%s' "$REPO_SLUG" "$INSTALL_REF"
  fi
}

npm_install_global() {
  local source="$1"
  local -a cmd=(npm install -g)

  if [ -n "$INSTALL_PREFIX" ]; then
    cmd+=(--prefix "$INSTALL_PREFIX")
  fi

  cmd+=("$source")

  log "installing ${source}"
  "${cmd[@]}"
}

print_success() {
  local bbcli_command="bbcli"

  if [ -n "$INSTALL_PREFIX" ] && [ -x "$INSTALL_PREFIX/bin/bbcli" ]; then
    bbcli_command="$INSTALL_PREFIX/bin/bbcli"
  fi

  log "install completed"
  printf '\nTry:\n  %s providers\n' "$bbcli_command"
}

main() {
  local install_source

  require_cmd curl
  require_cmd node
  require_cmd npm

  case "$INSTALL_MODE" in
    auto)
      if install_source="$(resolve_release_source)"; then
        :
      else
        install_source="$(resolve_git_source)"
        log "no installable GitHub Release package found; falling back to ${install_source}"
      fi
      ;;
    release)
      install_source="$(resolve_release_source)" || fail "no installable GitHub Release package found for ref '${INSTALL_REF}'"
      ;;
    git)
      install_source="$(resolve_git_source)"
      log "using GitHub repository source ${install_source}"
      ;;
    *)
      fail "unsupported BBCLI_INSTALL_MODE '${INSTALL_MODE}' (expected auto, release, or git)"
      ;;
  esac

  npm_install_global "$install_source"
  print_success
}

main "$@"
