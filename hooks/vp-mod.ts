/**
 * VP mod — Claude Mods（function hooks）で Vantage Point と繋ぐ hooks module。
 *
 * 読み込み条件: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`（early access。2.1.274 で実測）。
 * VP の外（`VP_REPO` / `VP_LANE` が無い）で起動された claude では何もしない。
 *
 * daemon との橋は `$.process.run(["vp", …])` 一本 — VP の transport は Unison(QUIC) で
 * `$.http` は届かないし、CLI が daemon RPC の唯一の公認入口なので mod は「もう 1 人の
 * CLI 利用者」に過ぎない（daemon に mod 専用 API を足さない）。
 *
 * 1. `vp now` 自動化 — `turn.start` / `tool.call` から now-line の下地を機械的に書く。
 *    AI が手で打った `vp now` を優先する（Bash の command で見えるので、その後
 *    HAND_NOW_HOLD_MS は mod が黙る）。`turn.complete` では書かない（GUI は TurnCompleted
 *    で now-line を消す既存仕様、`vp now ""` は CLI が拒む）。
 * 2. wire × prompt — VP の nudge 文言（delivery_actor::nudge_text）が prompt に入った瞬間
 *    に `vp wire recv` で本文を取り、`vp wire ack` を済ませ、本文を context で model に渡す。
 *    「ack 忘れ → 再 nudge → 二重配送」を構造的に消す。
 *
 * 診断: `VP_MOD_TRACE=<path>` を渡すと hook の入口ごとに 1 行ずつ書く（gate の内側ではなく
 * 入口で書く — 沈黙が「到達していない」と「条件不一致」の二義にならないように）。
 *
 * 書き方の制約（`claude plugin validate` の静的解析）: `$` を渡せる先は **この file の
 * top-level の function 宣言だけ**。closure に `$` を渡すと validate が落ちるので、
 * helper は top-level に置き、状態は module 変数で持つ。
 */
import type { EngineInterface, On } from 'claude-code'

/** VP 内の自分の身元（env から導出、`wire` は `vp wire --agent` に渡す address） */
type Identity = { repo: string; lane: string; wire: string }

/** AI が手で `vp now` を打ってから、mod が下地を書かずに黙る時間 */
const HAND_NOW_HOLD_MS = 120_000
/** now-line に書く最大文字数（GUI の名札直下の一行に収まる長さ） */
const NOW_MAX_CHARS = 60
/** VP の nudge 文言（`📨 wire: … message_id=<id> …`）。delivery_actor::nudge_text と対 */
const NUDGE_RE = /📨 wire:.*message_id=([A-Za-z0-9_-]+)/u
/** 旧世代の Main 予約名 — VP 本体 `wire_address_from_env` と同じ扱い */
const MAIN_LANE_NAMES = new Set(['main', 'root', 'conductor'])

// ---- module 状態（session.start で確定、以降の hook が読む） ----
let identity: Identity | null = null
let cwd = ''
let handNowUntil = 0
let tracePath: string | undefined
const trace: string[] = []
/** now-line の書き込み列。spawn は chain の外で走らせるが、順序だけは守る */
let nowChain: Promise<void> = Promise.resolve()
/** 最後に頼まれた now-line。列に溜まった古い依頼は書かずに捨てる（最新だけ書く） */
let latestNow = ''
/** 直前の prompt.submit が wire nudge だったとき、その本文の一行（turn.start の now-line 用） */
let nudgeNowLine: string | null = null

/**
 * `VP_REPO` / `VP_LANE` から身元を導く（純関数）。Main は `agent@<repo>`、Sub は
 * `agent@<repo>/<lane>`。どちらか欠けていれば VP 外 = null。
 */
export function identityOf(repo: string | undefined, lane: string | undefined): Identity | null {
  if (!repo || !lane) return null
  const wire = MAIN_LANE_NAMES.has(lane) ? `agent@${repo}` : `agent@${repo}/${lane}`
  return { repo, lane, wire }
}

/** 先頭行だけ、空白を畳んで、長さを詰める */
export function oneLine(text: string, max = NOW_MAX_CHARS): string {
  const line = text.split('\n').find(l => l.trim() !== '') ?? ''
  const squashed = line.replace(/\s+/gu, ' ').trim()
  return squashed.length > max ? `${squashed.slice(0, max - 1)}…` : squashed
}

/** cwd 配下の path は相対にして短く見せる */
function shortPath(path: unknown, base: string): string {
  if (typeof path !== 'string') return ''
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

/**
 * tool.call の引数から now-line の一行を作る（純関数）。
 * 引数は `e` の top-level に乗る（`ToolEnvelope & Arguments`）。MCP tool は
 * `mcp__<server>__<tool>` の prefix を落として tool 名だけ見せる。
 */
export function summarizeCall(e: { tool: string } & Record<string, unknown>, base: string): string {
  const { tool } = e
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'Read':
      return `${tool} ${shortPath(e.file_path, base)}`
    case 'NotebookEdit':
      return `${tool} ${shortPath(e.notebook_path, base)}`
    case 'Bash':
      return `Bash ${oneLine(String(e.description ?? e.command ?? ''))}`
    case 'Agent':
      return `Agent ${oneLine(String(e.description ?? ''))}`
    case 'Grep':
    case 'Glob':
      return `${tool} ${oneLine(String(e.pattern ?? ''))}`
    default: {
      const m = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/u.exec(tool)
      return m?.[1] ?? tool
    }
  }
}

/** 診断 1 行（`VP_MOD_TRACE` 指定時のみ file に出す。`$.fs.write` は全量書きなので溜めて書く） */
async function log($: EngineInterface, line: string): Promise<void> {
  if (!tracePath) return
  trace.push(`${new Date().toISOString()} ${line}`)
  try {
    await $.fs.write(tracePath, `${trace.join('\n')}\n`)
  } catch {
    // 診断は本体を止めない
  }
}

/**
 * `vp wire recv` の JSON から now-line 用の一行を作る（純関数）。
 * `📨 <from>: <text>`。形が読めなければ null（呼び手が既定に落とす）。
 */
export function nudgeLineOf(recvStdout: string): string | null {
  try {
    const parsed: unknown = JSON.parse(recvStdout)
    if (typeof parsed !== 'object' || parsed === null) return null
    const messages = (parsed as { messages?: unknown }).messages
    if (!Array.isArray(messages) || messages.length === 0) return null
    const first = messages[0] as { from?: unknown; body?: { text?: unknown } }
    const text = typeof first.body?.text === 'string' ? first.body.text : ''
    const from = typeof first.from === 'string' ? first.from : 'wire'
    return text === '' ? null : `📨 ${from}: ${text}`
  } catch {
    return null
  }
}

/**
 * now-line の下地を頼む。手打ち優先窓の中は黙る。
 *
 * 実際の `vp now` は chain の外で、ただし **直列に** 走る（fire-and-forget を並列にすると
 * 遅い前の呼びが後から書いて now-line が古くなる）。列に並んでいる間に新しい依頼が来たら
 * 古い方は書かない — 読む側が欲しいのは常に最新の一行だけ。
 */
function reportNow($: EngineInterface, text: string): void {
  if (!identity) return
  const line = oneLine(text)
  if (line === '') return
  latestNow = line
  nowChain = nowChain.then(() => writeNow($, line))
}

/** `vp now` を 1 回書く（reportNow の列の中で呼ばれる） */
async function writeNow($: EngineInterface, line: string): Promise<void> {
  if (line !== latestNow) {
    await log($, `now coalesced ${line}`)
    return
  }
  if (Date.now() < handNowUntil) {
    await log($, `now skip (hand hold) ${line}`)
    return
  }
  const t0 = Date.now()
  try {
    const r = await $.process.run(['vp', 'now', line], { timeoutMs: 3_000 })
    await log($, `now ${Date.now() - t0}ms exit=${r.exitCode} ${line}${r.stderr ? ` stderr=${oneLine(r.stderr, 120)}` : ''}`)
  } catch (err) {
    await log($, `now failed ${Date.now() - t0}ms ${String(err)}`)
  }
}

/**
 * hooks module の入口。`session.start` で身元を確定し、以降の hook はそれを見て動く。
 */
export function register(on: On) {
  on('session.start', async ($, e, next) => {
    tracePath = await $.env.get('VP_MOD_TRACE')
    identity = identityOf(await $.env.get('VP_REPO'), await $.env.get('VP_LANE'))
    cwd = e.cwd
    await log($, `session.start cwd=${cwd} identity=${JSON.stringify(identity)}`)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await log($, `turn.start turnId=${e.turnId} text=${oneLine(e.text, 40)}`)
    // wire nudge の turn は nudge 文言でなく本文を出す（prompt.submit が用意している）
    const line = nudgeNowLine ?? `▶ ${e.text}`
    nudgeNowLine = null
    reportNow($, line)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const args = e as { tool: string } & Record<string, unknown>
    await log($, `tool.call ${args.tool}`)
    if (args.tool === 'Bash' && /^\s*vp\s+now\b/u.test(String(args.command ?? ''))) {
      // AI の手打ち `vp now` — 以後しばらく mod は下地を書かない（裁定 B: 手打ち優先）
      handNowUntil = Date.now() + HAND_NOW_HOLD_MS
      await log($, `hand vp now → hold ${HAND_NOW_HOLD_MS}ms`)
    } else {
      reportNow($, summarizeCall(args, cwd))
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const m = NUDGE_RE.exec(e.text)
    await log($, `prompt.submit origin=${e.origin.kind} nudge=${m ? m[1] : '-'}`)
    if (!m || !identity) return next(e)
    const id = m[1] ?? ''
    const { wire } = identity
    // 本文を先に取る（recv は cursor を進める）→ ack。順序を逆にしても再配送はされないが、
    // 本文が無いまま ack だけ済むのは避ける
    const recv = await $.process.run(['vp', 'wire', 'recv', '--agent', wire, '--timeout', '1'], { timeoutMs: 10_000 })
    const ack = await $.process.run(['vp', 'wire', 'ack', '--message-id', id, '--agent', wire], { timeoutMs: 5_000 })
    await log($, `wire recv exit=${recv.exitCode} ${oneLine(recv.stdout, 80)} / ack exit=${ack.exitCode}`)
    const body = recv.exitCode === 0 ? recv.stdout.trim() : `(vp wire recv failed: ${oneLine(recv.stderr, 120)})`
    nudgeNowLine = recv.exitCode === 0 ? nudgeLineOf(recv.stdout) : null
    // nudge 文言（「wire_recv で受信し、処理後に wire_ack してください」）は model への手順書
    // なので、済ませた今はそのまま見せない — 本文と「ack 済み」に書き換える。context に
    // 生 JSON（thread / from / prev）を添えて、返信や thread 参照はそこから取れるようにする
    const text = [
      `📨 wire（message_id=${id}）— 受領時に ack 済み。wire_recv / wire_ack は呼ばなくてよい。`,
      nudgeNowLine ? nudgeNowLine.replace(/^📨 /u, '') : '(本文なし: 既に読まれた message か、recv が空)',
    ].join('\n')
    const context = `[vp-mod] vp wire recv の生 JSON（返信・thread 参照用）:\n${body}`
    return next({ ...e, text, context: [...(e.context ?? []), context] })
  })
}
