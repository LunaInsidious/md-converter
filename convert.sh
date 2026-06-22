#!/usr/bin/env bash
set -euo pipefail

# スクリプトのあるディレクトリ（= リポジトリルート）へ移動
cd "$(dirname "$0")"

# 依存が未インストールなら pnpm install を自動実行
if [ ! -d node_modules ]; then
  echo "初回セットアップ: pnpm install を実行します..." >&2
  pnpm install
fi

exec node convert.js "$@"
