#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import hljs from "highlight.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- 引数パース -----------------------------------------------------------
function parseArgs(argv) {
  const opts = { input: null, to: "html", out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--to") {
      opts.to = argv[++i];
    } else if (arg === "-o" || arg === "--out") {
      opts.out = argv[++i];
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (!arg.startsWith("-") && opts.input === null) {
      opts.input = arg;
    } else {
      throw new Error(`不明な引数: ${arg}`);
    }
  }
  return opts;
}

const USAGE = `使い方: md-convert <input.md> [--to html|pdf|both] [-o <出力先(拡張子なし)>]

  --to   出力形式 (既定: html)
  -o     出力先のベースパス。省略時は入力と同じ場所・同名で拡張子だけ差し替え
  -h     このヘルプを表示

例:
  md-convert README.md
  md-convert README.md --to pdf
  md-convert README.md --to both -o /tmp/out`;

// --- markdown-it セットアップ ---------------------------------------------
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {
        /* フォールバックへ */
      }
    }
    return md.utils.escapeHtml(code);
  },
}).use(anchor, { permalink: anchor.permalink.headerLink() });

// 表は横スクロール用のラッパーで囲む（列が多くキツキツなときに横スクロール）。
// 表の直前に <!-- sticky --> コメントを置くと、その表だけ一番左の列を固定する。
function tableWantsSticky(tokens, idx) {
  for (let i = idx - 1; i >= 0 && i >= idx - 3; i--) {
    const t = tokens[i];
    if (!t || t.type === "table_close") break; // 別の表に達したら打ち切り
    if (/<!--\s*sticky/i.test(t.content || "")) return true;
  }
  return false;
}
md.renderer.rules.table_open = (tokens, idx) =>
  `<div class="table-wrap${tableWantsSticky(tokens, idx) ? " sticky-first" : ""}">\n<table>\n`;
md.renderer.rules.table_close = () => "</table>\n</div>\n";

// 見出し（h2/h3）から目次（右サイドの一覧）を組み立てる。
// anchor プラグインが heading_open に付けた id を使う。
function buildToc(tokens) {
  const items = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "heading_open") continue;
    const level = Number(t.tag.slice(1));
    if (level < 2 || level > 3) continue;
    const id = t.attrGet("id");
    if (!id) continue;
    const inline = tokens[i + 1];
    const text = (inline?.children ?? [])
      .filter((c) => c.type === "text" || c.type === "code_inline")
      .map((c) => c.content)
      .join("") || inline?.content || "";
    items.push({ level, id, text });
  }
  return items;
}

function buildTocHtml(items) {
  if (!items.length) return "";
  const lis = items
    .map(
      (it) =>
        `<li class="lvl-${it.level}"><a data-id="${md.utils.escapeHtml(it.id)}" href="#${encodeURIComponent(it.id)}">${md.utils.escapeHtml(it.text)}</a></li>`,
    )
    .join("\n");
  return `<aside class="toc"><div class="toc-title">目次</div><nav><ul>\n${lis}\n</ul></nav></aside>`;
}

// 目次の現在地ハイライト（スクロール追従）。HTML 単体で動くよう最小スクリプトを埋め込む。
const TOC_SCRIPT = `<script>
(function(){
  var links = [].slice.call(document.querySelectorAll('.toc a'));
  if(!links.length) return;
  var map = {}, headings = [];
  links.forEach(function(a){
    var id = a.getAttribute('data-id'), h = document.getElementById(id);
    if(h){ map[id] = a; headings.push(h); }
  });
  var current = null;
  function setActive(a){
    if(current === a) return;
    if(current) current.classList.remove('active');
    if(a) a.classList.add('active');
    current = a;
  }
  function onScroll(){
    var y = window.scrollY + 120, active = headings[0];
    for(var i=0;i<headings.length;i++){
      if(headings[i].offsetTop <= y) active = headings[i]; else break;
    }
    setActive(map[active.id]);
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  window.addEventListener('resize', onScroll, {passive:true});
  onScroll();
})();
</script>`;

// highlight.js の github テーマ CSS を埋め込み用に読み込む
async function loadHljsCss() {
  const cssPath = path.join(
    __dirname,
    "node_modules",
    "highlight.js",
    "styles",
    "github.css",
  );
  try {
    return await readFile(cssPath, "utf8");
  } catch {
    return "";
  }
}

function buildHtml(title, bodyHtml, hljsCss, tocHtml) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${md.utils.escapeHtml(title)}</title>
<style>
:root {
  --fg: #1f2328;
  --fg-muted: #59636e;
  --accent: #2f6feb;
  --border: #e1e4e8;
  --bg: #ffffff;
  --bg-subtle: #f6f8fa;
  --bg-code: #f4f6fb;
  --radius: 10px;
}

* { box-sizing: border-box; }

body {
  font-family: "Hiragino Sans", "Noto Sans JP", -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  font-feature-settings: "palt" 1;
  line-height: 1.85;
  letter-spacing: 0.01em;
  margin: 0;
  color: var(--fg);
  background: var(--bg);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  word-wrap: break-word;
}

/* Zenn 風レイアウト: 本文を左、見出し一覧（目次）を右に */
.layout {
  display: flex;
  align-items: flex-start;
  gap: 4rem;
  max-width: 1360px;
  margin: 0 auto;
  padding: 4rem 2.4rem 6rem;
}
.content { flex: 1 1 0; min-width: 0; }

.toc {
  flex: 0 0 230px;
  position: sticky;
  top: 2rem;
  align-self: flex-start;
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
}
.toc-title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-muted);
  margin-bottom: 0.7rem;
}
.toc ul { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--border); }
.toc li { margin: 0; }
.toc a {
  display: block;
  padding: 0.28em 0.9em;
  margin-left: -2px;
  border-left: 2px solid transparent;
  color: var(--fg-muted);
  font-size: 0.82rem;
  line-height: 1.5;
  text-decoration: none;
}
.toc a:hover { color: var(--fg); border-bottom: 0; }
.toc a.active { color: var(--accent); border-left-color: var(--accent); font-weight: 600; }
.toc .lvl-3 a { padding-left: 1.8em; font-size: 0.78rem; }

/* 見出し */
h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.005em;
  margin: 2.4em 0 0.8em;
  scroll-margin-top: 2rem;
}
h1 {
  font-size: 2.1rem;
  margin-top: 0;
  padding-bottom: 0.4em;
  border-bottom: 2px solid var(--border);
}
h2 {
  font-size: 1.55rem;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}
h3 { font-size: 1.25rem; }
h4 { font-size: 1.05rem; color: var(--fg-muted); }

/* 段落・リンク */
p { margin: 1.1em 0; }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.15s; }
a:hover { border-bottom-color: var(--accent); }
.header-anchor { color: inherit; border: 0; }
.header-anchor:hover { border: 0; }

strong { font-weight: 700; }

/* リスト */
ul, ol { padding-left: 1.5em; margin: 1.1em 0; }
li { margin: 0.35em 0; }
li::marker { color: var(--fg-muted); }

/* インライン code */
code {
  font-family: "SFMono-Regular", "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.86em;
  background: var(--bg-code);
  color: #b3375a;
  padding: 0.15em 0.45em;
  border-radius: 6px;
  border: 1px solid var(--border);
}

/* コードブロック */
pre {
  background: var(--bg-subtle);
  padding: 1.1rem 1.25rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: auto;
  line-height: 1.6;
  box-shadow: 0 1px 2px rgba(27, 31, 36, 0.04);
}
pre code {
  background: none;
  border: 0;
  color: inherit;
  padding: 0;
  font-size: 0.84em;
}

/* 引用 */
blockquote {
  margin: 1.4em 0;
  padding: 0.4em 1.2em;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border-left: 4px solid var(--accent);
  border-radius: 0 var(--radius) var(--radius) 0;
}
blockquote p { margin: 0.5em 0; }

/* 表：列が多くてキツキツなときは横スクロール */
.table-wrap {
  margin: 1.6em 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  -webkit-overflow-scrolling: touch;
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: max-content;
  font-size: 0.95em;
}
th, td {
  padding: 0.6em 1em;
  text-align: left;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
th { background: var(--bg-subtle); font-weight: 700; }
tr:last-child td { border-bottom: 0; }
tbody tr:nth-child(2n) { background: #fbfcfd; }

/* <!-- sticky --> 付きの表だけ、一番左の列を固定 */
.table-wrap.sticky-first th:first-child,
.table-wrap.sticky-first td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  box-shadow: 1px 0 0 var(--border); /* スクロール時の境界線 */
}
.table-wrap.sticky-first thead th:first-child { z-index: 2; }
/* 固定セルは背景を不透明にして、スクロールで下に潜る本文を隠す（ゼブラも維持） */
.table-wrap.sticky-first thead th:first-child { background: var(--bg-subtle); }
.table-wrap.sticky-first tbody tr td:first-child { background: var(--bg); }
.table-wrap.sticky-first tbody tr:nth-child(2n) td:first-child { background: #fbfcfd; }

img { max-width: 100%; border-radius: var(--radius); }

hr {
  height: 1px;
  border: 0;
  background: linear-gradient(90deg, transparent, var(--border) 20%, var(--border) 80%, transparent);
  margin: 2.5em 0;
}

${hljsCss}

/* 狭い画面では目次を隠して本文をフル幅に */
@media (max-width: 960px) {
  .layout { display: block; padding: 2.5rem 1.4rem 4rem; }
  .toc { display: none; }
}

@media print {
  .layout { display: block; max-width: none; padding: 0; }
  .toc { display: none; }
  body { font-size: 10.5pt; }
  pre, blockquote, table, img { page-break-inside: avoid; }
  h1, h2, h3, h4 { page-break-after: avoid; }
  pre { box-shadow: none; }
  /* 印刷は横スクロールできないので折り返しに戻して見切れを防ぐ */
  .table-wrap { overflow: visible; }
  table { min-width: 0; }
  th, td { white-space: normal; }
}
</style>
</head>
<body>
<div class="layout">
<main class="content">
${bodyHtml}
</main>
${tocHtml}
</div>
${TOC_SCRIPT}
</body>
</html>`;
}

// --- PDF 出力 (Puppeteer) -------------------------------------------------
async function renderPdf(html, outPath) {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
  } finally {
    await browser.close();
  }
}

// --- メイン ---------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.input) {
    console.log(USAGE);
    process.exit(opts.input ? 0 : 1);
  }

  if (!["html", "pdf", "both"].includes(opts.to)) {
    throw new Error(`--to の値が不正です: ${opts.to} (html|pdf|both のいずれか)`);
  }

  if (!existsSync(opts.input)) {
    throw new Error(`入力ファイルが見つかりません: ${opts.input}`);
  }

  const source = await readFile(opts.input, "utf8");
  const title = path.basename(opts.input, path.extname(opts.input));
  const env = {};
  const tokens = md.parse(source, env);
  const bodyHtml = md.renderer.render(tokens, md.options, env);
  const tocHtml = buildTocHtml(buildToc(tokens));
  const hljsCss = await loadHljsCss();
  const fullHtml = buildHtml(title, bodyHtml, hljsCss, tocHtml);

  // 出力ベースパス: -o 指定 or 入力と同ディレクトリ・同名
  const base = opts.out
    ? opts.out.replace(/\.(html|pdf)$/i, "")
    : path.join(path.dirname(opts.input), title);

  const produced = [];

  if (opts.to === "html" || opts.to === "both") {
    const htmlPath = `${base}.html`;
    await writeFile(htmlPath, fullHtml, "utf8");
    produced.push(htmlPath);
  }

  if (opts.to === "pdf" || opts.to === "both") {
    const pdfPath = `${base}.pdf`;
    await renderPdf(fullHtml, pdfPath);
    produced.push(pdfPath);
  }

  console.log("生成しました:");
  for (const p of produced) console.log(`  ${p}`);
}

main().catch((err) => {
  console.error(`エラー: ${err.message}`);
  process.exit(1);
});
