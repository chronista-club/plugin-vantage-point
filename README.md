# Vantage Point Plugin

Shared Claude Code / Codex plugin for AI-native development — board visualization, parallel lanes, wire inter-agent communication, dev-flow orchestration, and GUI live tuning.

## Features

- **board 🧭** — Markdown / HTML / log / URL を貼る台。item は id を持ち、`update` で書き換えられる
- **lane** — 作業台（cwd / branch / board / layout を持つ checkout）。`root` + 並列 lane（`vp lane`, `add_sub`）
- **wire** — repo 跨ぎ inter-agent 通信（`wire_send` / `wire_recv` / `wire_inbox` / `wire_ack` / `wire_thread`）
- **dev-flow primitives** — `flow_handoff` / `flow_progress` で並列 orchestration
- **GUI live tuning** — `editor_*` / `layout_*` で AI が GUI を直接調律（HITL ループ）
- **Auto-update Hooks** — SessionStart で lane 状態をコンテキスト注入 + `vp wire hook-check`
- **Screenshot** — `vp shot` / `capture_window` で UI を PNG 化

## Requirements

- Vantage Point CLI (`vp`) **v0.57+** が **PATH にある**こと

  ```bash
  brew install --cask chronista-club/tap/vantage-point
  ```

- repo runtime が未起動でも MCP ツール呼び出し時に自動起動

## MCP サーバの宣言

本プラグインはリポジトリ直下の `.mcp.json` で MCP サーバを宣言します。**プラグインを入れれば `mcp__vantage-point__*` が使えます**（ホストでの有効化と実行許可が必要）。

```json
{
  "mcpServers": {
    "vantage-point": { "command": "vp", "args": ["mcp"] }
  }
}
```

> ⚠️ **`vp` が PATH に無い環境ではセッションごとに接続エラーが出ます。** バイナリ配布（brew）と MCP 宣言は別レイヤーで、VP は Rust + WebView の GUI アプリのため creo-memories 方式（クラウド）も プラグインだけも採れません。「brew で本体を入れ、プラグインが宣言する」が構造上の前提です。

## Installation

```bash
# From GitHub marketplace
/plugin marketplace add chronista-club/chronista-plugins
claude plugin install vantage-point@chronista-plugins
```

## Quick Start

```bash
# vp-app GUI を起動
vp app start

# handoff (atomic)
vp flow handoff feat-api --task-spec task.md --mode auto

# 並列追跡
vp flow progress
```

## 語彙（v0.56 命名エピック）

JoJo 由来の愛称は VP v0.56 で全廃され、機能名へ移行しました:

| 旧 | 現行 |
|---|---|
| Paisley Park / Canvas | **board** |
| Gold Experience | **runner** |
| Star Platinum / SP / project | **repo** |
| TheWorld / World | **daemon** |
| Echoes | **conversation** |
| Stand | **agent** / component / service |

lane address は **`<repo>/root` / `<repo>/<name>`**（`/Sub/` セグメントは撤去）。`root` は役割ではなく予約名で、`LaneKind` は撤去済み — **lane は全て対等**です。

## Commands

| Command | Description |
|---------|-------------|
| `/vantage-point:rename` | ローカル LLM (LM Studio) で日本語セッション名を生成 |

## Skills

| Skill | Description |
|-------|-------------|
| `vantage-point` | MCP ツール 26 個、語彙、アーキテクチャ、典型シナリオ |
| `dev-flow` | lane orchestration による並列開発フロー 6 phase |

## Claude Mods（function hooks、early access）

`hooks/vp-mod.ts` は Claude Code の **Mods**（TypeScript function hooks、early access。2.1.274 で実測）で VP と繋ぐ hooks module。
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` を付けて起動した claude だけが読む（未設定なら従来の command hook のみ）。
VP の外（`VP_REPO` / `VP_LANE` が無い）で起動された claude では何もしない。

| 何を | どう |
|---|---|
| `vp now` の自動化 | `turn.start` / `tool.call` から now-line の下地を書く（`Edit src/a.rs` / `Bash テスト実行` / MCP tool 名）。AI が手で `vp now` を打ったら 2 分は mod が黙る（手打ち優先） |
| wire の受領 ack | VP の nudge（`📨 wire: … message_id=…`）が prompt に入った瞬間に `vp wire recv` → `vp wire ack` を済ませ、prompt 本文を「本文 + ack 済み」に書き換える（生 JSON は context）。ack 忘れ → 再 nudge → 二重配送を構造的に消す |
| diff → board | Edit / Write / NotebookEdit と、差分を動かしうる Bash（git / fmt / sed / cargo / bun …）の後、turn の終わりに `git diff`（uncommitted 全体 + 未追跡一覧）を board の item `diff` **1 枚**に貼る（MCP `show` → 応答の `id=` を控えて以後 `update`、VP 0.71+）。触った file を先頭、file 120 行 / 全体 30k 字で切る。差分ゼロは「✓ 差分なし」に書き換える |
| daemon guard | lane の中から daemon を止める Bash（`vp daemon stop\|restart` / `vp restart-all` / `VP_SWAP_RESTART_DAEMON=1` / `launchctl bootout\|kickstart\|unload`）を deny し、理由（自分ごと落ちる、kitty から打ってもらう）を model に返す |
| turn の終わり | `turn.complete` で now-line に `✓ <answer 先頭行>`（中断は `⏹ 中断`）。console（tui）で最後の tool 名が残り続けないように |

hook は queue に積むだけで、`vp` / `git` の spawn は `session.start` で立てた `$.clock.every` の drain が dispatch の外で回す（now-line は最新だけ、diff は 1 回に畳む）。

daemon との橋は `$.process.run(["vp", …])` 一本（VP の transport は Unison(QUIC) なので `$.http` は届かない。CLI が daemon RPC の唯一の公認入口）。

```bash
# 試す（作業ツリーを直接読ませる）
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ~/repos/plugin-vantage-point
# 診断: hook の入口ごとに 1 行ずつ書く
VP_MOD_TRACE=/tmp/vp-mod.trace CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude …
```

開発: `bun test`（純関数）/ `tsc -p tsconfig.json`（`types/claude-code.d.ts` は `/plugin-types` の出力。Claude Code 更新後は再生成する）/ `claude plugin validate .`（`$` の呼び先と env 読み書きの棚卸しが出る。`$` を渡せるのは **file top-level の function 宣言だけ**）。

## MCP Tools（全 26 個）

### board

| ツール | 説明 |
|--------|------|
| `show` / `clear` | board に貼る (markdown/html/log/url)・clear |
| `read_board` | board 全 item を id / title / 全文つきで取得 |
| `update` | board item を **id 指定で in-place 置換** |
| `capture_window` | vp-app window スクリーンショット (PNG) |
| `switch_lane` | active lane の切替（`root` or lane 名） |

### lane

| ツール | 説明 |
|--------|------|
| `add_sub` / `delete_sub` | lane の作成・削除（`agent` / `base` / `model` 指定可） |
| `list_lanes` | lane 一覧（`sub_status` / `mailbox_addresses` / `repo_addresses`） |

> lane への text 注入・console 読取・ファイル監視は CLI のみ: `vp lane nudge` / `vp lane capture` / `vp file watch`

### dev-flow

| ツール | 説明 |
|--------|------|
| `flow_handoff` | lane 作成 + wire_send + nudge を atomic 実行 |
| `flow_progress` | 全 lane の git status + `flow_state`（6 state）集約 |

### wire

| ツール | 説明 |
|--------|------|
| `wire_send` / `wire_recv` | inter-agent message 送受信 |
| `wire_inbox` / `wire_ack` | 未読確認（cursor 不触り） / command 受領確認 |
| `wire_thread` | thread 系譜 trace |
| `delegate` / `complete` / `respond` | async future 型 task 委譲 |

### GUI live tuning

| ツール | 説明 |
|--------|------|
| `editor_fields` / `editor_values` / `editor_set` | live-tunable な design knob の列挙・読み・設定 |
| `layout_get` / `layout_set` / `layout_history` | pane layout の取得・設定・settle-log |

> **この 6 本と `read_board` / `update` に CLI pair はありません**（MCP 専用）。対象が GUI の生きた状態のため。

詳細: `skills/vantage-point/reference/mcp-tools.md`

## License

MIT

## 共通配布

Claude Code / Codex は同じ `skills/` を使います。[ホスト対応と検証範囲](docs/host-support.md)を参照してください。カタログは [chronista-plugins](https://github.com/chronista-club/chronista-plugins)。

Codex はカタログ追加後 `codex plugin add vantage-point@chronista-plugins` で登録する。共有 skills はホストのスキル一覧から呼び出す。
