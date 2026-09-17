// hooks/vp-mod.ts の純関数 test（bun test）。hook 本体は `claude plugin validate` と実機で見る。
import { describe, expect, test } from 'bun:test'

import {
  DAEMON_KILL_RE,
  DIFF_BASH_RE,
  diffMarkdownOf,
  identityOf,
  mcpTextOf,
  nudgeLineOf,
  oneLine,
  showItemIdOf,
  splitDiffByFile,
  summarizeCall,
} from '../hooks/vp-mod'

describe('identityOf', () => {
  test('main / 旧予約名は agent@<repo>', () => {
    expect(identityOf('vantage-point', 'main')?.wire).toBe('agent@vantage-point')
    expect(identityOf('vantage-point', 'root')?.wire).toBe('agent@vantage-point')
    expect(identityOf('vantage-point', 'conductor')?.wire).toBe('agent@vantage-point')
  })
  test('sub は agent@<repo>/<lane>', () => {
    expect(identityOf('vantage-point', 'modtest')?.wire).toBe('agent@vantage-point/modtest')
  })
  test('env が欠けていれば VP 外 = null', () => {
    expect(identityOf(undefined, 'main')).toBeNull()
    expect(identityOf('vantage-point', '')).toBeNull()
  })
})

describe('oneLine', () => {
  test('先頭の空でない行だけ、空白を畳む', () => {
    expect(oneLine('\n\n  a   b\nc')).toBe('a b')
  })
  test('上限を超えたら … で詰める', () => {
    expect(oneLine('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('summarizeCall', () => {
  const cwd = '/repo'
  test('Edit / Write / Read は cwd 相対 path', () => {
    expect(summarizeCall({ tool: 'Edit', file_path: '/repo/src/a.rs' }, cwd)).toBe('Edit src/a.rs')
    expect(summarizeCall({ tool: 'Read', file_path: '/other/b.rs' }, cwd)).toBe('Read /other/b.rs')
  })
  test('Bash は description 優先、無ければ command', () => {
    expect(summarizeCall({ tool: 'Bash', command: 'cargo test', description: 'テスト実行' }, cwd)).toBe('Bash テスト実行')
    expect(summarizeCall({ tool: 'Bash', command: 'cargo test\n' }, cwd)).toBe('Bash cargo test')
  })
  test('MCP tool は prefix を落とす', () => {
    expect(summarizeCall({ tool: 'mcp__vantage-point__wire_recv' }, cwd)).toBe('wire_recv')
    expect(summarizeCall({ tool: 'mcp__creo_memories__remember' }, cwd)).toBe('remember')
  })
  test('知らない tool は名前だけ', () => {
    expect(summarizeCall({ tool: 'WebSearch', query: 'x' }, cwd)).toBe('WebSearch')
  })
})

describe('nudgeLineOf', () => {
  test('vp wire recv の JSON から 📨 <from>: <text>', () => {
    const out = JSON.stringify({ count: 1, messages: [{ from: 'vp-cli', body: { category: 'command', text: '1+1 は？' } }] })
    expect(nudgeLineOf(out)).toBe('📨 vp-cli: 1+1 は？')
  })
  test('空・壊れた JSON は null', () => {
    expect(nudgeLineOf('{"count":0,"messages":[]}')).toBeNull()
    expect(nudgeLineOf('not json')).toBeNull()
  })
})

describe('DAEMON_KILL_RE（lane の中から daemon を止める command）', () => {
  test('止める側は捕まえる', () => {
    for (const c of [
      'vp daemon stop',
      'vp daemon restart --if-running',
      'vp restart-all',
      'VP_SWAP_RESTART_DAEMON=1 mise run app:swap',
      'cd ~/repos/x && VP_SWAP_RESTART_DAEMON=1 mise run app:swap',
      'launchctl kickstart -k gui/501/club.chronista.vp',
    ]) {
      expect(DAEMON_KILL_RE.test(c), c).toBe(true)
    }
  })
  test('止めない側は通す', () => {
    for (const c of ['vp daemon status', 'vp daemon start', 'mise run app:swap', 'mise run daemon', 'vp ps', 'vp now "x"']) {
      expect(DAEMON_KILL_RE.test(c), c).toBe(false)
    }
  })
})

describe('DIFF_BASH_RE（差分を動かしうる Bash）', () => {
  test('git / formatter / in-place 編集は貼り直す', () => {
    for (const c of ['git checkout -- a.rs', 'cargo fmt --all', "sed -i '' 's/a/b/' x", 'bun run build', 'mise run check']) {
      expect(DIFF_BASH_RE.test(c), c).toBe(true)
    }
  })
  test('読むだけの command は貼り直さない', () => {
    for (const c of ['ls -la', 'cat README.md', 'echo hi', 'vp lane list']) {
      expect(DIFF_BASH_RE.test(c), c).toBe(false)
    }
  })
})

const DIFF_TWO_FILES = [
  'diff --git a/src/a.rs b/src/a.rs',
  'index 1..2 100644',
  '--- a/src/a.rs',
  '+++ b/src/a.rs',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  'diff --git a/README.md b/README.md',
  'index 3..4 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' # t',
  '+more',
  '',
].join('\n')

describe('splitDiffByFile', () => {
  test('diff --git を境に file ごとに割る', () => {
    const files = splitDiffByFile(DIFF_TWO_FILES)
    expect(files.map(f => f.path)).toEqual(['src/a.rs', 'README.md'])
    expect(files[0]?.body.startsWith('diff --git a/src/a.rs')).toBe(true)
  })
  test('空なら空配列', () => {
    expect(splitDiffByFile('')).toEqual([])
  })
})

describe('diffMarkdownOf', () => {
  test('触った file を先頭に、file ごとの diff fence、件数を title に', () => {
    const md = diffMarkdownOf(DIFF_TWO_FILES, ' 2 files changed', [], 'README.md')
    expect(md?.title).toBe('diff · 2 files')
    const first = md!.markdown.indexOf('### README.md')
    const second = md!.markdown.indexOf('### src/a.rs')
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(second)
    expect(md!.markdown).toContain('```diff\ndiff --git a/README.md')
  })
  test('untracked は一覧で出し、件数に含める', () => {
    const md = diffMarkdownOf('', '', ['new.txt'], null)
    expect(md?.title).toBe('diff · 1 file')
    expect(md?.markdown).toContain('新規（未追跡）: `new.txt`')
  })
  test('差分ゼロは null（pane を閉じる合図）', () => {
    expect(diffMarkdownOf('', '', [], null)).toBeNull()
  })
  test('長い file は行数で切って残りを示す', () => {
    const body = ['diff --git a/x b/x', ...Array.from({ length: 300 }, (_, i) => `+${i}`)].join('\n')
    const md = diffMarkdownOf(body, '', [], null)
    expect(md?.markdown).toContain('… (+181 行)')
  })
})

describe('showItemIdOf / mcpTextOf', () => {
  test('VP 0.71+ の show 応答から id を拾う', () => {
    expect(showItemIdOf('Content pinned to the board. id=ee3c111c-7cb1-4edd-ae29-4530c5a44bc7')).toBe('ee3c111c-7cb1-4edd-ae29-4530c5a44bc7')
  })
  test('旧 daemon（id 無し）は null', () => {
    expect(showItemIdOf('Content pinned to the board.')).toBeNull()
  })
  test('MCP result の text block を繋ぐ', () => {
    expect(mcpTextOf({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })).toBe('a\nb')
    expect(mcpTextOf({})).toBe('')
  })
})
