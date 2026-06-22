# md-converter

Markdown をコマンド一発で **HTML / PDF** に変換するツール。
markdown-it でレンダリングし、PDF は Puppeteer（ヘッドレス Chrome）で生成します。きれいなスタイル付き。

## セットアップ

```sh
pnpm install
```

> 初回は Puppeteer が Chromium を自動ダウンロードします（数十 MB）。
> `convert.sh` 経由なら `node_modules` が無いとき自動で `pnpm install` を実行します。

## 使い方

```sh
./convert.sh <input.md> [--to html|pdf|both] [-o <出力先>]
```

| コマンド | 出力 |
| --- | --- |
| `./convert.sh sample.md` | `sample.html`（既定は HTML） |
| `./convert.sh sample.md --to pdf` | `sample.pdf` |
| `./convert.sh sample.md --to both` | HTML と PDF の両方 |
| `./convert.sh sample.md --to both -o /tmp/out` | `/tmp/out.html` と `/tmp/out.pdf` |

オプション:

- `--to` — 出力形式（`html` / `pdf` / `both`、既定 `html`）
- `-o`, `--out` — 出力先のベースパス（拡張子は自動付与）。省略時は入力と同じ場所・同名
- `-h`, `--help` — ヘルプ表示

## 特徴

- 日本語フォント対応（Hiragino Sans / Noto Sans JP フォールバック）
- highlight.js によるコードのシンタックスハイライト
- Zenn 風レイアウト: 本文を左、見出し一覧（目次）を右に sticky 表示。スクロールに追従して現在地をハイライト
- 見出し・表・引用・リストを読みやすく整えたスタイル（CSS は HTML にインライン埋め込み）
- 列が多い表は HTML で横スクロール（PDF では折り返し）
- 狭い画面（≤960px）と PDF では目次を隠して本文フル幅
- 印刷用 `@media print` 調整済み

## 表の左列固定（任意）

横スクロールする表で一番左の列を固定したいときは、**その表の直前に `<!-- sticky -->` コメント**を置きます（このマーカーの無い表は通常スクロール）。GitHub など他のレンダラーではただのコメントとして無視されます。

```markdown
<!-- sticky -->

| ツール | 列B | 列C | 列D | 列E |
| --- | --- | --- | --- | --- |
| Dependabot | … | … | … | … |
```
