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
