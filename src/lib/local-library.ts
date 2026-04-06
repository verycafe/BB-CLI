import {execFile} from "node:child_process";
import {readdir, readFile, stat} from "node:fs/promises";
import {homedir} from "node:os";
import {basename, extname, join, resolve} from "node:path";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_RESULTS = 80;
const SCAN_ROOTS = [
  {label: "当前目录", path: resolve(process.cwd())},
  {label: "Books", path: join(homedir(), "Books")},
  {label: "文稿", path: join(homedir(), "Documents")},
  {label: "下载", path: join(homedir(), "Downloads")},
  {label: "桌面", path: join(homedir(), "Desktop")},
] as const;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".cache",
]);

const BOOK_FORMATS = {
  ".txt": {id: "txt", label: "TXT"},
  ".md": {id: "markdown", label: "Markdown"},
  ".markdown": {id: "markdown", label: "Markdown"},
  ".html": {id: "html", label: "HTML"},
  ".htm": {id: "html", label: "HTML"},
  ".xhtml": {id: "html", label: "HTML"},
  ".epub": {id: "epub", label: "EPUB"},
  ".pdf": {id: "pdf", label: "PDF"},
  ".rtf": {id: "rtf", label: "RTF"},
  ".docx": {id: "docx", label: "DOCX"},
  ".doc": {id: "doc", label: "DOC"},
  ".odt": {id: "odt", label: "ODT"},
} as const;

export type LocalBookFormat = (typeof BOOK_FORMATS)[keyof typeof BOOK_FORMATS]["id"];

export type LocalBook = {
  id: string;
  path: string;
  title: string;
  fileName: string;
  format: LocalBookFormat;
  formatLabel: string;
  sourceLabel: string;
  sizeBytes: number;
  modifiedAt: string;
};

export type LocalLibrarySnapshot = {
  books: LocalBook[];
  roots: string[];
};

export type LocalBookDocument = {
  book: LocalBook;
  text: string;
};

export async function listLocalBooks(limit = MAX_SCAN_RESULTS): Promise<LocalLibrarySnapshot> {
  const roots = await filterExistingRoots();
  const books: LocalBook[] = [];

  for (const root of roots) {
    await walkDirectory(root.path, root.label, MAX_SCAN_DEPTH, limit, books);
    if (books.length >= limit) {
      break;
    }
  }

  books.sort((left, right) => {
    return new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  });

  return {
    books: books.slice(0, limit),
    roots: roots.map((root) => `${root.label} · ${root.path}`),
  };
}

export async function loadLocalBook(book: LocalBook): Promise<LocalBookDocument> {
  const text = normalizeDocumentText(await extractTextForBook(book));
  if (!text.trim()) {
    throw new Error(`《${book.title}》没有解析出可阅读的正文。`);
  }

  return {
    book,
    text,
  };
}

async function filterExistingRoots(): Promise<Array<{label: string; path: string}>> {
  const unique = new Map<string, {label: string; path: string}>();

  for (const root of SCAN_ROOTS) {
    try {
      const details = await stat(root.path);
      if (!details.isDirectory()) {
        continue;
      }

      unique.set(root.path, root);
    } catch {
      continue;
    }
  }

  return [...unique.values()];
}

async function walkDirectory(
  directoryPath: string,
  sourceLabel: string,
  remainingDepth: number,
  limit: number,
  books: LocalBook[],
): Promise<void> {
  if (remainingDepth < 0 || books.length >= limit) {
    return;
  }

  let entries;
  try {
    entries = await readdir(directoryPath, {withFileTypes: true});
  } catch {
    return;
  }

  for (const entry of entries) {
    if (books.length >= limit) {
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

    try {
      const details = await stat(entryPath);
      books.push({
        id: entryPath,
        path: entryPath,
        title: stripKnownExtension(entry.name),
        fileName: entry.name,
        format: format.id,
        formatLabel: format.label,
        sourceLabel,
        sizeBytes: details.size,
        modifiedAt: details.mtime.toISOString(),
      });
    } catch {
      continue;
    }
  }
}

function getFormatFromPath(filePath: string) {
  return BOOK_FORMATS[extname(filePath).toLowerCase() as keyof typeof BOOK_FORMATS];
}

function stripKnownExtension(fileName: string): string {
  const extension = extname(fileName);
  return basename(fileName, extension);
}

async function extractTextForBook(book: LocalBook): Promise<string> {
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

async function extractTextFromPdf(filePath: string): Promise<string> {
  const result = await runHelper(
    "pdftotext",
    ["-enc", "UTF-8", "-layout", "-nopgbrk", filePath, "-"],
    "当前机器缺少 pdftotext，暂时无法读取 PDF。你可以先安装 poppler。",
  );

  return result.stdout;
}

async function extractTextFromDocx(filePath: string): Promise<string> {
  const chunks: string[] = [];

  for (const entry of ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]) {
    try {
      const result = await runHelper(
        "unzip",
        ["-p", filePath, entry],
        "当前机器缺少 unzip，暂时无法读取 DOCX。",
      );
      if (result.stdout.trim()) {
        chunks.push(renderWordXmlToText(result.stdout));
      }
    } catch {
      continue;
    }
  }

  return chunks.join("\n\n");
}

async function extractTextFromEpub(filePath: string): Promise<string> {
  const listing = await runHelper(
    "unzip",
    ["-Z1", filePath],
    "当前机器缺少 unzip，暂时无法读取 EPUB。",
  );

  const contentEntries = listing.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => /\.(xhtml|html|htm)$/i.test(entry))
    .filter((entry) => !/(toc|nav|cover)/i.test(entry));

  if (contentEntries.length === 0) {
    throw new Error("这个 EPUB 里没有找到可阅读的章节文件。");
  }

  const sections: string[] = [];
  for (const entry of contentEntries) {
    const result = await runHelper(
      "unzip",
      ["-p", filePath, entry],
      "当前机器缺少 unzip，暂时无法读取 EPUB。",
    );
    const content = extractTextFromMarkup(result.stdout).trim();
    if (content) {
      sections.push(content);
    }
  }

  return sections.join("\n\n");
}

async function extractTextViaTextutil(filePath: string): Promise<string> {
  const result = await runHelper(
    "textutil",
    ["-convert", "txt", "-stdout", filePath],
    "当前机器缺少 textutil，暂时无法读取这个文档格式。",
  );

  return result.stdout;
}

async function runHelper(command: string, args: string[], missingMessage: string): Promise<{stdout: string; stderr: string}> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException & {stdout?: string; stderr?: string};
    if (maybeError.code === "ENOENT") {
      throw new Error(missingMessage);
    }

    const details = maybeError.stderr?.trim() || maybeError.stdout?.trim() || maybeError.message;
    throw new Error(details);
  }
}

function renderMarkdownToText(markdown: string): string {
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

function renderWordXmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, "    ")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function extractTextFromMarkup(markup: string): string {
  return decodeEntities(
    markup
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|div|section|article|aside|header|footer|blockquote|ul|ol|table|tr|h[1-6])>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function decodeEntities(input: string): string {
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

function normalizeDocumentText(text: string): string {
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
