---
name: dev-flow
description: VP の lane orchestration による並列開発フロー — hearing → 議論 → spec memory → handoff
  → 並列追跡 → merge の 6 phase。「並列開発」「handoff」「lane」「並列 lane」「control surrender」「dev flow」「Sub」等のキーワードで
  invoke
metadata:
  version: "0.26.0"
  tags: dev-flow, orchestration, lane, memory-first, parallel-dev, handoff, control-surrender
---

## ホスト共通の読み方

このディレクトリが共有定義の正本。Claude Code は `.claude-plugin`、Codex は `.codex-plugin` から同じ skills を読む。Grok CLI は Claude 互換形式を対象とするが実機確認待ち。
本文中の `Agent`、`Bash`、`Read` や MCP の名前は Claude 表記の例。利用中のホストで提供された同等のツールを発見して使う。存在しないツール・モデル・実行結果を仮定しない。`${CLAUDE_PLUGIN_ROOT}` の資料パスは、この skill から辿れるプラグインルートに読み替える。

# VP Dev Flow — lane × wire × memory

> **AI ネイティブ開発フロー** — VP の lane（作業台）+ wire（郵便）+ creo memory（記憶）が揃ったことで物理的に成立した並列開発手法。chronista-style と統合した formalization。

## 起点

伝統的 dev = code 書く / PR / merge、spec は markdown / 議論は Slack / trail は git log で分散。VP × creo は **memory を背骨に、lane を実行体に、wire を transport にして** 1 つの orchestrated stream に統合します。

詳細仕様: creo memory `mem_1CbUUzvguCptQPU4eWTKHx`（本 skill の canonical reference）

---

## 中心原理 — lane は対等。役割は「control の所在」

**VP v0.56 で `LaneKind`（Conductor / Performer）は撤去されました**（doc 44 D4「lane 自身は役割状態を持たない」）。lane は全て対等な作業台であり、`root` は *たまたま開発起点である* lane を指す**予約名**にすぎません。

これは dev-flow にとって破壊ではなく **純化**です。旧モデルは「Conductor という役割」と「control surrender という関係」を二重に持っていました。役割側が消えたことで、**control の所在だけが唯一の役割表現**になります。

```
❌ 旧: 「Conductor lane」と「Sub lane」という 2 種類の存在がいる
✅ 新: lane は全て対等。「今どの lane が control を握っているか」という関係だけがある
```

実務上の帰結:

- **orchestrate しているのは lane ではなく、その時点で control を握っている側** — root lane が常に orchestrator とは限らない。Sub が別の lane に handoff することもできる
- **役割は固定されない** — control は surrender（手放す）と grab（握り直す）を繰り返す。それが orchestration そのもの
- **address に役割は現れない** — `<repo>/root` も `<repo>/feat-api` も同じ形。`/Sub/` セグメントは撤去済み

> ⚠️ ただし `add_sub` / `flow_handoff` という **tool 名には Sub が残っています**。これは「新しい lane を作って仕事を渡す」という**動詞**であって、作られた lane が特別な種族になるわけではありません。

---

## 5 つの principle

### 1. 起点 lane は idea / 議論 / orchestration の場

- `hearing` で要件抽出（= chronista-style:hearing）
- `council` で多角検証（= 4 voice）
- spec memory に decision を **stream** で trail（status:spark → in-progress → done）
- handoff + 進捗追跡 + 最終統合 / merge

### 2. handoff 先 lane は分解された task の実装主体

- lane-clone された worktree + そこに座る agent session の合成体
- **1 lane = 1 session ではない**（doc 46 P5）。session（slot）は 0..N 枚座れ、`vp lane slot-new` で増やせる。root session が **lane の代表**（wire の読み手 / pid / Dead 判定 / 省略時の解決先）を担う
- **auto mode**: spec を 1 回渡して自走、完了報告で初回 interaction
- **HITL mode**: 進捗 / blocker / 判断で thread 対話
- question wire が飛んだら自動的に HITL へ shift する escalation

### 3. wire は意思決定 + 状態の transport

- lane ↔ lane（同 repo / repo 跨ぎ）: 永続 inbox + thread（`reply_to` で chain）
- **store が真実、push は加速** — message は lane の箱に届く（配送不能な状態は存在しない）。nudge は肩を叩くだけ
- 全 message 永続化、supersede / annotate で trail

### 4. memory は decision lineage の永続化

- **spec** (principle / decision / rationale) / **feedback** (correction) / **project** (ongoing) / **reference** (external pointer)
- supersede / annotate / derivedFrom / extends で trail 完全保持
- 「memory が canonical、markdown は projection」

### 5. control surrender awareness — 「手放してる / 手放してない」の見える化

lane が対等になった今、**これが唯一の役割表現**です:

- **control 手放してる**（autonomous） → その lane は自走中、介入なし
- **control 手放してない**（interactive） → reply 待ち or 対話進行中

`flow_progress` が 6 state FSM で server 側 derive します。orchestration とは「**どの lane から control を手放し、どこで握り直すか**」の判断連鎖のこと。

---

## control state machine（6 state、server が derive）

```
        ┌─ idle (⏸ = 起動済、task 未受領)
        │
        ▼ 「task」 wire
   working (🤖 auto-running = 作業中、介入なし)  ← control 手放してる
        │
        ├─→ hitl_pending (🤝 = 「question」 wire 送信、reply 待ち)  ← control 手放してない
        │        │ 「approve / modify / clarify」 wire
        │        ▼
        │   working  ← control 再 surrender
        │
        ├─→ awaiting_user (🙋 needs-you = 「needs_user」 wire、**ユーザ本人**の回答待ち)
        │        │ user 回答 → reply
        │        ▼
        │   working
        │
        └─→ completed (✅ = 「complete」 wire、review 待ち)  ← control が戻る
                │
                ▼ merge
            merged / closed
        │
   stuck (⚠ = dirty あり + commit なし、詰まってる可能性)  ← 介入候補
```

`awaiting_user` は `hitl_pending` と**別軸**です — 前者は「AI 同士では代答できないユーザ本人待ち」、後者は「orchestrator 側の reply 待ち」。

> **GUI 直通 HITL rail（VP v0.45+）**: mode `gui`（ChatView）の lane では、native `AskUserQuestion` / permission prompt / `ExitPlanMode` が **PromptCard / PermissionCard / PlanCard として直接ユーザーに届きます**（sidebar の needs-you も点灯）。wire の `needs_user` rail（上図）と**並存**する経路で、ユーザーが lane を開いていれば GUI で即答でき、開いていなくても sidebar 点灯で気付けます。

### derive の入口

`flow_progress`（MCP `mcp__vantage-point__flow_progress` / CLI `vp flow progress`）が各 lane に `flow_state` / `control_surrender` / `state_reason` / `last_state_transition_at` / `sub_status` / `unread_wire_count` を返します。read-only で cursor は触りません。

### wire msg `kind` taxonomy（state derivation の入力）

| kind | 向き | 意味 |
|---|---|---|
| `task` | orchestrator → 実装 lane | 初手 handoff spec |
| `question` | 実装 lane → orchestrator | 質問 / decision 依頼 |
| `needs_user` | 実装 lane → orchestrator | **ユーザ本人**の判断が要る（AI では代答不可）。未 ack で `awaiting_user` |
| `ack` | 実装 lane → orchestrator | 受領 / progress |
| `decision` | 実装 lane → orchestrator | 自己判断の表明 |
| `approve` / `modify` / `clarify` | orchestrator → 実装 lane | reply |
| `complete` | 実装 lane → orchestrator | 完了報告 |
| `request` | 実装 lane → orchestrator | action 依頼（dogfood 等） |

---

## workflow 6 phase

```
Phase 1: idea / hearing        →  spark memory (status:spark)
   ↓
Phase 2: 議論 / refinement      →  status:in-progress + annotate trail
   ↓
Phase 3: spec 確定              →  status:done memory (derivedFrom / extends で lineage)
   ↓
Phase 4: 分解 + handoff         →  flow_handoff（推奨）or lane new + wire_send + lane nudge
   ↓
Phase 5: 並列追跡               →  flow_progress (+ wire_inbox / wire_recv で詳細)
   ↓                                  ↑
   │                                  │ HITL escalation（question wire）
   ↓
Phase 6: 統合 + merge           →  PR review → merge → retrospect memory
   │
   └→ learnings → Phase 1 へ feedback loop
```

各 phase が memory に stream で trail され、後の session が context-engine 経由で auto-load します。

---

## mode 選択基準

| mode | 条件 | 例 |
|---|---|---|
| **auto**（control 手放す） | spec 明確 / ambiguity 少 / test-driven / 既知 pattern | fmt fix、単純 refactor、docs update、schema migration boilerplate |
| **hitl**（control 握る、default） | 設計判断含む / spec 内 ambiguity / dogfood feedback 要 | 新 architecture、schema 設計、UX 判断、API 変更 |

**動的 shift trigger**:
- `question` wire → auto から HITL へ shift（control が戻る）
- `complete` wire → auto 完結（control が戻る、review へ）
- `approve` / `modify` / `clarify` wire → HITL から auto へ再 surrender

---

## agent engine の選択（v0.56+）

lane を作るとき `agent` param で engine を選べます:

| agent | 用途の目安 |
|---|---|
| `claude` | **default**。設計判断・文脈の厚い実装・review |
| `codex` | OpenAI Codex CLI を使いたいとき |
| `grok` | xAI Grok CLI を使いたいとき |
| `opencode` | opencode（model は opencode の config 側） |
| `shell` | AI なしの素の作業台。**人間が駆る席**（wire の市民権は席に付くので `vp wire inbox` / `vp now` / board はフルに使える） |

**規律: engine は不変属性です。** 「engine を替える」という操作は存在しません — 会話の文脈は物理的に engine 間を移動できないからです。乗り換えたければ **隣に新しい lane を立てる**。

`model` param（claude の alias）は task 難度に合わせます: 機械的作業 = `sonnet` / 中核設計 = `opus`。省略時は VP config の `default-lane-model`、無記録なら engine 側の user 既定（claude なら `~/.claude` 設定）に委ねられます。

---

## tools（VP v0.57 core セット）

| tool | layer | 用途 |
|---|---|---|
| `flow_handoff` / `vp flow handoff` | handoff | lane 作成 + `wire_send` + nudge を atomic（失敗時 rollback） |
| `flow_progress` / `vp flow progress` | state | 全 lane の git status + 未読 wire + `flow_state` / `control_surrender` 集約 |
| `add_sub` / `vp lane new` | lane 作成 | worktree + agent spawn（handoff を使わない低レベル操作） |
| `wire_send` / `vp wire send` | message | thread 化 inter-agent msg（`reply_to` で chain、`body.category` で delivery policy） |
| `wire_recv` / `vp wire recv` | message | 未読取得（cursor 前進） |
| `wire_inbox` / `vp wire inbox` | message | 未読数だけ（cursor 不触り、P5 の軽量ポーリング向け） |
| `wire_ack` / `vp wire ack` | message | `category: command` の受領確認（**処理後**に打つ） |
| `list_lanes` / `vp lane ls --detail` | routing | lane 一覧 + `sub_status` / `mailbox_addresses` |
| `vp lane nudge`（**CLI のみ**） | nudge | lane の agent / shell に text + Enter を注入 |
| `show` / `update` / `read_board` | view | board に構想 / 進捗を可視化。**進捗表は `update` で 1 枚を書き換える** |
| `mcp__creo-memories__remember` | persist | memory trail（atlas + tags + supersedes） |
| `gh pr merge --auto --squash` | ship | CI 通過後に自動 merge |

**補助 primitive**（単発委譲、wire handoff と併用可）: `delegate` / `complete` / `respond` — async future 型。doer が `complete` で報告し、requester は spin-wait 不要。

---

## handoff 標準 pattern

### A. 推奨: `flow_handoff`（1 call）

```
mcp__vantage-point__flow_handoff
  name: "<slug>"
  task_spec: "<markdown 仕様>"
  mode: "auto" | "hitl"      # default: hitl
  agent: "claude"            # claude(default) / codex / grok / opencode / shell
  model: "opus"              # 機械的=sonnet / 中核設計=opus
  branch: "<user>/<slug>"    # 省略可（auto-derive）
  base: "origin/nightly"     # 未 push の local branch も可
  nudge: true                # false = 完全 async（CLI flag は --no-nudge）
```

CLI: `vp flow handoff <slug> --task-spec <file|->`

→ lane 作成 + `wire_send` + nudge を atomic 実行。失敗時は lane を削除して rollback。

### B. 低レベル fallback（3 step）

```
# 1. lane 作成
vp lane new <slug> <user>/<slug>
  → worktree 作成 + agent auto spawn
  → zero-config で .mcp.json / CLAUDE.local.md / .env を auto-symlink

# 2. task spec を wire で送信
mcp__vantage-point__wire_send
  to: ["agent@<repo>/<slug>"]
  body: {
    kind: "task",
    category: "command",      # default（wire_ack まで再掲示）
    title: "...",
    task_spec: "<markdown 仕様>",
    mode: "auto" | "hitl",
    priority: "high",
    scope_outs: ["..."]
  }

# 3. nudge（MCP には無い、CLI のみ）
vp lane nudge <repo>/<slug> \
  "task が届いています。mcp__vantage-point__wire_recv で確認して着手。"
```

### C. 並列追跡

```
mcp__vantage-point__flow_progress    → flow_state / control_surrender / sub_status / unread_wire_count
mcp__vantage-point__wire_inbox       → 未読数だけ軽量確認（cursor 不触り）
mcp__vantage-point__wire_recv        → question / 完了報告の本文取得
mcp__vantage-point__wire_ack         → command msg を処理した後に ack
```

**進捗の可視化は board 1 枚を `update`** するのが定石:

```
mcp__vantage-point__read_board                        → 進捗 item の id を取る
mcp__vantage-point__update  id: "<id>", content: ...  → 積み増さず書き換える
```

### D. HITL reply

```
mcp__vantage-point__wire_send
  to: ["agent@<repo>/<slug>"]
  reply_to: "<相手の msg id>"
  body: { kind: "approve" | "modify" | "clarify", category: "command", ... }
  → control 再 surrender（自走に戻る）
```

---

## chronista-style stack 統合

| skill | dev flow phase |
|---|---|
| `hearing` | P1（要件抽出） |
| `codeflow` | P1-4 orchestrate（ヒアリング → SDG → 実装） |
| `spec-design-guide` | P3（Why / What / How を memory に） |
| `council` | P2（4 voice 合議） |
| `sex-pistols` | P4（並列 dispatch、6 unit coordinate） |
| `santa-method` | P6（2 reviewer 独立検証） |
| `route` | P3-4（goal までの path 探索） |
| `agent-introspection` | P5（lane の failure self-debug） |
| `size-stepper` | P4-5（design token 演奏。VP の `editor_*` と直結） |

---

## 落とし穴

| 症状 | 原因 / 対処 |
|---|---|
| lane address が解決しない | `/Sub/` を付けている。v0.56+ は `<repo>/<name>` |
| `stand` param が弾かれる | `agent` に改名（値 `echoes` → `claude`） |
| command msg が何度も nudge される | 受信側が `wire_ack` を忘れている（**受信 ≠ ack**） |
| `flow_progress` が古い値を返す | read-only cache。最新は `wire_recv` 側で確認 |
| board が進捗ログで溢れる | `show` で積み増している。`read_board` → `update` に切り替える |
| engine を途中で替えたい | **できない**（engine は不変属性）。隣に新しい lane を立てる |
| 手放したのに進まない | `flow_state` が `stuck`（dirty あり + commit なし）か確認 → 介入候補 |

---

## 真の paradigm shift

### 「dev = orchestrated stream of memories」

従来は spec が markdown / 議論が Slack / trail が git log に分散。新しくは idea → 議論 → spec → 実装 → review → learn が**全部 memory で trail** され、全 lane が同じ memory graph に access し、AI agent が一級市民として参加します。

### 「lane × wire × memory = AI cognition OS」

- **lane** = isolation（各作業台が独立した process / git context）
- **wire** = communication（inter-lane message + state machine event）
- **memory** = persistence（decision trail + knowledge）

3 つ揃って「人 + AI が pair で開発する environment」が物理的に成立します。

### 「control surrender は orchestration の単位」

lane が対等になったことで、orchestration の実体は「**どの lane から control を手放し、どこで握り直すか**」の判断連鎖だけになりました。6 state FSM が wire pattern からそれを derive し、orchestrator は lane 群の control 状態を一望して、必要な lane にだけ介入します。

これは「**複数 lane を同時並走させながら、orchestrator 側の認知コストを一定に保つ**」構造で、並列開発の規模拡張を可能にします。

---

## 関連 references

- canonical memory: `mem_1CbUUzvguCptQPU4eWTKHx`（dev-flow overview）
- knowledge layer: `mem_1CbUPuphWcEQq39MGX8k7z`（creo × KDL Ruby × Projection Engine 構想）
- VP 命名エピック台帳: `mem_1CdQxvayZBB3E768g1mDbQ`
- VP design doc: doc 44（lane の対等化 / D4 / P2）、doc 54（働き手モデル・起草）、doc 28（delegation）
- vantage-point skill: `skills/vantage-point/SKILL.md` — tool surface と語彙の SSOT
- chronista-style: `hearing` / `codeflow` / `council` / `sex-pistols` / `santa-method` / `route` / `agent-introspection` / `size-stepper`
