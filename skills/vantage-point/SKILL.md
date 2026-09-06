---
name: vantage-point
description: AI ネイティブ開発環境 — board 視覚化、並列 lane 展開、wire inter-agent 通信、dev-flow orchestration、GUI
  live tuning を実現する MCP server。Claude Code 用 dashboard tool
metadata:
  version: 0.24.0
  tags: dashboard, board, mcp, inter-agent, lane, dev-flow, gui-tuning
---

## ホスト共通の読み方

このディレクトリが共有定義の正本。Claude Code は `.claude-plugin`、Codex は `.codex-plugin` から同じ skills を読む。Grok CLI は Claude 互換形式を対象とするが実機確認待ち。
本文中の `Agent`、`Bash`、`Read` や MCP の名前は Claude 表記の例。利用中のホストで提供された同等のツールを発見して使う。存在しないツール・モデル・実行結果を仮定しない。`${CLAUDE_PLUGIN_ROOT}` の資料パスは、この skill から辿れるプラグインルートに読み替える。

# Vantage Point

> **AI ネイティブ開発環境** — Claude Code セッション中に board 視覚化、並列 lane 展開、wire inter-agent 通信、dev-flow orchestration、GUI live tuning を実現する MCP server。

VP は「ブラウザビューア」ではなく、開発体験そのものを構成する **6 つの柱**を提供します:

1. **board 🧭** — markdown / HTML / URL / ログを貼る台。item は id を持ち、`update` で書き換えられる
2. **lane** — 作業台（cwd / branch / board / layout を持つ checkout）。root + Subs の並列開発環境
3. **wire** — repo 跨ぎ inter-agent 通信（永続 thread + delivery policy）
4. **dev-flow** — `flow_handoff` / `flow_progress` で並列 orchestration
5. **GUI live tuning** — `editor_*` / `layout_*` で AI が GUI を直接調律（HITL ループ）
6. **screenshot** — `capture_window` / `vp shot` で UI 状態を PNG 化、Read tool で AI が視認

---

## 語彙（v0.56 命名エピックで確定）

JoJo 由来の愛称は **VP v0.56（PR #936〜#946）で全廃**され、機能名へ移行しました。SSOT = VP 本体 `CLAUDE.md`「アーキテクチャ命名体系」。

```
daemon ⚙️  (Process Manager / 常駐デーモン)
  ├── repo 📦  (Repo Runtime / 各機能が同居する場)
  │     ├── conversation 💬  (AI との会話層 — host / 翻訳 / transcript)
  │     ├── board 🧭  (Information Navigator / 貼る台)
  │     └── runner 🌿  (Code Runner)
  ├── devices 🧲  (machine scope / device registry)
  └── device_io 🌫️  (lane scope / device I/O)

軸: agent（claude / codex / grok / opencode / shell）× mode（tui / gui）
GUI 容器 = Pane（app 専用語）。部品 = component / 常駐 = service。総称「Stand」は廃止。
```

**旧名で書かれた doc / memory を読むときの対応表**:

| 旧 | 現行 |
|---|---|
| Paisley Park / PP / Canvas | **board** |
| Gold Experience / GE | **runner** |
| Star Platinum / SP / project（容器の義） | **repo** |
| TheWorld / World | **daemon** |
| Echoes | **conversation** |
| Stand / stand | **agent**（engine 軸）/ component / service に分解 |
| The Hand | **shell**（agent の一種） |
| `@world` | **`@machine`** |
| act（chat / tui） | **mode**（gui / tui） |

### address

| 種別 | 形 | 例 |
|---|---|---|
| **lane address** | `<repo>/root` / `<repo>/<name>` | `vantage-point/root` / `vantage-point/feat-api` |
| **wire address** | `agent@<repo>` / `agent@<repo>/<name>` | `agent@vantage-point/feat-api` |
| **board inbox** | `board@<repo>/<name>` | `board@vantage-point/feat-api` |

> ⚠️ **lane address から `/performer/` セグメントが消えました**（doc 44 P2）。旧形 (`<repo>/conductor` / `<repo>/performer/<name>`) は parse 側が受理して正規化しますが、**新しく書く記述は新形で**。
>
> **`root` は役割ではなく予約名**です。`LaneKind`（Conductor / Performer）は撤去され、「lane は役割状態を持たない」(doc 44 D4) になりました。lane は全て対等で、root lane は *たまたま開発起点である* lane にすぎません。orchestrate するかどうかは運用の話であって、lane の属性ではない。

---

## クイックスタート

```bash
vp app start     # vp-app GUI を起動（daemon が無ければ auto-launch）
```

repo runtime は vp-app sidebar から expand → auto-spawn。起動していなくても、MCP ツールを呼べば自動的に起動します。

---

## 典型シナリオ

### 1. board に貼る

```
mcp__vantage-point__show
  content: "# 進捗\n- A 完了\n- B 着手"
  content_type: "markdown"
  title: "進捗"
```

### 2. 貼ったものを書き換える（積み増さない）

```
mcp__vantage-point__read_board      → item の id を取る
mcp__vantage-point__update
  id: "<その id>"
  content: "# 進捗\n- A 完了\n- B 完了"
```

進捗表・テスト結果・設計の現行形は **1 枚を update** する。board が「流れるログ」ではなく「現在の状態を映す面」になります。

### 3. ログをリアルタイム監視（CLI のみ）

```bash
vp file watch /tmp/build.log right --format json_lines --filter "INFO|WARN|ERROR"
vp file unwatch right   # 停止
```

### 4. 並列 lane 展開 + handoff

```
# 推奨: atomic handoff
mcp__vantage-point__flow_handoff
  name: "feat-api"
  task_spec: "<markdown 仕様>"
  mode: "auto" | "hitl"      # default: hitl
  agent: "claude"            # claude(default) / codex / grok / opencode / shell
  model: "opus"              # 機械的作業=sonnet / 中核設計=opus

# 低レベル fallback
mcp__vantage-point__add_sub  name: "feat-api", branch: "user/feat-api"
mcp__vantage-point__wire_send      to: ["agent@<repo>/feat-api"], body: { kind: "task", category: "command", task_spec: "..." }
# nudge は CLI で（MCP に lane_nudge は無い）:
#   vp lane nudge <repo>/feat-api "task が届いています。wire_recv で確認して着手。"
```

`flow_progress` で全 lane の git status + 未読 wire + `flow_state` / `control_surrender` を 1 view で監視。

### 5. repo 跨ぎ inter-agent 通信

```
mcp__vantage-point__wire_send    to: ["agent@creo-memories"], body: { text: "review request", category: "command" }
mcp__vantage-point__wire_inbox   # 未読数だけ（cursor 不触り）
mcp__vantage-point__wire_recv    timeout: 10
mcp__vantage-point__wire_ack     message_id: "<id>"   # 処理"後"に
mcp__vantage-point__wire_thread  message_id: "<id>"   # 系譜を辿る
```

thread は `prev` parent-pointer で表現されます（`thread_id` は無い）。

### 6. GUI を AI が調律する（HITL ループ）

```
mcp__vantage-point__editor_fields                              # 弄れる knob を知る
mcp__vantage-point__editor_set   id: "sb.text.base", value: 1.75   # 画面が即変わる
mcp__vantage-point__editor_values                              # ユーザーの手調整も含めて回収
# → AI が自分の Edit で source に落とす（書き戻し tool は無い。これが正規経路 = doc 48 D-B）
```

```
mcp__vantage-point__layout_get   scope: "app"
mcp__vantage-point__layout_set   scope: "app", notation: "console | board/runner", attention: { runner: 0 }
mcp__vantage-point__layout_history  scope: "app"   # 人間が組んだ形 / AI の変更を監査
```

### 7. 画面を見て確かめる

```bash
vp shot -o /tmp/vp.png --region main       # CLI が上位互換（--region / --rect / --series）
```
```
mcp__vantage-point__capture_window  path: "/tmp/vp.png"
```

→ Read tool で PNG を視覚 review。

---

## MCP Tools 一覧（VP v0.57、全 26 個）

### board 🧭

| Tool | 用途 |
|------|------|
| `show` | 現 lane の board に item を貼る（markdown / html / log / url） |
| `update` | board item を **id 指定で in-place 置換**（位置と title は保持） |
| `read_board` | board の全 item を id / title / content_type / 全文つきで取得（newest-first） |
| `clear` | board を clear |
| `capture_window` | vp-app window 全体を PNG capture |
| `switch_lane` | active lane 切替（`root` or Sub 名） |

### lane

| Tool | 用途 |
|------|------|
| `add_sub` | Sub lane を作成（lane clone + spawn）。`agent` / `base` / `model` 指定可 |
| `delete_sub` | Sub lane を片付け（`cleanup: false` で dir 残置） |
| `list_lanes` | 全 lane 一覧（`sub_status` / `mailbox_addresses` / `repo_addresses` 付き）。`kind` = `root` \| `sub` |

> lane への text 注入と console 読み取りは **CLI のみ**: `vp lane nudge <lane> <text>` / `vp lane capture <lane>`

### dev-flow

| Tool | 用途 |
|------|------|
| `flow_handoff` | lane 作成 + `wire_send` + nudge を atomic（失敗時 rollback） |
| `flow_progress` | 全 lane の git status + 未読 wire + `flow_state`（6 state）/ `control_surrender` 集約 |

### wire

| Tool | 用途 |
|------|------|
| `wire_send` | wire address に送信。`reply_to` なし = 新規 thread root |
| `wire_recv` | 未読受信（読むと cursor 前進） |
| `wire_inbox` | 未読数だけ確認（cursor 不触り） |
| `wire_ack` | `category: command` の受領確認（**処理後**に打つ） |
| `wire_thread` | message 系譜 trace（root-first、cursor 不触り） |

### delegation（async future）

| Tool | 用途 |
|------|------|
| `delegate` | task を doer lane に委譲し turn を park（spin-wait 不要） |
| `complete` | 委譲 task の outcome 報告（`done` / `failed` / `needs_input`） |
| `respond` | doer の `needs_input` への回答 |

### GUI live tuning

| Tool | 用途 |
|------|------|
| `editor_fields` | live-tunable な design knob 一覧（id / label / type / cssVar / constraints） |
| `editor_values` | 現在値を読む（**ユーザーの手調整も含む**） |
| `editor_set` | knob を設定（即座に画面反映、永続化はしない） |
| `layout_get` | pane layout（notation / attention / shares / locks）を読む |
| `layout_set` | pane layout を設定（即適用 + settle-log に author `ai` で記録） |
| `layout_history` | settle-log（`human` / `ai` / `scene` の変更履歴） |

### process

| Tool | 用途 |
|------|------|
| `restart` | repo runtime restart（session 状態保持） |

**詳細な param は `reference/mcp-tools.md`**。

---

## MCP ↔ CLI pair invariant

VP は「同じ logic を MCP（AI 用）と CLI（人間用）の両方から expose する」を invariant として持ちます。**現在 2 方向に例外があります** — これを知っていると「どちらで叩くか」の判断が速くなります。

### MCP のみ（CLI pair なし）

`read_board` / `update` / `editor_fields` / `editor_values` / `editor_set` / `layout_get` / `layout_set` / `layout_history`

→ いずれも対象が **GUI の生きた状態**（board item の id、画面上の CSS var、pane の attention field）。CLI の一発実行モデルでは掴めないため。

### CLI のみ（MCP pair なし）

| CLI | 用途 |
|---|---|
| `vp lane nudge` / `vp lane capture` | lane への text 注入 / console 読み取り |
| `vp lane fork` / `status` / `cleanup` / `history` / `origin` | lane の派生・棚卸し・帳簿 |
| `vp lane slots` / `slot-new` / `slot-close` | console slot の増減（**1 lane に session を複数座らせる**、doc 46 P5） |
| `vp pane split` / `close` / `toggle` | pane 操作 |
| `vp file watch` / `unwatch` | ログの実時間監視 |
| `vp wire watch` / `watch-supervised` / `discover` / `hook-check` / `deleg-thread` | 購読・federation discovery・hook・委譲観測 |
| `vp now` | session の「今なにを」を 1 行報告（**サブタスクの切れ目ごとに打つ想定**） |
| `vp events` | event log（agent の episodic memory） |
| `vp repos` / `vp sync` / `vp auth` | repo 管理・ghost repo 除去・Creo ID 認証 |

### `list_lanes` vs `vp ps` vs `vp lane ls`

- **`list_lanes`** — 現 repo の全 lane。`sub_status` / `mailbox_addresses` 付き
- **`vp ps`** — daemon 配下の全 repo runtime 一覧
- **`vp lane ls`** — fs scan の簡易表示（runtime 不要）
- **`vp lane ls --detail`** — `list_lanes` の CLI pair（runtime 稼働中のみ）

---

## アーキテクチャ

```
daemon ⚙️ — 常駐、全 repo runtime を統括
  │
  └── repo 📦 (Repo Runtime) — repo 単位の容器
        ├── conversation 💬 — AI との会話層（host / 翻訳 / transcript）
        │                     mode: tui（PTY console）/ gui（ChatView + HITL 4 面）
        ├── board 🧭 — 貼る台（item は id を持つ）
        ├── runner 🌿 — Code Runner（process 管理）
        └── lane — 作業台（cwd / branch / board / layout を持つ checkout）
              ├── root      — 開発起点 lane（予約名。役割ではない）
              └── <name>    — 並列 lane（worktree）
                    └── slot × 0..N — 1 lane に session が複数座れる（doc 46 P5）
                          agent: claude / codex / grok / opencode / shell
                          root session = lane の代表
```

lane は全て対等です（doc 44 D4）。「orchestrate する側 / される側」は **運用上の役割**であって、lane が持つ状態ではありません。

### 1 lane = 1 session ではない

**lane には session（slot）が 0..N 枚座ります**（doc 46 P5 / A5-2 で実装済み）。`pty_slots`（tui の端末）/ `term_attaches`（Term grid）/ `chat_engines`（gui）はいずれも `(lane, session)` 粒度で保持されます。

かつて「端末を持てるのは root session だけ」という制約がありましたが、これは lane の性質ではなく **slot の枚数**が作っていた制約で、既に解消されています。

**root session が特別なのは「lane の代表」である点だけ** — mailbox（wire の読み手）/ pid / Dead 判定 / 省略時の解決先を担います。

```bash
vp lane slots <lane>       # この lane の console slot 一覧
vp lane slot-new <lane>    # console をもう 1 枚立てる
vp lane slot-close <lane>  # 1 枚閉じる
```

> slot 操作は **CLI のみ**（MCP tool は無い）。`list_lanes` の返り値も現状は lane 粒度で、session 一覧は含みません（doc 54 R4「pane 一覧配信」で変わる予定）。
>
> VP は更に「**働き手（worker）**」という identity 層（VP 発行 id の永久欠番 / 代表の自動継承と空位許容）へ向かっています（doc 54）。**モデルの物理（複数 session）は上記のとおり実装済み**で、未実装なのは identity 層 — 現状の session 鍵は `SessionKey`（lane 内の小整数、Reset で再利用）です。

---

## board の表示モデル

- `show` した内容は現 lane の board に **item として積まれる**。各 item は **id** を持つ
- **`update` で id 指定の in-place 置換ができる** — 未知 id は意図的に loud fail（黙って重複を作らない）
- `pane_id` は撤去済み。現行は `scope` のみで値は `lane` 一択
- `append` は MCP に無く CLI (`vp pane show --append`) のみ
- lane を切り替えると board も切り替わる（`switch_lane`）

### content_type

| タイプ | 説明 |
|--------|------|
| `markdown` | **デフォルト・推奨** |
| `html` | 精密な視覚レイアウトが要るとき（dashboard / 色付き図） |
| `log` | ログ形式（追記向け） |
| `url` | 外部 URL を iframe 埋め込み |

---

## wire delivery policy

`wire_send` の `body.category` で delivery を制御します:

| category | 挙動 |
|----------|------|
| `command` | **default**。受信者が `wire_ack` するまで再 nudge |
| `event` / `data` / `state` / `log` | fire-and-forget、再掲示なし |

- **store が真実、push は加速**: message は lane 単位の store に届く（配送不能な状態は存在しない）。nudge は「今の代表が agent のときだけ肩を叩く」加速装置
- **ack は処理後に**: `wire_recv` で受信しただけでは ack にならない。未 ack の `command` は再掲示され続ける
- 未 ack の手紙は後任に引き継がれます（受領即 ack が「後任に二重配送させない礼儀」）

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| repo runtime が stale（sidebar 緑だが console 壊れ） | vp-app sidebar の 🔄（Restart）ボタン |
| lane が dead 化 | lifecycle monitor が 5s 以内に検知 → sidebar 赤 dot → 手動 respawn |
| `mcp_call timeout` | `restart` / `vp restart-all` |
| `wire_*` が動かない | runtime 起動確認（`vp app start` → sidebar expand）、wire address を再確認（`agent@<repo>` / `agent@<repo>/<name>`） |
| command msg が何度も nudge される | 受信側が `wire_ack` を忘れている |
| lane address が「見つからない」 | `/Sub/` セグメントを付けていないか確認（v0.56+ は `<repo>/<name>`） |
| `stand` パラメータが弾かれる | `agent` に改名済み（値 `echoes` → `claude`） |
| `read_pane` / `list_canvas` / `capture_canvas` が無い | `read_board` / `capture_window` に統合・改名済み |
| `editor_*` / `layout_*` が失敗する | **vp-app 稼働が前提**（`vp app start`） |
| `update` が id エラーで落ちる | 仕様（未知 id は loud fail）。`read_board` で id を取り直す |

---

## 開発・dogfooding tip（maintainer 向け）

- GUI 変更の実機確認は `mise run app:swap`（DRY build → `/Applications/VantagePoint.app` 差し替え → 起動）
- log は XDG state zone: `~/.local/state/vp/log/`
- daemon 再起動は 2 種: `vp daemon stop` = gentle（repo runtime 温存）/ cascade（全停止）。lane 内から検証するときは gentle 側
- サブタスクの切れ目で `vp now` を打つと、session の「今なにを」が 1 行で board / sidebar に残る

---

## 関連

- **dev-flow skill**: `skills/dev-flow/SKILL.md` — 並列 orchestration の 6 phase
- **詳細リファレンス**: `reference/mcp-tools.md` — 26 tool の完全な param
- **VP リポジトリ**: https://github.com/chronista-club/vantage-point
- 関連 memory: mental model（`mem_1CaVnfJRgWtuRgZD9yQSoV`）/ dev-flow overview（`mem_1CbUUzvguCptQPU4eWTKHx`）/ 命名エピック台帳（`mem_1CdQxvayZBB3E768g1mDbQ`）
