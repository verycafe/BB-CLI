# BBCLI

`BBCLI` 是一个基于 `Node + Ink` 的终端内容工具箱。

它现在的核心方向不是“记一堆命令参数”，而是：

- 直接运行 `bbcli`，进入带品牌头图的首页启动器
- 先看一级菜单，再进入二级工作区
- 以“发现 / 搜索 / 书库 / 账号”作为统一交互骨架
- 先把哔哩哔哩跑顺，同时为后续接入微信读书、YouTube、Google、本地文件等能力留出结构位

## 当前能力

- 启动后显示带兔子头图和 Logo 的交互首页
- 默认从“发现”进入，而不是强迫用户先记站点子命令
- 在“发现”里查看哔哩哔哩首页推荐视频
- 在“搜索”里搜索哔哩哔哩视频，或直接粘贴链接打开
- 在“书库”里直接扫描并阅读本地 EPUB、PDF、TXT、Markdown、HTML、DOCX
- 用统一的“账号”工作区管理各个平台身份
- 抓取视频页里的 `window.__playinfo__` 和 `window.__INITIAL_STATE__`
- 优先通过 `mpv` 的终端输出模式播放：`kitty -> sixel -> tct`
- 在 Ink 交互界面里直接绑定平台账号，也支持命令行绑定

## 环境要求

- Node 20+
- `mpv`，如果你希望在终端里直接播放视频
- `ffplay` 可选，只会在你明确允许外部播放器时作为回退方案

## 安装

当前最推荐的安装方式是直接通过 GitHub 压缩包走 `npm`：

```bash
npm install -g https://github.com/verycafe/BB-CLI/archive/main.tar.gz
```

在支持的系统上，安装过程会自动检测并尝试安装 `mpv`：

- macOS：`Homebrew`
- Linux：`apt-get / dnf / pacman / zypper`

如果你不希望安装时自动处理 `mpv`，可以显式跳过：

```bash
BBCLI_SKIP_MPV_INSTALL=1 npm install -g https://github.com/verycafe/BB-CLI/archive/main.tar.gz
```

如果你只想临时试一下，不保留全局安装：

```bash
npm exec --yes github:verycafe/BB-CLI -- providers
```

一键安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/verycafe/BB-CLI/main/install.sh | bash
```

同样也支持跳过自动安装 `mpv`：

```bash
curl -fsSL https://raw.githubusercontent.com/verycafe/BB-CLI/main/install.sh | BBCLI_SKIP_MPV_INSTALL=1 bash
```

如果要安装指定版本或指定标签：

```bash
curl -fsSL https://raw.githubusercontent.com/verycafe/BB-CLI/main/install.sh | BBCLI_INSTALL_REF=v0.1.0 bash
```

如果未来某个 GitHub Release 附带了 `.tgz` 安装包，也可以直接这样装：

```bash
npm install -g https://github.com/verycafe/BB-CLI/releases/download/v0.1.0/verycafe-bb-cli-0.1.0.tgz
```

安装脚本会优先尝试最新的 GitHub Release 安装包；如果还没有可安装资产，就自动回退到 `main` 分支压缩包。

本地开发安装：

```bash
npm install
```

## 启动

最主要的使用方式现在就是：

```bash
bbcli
```

本地开发时可以这样跑：

```bash
npm run dev
```

或者先构建再启动：

```bash
npm run build
npm start --
```

## 首页交互

启动 `bbcli` 后，你会先进入一级菜单，而不是直接掉进某个站点列表页。

当前首页结构：

- `发现`
- `搜索`
- `书库`
- `账号`

一级菜单操作：

- `← / →`：切换顶部菜单
- `Enter`：进入当前二级界面
- 直接输入文字：从首页直接跳进“搜索”

## 二级界面交互

### 发现

- 查看哔哩哔哩首页推荐
- `↑ / ↓` 选择视频
- `Enter` 打开当前视频
- `r` 刷新推荐流
- `b` 返回首页

### 搜索

- 直接输入关键词
- 也可以粘贴哔哩哔哩视频链接
- 回车后会先尝试识别链接；如果不是链接，就执行搜索
- `↑ / ↓` 选择搜索结果
- `Enter` 打开当前结果
- `Esc` 返回首页

### 书库

- 自动扫描当前目录、`~/Books`、`~/Documents`、`~/Downloads`、`~/Desktop`
- 当前支持打开 EPUB、PDF、TXT、Markdown、HTML、DOCX、RTF 等常见本地书籍格式
- `↑ / ↓` 选书
- `Enter` 进入阅读
- `r` 刷新书架
- 阅读器里可用 `↑ / ↓` 微调、`Space / PgDn` 翻页、`u / PgUp` 上翻、`g / G` 首尾跳转、`Esc` 返回书库

### 账号

- 当前已支持哔哩哔哩账号绑定
- 后续会继续接微信读书、YouTube、Google 等平台
- `[` / `]`：切换平台
- `Tab`：切换表单字段
- `Enter`：保存绑定
- `Esc` 返回首页

## 常用命令

虽然主路径已经是 `bbcli` 首页，但命令行入口仍然保留，方便脚本和快速调试：

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

## 账号绑定

账号按“平台 + 名称”存储在本地：

```bash
~/.config/bbcli/accounts.json
```

最推荐的绑定方式是直接在启动器里完成：

```bash
bbcli
```

进入“账号”后填写：

- 账号名
- Cookie 文本或 Cookie 文件路径
- 可选备注

如果平台多起来了，可以在“账号”页用 `[` 和 `]` 切换不同平台。

当然，也可以继续走命令行方式：

从已有 Cookie 文本绑定一个哔哩哔哩账号：

```bash
bbcli account bind bilibili --name main --cookie 'SESSDATA=...; bili_jct=...'
```

如果你不想把 Cookie 留在 shell 历史里：

```bash
pbpaste | bbcli account bind bilibili --name main --cookie-stdin --default
```

从文件导入原始 Cookie 文本或 Netscape 格式的 Cookie 文件：

```bash
bbcli account bind bilibili --name main --cookie-file ./bilibili.cookies
```

查看和检查账号：

```bash
bbcli account list
bbcli account show bilibili main
bbcli account check bilibili main
bbcli account check bilibili main --remote
bbcli account use bilibili main
bbcli account remove bilibili main
```

这套账号层是通用的，所以未来别的平台也能直接复用：

```bash
bbcli account bind github --name work --header 'Authorization: Bearer ghp_xxx'
```

查看当前内置平台：

```bash
bbcli providers
bbcli providers bilibili
```

## 说明

- 哔哩哔哩的码流链接是带签名、会过期的，所以每次运行都会重新解析页面。
- 现在 `bbcli` 的主入口已经是“推荐 + 搜索”，`BV` 和直链仍然可用，但不再是唯一入口。
- `kitty` 和 `sixel` 需要你的终端支持对应图形协议。
- `tct` 是不支持图形协议时的 Unicode 回退模式。
- 一键安装脚本支持 `BBCLI_INSTALL_MODE=auto|release|archive`、`BBCLI_INSTALL_REF` 和 `BBCLI_PREFIX`。
- 包安装阶段会自动尝试补齐 `mpv`；如果你不想这样做，可以设置 `BBCLI_SKIP_MPV_INSTALL=1`。
- 这个项目当前更推荐 GitHub 压缩包安装，而不是 `github:owner/repo` 形式的 git 安装。
- 当前账号层是平台无关的，本质上是在存命名的请求头组合，由各个平台自己决定如何使用。
- 目前内置媒体平台只有哔哩哔哩，但账号层已经能先存其他平台的身份信息。
- `account check` 默认做本地校验；加上 `--remote` 后，会在支持的平台上做远程登录探针。对哔哩哔哩来说，这会调用 [`x/web-interface/nav`](https://api.bilibili.com/x/web-interface/nav) 检查 Cookie 是否仍然代表已登录账号。
