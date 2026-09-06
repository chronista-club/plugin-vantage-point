#!/bin/bash
# SessionStart hook: VP lane (作業台) の状態をセッション開始時にコンテキスト注入
# vp CLI が使えない場合は静かに終了する
#
# 語彙は VP v0.56 命名エピック後に準拠 (lane = 作業台、repo = 場、agent = engine)。
# lane 配置は project-local `<repo>/.vp/lanes/` (VP 本体 lane/config.rs の
# `project_lanes_dir()` が SSOT)。

set -euo pipefail

# Hosts may launch hooks outside the project. Resolve the event cwd first.
EVENT_CWD=$(python3 -c 'import json,sys; d=json.load(sys.stdin); p=d.get("cwd"); assert isinstance(p,str) and p; print(p)' 2>/dev/null) || exit 0
cd "$EVENT_CWD" 2>/dev/null || exit 0


# vp コマンドの存在チェック
if ! command -v vp &>/dev/null; then
  exit 0
fi

# lane 一覧を取得
LANE_LIST=$(vp lane ls 2>/dev/null || echo "")

# lane が 0 件なら何もしない
if [ -z "$LANE_LIST" ]; then
  exit 0
fi

# 現在のディレクトリが lane 内かどうか判定
CURRENT_DIR=$(pwd)
IN_LANE=""
if echo "$CURRENT_DIR" | grep -q "/\.vp/lanes/"; then
  IN_LANE="true"
fi

# コンテキストを構築 (実際の改行のまま組み、JSON 化は最後の encoder に任せる)
if [ -n "$IN_LANE" ]; then
  CONTEXT=$(cat <<EOF
## VP Lane 環境

現在 lane (作業台) 内で作業中です。
パス: ${CURRENT_DIR}

### この repo の lane 一覧
\`\`\`
${LANE_LIST}
\`\`\`

lane address は \`<repo>/root\` / \`<repo>/<name>\` (v0.56+ で \`/performer/\` は撤去)。
管理: vp lane ls --detail / vp lane rm <name> / vp lane status
EOF
)
else
  CONTEXT=$(cat <<EOF
## VP Lane 環境

アクティブな lane があります。

### lane 一覧
\`\`\`
${LANE_LIST}
\`\`\`

lane address は \`<repo>/root\` / \`<repo>/<name>\` (v0.56+ で \`/performer/\` は撤去)。
管理: vp lane ls --detail / vp lane new <name> <branch> / vp lane rm <name>
EOF
)
fi

# --- JSON エンコード ---
# `vp lane ls` の出力はタブ区切りの複数行。これを文字列連結で JSON に埋めると
# 生の改行が "Unterminated string" を、タブが制御文字エラーを起こす (2026-09-06 実測)。
# 必ず encoder に通すこと。python3 が無い環境のために sed/awk の fallback を持つ。
escaped=$(printf '%s' "$CONTEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || true)

if [ -z "$escaped" ]; then
  TAB=$(printf '\t')
  escaped=$(printf '%s' "$CONTEXT" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/${TAB}/\\\\t/g" \
    | awk '{printf "%s\\n", $0}')
  escaped="\"${escaped%\\n}\""
fi

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": ${escaped}
  }
}
EOF

exit 0
