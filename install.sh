#!/usr/bin/env bash
set -euo pipefail

REPO_SLUG="verycafe/BB-CLI"
INSTALL_MODE="${BBCLI_INSTALL_MODE:-auto}"
INSTALL_REF="${BBCLI_INSTALL_REF:-latest}"
INSTALL_PREFIX="${BBCLI_PREFIX:-}"

log() {
  printf 'bbcli 安装：%s\n' "$*" >&2
}

fail() {
  printf 'bbcli 安装：%s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少必需命令：$1"
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
    log "使用 GitHub Release 资产：${tag_name}"
  else
    log "使用 GitHub Release 资产"
  fi

  printf '%s' "$asset_url"
}

resolve_archive_source() {
  if [ "$INSTALL_REF" = "latest" ]; then
    printf 'https://codeload.github.com/%s/tar.gz/main' "$REPO_SLUG"
  else
    printf 'https://codeload.github.com/%s/tar.gz/%s' "$REPO_SLUG" "$INSTALL_REF"
  fi
}

npm_install_global() {
  local source="$1"
  local -a cmd=(npm install -g)

  if [ -n "$INSTALL_PREFIX" ]; then
    cmd+=(--prefix "$INSTALL_PREFIX")
  fi

  cmd+=("$source")

  log "正在安装：${source}"
  "${cmd[@]}"
}

print_success() {
  local bbcli_command="bbcli"

  if [ -n "$INSTALL_PREFIX" ] && [ -x "$INSTALL_PREFIX/bin/bbcli" ]; then
    bbcli_command="$INSTALL_PREFIX/bin/bbcli"
  fi

  log "安装完成"
  printf '\n现在可以运行：\n  %s\n' "$bbcli_command"

  if ! command -v mpv >/dev/null 2>&1; then
    printf '\n终端内播放需要 mpv，但当前机器还没有安装。\n' >&2

    if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
      printf '可以这样安装：\n  brew install mpv ffmpeg\n' >&2
    else
      printf '请先用系统包管理器安装 mpv，再尝试播放视频。\n' >&2
    fi

    printf 'BBCLI 默认会停留在终端模式，不会自动弹出单独的 ffplay 窗口。\n' >&2
  fi
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
        install_source="$(resolve_archive_source)"
        log "没有找到可安装的 GitHub Release 包，回退到 ${install_source}"
      fi
      ;;
    release)
      install_source="$(resolve_release_source)" || fail "没有找到 ref='${INSTALL_REF}' 对应的可安装 GitHub Release 包"
      ;;
    archive)
      install_source="$(resolve_archive_source)"
      log "使用 GitHub 压缩包源：${install_source}"
      ;;
    *)
      fail "不支持的 BBCLI_INSTALL_MODE：'${INSTALL_MODE}'，可选值为 auto、release、archive"
      ;;
  esac

  npm_install_global "$install_source"
  print_success
}

main "$@"
