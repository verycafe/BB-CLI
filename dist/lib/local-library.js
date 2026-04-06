import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export const LOCAL_LIBRARY_STORE_VERSION = 1;
const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_RESULTS = 80;
const IGNORED_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    ".cache",
]);
const BOOK_FORMATS = {
    ".txt": { id: "txt", label: "TXT" },
    ".md": { id: "markdown", label: "Markdown" },
    ".markdown": { id: "markdown", label: "Markdown" },
    ".html": { id: "html", label: "HTML" },
    ".htm": { id: "html", label: "HTML" },
    ".xhtml": { id: "html", label: "HTML" },
    ".epub": { id: "epub", label: "EPUB" },
    ".pdf": { id: "pdf", label: "PDF" },
    ".rtf": { id: "rtf", label: "RTF" },
    ".docx": { id: "docx", label: "DOCX" },
    ".doc": { id: "doc", label: "DOC" },
    ".odt": { id: "odt", label: "ODT" },
};
export async function listLocalBooks(limit = MAX_SCAN_RESULTS) {
    const sources = await listLocalLibrarySources();
    const books = new Map();
    for (const source of sources) {
        await scanSource(source, limit, books);
        if (books.size >= limit) {
            break;
        }
    }
    const sortedBooks = [...books.values()].sort((left, right) => {
        return new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
    });
    return {
        books: sortedBooks.slice(0, limit),
        sources,
    };
}
export async function loadLocalBook(book) {
    const text = normalizeDocumentText(await extractTextForBook(book));
    if (!text.trim()) {
        throw new Error(`《${book.title}》没有解析出可阅读的正文。`);
    }
    return {
        book,
        text,
    };
}
export async function listLocalLibrarySources() {
    const store = await loadLocalLibraryStore();
    const existingSources = [];
    for (const source of store.sources) {
        try {
            const details = await stat(source.path);
            const kind = details.isDirectory()
                ? "directory"
                : details.isFile()
                    ? "file"
                    : undefined;
            if (!kind) {
                continue;
            }
            existingSources.push({
                ...source,
                kind,
            });
        }
        catch {
            continue;
        }
    }
    return existingSources;
}
export async function addLocalLibrarySource(inputPath) {
    const normalizedInput = normalizeSourceInput(inputPath);
    const resolvedPath = normalizedInput === "." ? resolve(process.cwd()) : resolve(normalizedInput);
    const details = await stat(resolvedPath).catch(() => {
        throw new Error(`没有找到这个路径：${resolvedPath}`);
    });
    const kind = details.isDirectory()
        ? "directory"
        : details.isFile()
            ? "file"
            : undefined;
    if (!kind) {
        throw new Error("只能添加文件夹或文件。");
    }
    if (kind === "file" && !getFormatFromPath(resolvedPath)) {
        throw new Error("这个文件格式暂时不在书库支持范围内。请添加 EPUB、PDF、TXT、Markdown、HTML、DOCX、RTF 等常见书籍文件。");
    }
    const source = {
        path: resolvedPath,
        kind,
        label: basename(resolvedPath) || resolvedPath,
        addedAt: new Date().toISOString(),
    };
    const store = await loadLocalLibraryStore();
    const nextSources = [
        ...store.sources.filter((entry) => entry.path !== resolvedPath),
        source,
    ];
    await saveLocalLibraryStore({
        version: LOCAL_LIBRARY_STORE_VERSION,
        sources: nextSources,
    });
    return source;
}
export async function removeLocalLibrarySource(sourcePath) {
    const normalizedPath = resolve(sourcePath);
    const store = await loadLocalLibraryStore();
    const nextSources = store.sources.filter((entry) => entry.path !== normalizedPath);
    if (nextSources.length === store.sources.length) {
        return false;
    }
    await saveLocalLibraryStore({
        version: LOCAL_LIBRARY_STORE_VERSION,
        sources: nextSources,
    });
    return true;
}
export function buildLocalLibraryStorePath() {
    const configRoot = process.env.XDG_CONFIG_HOME
        ? join(process.env.XDG_CONFIG_HOME, "bbcli")
        : join(homedir(), ".config", "bbcli");
    return join(configRoot, "library.json");
}
async function loadLocalLibraryStore() {
    const storePath = buildLocalLibraryStorePath();
    try {
        const raw = await readFile(storePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== LOCAL_LIBRARY_STORE_VERSION || !Array.isArray(parsed.sources)) {
            throw new Error(`书库来源配置格式不受支持：${storePath}`);
        }
        return {
            version: LOCAL_LIBRARY_STORE_VERSION,
            sources: parsed.sources
                .filter((source) => typeof source.path === "string" && typeof source.label === "string")
                .map((source) => ({
                path: resolve(source.path),
                kind: source.kind === "file" ? "file" : "directory",
                label: source.label,
                addedAt: source.addedAt ?? new Date().toISOString(),
            })),
        };
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return {
                version: LOCAL_LIBRARY_STORE_VERSION,
                sources: [],
            };
        }
        throw error;
    }
}
async function saveLocalLibraryStore(store) {
    const storePath = buildLocalLibraryStorePath();
    await mkdir(dirname(storePath), { recursive: true, mode: 0o700 });
    await writeFile(storePath, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
}
async function scanSource(source, limit, books) {
    if (source.kind === "file") {
        await addBookFromFile(source.path, source.label, books);
        return;
    }
    await walkDirectory(source.path, source.label, MAX_SCAN_DEPTH, limit, books);
}
async function walkDirectory(directoryPath, sourceLabel, remainingDepth, limit, books) {
    if (remainingDepth < 0 || books.size >= limit) {
        return;
    }
    let entries;
    try {
        entries = await readdir(directoryPath, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (books.size >= limit) {
            return;
        }
        const entryPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) {
                continue;
            }
            await walkDirectory(entryPath, sourceLabel, remainingDepth - 1, limit, books);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const format = getFormatFromPath(entryPath);
        if (!format) {
            continue;
        }
        await addBookFromFile(entryPath, sourceLabel, books);
    }
}
async function addBookFromFile(filePath, sourceLabel, books) {
    const format = getFormatFromPath(filePath);
    if (!format || books.has(filePath)) {
        return;
    }
    try {
        const details = await stat(filePath);
        books.set(filePath, {
            id: filePath,
            path: filePath,
            title: stripKnownExtension(basename(filePath)),
            fileName: basename(filePath),
            format: format.id,
            formatLabel: format.label,
            sourceLabel,
            sizeBytes: details.size,
            modifiedAt: details.mtime.toISOString(),
        });
    }
    catch {
        return;
    }
}
function getFormatFromPath(filePath) {
    return BOOK_FORMATS[extname(filePath).toLowerCase()];
}
function normalizeSourceInput(inputPath) {
    const trimmed = inputPath.trim();
    if (!trimmed) {
        throw new Error("请先输入文件或文件夹路径。");
    }
    const unwrapped = ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")))
        ? trimmed.slice(1, -1)
        : trimmed;
    return unwrapped.replace(/\\([\\ "'()[\]{}])/g, "$1");
}
function stripKnownExtension(fileName) {
    const extension = extname(fileName);
    return basename(fileName, extension);
}
async function extractTextForBook(book) {
    switch (book.format) {
        case "txt":
            return readFile(book.path, "utf8");
        case "markdown":
            return renderMarkdownToText(await readFile(book.path, "utf8"));
        case "html":
            return extractTextFromMarkup(await readFile(book.path, "utf8"));
        case "epub":
            return extractTextFromEpub(book.path);
        case "pdf":
            return extractTextFromPdf(book.path);
        case "docx":
            return extractTextFromDocx(book.path);
        case "doc":
        case "rtf":
        case "odt":
            return extractTextViaTextutil(book.path);
        default:
            throw new Error(`暂不支持打开 ${book.formatLabel}。`);
    }
}
async function extractTextFromPdf(filePath) {
    const result = await runHelper("pdftotext", ["-enc", "UTF-8", "-layout", "-nopgbrk", filePath, "-"], "当前机器缺少 pdftotext，暂时无法读取 PDF。你可以先安装 poppler。");
    return result.stdout;
}
async function extractTextFromDocx(filePath) {
    const chunks = [];
    for (const entry of ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]) {
        try {
            const result = await runHelper("unzip", ["-p", filePath, entry], "当前机器缺少 unzip，暂时无法读取 DOCX。");
            if (result.stdout.trim()) {
                chunks.push(renderWordXmlToText(result.stdout));
            }
        }
        catch {
            continue;
        }
    }
    return chunks.join("\n\n");
}
async function extractTextFromEpub(filePath) {
    const listing = await runHelper("unzip", ["-Z1", filePath], "当前机器缺少 unzip，暂时无法读取 EPUB。");
    const contentEntries = listing.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => /\.(xhtml|html|htm)$/i.test(entry))
        .filter((entry) => !/(toc|nav|cover)/i.test(entry));
    if (contentEntries.length === 0) {
        throw new Error("这个 EPUB 里没有找到可阅读的章节文件。");
    }
    const sections = [];
    for (const entry of contentEntries) {
        const result = await runHelper("unzip", ["-p", filePath, entry], "当前机器缺少 unzip，暂时无法读取 EPUB。");
        const content = extractTextFromMarkup(result.stdout).trim();
        if (content) {
            sections.push(content);
        }
    }
    return sections.join("\n\n");
}
async function extractTextViaTextutil(filePath) {
    const result = await runHelper("textutil", ["-convert", "txt", "-stdout", filePath], "当前机器缺少 textutil，暂时无法读取这个文档格式。");
    return result.stdout;
}
async function runHelper(command, args, missingMessage) {
    try {
        const result = await execFileAsync(command, args, {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        });
        return {
            stdout: result.stdout,
            stderr: result.stderr,
        };
    }
    catch (error) {
        const maybeError = error;
        if (maybeError.code === "ENOENT") {
            throw new Error(missingMessage);
        }
        const details = maybeError.stderr?.trim() || maybeError.stdout?.trim() || maybeError.message;
        throw new Error(details);
    }
}
function renderMarkdownToText(markdown) {
    return markdown
        .replace(/\r\n/g, "\n")
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/!\[[^\]]*]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
        .replace(/^[*-]\s+/gm, "• ")
        .replace(/^>\s?/gm, "")
        .replace(/`{1,3}/g, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/_([^_]+)_/g, "$1");
}
function renderWordXmlToText(xml) {
    return decodeEntities(xml
        .replace(/<w:tab\/>/g, "    ")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n\n")
        .replace(/<[^>]+>/g, ""));
}
function extractTextFromMarkup(markup) {
    return decodeEntities(markup
        .replace(/<script[\s\S]*?<\/script>/gi, "\n")
        .replace(/<style[\s\S]*?<\/style>/gi, "\n")
        .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "\n• ")
        .replace(/<\/(p|div|section|article|aside|header|footer|blockquote|ul|ol|table|tr|h[1-6])>/gi, "\n\n")
        .replace(/<[^>]+>/g, ""));
}
function decodeEntities(input) {
    return input
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}
function normalizeDocumentText(text) {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\u0000/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
