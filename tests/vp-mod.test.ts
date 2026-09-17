// hooks/vp-mod.ts の純関数 test（bun test）。hook 本体は `claude plugin validate` と実機で見る。
import { describe, expect, test } from 'bun:test'

import { identityOf, nudgeLineOf, oneLine, summarizeCall } from '../hooks/vp-mod'

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
