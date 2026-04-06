export const BILIBILI_DESKTOP_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
export const BILIBILI_SOURCE_ORIGIN = "https://www.bilibili.com";
const SUPPORTED_CODECID_ORDER = [7, 12, 13];
export function normalizeVideoInput(input) {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error("Please provide a Bilibili video URL or a BV id.");
    }
    if (/^BV[0-9A-Za-z]+$/i.test(trimmed)) {
        return `${BILIBILI_SOURCE_ORIGIN}/video/BV${trimmed.slice(2)}/`;
    }
    try {
        const parsed = new URL(trimmed);
        if (!parsed.hostname.endsWith("bilibili.com")) {
            throw new Error("Only bilibili.com video URLs are supported right now.");
        }
        return parsed.toString();
    }
    catch (error) {
        if (error instanceof TypeError) {
            throw new Error("Input must be a valid Bilibili video URL or a BV id.");
        }
        throw error;
    }
}
export async function fetchVideoSession(input, account) {
    const pageUrl = normalizeVideoInput(input);
    const html = await fetchHtml(pageUrl, account);
    const playInfo = extractJsonObject(html, "window.__playinfo__=");
    const initialState = extractJsonObject(html, "window.__INITIAL_STATE__=");
    return buildVideoSession(pageUrl, playInfo.data, initialState.videoData);
}
export async function searchVideos(query, account) {
    const params = new URLSearchParams({
        search_type: "video",
        keyword: query.trim(),
        page: "1",
        page_size: "10",
    });
    const url = `https://api.bilibili.com/x/web-interface/search/type?${params.toString()}`;
    const response = await fetch(url, {
        headers: {
            "user-agent": BILIBILI_DESKTOP_USER_AGENT,
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
            referer: `${BILIBILI_SOURCE_ORIGIN}/`,
            origin: BILIBILI_SOURCE_ORIGIN,
            ...buildBilibiliRequestHeaders(account),
        },
    });
    if (!response.ok) {
        throw new Error(`Bilibili search failed with HTTP ${response.status} ${response.statusText}.`);
    }
    const payload = (await response.json());
    if (payload.code !== 0) {
        throw new Error(`Bilibili search failed: ${payload.message ?? `code ${payload.code ?? "unknown"}`}`);
    }
    return (payload.data?.result ?? [])
        .map((item) => buildSearchResult(item))
        .filter((item) => item !== undefined);
}
export async function fetchRecommendedVideos(account) {
    const params = new URLSearchParams({
        fresh_type: "4",
        ps: "12",
        fresh_idx: "1",
        fresh_idx_1h: "1",
        version: "1",
        feed_version: "V8",
        homepage_ver: "1",
    });
    const url = `https://api.bilibili.com/x/web-interface/index/top/feed/rcmd?${params.toString()}`;
    const response = await fetch(url, {
        headers: {
            "user-agent": BILIBILI_DESKTOP_USER_AGENT,
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
            referer: `${BILIBILI_SOURCE_ORIGIN}/`,
            origin: BILIBILI_SOURCE_ORIGIN,
            ...buildBilibiliRequestHeaders(account),
        },
    });
    if (!response.ok) {
        throw new Error(`Bilibili recommendations failed with HTTP ${response.status} ${response.statusText}.`);
    }
    const payload = (await response.json());
    if (payload.code !== 0) {
        throw new Error(`Bilibili recommendations failed: ${payload.message ?? `code ${payload.code ?? "unknown"}`}`);
    }
    const results = [];
    for (const item of payload.data?.item ?? []) {
        const bvid = item.bvid ?? item.uri?.match(/BV[0-9A-Za-z]+/i)?.[0];
        if (!bvid) {
            continue;
        }
        results.push({
            providerId: "bilibili",
            providerLabel: "Bilibili",
            title: cleanSearchText(item.title) || bvid,
            ownerName: cleanSearchText(item.owner?.name) || "Unknown uploader",
            durationSeconds: item.duration,
            viewCount: item.stat?.view,
            publishedAt: item.pubdate ? new Date(item.pubdate * 1000).toISOString() : undefined,
            targetInput: bvid,
            pageUrl: `${BILIBILI_SOURCE_ORIGIN}/video/${bvid}/`,
        });
    }
    return results;
}
async function fetchHtml(url, account) {
    const response = await fetch(url, {
        headers: {
            "user-agent": BILIBILI_DESKTOP_USER_AGENT,
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
            referer: BILIBILI_SOURCE_ORIGIN,
            ...buildBilibiliRequestHeaders(account),
        },
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
}
function buildBilibiliRequestHeaders(account) {
    if (!account || account.provider !== "bilibili") {
        return {};
    }
    return normalizeRequestHeaders(account.headers);
}
function normalizeRequestHeaders(headers) {
    return Object.fromEntries(Object.entries(headers).filter(([, value]) => value.trim().length > 0));
}
function buildVideoSession(pageUrl, playData, videoData) {
    const videoTracks = playData.dash?.video ?? [];
    const audioTracks = playData.dash?.audio ?? [];
    if (videoTracks.length === 0 || audioTracks.length === 0) {
        throw new Error("This page did not expose a playable DASH video/audio pair.");
    }
    const bestAudio = chooseBestAudio(audioTracks);
    const variants = buildVariants(playData, videoTracks, bestAudio);
    if (variants.length === 0) {
        throw new Error("No supported stream variants were found on the page.");
    }
    return {
        pageUrl,
        sourceOrigin: BILIBILI_SOURCE_ORIGIN,
        userAgent: BILIBILI_DESKTOP_USER_AGENT,
        bvid: videoData.bvid,
        aid: videoData.aid,
        cid: videoData.cid,
        title: videoData.title,
        description: videoData.desc,
        durationSeconds: Math.round(playData.timelength / 1000) || videoData.duration,
        ownerName: videoData.owner?.name ?? "Unknown uploader",
        stats: {
            views: videoData.stat?.view,
            likes: videoData.stat?.like,
            danmaku: videoData.stat?.danmaku,
            favorites: videoData.stat?.favorite,
            coins: videoData.stat?.coin,
            shares: videoData.stat?.share,
            replies: videoData.stat?.reply,
        },
        parts: videoData.pages ?? [],
        variants,
    };
}
function buildVariants(playData, videoTracks, audioTrack) {
    const formatIndex = new Map();
    for (const format of playData.support_formats ?? []) {
        formatIndex.set(format.quality, format);
    }
    const grouped = new Map();
    for (const track of videoTracks) {
        const list = grouped.get(track.id) ?? [];
        list.push(track);
        grouped.set(track.id, list);
    }
    return Array.from(grouped.entries())
        .sort((left, right) => right[0] - left[0])
        .map(([quality, tracks]) => {
        const video = chooseBestVideo(tracks);
        const format = formatIndex.get(quality);
        const videoUrl = trackUrl(video);
        const audioUrl = trackUrl(audioTrack);
        return {
            quality,
            label: buildVariantLabel(quality, format, video),
            width: video.width,
            height: video.height,
            videoBandwidth: video.bandwidth,
            audioBandwidth: audioTrack.bandwidth,
            codecLabel: buildCodecLabel(video, audioTrack),
            videoUrl,
            audioUrl,
            expiresAt: extractExpiry(videoUrl),
            host: new URL(videoUrl).host,
        };
    });
}
function chooseBestAudio(tracks) {
    return [...tracks].sort((left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
}
function chooseBestVideo(tracks) {
    return [...tracks].sort((left, right) => {
        const codecBias = codecScore(right.codecid) - codecScore(left.codecid);
        if (codecBias !== 0) {
            return codecBias;
        }
        return (right.bandwidth ?? 0) - (left.bandwidth ?? 0);
    })[0];
}
function codecScore(codecid) {
    const index = SUPPORTED_CODECID_ORDER.indexOf(codecid ?? -1);
    return index === -1 ? -SUPPORTED_CODECID_ORDER.length : SUPPORTED_CODECID_ORDER.length - index;
}
function buildVariantLabel(quality, format, track) {
    const base = format?.new_description ?? format?.display_desc ?? `${quality}P`;
    const size = track.width && track.height ? `${track.width}x${track.height}` : "unknown size";
    return `${base}  ${size}`;
}
function buildCodecLabel(video, audio) {
    const videoCodec = simplifyCodec(video.codecs);
    const audioCodec = simplifyCodec(audio.codecs);
    return `${videoCodec} + ${audioCodec}`;
}
function simplifyCodec(value) {
    if (!value) {
        return "unknown";
    }
    if (value.startsWith("avc1")) {
        return "H.264";
    }
    if (value.startsWith("hev1")) {
        return "HEVC";
    }
    if (value.startsWith("mp4a")) {
        return "AAC";
    }
    return value;
}
function trackUrl(track) {
    const url = track.baseUrl ?? track.base_url;
    if (!url) {
        throw new Error("Stream track is missing a usable URL.");
    }
    return url;
}
function extractExpiry(url) {
    const deadline = new URL(url).searchParams.get("deadline");
    if (!deadline) {
        return undefined;
    }
    const seconds = Number.parseInt(deadline, 10);
    if (Number.isNaN(seconds)) {
        return undefined;
    }
    return new Date(seconds * 1000).toISOString();
}
function extractJsonObject(html, marker) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error(`Could not find ${marker} in the page HTML.`);
    }
    let current = markerIndex + marker.length;
    while (/\s/.test(html[current] ?? "")) {
        current += 1;
    }
    if (html[current] !== "{") {
        throw new Error(`Expected a JSON object after ${marker}.`);
    }
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    for (let index = current; index < html.length; index += 1) {
        const char = html[index];
        if (inString) {
            if (isEscaped) {
                isEscaped = false;
            }
            else if (char === "\\") {
                isEscaped = true;
            }
            else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
            continue;
        }
        if (char === "{") {
            depth += 1;
            continue;
        }
        if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                const json = html.slice(current, index + 1);
                return JSON.parse(json);
            }
        }
    }
    throw new Error(`Unterminated JSON object for ${marker}.`);
}
function buildSearchResult(item) {
    const bvid = extractBvid(item);
    if (!bvid) {
        return undefined;
    }
    const pageUrl = `${BILIBILI_SOURCE_ORIGIN}/video/${bvid}/`;
    return {
        providerId: "bilibili",
        providerLabel: "Bilibili",
        title: cleanSearchText(item.title) || bvid,
        description: cleanSearchText(item.description),
        ownerName: cleanSearchText(item.author) || "Unknown uploader",
        durationSeconds: parseDurationText(item.duration),
        viewCount: item.play,
        publishedAt: item.pubdate ? new Date(item.pubdate * 1000).toISOString() : undefined,
        targetInput: bvid,
        pageUrl,
    };
}
function extractBvid(item) {
    if (item.bvid && /^BV[0-9A-Za-z]+$/i.test(item.bvid)) {
        return item.bvid;
    }
    const arcurl = item.arcurl ?? "";
    const match = arcurl.match(/BV[0-9A-Za-z]+/i);
    return match?.[0];
}
function cleanSearchText(value) {
    if (!value) {
        return undefined;
    }
    return value
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}
function parseDurationText(value) {
    if (!value) {
        return undefined;
    }
    const parts = value
        .split(":")
        .map((part) => Number.parseInt(part, 10))
        .filter((part) => !Number.isNaN(part));
    if (parts.length === 0) {
        return undefined;
    }
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    return parts[0];
}
