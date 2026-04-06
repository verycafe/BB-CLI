export function parseCookieInput(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("Cookie input was empty.");
    }
    if (looksLikeNetscapeCookieJar(trimmed)) {
        const cookies = parseNetscapeCookieJar(trimmed);
        if (cookies.length === 0) {
            throw new Error("No usable cookies were found in the cookie jar.");
        }
        return buildCookieHeader(cookies);
    }
    return stripCookieHeaderPrefix(trimmed);
}
export function parseCookieHeader(header) {
    const trimmed = stripCookieHeaderPrefix(header);
    const result = new Map();
    for (const part of trimmed.split(";")) {
        const segment = part.trim();
        if (!segment) {
            continue;
        }
        const separatorIndex = segment.indexOf("=");
        if (separatorIndex === -1) {
            continue;
        }
        const name = segment.slice(0, separatorIndex).trim();
        const value = segment.slice(separatorIndex + 1).trim();
        if (!name) {
            continue;
        }
        result.set(name, value);
    }
    return result;
}
export function buildCookieHeader(cookies) {
    const map = new Map();
    for (const cookie of cookies) {
        if (cookie.name.trim().length === 0) {
            continue;
        }
        map.set(cookie.name.trim(), cookie.value.trim());
    }
    return Array.from(map.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}
function looksLikeNetscapeCookieJar(value) {
    return value.includes("# Netscape HTTP Cookie File") || /\t(TRUE|FALSE)\t/.test(value);
}
function parseNetscapeCookieJar(raw) {
    const cookies = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const parts = line.split("\t");
        if (parts.length < 7) {
            continue;
        }
        const name = parts[5]?.trim() ?? "";
        const value = parts[6]?.trim() ?? "";
        if (!name) {
            continue;
        }
        cookies.push({ name, value });
    }
    return cookies;
}
function stripCookieHeaderPrefix(value) {
    return value.replace(/^cookie\s*:\s*/i, "").trim();
}
