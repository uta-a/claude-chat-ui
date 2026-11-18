import { expect, test } from 'claude-code/testing'

const EDIT_OUTPUT = {
  filePath: '/repo/src/foo.ts',
  structuredPatch: [
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c', ' d'] },
  ],
}

const toolUse = (id: string, tool: string, input: unknown, output?: unknown) =>
  ({
    plugin: 'compact-tools',
    component: 'ToolUse',
    requestId: id,
    surface: 'terminal',
    props: {
      tool_use_id: id,
      tool,
      input,
      output,
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      isExpanded: false,
    },
  }) as const

// まとまり: t1 (Bash) -> t2 (Bash) -> t3 (Write 新規)
const seed = (key: string, id?: string): unknown => {
  if (key === 'headOf') return id === 'stray' ? undefined : 't1'
  if (key === 'members') return id === 't1' ? ['t1', 't2', 't3'] : undefined
  if (key === 'expanded') return false
  if (key === 'call') {
    if (id === 't3') return { tool: 'Write', status: 'done', file: 'vercel.ts', created: true, added: 74, removed: 0 }
    return { tool: 'Bash', status: 'done' }
  }
  return undefined
}

test('記録のない Edit 行は「編集しました ファイル名 +N -M」の1行になる', async ($, on) => {
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  const ui = await $.ui.mount(toolUse('stray', 'Edit', { file_path: '/repo/src/foo.ts' }, EDIT_OUTPUT))
  expect((await ui.find({ type: 'Text', text: /編集しました/ }))?.text).toBe('編集しました')
  expect((await ui.find({ type: 'Text', text: /foo\.ts/ }))?.text).toBe('  foo.ts')
  expect((await ui.find({ type: 'Text', text: /\+2/ }))?.text).toBe('  +2')
  expect((await ui.find({ type: 'Text', text: /-1/ }))?.text).toBe(' -1')
  await ui.unmount()
})

test('まとまりの先頭行はサマリー、後続行は何も描かない', async ($, on) => {
  on('state.get', (_, e) => {
    const value = seed(e.key, e.id)
    return { value: { value, version: value === undefined ? 0 : 1 } }
  })

  const head = await $.ui.mount(toolUse('t1', 'Bash', { command: 'ls' }))
  const line = await head.find({ type: 'Text', text: /実行済み/ })
  expect(line?.text).toBe('実行済み 2 件のコマンド, 作成 vercel.ts')
  expect((await head.find({ type: 'Text', text: /\+74/ }))?.text).toBe('  +74')
  await head.unmount()

  const rest = await $.ui.mount(toolUse('t2', 'Bash', { command: 'pwd' }))
  expect(await rest.find({ type: 'Text' })).toBe(undefined)
  await rest.unmount()
})
