import {
  BILIBILI_DESKTOP_USER_AGENT,
  BILIBILI_SOURCE_ORIGIN,
  fetchVideoSession,
  fetchRecommendedVideos,
  normalizeVideoInput,
  searchVideos,
} from "../lib/bilibili.js";
import {parseCookieHeader} from "../lib/cookies.js";
import type {MediaProvider} from "./types.js";

export const bilibiliProvider: MediaProvider = {
  descriptor: {
    id: "bilibili",
    label: "哔哩哔哩",
    supportsMedia: true,
    supportsAccounts: true,
    authHint: "绑定浏览器登录态 Cookie，这样 BBCLI 在需要时就能发起带身份的请求。",
    detectionHint: "支持识别 BV 号和 bilibili.com 视频链接。",
    accountFields: [
      {
        key: "Cookie",
        label: "Cookie",
        required: true,
        secret: true,
        description: "浏览器登录后的 Cookie，例如 SESSDATA 和 bili_jct，作为 Cookie 请求头发送。",
      },
    ],
    examples: [
      "BV17PYqerEtA",
      "https://www.bilibili.com/video/BV17PYqerEtA/",
    ],
  },
  detect(input) {
    const trimmed = input.trim();
    if (/^BV[0-9A-Za-z]+$/i.test(trimmed)) {
      return true;
    }

    try {
      const parsed = new URL(trimmed);
      return parsed.hostname.endsWith("bilibili.com");
    } catch {
      return false;
    }
  },
  normalizeInput(input) {
    return normalizeVideoInput(input);
  },
  async loadSession(normalizedInput, account) {
    return fetchVideoSession(normalizedInput, account);
  },
  async search(query, account) {
    return searchVideos(query, account);
  },
  async getRecommendations(account) {
    return fetchRecommendedVideos(account);
  },
  validateAccountHeaders(headers) {
    if (!headers.Cookie) {
      throw new Error("哔哩哔哩账号绑定必须提供 Cookie 请求头。");
    }
  },
  inspectAccountHeaders(headers) {
    const diagnostics: Array<{level: "ok" | "warning" | "error"; message: string}> = [];
    const cookieHeader = headers.Cookie;

    if (!cookieHeader) {
      diagnostics.push({
        level: "error",
        message: "缺少 Cookie 请求头。",
      });
      return diagnostics;
    }

    const cookies = parseCookieHeader(cookieHeader);
    const sessdata = cookies.get("SESSDATA");
    const biliJct = cookies.get("bili_jct");
    const dedeUserId = cookies.get("DedeUserID");

    if (sessdata) {
      diagnostics.push({
        level: "ok",
        message: "已检测到 SESSDATA。",
      });
    } else {
      diagnostics.push({
        level: "error",
        message: "缺少 SESSDATA。没有它，登录态请求通常无法正常工作。",
      });
    }

    if (biliJct) {
      diagnostics.push({
        level: "ok",
        message: "已检测到 bili_jct。",
      });
    } else {
      diagnostics.push({
        level: "warning",
        message: "缺少 bili_jct。部分会修改状态的请求可能无法通过 CSRF 校验。",
      });
    }

    if (dedeUserId) {
      diagnostics.push({
        level: "ok",
        message: "已检测到 DedeUserID。",
      });
    } else {
      diagnostics.push({
        level: "warning",
        message: "缺少 DedeUserID。部分账号相关请求可能缺少上下文。",
      });
    }

    diagnostics.push({
      level: "ok",
      message: `已解析到的 Cookie 键：${Array.from(cookies.keys()).sort().join(", ") || "无"}`,
    });

    return diagnostics;
  },
  async checkAccountRemotely(account) {
    const response = await fetch("https://api.bilibili.com/x/web-interface/nav", {
      headers: {
        "user-agent": BILIBILI_DESKTOP_USER_AGENT,
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        referer: BILIBILI_SOURCE_ORIGIN,
        origin: BILIBILI_SOURCE_ORIGIN,
        ...account.headers,
      },
    });

    if (!response.ok) {
      return {
        diagnostics: [
          {
            level: "error",
            message: `远程探针失败：HTTP ${response.status} ${response.statusText}。`,
          },
        ],
      };
    }

    const payload = (await response.json()) as {
      code?: number;
      message?: string;
      data?: {
        isLogin?: boolean;
        uname?: string;
        mid?: number;
        money?: number;
        ip_region?: string;
      };
    };

    const summaryLines = [
      `接口返回码：${payload.code ?? "未知"}`,
      `接口消息：${payload.message ?? "未知"}`,
    ];

    if (payload.data?.ip_region) {
      summaryLines.push(`IP 地区：${payload.data.ip_region}`);
    }

    if (payload.code === 0 && payload.data?.isLogin) {
      const diagnostics = [
        {
          level: "ok" as const,
          message: "远程探针确认当前账号已登录。",
        },
      ];

      if (payload.data.uname) {
        diagnostics.push({
          level: "ok" as const,
          message: `远程账号：${payload.data.uname}${payload.data.mid ? `（mid ${payload.data.mid}）` : ""}。`,
        });
      }

      if (payload.data.money !== undefined) {
        diagnostics.push({
          level: "ok" as const,
          message: `B 币余额：${payload.data.money}。`,
        });
      }

      return {diagnostics, summaryLines};
    }

    return {
      diagnostics: [
        {
          level: "error",
          message: `远程探针显示当前账号未登录${payload.message ? `：${payload.message}` : "。"}`,
        },
      ],
      summaryLines,
    };
  },
};
