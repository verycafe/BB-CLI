import {
  BILIBILI_DESKTOP_USER_AGENT,
  BILIBILI_SOURCE_ORIGIN,
  fetchVideoSession,
  normalizeVideoInput,
} from "../lib/bilibili.js";
import {parseCookieHeader} from "../lib/cookies.js";
import type {MediaProvider} from "./types.js";

export const bilibiliProvider: MediaProvider = {
  descriptor: {
    id: "bilibili",
    label: "Bilibili",
    supportsMedia: true,
    supportsAccounts: true,
    authHint: "Bind browser session cookies so BBCLI can send authenticated requests when needed.",
    detectionHint: "Recognizes BV ids and bilibili.com video URLs.",
    accountFields: [
      {
        key: "Cookie",
        label: "Cookie",
        required: true,
        secret: true,
        description: "Logged-in browser cookies such as SESSDATA and bili_jct, sent as the Cookie request header.",
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
  validateAccountHeaders(headers) {
    if (!headers.Cookie) {
      throw new Error("Bilibili account bindings require a Cookie header.");
    }
  },
  inspectAccountHeaders(headers) {
    const diagnostics: Array<{level: "ok" | "warning" | "error"; message: string}> = [];
    const cookieHeader = headers.Cookie;

    if (!cookieHeader) {
      diagnostics.push({
        level: "error",
        message: "Missing Cookie header.",
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
        message: "SESSDATA is present.",
      });
    } else {
      diagnostics.push({
        level: "error",
        message: "SESSDATA is missing. Logged-in requests usually will not work without it.",
      });
    }

    if (biliJct) {
      diagnostics.push({
        level: "ok",
        message: "bili_jct is present.",
      });
    } else {
      diagnostics.push({
        level: "warning",
        message: "bili_jct is missing. Some state-changing requests may fail CSRF validation.",
      });
    }

    if (dedeUserId) {
      diagnostics.push({
        level: "ok",
        message: "DedeUserID is present.",
      });
    } else {
      diagnostics.push({
        level: "warning",
        message: "DedeUserID is missing. Some account-specific requests may have less context.",
      });
    }

    diagnostics.push({
      level: "ok",
      message: `Cookie keys parsed: ${Array.from(cookies.keys()).sort().join(", ") || "none"}`,
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
            message: `Remote probe failed with HTTP ${response.status} ${response.statusText}.`,
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
      `API code: ${payload.code ?? "unknown"}`,
      `API message: ${payload.message ?? "unknown"}`,
    ];

    if (payload.data?.ip_region) {
      summaryLines.push(`IP region: ${payload.data.ip_region}`);
    }

    if (payload.code === 0 && payload.data?.isLogin) {
      const diagnostics = [
        {
          level: "ok" as const,
          message: "Remote login probe says the account is logged in.",
        },
      ];

      if (payload.data.uname) {
        diagnostics.push({
          level: "ok" as const,
          message: `Remote user: ${payload.data.uname}${payload.data.mid ? ` (mid ${payload.data.mid})` : ""}.`,
        });
      }

      if (payload.data.money !== undefined) {
        diagnostics.push({
          level: "ok" as const,
          message: `B coin balance: ${payload.data.money}.`,
        });
      }

      return {diagnostics, summaryLines};
    }

    return {
      diagnostics: [
        {
          level: "error",
          message: `Remote login probe says the account is not logged in${payload.message ? `: ${payload.message}` : "."}`,
        },
      ],
      summaryLines,
    };
  },
};
