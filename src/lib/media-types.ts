export type StreamVariant = {
  quality: number;
  label: string;
  width?: number;
  height?: number;
  videoBandwidth?: number;
  audioBandwidth?: number;
  codecLabel: string;
  videoUrl: string;
  audioUrl: string;
  expiresAt?: string;
  host: string;
};

export type VideoSession = {
  pageUrl: string;
  sourceOrigin: string;
  userAgent: string;
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  description: string;
  durationSeconds: number;
  ownerName: string;
  stats: {
    views?: number;
    likes?: number;
    danmaku?: number;
    favorites?: number;
    coins?: number;
    shares?: number;
    replies?: number;
  };
  parts: Array<{
    cid: number;
    page: number;
    part: string;
    duration: number;
  }>;
  variants: StreamVariant[];
};

export type RequestAccount = {
  provider: string;
  name: string;
  headers: Record<string, string>;
};
