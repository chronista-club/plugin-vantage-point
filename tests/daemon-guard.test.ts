// task: mem_1Cg5ZMy8oPgcvmM1oq8X5W
import { expect, test } from 'bun:test'
import { register } from '../hooks/vp-mod'

async function guard(command: string) {
  const handlers: { event: string; filter: unknown; fn: Function }[] = []
  register(((event: string, ...args: unknown[]) => {
    handlers.push({ event, filter: args.length === 2 ? args[0] : null, fn: args.at(-1) as Function })
  }) as Parameters<typeof register>[0])
  const api = {
    env: { get: async (key: string) => ({ VP_REPO: 'vantage-point', VP_LANE: 'swap-detached' })[key] },
    clock: { every: () => {} },
  }
  await handlers.find(h => h.event === 'session.start')!.fn(api, { cwd: '/repo' }, () => {})
  return handlers.find(h => h.event === 'tool.call' && h.filter)!.fn(api, { command }, () => 'allowed')
}

test('detached の二つの完全一致だけを許可する', async () => {
  for (const command of ['mise run app:swap:detached', 'VP_SWAP_RESTART_DAEMON=1 mise run app:swap:detached']) {
    expect(await guard(command), command).toBe('allowed')
  }
})

test('連結・追記・直接の daemon 再起動は拒否し、安全な入口を案内する', async () => {
  for (const command of [
    'VP_SWAP_RESTART_DAEMON=1 mise run app:swap',
    'launchctl kickstart -k gui/501/club.chronista.vp',
    ...['&&', ';', '|', '\n'].map(op => `mise run app:swap:detached ${op} echo extra`),
    ...['&&', ';', '|', '\n'].map(op => `VP_SWAP_RESTART_DAEMON=1 mise run app:swap:detached ${op} echo extra`),
    'VP_SWAP_RESTART_DAEMON=1 mise run app:swap:detached\n',
    'VP_SWAP_RESTART_DAEMON=1 mise run app:swap:detached --extra',
  ]) {
    expect((await guard(command)).deny, command).toContain('mise run app:swap:detached')
  }
})
