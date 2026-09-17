# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

- feat: **Claude Mods（function hooks）の hooks module `hooks/vp-mod.ts`** を追加。`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` の claude だけが読む（early access。Claude Code 2.1.274 で実測、それ以前の版は未確認）。
  - `vp now` の自動化 — `turn.start` / `tool.call` から now-line の下地を書く。AI の手打ち `vp now` を優先（2 分間は mod が黙る）。書き込みは chain の外で直列（順序を守り、古い依頼は間引く）。実測: `vp now` 1 回 130〜330 ms、chain には乗らない
  - wire の受領 ack — VP の nudge 文言を `prompt.submit` で検知し、`vp wire recv` → `vp wire ack` を済ませ、prompt 本文を「本文 + ack 済み」に書き換える（生 JSON は context に添える）。実測（`-p` 経路）: 検知から ack まで約 420 ms、model は MCP の wire tool を呼ばず 1 turn で応答
  - VP の外では何もしない（`VP_REPO` / `VP_LANE` 不在 = null）。daemon との橋は `$.process.run(["vp", …])` のみ
- test: `tests/vp-mod.test.ts`（bun test、純関数）と `tsconfig.json`（`types/claude-code.d.ts` = `/plugin-types` の出力）を追加。CI に bun test / tsc を追加
- docs: README に「Claude Mods」節。host-support に `hooks.json` の `modules` key（Claude 専用、他 host は無視する前提）を明記

## [0.24.0] - 2026-09-06

- 新しい plugin-vantage-point リポジトリを正本とし、Claude Code / Codex の共有 skills と配布定義を追加。
- ホスト固有の前提を明記し、検証・CI・安定配布経路を整備。

## 0.23.0 (2026-09-01)

- feat: **`.mcp.json` を追加** — プラグインが `vp mcp` を stdio MCP サーバとして宣言する。これまで **VP プラグインを入れても MCP ツールは付いてこなかった**（commands / skills / hooks のみ）。mako 環境で `mcp__vantage-point__*` が使えていたのは個人の共有 config store が宣言を肩代わりしていたためで、他の環境では再現しなかった。`{"command": "vp", "args": ["mcp"]}` は個人パスを含まずポータブル。`.mcp.json` はプラグインルートの MCP 自動検出位置で、公式に推奨される宣言方式（plugin-dev `mcp-integration` の Method 1）。既存 2 プラグイン（creo-memories = http / team-bucciarati = バイナリ同梱）と同じ `mcpServers` 形式に揃えた
- docs: README に「MCP サーバの宣言」節を追加。Requirements を「インストール済み」から「**PATH にある**こと」に精緻化し、brew cask のインストールコマンドを明記。**`vp` が PATH に無い環境ではセッションごとに接続エラーが出る**というトレードオフも明示した（バイナリ配布と MCP 宣言は別レイヤーで、VP は Rust + WebView の GUI アプリのためクラウド化もバイナリ同梱も採れない）
- 検証: `vp mcp` が MCP `initialize` に正しく応答することを実測（`rmcp 1.8.0`、exit=0）
- 依頼元: `agent@claude-plugin-chronista-style` からの wire handoff（claude-plugins PR #11 で DEVELOPMENT.md に事実として記録済み）

## 0.22.0 (2026-08-16)

- docs: 語彙を **Main/Sub** へ全面同期（VP #1003 と対）— `performer` → `sub`（`add_sub` / `delete_sub` / `sub_status` / `kind: "sub"`）、表記は Main lane / Sub。識別子（予約名 `root`、wire address）は不変
- 移行表に performer → sub 段を追記。歴史記述（旧 address 形・旧 `LaneKind`）は当時の語のまま維持


## [Unreleased]

## [0.21.1] - 2026-07-28

### Fixed

- **「1 lane に session が 0..N 枚座る」を未実装として書いていた誤りを訂正**。v0.21.0 は doc 54 の Status 行「実装未着手」を根拠に、このモデルを「起草段階」として 1 行注記に留めていた。実際には **doc 54 が語彙と identity 層を設計する前に、モデルの物理は doc 46 P5 / A5-2 で先に実装済み**だった（Status 行が指していたのは doc 54 固有の schema 束）。実装の証跡:
  - `LanePool` の `pty_slots` / `term_attaches` / `chat_engines` はいずれも **`(lane, session)` の 2 段 map**（`crates/vantage-point/src/repo/lanes_state.rs`）
  - 「旧実装は lane に 1 本だったため『tui になれるのは root session だけ』という制約があったが、それは lane の性質ではなく **slot の枚数**が作っていた制約だった」（同ファイルのコメント）
  - CLI `vp lane slots` / `slot-new` / `slot-close`（VP 本体 PR #916）
  - `root` が特別なのは **lane の代表**（mailbox / pid / Dead 判定 / 省略時の解決先）である点だけで、「端末を持てるのは root だけ」という制約は既に無い
- `skills/vantage-point/SKILL.md`（v0.21.1）: architecture 図に slot 層を追加し、「**1 lane = 1 session ではない**」節を新設（3 つの入れ物の粒度 / root = 代表の意味 / `vp lane slots` 系の CLI / slot 操作は MCP に無く `list_lanes` も現状 lane 粒度であること）。未実装として残るのは **worker identity 層**（VP 発行 id の永久欠番 / 代表の自動継承と空位許容）で、現状の session 鍵は `SessionKey`（lane 内の小整数、Reset で再利用）である旨に注記を差し替え
- `skills/dev-flow/SKILL.md`（v0.4.1）: 「lane = worktree + **独立した** agent session の合成体」という 1 session 前提の表現を訂正し、slot が 0..N 枚座ること・root session が代表を担うことを明記
- CLI 一覧の `vp lane slots` 系の説明に「1 lane に session を複数座らせる」意義を追記

## [0.21.0] - 2026-07-27

VP **v0.46 → v0.57**（12 release 分）の乖離を一括解消。plugin は v0.44/v0.45 想定のまま止まっていた。

### Changed

- **MCP tool surface を 20 → 26 に同期**（SSOT = `crates/vantage-point/src/mcp.rs` + `src/mcp/{editor,layout}.rs` + `src/generated/agent_tools.rs`、後者は `schema/vp-agent.kdl` 由来）:
  - 撤去: `read_pane` / `list_canvas` → **`read_board`** に統合（id / title / content_type / 全文を newest-first で返す）
  - 改名: `capture_canvas` → **`capture_window`**
  - param 差し替え: `show` / `clear` の `pane_id` → **`scope`**（`lane` 一択、dead field だった `pane_id` は消滅）/ `add_performer` / `flow_handoff` の `stand` → **`agent`**（値 `echoes` → `claude`、`codex` / `grok` / `opencode` / `shell` が選択肢に追加）/ `list_lanes` の `kind` `conductor` → **`root`**、`mailbox_addresses.canvas` → **`board`**、top-level に `repo_addresses` / `machine_addresses` 追加
  - `restart` に `open_viewer` param
- **v0.56 命名エピック（PR #936〜#946、JoJo 由来命名の全撤去）へ全面追随**。SSOT = VP 本体 `CLAUDE.md`「アーキテクチャ命名体系」。Paisley Park/PP/Canvas → **board** / Gold Experience → **runner** / Star Platinum・SP・project（容器の義）→ **repo** / TheWorld・World → **daemon** / Echoes → **conversation** / Stand → **agent**（engine 軸）+ component + service に分解 / The Hand → **shell** / Hermit Purple・Stone Free → 消滅 / `@world` → **`@machine`** / act（chat・tui）→ **mode**（gui・tui）。旧 doc 読解用の対応表を SKILL.md / reference / README に掲載
- **lane address の構造変更に追随**（doc 44 P2）: `<repo>/conductor` / `<repo>/performer/<name>` → **`<repo>/root` / `<repo>/<name>`**（`/performer/` セグメント撤去）。旧形は `LanePool::parse_address` が受理して正規化されるが、新規記述は新形に統一。wire address（`agent@<repo>` / `agent@<repo>/<name>`）は不変
- **`skills/dev-flow/SKILL.md` を lane 対等モデルで全面再設計**（v0.3.3 → v0.4.0）。VP が `LaneKind`（Conductor / Performer）を撤去し「lane は役割状態を持たない」(doc 44 D4) へ舵を切ったのを受け、「Conductor という役割」と「control surrender という関係」の二重表現を **control の所在だけ**に畳んだ。`root` は予約名であって役割ではないこと、`add_performer` / `flow_handoff` の performer は「lane を作って仕事を渡す動詞」であって種族名ではないことを明記。6 state FSM（`idle` / `working` / `hitl_pending` / `awaiting_user` / `completed` / `stuck`）と `control_surrender` は VP 側で健在なため保持し、表示ラベル（⏸ / 🤖 / 🤝 / 🙋 / ✅ / ⚠）を追記
- **`skills/vantage-point/SKILL.md` を全面改訂**（5 柱 → 6 柱）。architecture 図・tool 表・トラブルシューティング・dogfooding tip を現行語彙へ。旧名で書かれた doc / memory を読むための対応表を追加
- **CLI 新サーフェスを反映**: 新 top-level `vp now` / `vp events` / `vp repos` / `vp auth` / `vp sync`、`vp lane` に fork / status / cleanup / history / last-session / resume-failed / capture / slots / slot-new / slot-close / origin、`vp wire` に discover / hook-check / deleg-thread / watch-supervised、`vp shot` の `--region` / `--rect` / `--series`（MCP `capture_window` に対し **CLI が上位互換**）
- `hooks/scripts/lane-status.sh` の語彙と案内文を現行化（「performer 環境」→「lane (作業台)」、新 lane address の明示、`vp lane ls --detail` / `vp lane status` を案内に追加）。lane 判定 pattern `/\.vp/lanes/` は現行のままで正しいことを実機確認
- `plugin.json` の description / keywords を新語彙へ（`canvas`/`performer-lane`/`wiremsg` → `board`/`lane`/`wire`/`gui-tuning`）

### Added

- **GUI live tuning を skill 本編の柱として追加**（doc 48 / doc 49）:
  - `editor_fields` / `editor_values` / `editor_set` — GUI に bind された design knob の列挙・読み・設定。**書き戻し専用 tool は設計上存在しない**（doc 48 D-B）: ユーザーが slider で探索 → AI が `editor_values` で読む → **AI 自身の Edit で source に落とす**、が正規経路で、これにより探索が `git diff` に出る
  - `layout_get` / `layout_set` / `layout_history` — pane layout（creo-ui-layout の attention field）の取得・設定・settle-log。`notation`（`|` 列区切り / `/` 縦積み / `~` floating）は構造のみを表しサイズは持たず、サイズは `attention` の領分。変更は author `ai` として settle-log に記録され、全 pane が隠れる指定は reject
- **`update` tool を軸にした board 運用パターン**を追加。進捗表・テスト結果・設計の現行形は `show` で積み増すのではなく `read_board` → `update` で **1 枚を書き換える**。board が「流れるログ」から「現在の状態を映す面」になる。未知 id は意図的に loud fail（黙って重複を作らない）
- **agent engine 選択の指針**を dev-flow skill に追加。`claude`（default）/ `codex` / `grok` / `opencode` / `shell` の使い分けと、**engine は不変属性**という規律（engine を替える操作は存在しない — 会話の文脈は engine 間を移動できないため、乗り換えるなら隣に新しい lane を立てる）。`shell` lane も wire の市民権を持つ（市民権は席の env に付く）
- **「MCP ↔ CLI pair invariant の例外」を明文化**。`read_board` / `update` / `editor_*` / `layout_*` の 8 本は **MCP 専用**（対象が GUI の生きた状態 = board item の id、画面上の CSS var、pane の attention field で、CLI の一発実行モデルでは掴めない）。逆に `vp shot` は `capture_window` の上位互換になっており、pair は「同じ logic を両方から」であって「同じ機能量」ではないことを注記
- dev-flow skill に「落とし穴」表を追加（`/performer/` 付き address、`stand` param、受信 ≠ ack、board の積み増し、engine 途中変更、`stuck` の見分け）

### Removed

- 陳腐化した未 merge ローカルブランチ 2 本を削除: `docs/sync-vp-v0.45`（PR #13 で main にマージ済みの残骸）/ `docs/sync-vp-v0.40-conductor-performer`（v0.40 時代、main が先行して完全に陳腐化）

## [0.20.0] - 2026-07-14

### Changed
- **VP v0.45 実サーフェスに追随** (v0.44.0 → v0.45.0 の全 diff 確認):
  - MCP tool surface は **v0.44 から無変更** (`src/mcp{,.rs}` / `generated/agent_tools.rs` に diff ゼロ、 20 個のまま)。 対応バージョン表記を v0.44+ → v0.45+ に更新
  - **Act II HITL 4 面完成** (#748 質問 / #752 中断 / #753 permission / #754 plan 承認) を skill docs に反映 — performer echoes (Act II chat GUI) の native `AskUserQuestion` / permission prompt / `ExitPlanMode` が PromptCard / PermissionCard / PlanCard として直接ユーザに届き sidebar needs-you が点灯。 dev-flow skill には wire `needs_user` rail (conductor 経由) と並存する GUI 直通 rail として記述 (dev-flow v0.3.3)
  - **二重 dispatch TOCTOU 根治** (#750、 `create_performer_orchestrated` の creation reservation — `add_performer` / `flow_handoff` / `vp lane new` 共通 core) を tool 説明 + troubleshooting に追記
  - SKILL.md pair table の崩れを修正: `restart` 行と MCP に存在しない `port_*` 行が table 外 (「CLI のみ」段落直後) に漏出していた — `restart` を pair table 内に戻し、 `port_*` 行を削除
- **skill docs を VP v0.44 実サーフェスに全面同期** (`skills/vantage-point/SKILL.md` / `reference/mcp-tools.md` / `skills/dev-flow/SKILL.md` / `README.md`)。 SSOT = `crates/vantage-point/src/mcp{,.rs}` + `src/generated/agent_tools.rs`、 実 MCP tool は 20 個:
  - 存在しない tool の記述を削除: `toggle_pane` / `close_pane` / `watch_file` / `unwatch_file` / `port_show|url|roles|layout` / `permission` (#625 tool 整理で撤去) + `lane_nudge` (MCP には元から無い、 CLI `vp lane nudge` のみ)。 main に残っていた `tmux_*` / `eval_ruby` 系 / `add_wing` / `capture_terminal` / `open_canvas` 系も一掃
  - `show`: `append` param は存在しない / `pane_id` は dead field (全 show は現 lane の PP body stack に集約、 doc 19) — 旧 3-pane (main/left/right) モデルの記述を撤去
  - `delete_performer`: param は `force` でなく `cleanup`。 `add_performer` / `flow_handoff` に `stand` / `base` / `model` を追記
  - dev-flow: control state machine を 5 → 6 state に更新 (`awaiting_user` 追加、 2026-07-11 VP 本体) + wire kind `needs_user` を taxonomy に追加。 `mcp__creo-memories-mito__remember` → `mcp__creo-memories__remember`
  - 用語を conductor / performer に統一 (未 merge branch `docs/sync-vp-v0.40-conductor-performer` の同期内容を土台に取り込み)
  - `vp app` → `vp app start`、 対応バージョン v0.40+ → v0.44+、 dogfooding tip を現行化 (XDG log path / `mise run app:swap`)

### Fixed
- **hooks/lane-status.sh の lane 判定が silent no-op だったのを修正**: 判定 pattern `/vp/lanes/` が現 lane 配置 `<repo>/.vp/lanes/` (project-local、 旧 `vp_data_dir()/lanes/` から移動) に不一致で、 in-lane 分岐が常に不発だった。 pattern を `/\.vp/lanes/` に更新
- **`plugin.json` description を刷新**: 「Rich dashboard display - show memories, todos...」(旧 3-pane dashboard 前提) から「AI-native development environment — Canvas visualization, performer lanes, wiremsg inter-agent messaging, and dev-flow orchestration」へ。 keywords も同期 (`dashboard`/`memories`/`todos`/`context` → `canvas`/`performer-lane`/`wiremsg`/`dev-flow`/`orchestration`)

### Removed
- **`commands/show.md` / `commands/clear.md`**: MCP tool `show` / `clear` の薄い wrapper。 `show.md` は存在しない `append` param を記載していた。 MCP tool 自体は現存、 CLI からは直接 tool 呼び出しで代替可能
- **`commands/dashboard.md`**: 前提の 3-pane (main/left/right) モデルが崩壊 (`pane_id` は dead field、 全 show は PP body stack に集約) + `gh issue list --label next` が現運用 (GitHub Issues 不使用、 creo-memories に一本化) と矛盾
- **`hooks/scripts/session-start.sh`**: 案内していた `/vantage-point:dashboard` が削除済み (リンク切れ) + git repo/branch context は Claude Code 標準 context と重複。 「VP Lane 環境 / lane 一覧」出力は元々 `hooks/scripts/lane-status.sh` の責務であり、 削除後も維持される
- **`hooks/scripts/block-ask-in-worker.sh`** + `hooks.json` の `PreToolUse` entry: (a) lane 判定 pattern が `/vp/lanes/` のままで現配置 `<repo>/.vp/lanes/` に不一致、 常に no-op と化していた、 (b) VP 本体が doc 35 で Act II HITL (`AskUserQuestion` を control protocol 経由で復活させる方向) を進めており、 本 hook の「worker で AskUserQuestion を block する」方針自体が現行の設計方向と逆行するため確定で削除


## [0.19.1] - 2026-07-13

### Fixed
- **lane session 蘇り bug**: SessionStart hook に `vp wire hook-check` を追加し、 lane の CC session id 記録 (VP 本体 R3-b、 `cc_session` state file) の書き手を plugin が担う。 旧方式 (= global `~/.claude/settings.json` への手動設置、 new-machine-setup 依存) は settings 掃除で silent に消え、「lane で New Session しても daemon/app 再起動で古い session が `--resume` される」不具合の根因だった (実機で `cc_sessions/` の state file が 3 週間 mtime 凍結を確認)。 plugin 同梱により install に追従して自動修復。 `vp` 不在マシンは `command -v` guard で silent skip (fail-open)。 VP 本体側の root fix は別途追跡

### Added
- `rename` command (`commands/rename.md`): ローカル LLM (LM Studio) で日本語セッション名を生成 (#8)
- `dev-flow` skill (`skills/dev-flow/SKILL.md`): VP の Lead × Wing × Memory orchestration による開発フロー — hearing → 議論 → spec memory → wing handoff → 並列追跡 → merge の 6 phase。 chronista-style stack (= hearing / codeflow / council / sex-pistols / santa-method 等) と統合、 auto / human-in-the-loop の 2 mode + 動的 shift trigger を formalize。 canonical memory `mem_1CbUUzvguCptQPU4eWTKHx`
- dev-flow skill v0.2.0: **principle 5 「control surrender awareness」 追加** + 「worker」 用語撤去 (= VP は wing 1 用語に統一、 役割 / 動的主体としても wing が立つ)。 5 state FSM (idle / working / hitl_pending / completed / stuck) を wire pattern で derive、 metadata 追加ゼロで「control 手放してる / 手放してない」 を可視化。 lead が複数 wing の control 状態を一望して必要な wing にだけ介入する構造を formalize
- **SKILL.md に「MCP ↔ CLI pair invariant」 section を追加**: VP の規約 (= 同じ logic を MCP / CLI 両方から expose) を明文化、 pair table + invariant の守り方 + `list_lanes` vs `vp ps` vs `vp lane ls` の役割整理を追記 (VP 本体 PR mcp-cli-audit)


## [0.18.0] - 2026-05-22

### Changed
- wiremsg 移行に doc を同期: `msg_send` / `msg_recv` / `msg_ack` / `msg_peers` / `msg_thread` / `msg_directory` / `msg_broadcast` を `wire_send` / `wire_recv` / `wire_thread` に差し替え (VP 本体 PR #406〜#420)
- `vp mailbox` CLI → `vp wire watch` / `vp wire send` / `vp wire watch-supervised` に同期
- ccwire / msgbox は廃止、 inter-agent 通信は wiremsg に一本化。 thread は `prev` parent-pointer で表現 (`thread_id` は無い)
- SKILL.md / reference/mcp-tools.md / hooks スクリプトの inter-agent 通信記述を wiremsg に更新
- SKILL.md の旧 Worker workspace section を Wing Lane (Whitesnake 🐍 連動) に rename: `add_worker` / `delete_worker` 表記を `add_wing` / `delete_wing` に更新 (VP 本体 lane refactor `worker→wing` 2026-05-17 と同期、 doc rot 解消)


## [0.17.0] - 2026-05-08

### Added
- `add_worker` / `delete_worker` ツール: Worker workspace の lifecycle 管理 (ccws clone-based isolated workspace)
- `list_lanes` ツール: project 内 Lane 一覧取得 (Lead + Worker、 Frame Engine 連動)
- 3D Frame Layout Engine (PR-ε-1): Pane を portable 3D オブジェクトとして inversion、 4 default Scene + Ctrl+Shift+1..4 で切替
- PP body markdown 表示 = B 達成 (PR-ε-3): `mcp__show` → state.hub.broadcast → /ws → show-subscriber → vpPP.renderPP の 6 段 pipeline 物理化
- Live Token pattern 体系化 (#300, #301): terminal 5 token (fontSize / line-height / letter-spacing / font-family / cursor-style) を creo-ui-editor-host から runtime 編集可能
- per-Lane Scene state preservation: Lane 切替で Scene layout を維持 (`Map<LaneAddress, SceneId>`)

### Changed
- 35 tools (旧 28 から +7)。 SKILL.md / reference/mcp-tools.md を v0.17.0 状態に同期
- `Heaven's Door 📖 (HD)` → `Echoes 💬` rename (VP-118): Coding Assistant Stand 名称変更、 actor address `hd@*` → `echoes@*`
- `Hermit Purple 🍇` を World 階層に物理移管 (LSCM PR-α series): `hermit_purple@world` rewire
- `Paisley Park 🧭` を Lane 階層に物理移管 (LSCM PR-β series): cardinality 1 → N (Lane あたり独立 instance)

### Removed
- `split_pane` ツール: 削除 (Frame Engine の portable オブジェクト inversion により不要に)
- `open_canvas` / `close_canvas` ツール: 削除 (Canvas は vp-app の常駐 view component に統合)


## [0.15.2] - 2026-05-02

### Fixed
- `skills/vantage-point/SKILL.md` に YAML frontmatter 不在で `/reload-plugins` が「1 error」 を出していた問題を解消
- 公式 spec 必須: skill の SKILL.md 先頭に `name` / `description` / `version` / `tags` の frontmatter


## [0.15.1] - 2026-05-02

### Changed
- Skill tree refactor: `vantage-point/SKILL.md` → `skills/vantage-point/SKILL.md` (公式 spec 準拠)

## [0.15.0] - 2026-05-02

### Changed
- Spec compliance: license/homepage fields, CHANGELOG, dropped legacy skills.txt
