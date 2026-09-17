/**
 * VP mod — Claude Mods（function hooks）で Vantage Point と繋ぐ hooks module。
 *
 * 読み込み条件: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`（early access。2.1.274 で実測。VP は
 * 0.71 以降 spawn 時に焼く）。VP の外（`VP_REPO` / `VP_LANE` が無い）で起動された claude では
 * 何もしない。
 *
 * daemon との橋は `$.process.run(["vp", …])` 一本 — VP の transport は Unison(QUIC) で
 * `$.http` は届かないし、CLI が daemon RPC の唯一の公認入口なので mod は「もう 1 人の
 * CLI 利用者」に過ぎない（daemon に mod 専用 API を足さない）。
 *
 * 1. `vp now` 自動化 — `turn.start` / `tool.call` / `turn.complete` から now-line を書く。
 *    AI が手で打った `vp now` を優先する（Bash の command で見えるので、その後
 *    HAND_NOW_HOLD_MS は mod が黙る）。
 * 2. wire × prompt — VP の nudge 文言（delivery_actor::nudge_text）が prompt に入った瞬間
 *    に `vp wire recv` で本文を取り、`vp wire ack` を済ませ、prompt 本文を「本文 + ack 済み」
 *    に書き換える。「ack 忘れ → 再 nudge → 二重配送」を構造的に消す。
 * 3. diff → board — Edit / Write / NotebookEdit と、差分を動かしうる Bash の後に
 *    `git diff`（uncommitted 全体）を board の固定 pane `diff` に貼る。差分ゼロで閉じる。
 * 4. daemon guard — lane の中から daemon を止める command（`vp daemon stop|restart` /
 *    `vp restart-all` / `VP_SWAP_RESTART_DAEMON=1`）を deny する。lane の claude は daemon の
 *    子なので、通すと自分ごと落ちて `start` に届かない（CLAUDE.md の ⚠️ を構造に降ろす）。
 *
 * 実行モデル: hook は **queue に積むだけ**で、`vp` / `git` の spawn は `session.start` で立てた
 * `$.clock.every` の drain が dispatch の外で回す（hook の dispatch には budget があり、
 * 捨てられると `next.signal` で中断される）。now-line は最新だけ書き、diff は 1 回に畳む。
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
/** queue を drain する周期 */
const DRAIN_EVERY_MS = 250
/** VP の nudge 文言（`📨 wire: … message_id=<id> …`）。delivery_actor::nudge_text と対 */
const NUDGE_RE = /📨 wire:.*message_id=([A-Za-z0-9_-]+)/u
/** 旧世代の Main 予約名 — VP 本体 `wire_address_from_env` と同じ扱い */
const MAIN_LANE_NAMES = new Set(['main', 'root', 'conductor'])
/** 編集系 tool（この後に diff を貼り直す） */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
/** 差分を動かしうる Bash（git 操作 / formatter / in-place 編集 / package 系）。他は turn.complete の保険で拾う */
export const DIFF_BASH_RE = /\b(git|cargo|rustfmt|fmt|sed|patch|mv|rm|cp|bun|npm|pnpm|prettier|biome|eslint|mise)\b/u
/**
 * lane の中から打つと自分ごと落ちる command。`vp daemon start` / `status` は通す。
 * `mise run daemon`（dev profile、:32100）は brew の lane を落とさないので対象外。
 */
export const DAEMON_KILL_RE =
  /\bvp\s+(?:daemon\s+(?:stop|restart)|restart-all)\b|\bVP_SWAP_RESTART_DAEMON=1\b|\blaunchctl\s+(?:bootout|kickstart|unload)\b/u
/** board の diff item の title（`update` は title を保つので固定。件数は本文の見出しに出す） */
const DIFF_TITLE = 'diff'
/** VP の MCP server 名（`/mcp` に出る名前 = plugin の `.mcp.json` の key） */
const VP_MCP_SERVER = 'vantage-point'
/** MCP `show` の応答文から貼った item の id を拾う（VP 0.71+ が `id=<uuid>` を付ける） */
const SHOW_ID_RE = /\bid=([0-9a-fA-F-]{8,})\b/u
/** diff markdown の上限（file ごとの行数 / 全体の文字数 — board を重くしない） */
const DIFF_FILE_MAX_LINES = 120
const DIFF_TOTAL_MAX_CHARS = 30_000

// ---- module 状態（session.start で確定、以降の hook が読む） ----
let identity: Identity | null = null
let cwd = ''
let handNowUntil = 0
let tracePath: string | undefined
const trace: string[] = []
/** 直前の prompt.submit が wire nudge だったとき、その本文の一行（turn.start の now-line 用） */
let nudgeNowLine: string | null = null
/** 書きたい now-line（最新だけ。drain が取り出して書く） */
let pendingNow: string | null = null
/** 貼り直したい diff（`touched` = 直前に触った file、先頭に出す。drain が 1 回に畳む） */
let pendingDiff: { touched: string | null } | null = null
let isDraining = false
/** board 上の diff item の id（初回 `show` の応答から。以後は `update` で 1 枚を差し替える） */
let diffItemId: string | null = null
/** `show` が id を返さなかった（VP 0.70 以前）— 差し替えられないので、積み上げないよう以後は貼らない */
let isDiffShowWithoutId = false

/**
 * `VP_REPO` / `VP_LANE` から身元を導く（純関数）。Main は `agent@<repo>`、Sub は
 * `agent@<repo>/<lane>`。どちらか欠けていれば VP 外 = null。
 */
export function identityOf(repo: string | undefined, lane: string | undefined): Identity | null {
  if (!repo || !lane) return null
  const wire = MAIN_LANE_NAMES.has(lane) ? `agent@${repo}` : `agent@${repo}/${lane}`
  return { repo, lane, wire }
}

/** 先頭の空でない行だけ、空白を畳んで、長さを詰める */
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

/** `git diff` の出力を file ごとに割る（純関数）。`diff --git a/<p> b/<p>` を境に */
export function splitDiffByFile(full: string): { path: string; body: string }[] {
  const files: { path: string; body: string }[] = []
  for (const chunk of full.split(/^(?=diff --git )/mu)) {
    if (chunk.trim() === '') continue
    const m = /^diff --git a\/(.+?) b\/(.+)$/mu.exec(chunk)
    files.push({ path: m?.[2] ?? '(unknown)', body: chunk.trimEnd() })
  }
  return files
}

/**
 * board に貼る diff markdown を組む（純関数）。
 * 直前に触った file を先頭に、file ごとに ```diff fence（行数上限つき）、全体にも文字数上限。
 * 差分ゼロ（tracked も untracked も無し）なら null = pane を閉じる合図。
 */
export function diffMarkdownOf(
  full: string,
  stat: string,
  untracked: readonly string[],
  touched: string | null,
): { title: string; markdown: string } | null {
  const files = splitDiffByFile(full)
  if (files.length === 0 && untracked.length === 0) return null
  const ordered = touched
    ? [...files.filter(f => f.path === touched), ...files.filter(f => f.path !== touched)]
    : files
  const count = files.length + untracked.length
  const title = `diff · ${count} file${count === 1 ? '' : 's'}`
  const parts: string[] = [`## ${title}`]
  if (stat.trim() !== '') parts.push('```\n' + stat.trimEnd() + '\n```')
  if (untracked.length > 0) parts.push(`新規（未追跡）: ${untracked.map(p => '`' + p + '`').join(', ')}`)
  for (const f of ordered) {
    const lines = f.body.split('\n')
    const shown = lines.slice(0, DIFF_FILE_MAX_LINES)
    const rest = lines.length - shown.length
    parts.push(`### ${f.path}`)
    parts.push('```diff\n' + shown.join('\n') + (rest > 0 ? `\n… (+${rest} 行)` : '') + '\n```')
  }
  let markdown = parts.join('\n\n')
  if (markdown.length > DIFF_TOTAL_MAX_CHARS) {
    markdown = `${markdown.slice(0, DIFF_TOTAL_MAX_CHARS)}\n… (全体 ${markdown.length} 文字を切り詰め)`
  }
  return { title, markdown }
}

/** MCP result の text block を繋ぐ（純関数） */
export function mcpTextOf(result: { content?: readonly { type?: string; text?: string }[] }): string {
  return (result.content ?? [])
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
}

/** MCP `show` の応答文から item id を拾う（純関数）。無ければ null（旧 daemon） */
export function showItemIdOf(text: string): string | null {
  return SHOW_ID_RE.exec(text)?.[1] ?? null
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

/** now-line を頼む（最新だけ残す）。手打ち優先窓の中は黙る */
function enqueueNow(text: string): void {
  if (!identity) return
  const line = oneLine(text)
  if (line === '') return
  pendingNow = line
}

/** diff の貼り直しを頼む（1 回に畳む。`touched` は先頭に出す file） */
function enqueueDiff(touched: string | null): void {
  if (!identity) return
  pendingDiff = { touched: touched ?? pendingDiff?.touched ?? null }
}

/**
 * queue を空にする。`session.start` の `$.clock.every` から周期的に呼ばれる（dispatch の外）。
 * 同時に 1 本だけ走る。now → diff の順（now-line の方が軽く、鮮度が命）。
 */
async function drain($: EngineInterface): Promise<void> {
  if (isDraining) return
  isDraining = true
  try {
    while (pendingNow !== null || pendingDiff !== null) {
      if (pendingNow !== null) {
        const line = pendingNow
        pendingNow = null
        await writeNow($, line)
      } else if (pendingDiff !== null) {
        const { touched } = pendingDiff
        pendingDiff = null
        await refreshDiff($, touched)
      }
    }
  } finally {
    isDraining = false
  }
}

/** `vp now` を 1 回書く */
async function writeNow($: EngineInterface, line: string): Promise<void> {
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

/** `git diff` を取って board の diff pane に貼る（差分ゼロなら閉じる） */
async function refreshDiff($: EngineInterface, touched: string | null): Promise<void> {
  const t0 = Date.now()
  try {
    const stat = await $.process.run(['git', 'diff', '--no-color', '--stat'], { timeoutMs: 10_000 })
    if (stat.exitCode !== 0) {
      await log($, `diff skip (not a git repo?) ${oneLine(stat.stderr, 120)}`)
      return
    }
    const full = await $.process.run(['git', 'diff', '--no-color'], { timeoutMs: 10_000 })
    const others = await $.process.run(['git', 'ls-files', '--others', '--exclude-standard'], { timeoutMs: 10_000 })
    const untracked = others.exitCode === 0 ? others.stdout.split('\n').filter(l => l.trim() !== '') : []
    const md = diffMarkdownOf(full.stdout, stat.stdout, untracked, touched)
    // board は per-lane 1 枚の stack で、`show` は毎回新しい item を積む（`--pane-id` は dead
    // field、doc 52 §7）。1 枚を保つには初回 `show` の id を控えて以後 `update`（doc 52 §5）。
    // item を消す API は無いので、差分ゼロは「差分なし」に書き換えて残す。
    if (md === null) {
      if (diffItemId !== null) {
        const r = await $.mcp.call(VP_MCP_SERVER, 'update', { id: diffItemId, content: '## diff\n\n✓ 差分なし（clean）' })
        await log($, `diff clean ${Date.now() - t0}ms isError=${r.isError === true}`)
      }
      return
    }
    if (diffItemId !== null) {
      const r = await $.mcp.call(VP_MCP_SERVER, 'update', { id: diffItemId, content: md.markdown })
      if (r.isError === true) {
        // id が消えた（board clear 等）→ 次は貼り直す
        diffItemId = null
        await log($, `diff update failed ${Date.now() - t0}ms ${oneLine(mcpTextOf(r), 120)}`)
        return
      }
      await log($, `diff update ${Date.now() - t0}ms ${md.title} ${md.markdown.length} chars`)
      return
    }
    if (isDiffShowWithoutId) {
      await log($, `diff skip (daemon が id を返さない: 1 枚目で止める) ${md.title}`)
      return
    }
    const r = await $.mcp.call(VP_MCP_SERVER, 'show', { content: md.markdown, content_type: 'markdown', title: DIFF_TITLE })
    const text = mcpTextOf(r)
    diffItemId = r.isError === true ? null : showItemIdOf(text)
    if (r.isError !== true && diffItemId === null) isDiffShowWithoutId = true
    await log($, `diff show ${Date.now() - t0}ms isError=${r.isError === true} id=${diffItemId ?? '-'} ${md.title} ${md.markdown.length} chars`)
  } catch (err) {
    await log($, `diff failed ${Date.now() - t0}ms ${String(err)}`)
  }
}

/**
 * hooks module の入口。`session.start` で身元を確定し、drain の timer を立てる。
 */
export function register(on: On) {
  on('session.start', async ($, e, next) => {
    tracePath = await $.env.get('VP_MOD_TRACE')
    identity = identityOf(await $.env.get('VP_REPO'), await $.env.get('VP_LANE'))
    cwd = e.cwd
    await log($, `session.start cwd=${cwd} identity=${JSON.stringify(identity)}`)
    if (identity) {
      // queue の drain は dispatch の外（timer）で回す。module reload で timer は落ちる
      $.clock.every(DRAIN_EVERY_MS, () => {
        void drain($)
      })
    }
    return next(e)
  })

  // 4. daemon guard — now-line の hook より先に登録する（deny なら next を呼ばない = 下は走らない）
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String((e as Record<string, unknown>).command ?? '')
    if (identity && DAEMON_KILL_RE.test(command)) {
      await log($, `deny daemon kill: ${oneLine(command, 120)}`)
      return {
        deny:
          `[vp-mod] この session は VP の lane（${identity.wire}）の中で動いていて、daemon の子プロセスです。` +
          ' daemon を止める command を通すと自分ごと落ちて、その後の start / swap に届きません。' +
          ' この command は VP の外（kitty 等のターミナル）から mako に打ってもらってください。',
      }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await log($, `turn.start turnId=${e.turnId} text=${oneLine(e.text, 40)}`)
    // wire nudge の turn は nudge 文言でなく本文を出す（prompt.submit が用意している）
    const line = nudgeNowLine ?? `▶ ${e.text}`
    nudgeNowLine = null
    enqueueNow(line)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const args = e as { tool: string } & Record<string, unknown>
    await log($, `tool.call ${args.tool}`)
    const command = args.tool === 'Bash' ? String(args.command ?? '') : ''
    if (args.tool === 'Bash' && /^\s*vp\s+now\b/u.test(command)) {
      // AI の手打ち `vp now` — 以後しばらく mod は下地を書かない（裁定 B: 手打ち優先）
      handNowUntil = Date.now() + HAND_NOW_HOLD_MS
      pendingNow = null
      await log($, `hand vp now → hold ${HAND_NOW_HOLD_MS}ms`)
    } else {
      enqueueNow(summarizeCall(args, cwd))
    }
    // 3. diff → board: 編集が終わってから貼り直す（`next(e)` の後 = 結果が出た後）
    const result = await next(e)
    if (EDIT_TOOLS.has(args.tool)) {
      enqueueDiff(shortPath(args.file_path ?? args.notebook_path, cwd) || null)
    } else if (args.tool === 'Bash' && DIFF_BASH_RE.test(command)) {
      enqueueDiff(null)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    await log($, `turn.complete turnId=${e.turnId} aborted=${e.isAborted} ${e.durationMs}ms`)
    // console（tui）は turn 後も最後の tool 名が残るので、終わりを一行で示す。
    // chat（gui）は TurnCompleted で now-line が消える既存仕様なので、そちらでは見えない
    enqueueNow(e.isAborted ? '⏹ 中断' : `✓ ${e.answer}`)
    // Bash の取りこぼし（DIFF_BASH_RE に無い command で差分が動いた）の保険
    enqueueDiff(null)
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
