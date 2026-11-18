import { atom, memberOf, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  RenderElement,
  RenderInput,
} from 'claude-code'

import type { CallInfo } from '../types'

// テキストを挟まずに続いたツール呼び出しを「まとまり」として1行で表示する。
// まとまりの先頭の行だけがサマリーを描き、残りの行と結果ブロックは隠す。
// 行をクリックすると展開し、ctrl+o（isExpanded）では常にエンジン本来の表示。

const headOf = atom({ plugin: 'compact-tools', key: 'headOf' } as const, '')
const members = atom(
  { plugin: 'compact-tools', key: 'members' } as const,
  [] as string[],
)
const call = atom({ plugin: 'compact-tools', key: 'call' } as const, {
  tool: '',
  status: 'running',
} as CallInfo)
const expanded = atom({ plugin: 'compact-tools', key: 'expanded' } as const, false)
const openHead = atom(
  { plugin: 'compact-tools', key: 'openHead' } as const,
  null as string | null,
)

// ---------- 呼び出し内容の要約 ----------

const basename = (p: unknown) =>
  typeof p === 'string' ? (p.split('/').pop() ?? p) : undefined

const field = (v: unknown, k: string): unknown =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined

/** structuredPatch の +/- 行を数える */
const countPatch = (output: unknown) => {
  const patch = field(output, 'structuredPatch')
  let added = 0
  let removed = 0
  if (Array.isArray(patch)) {
    for (const hunk of patch) {
      const lines = field(hunk, 'lines')
      if (!Array.isArray(lines)) continue
      for (const l of lines) {
        if (typeof l !== 'string') continue
        if (l.startsWith('+')) added += 1
        else if (l.startsWith('-')) removed += 1
      }
    }
  }
  return { added, removed }
}

const isFileTool = (tool: string) =>
  tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit'

/** 出力からファイル変更の情報を拾う（Edit / Write 以外は空） */
const fileInfo = (tool: string, input: unknown, output: unknown): Partial<CallInfo> => {
  if (!isFileTool(tool)) return {}
  const file = basename(field(input, 'file_path') ?? field(input, 'notebook_path'))
  if (output === undefined) return { file }
  const created = tool === 'Write' && field(output, 'type') === 'create'
  let { added, removed } = countPatch(output)
  if (created && added === 0) {
    const content = field(output, 'content') ?? field(input, 'content')
    if (typeof content === 'string' && content.length > 0) {
      added = content.replace(/\n$/, '').split('\n').length
    }
  }
  return { file, created, added, removed }
}

const mcpServer = (tool: string) => {
  const m = /^mcp__(.+)__[^_].*$/.exec(tool)
  if (!m) return undefined
  // mcp__plugin_<plugin>_<server>__tool / mcp__claude_ai_<name>__tool を短くする
  return (m[1] ?? '')
    .replace(/^plugin_[^_]+_/, '')
    .replace(/^claude_ai_/, '')
}

type Part = { key: string; label: (n: number) => string }

const partOf = (tool: string): Part => {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
    case 'BashOutput':
    case 'KillShell':
      return { key: 'cmd', label: n => `実行済み ${n} 件のコマンド` }
    case 'Agent':
    case 'Task':
      return { key: 'agent', label: n => `実行済み ${n} 個のエージェント` }
    case 'Read':
      return { key: 'read', label: n => `読み込みました ${n} 件のファイル` }
    case 'Grep':
    case 'Glob':
      return { key: 'grep', label: n => `検索しました コード（${n} 回）` }
    case 'WebSearch':
      return { key: 'web', label: n => `検索しました ウェブ（${n} 回）` }
    case 'WebFetch':
      return { key: 'fetch', label: n => `取得しました ウェブページ（${n} 件）` }
    case 'ToolSearch':
      return { key: 'toolsearch', label: () => 'ツールを読み込みました' }
    case 'Skill':
      return { key: 'skill', label: () => 'スキルを使用しました' }
    case 'TodoWrite':
      return { key: 'todo', label: () => 'ToDo を更新しました' }
    case 'AskUserQuestion':
      return { key: 'ask', label: () => '質問しました' }
  }
  const server = mcpServer(tool)
  if (server) return { key: `mcp:${server}`, label: () => `${server}を使用しました` }
  return { key: `tool:${tool}`, label: () => `${tool}を使用しました` }
}

type Summary = {
  /** 薄い色で描く本文 */
  text: string
  /** 単独のファイル変更のとき、通常色で描くファイル名 */
  file?: string
  added: number
  removed: number
  running: boolean
  errors: number
}

const summarize = (infos: readonly CallInfo[]): Summary => {
  const order: string[] = []
  const counts = new Map<string, { part: Part; n: number }>()
  const files: CallInfo[] = []
  let added = 0
  let removed = 0
  let errors = 0
  let running = false

  for (const info of infos) {
    if (info.status === 'running') running = true
    if (info.status === 'error') errors += 1
    added += info.added ?? 0
    removed += info.removed ?? 0
    if (isFileTool(info.tool)) {
      if (!order.includes('file')) order.push('file')
      files.push(info)
      continue
    }
    const part = partOf(info.tool)
    const hit = counts.get(part.key)
    if (hit) hit.n += 1
    else {
      counts.set(part.key, { part, n: 1 })
      order.push(part.key)
    }
  }

  const fileNames = [...new Set(files.map(f => f.file ?? 'ファイル'))]
  const allCreated = files.length > 0 && files.every(f => f.created)
  const verbShort = allCreated ? '作成' : '編集'

  // ファイル変更だけのまとまりで、対象が1つなら「作成しました vercel.ts」
  if (order.length === 1 && order[0] === 'file' && fileNames.length === 1) {
    return {
      text: allCreated ? '作成しました' : '編集しました',
      file: fileNames[0],
      added,
      removed,
      running,
      errors,
    }
  }

  const pieces = order.map(key => {
    if (key === 'file') {
      return fileNames.length === 1
        ? `${verbShort} ${fileNames[0]}`
        : `${verbShort} ${fileNames.length} 件のファイル`
    }
    const hit = counts.get(key)!
    return hit.part.label(hit.n)
  })

  return { text: pieces.join(', '), added, removed, running, errors }
}

const infoFromProps = (p: {
  tool: string
  input: unknown
  output?: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}): CallInfo => ({
  tool: p.tool,
  status: p.isRunning ? 'running' : p.isErrored || p.isInterrupted ? 'error' : 'done',
  ...fileInfo(p.tool, p.input, p.isErrored ? undefined : p.output),
})

// ---------- 1行の描画 ----------

const drawLine = (
  $: EngineInterface,
  e: RenderInput,
  s: Summary,
  toggle: { head: string; isOpen: boolean } | undefined,
): RenderElement => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const content = [
    <Text dimColor>{s.text}</Text>,
    s.file !== undefined ? <Text>{`  ${s.file}`}</Text> : null,
    s.added > 0 ? <Text color="success">{`  +${s.added}`}</Text> : null,
    s.removed > 0 ? <Text color="error">{` -${s.removed}`}</Text> : null,
    s.errors > 0 ? <Text color="error">{`, ${s.errors} 件失敗`}</Text> : null,
    s.running ? <Text dimColor>{' 実行中…'}</Text> : null,
    <Text dimColor>{toggle?.isOpen ? ' ⌄' : ' ›'}</Text>,
  ].filter(x => x !== null)

  if (toggle === undefined) {
    return <Box>{content}</Box>
  }
  const { head, isOpen } = toggle
  return (
    <Box>
      <Button
        key={`compact-tools-${head}`}
        plain
        onPress={() => update($, memberOf(expanded, { requestId: head }), () => !isOpen)}
      >
        {content}
      </Button>
    </Box>
  )
}

const readInfos = async ($: EngineInterface, head: string) => {
  const ids = await read($, memberOf(members, { requestId: head }))
  return Promise.all(ids.map(id => read($, memberOf(call, { requestId: id }))))
}

// ツール行：先頭はサマリー、ほかは隠す
async function renderToolUse(
  $: EngineInterface,
  e: RenderInput<'ToolUse'>,
  next: (e: never) => Promise<RenderElement>,
  withButton: boolean,
): Promise<RenderElement> {
  const { Box } = $.ui.resolve(e)
  if (e.props.isExpanded === true) return next(e as never)

  const id = e.props.tool_use_id
  const head = await read($, memberOf(headOf, { requestId: id }))

  // 記録のない行（mod 読み込み前・resume 後）は、その行だけで1行にする
  if (head === '') {
    return drawLine($, e, summarize([infoFromProps(e.props)]), undefined)
  }

  const isOpen = await read($, memberOf(expanded, { requestId: head }))
  if (head !== id) {
    return isOpen ? next(e as never) : <Box />
  }

  const infos = await readInfos($, head)
  const line = drawLine(
    $,
    e,
    summarize(infos.length > 0 ? infos : [infoFromProps(e.props)]),
    withButton ? { head, isOpen } : undefined,
  )
  if (!isOpen) return line
  return (
    <Box flexDirection="column">
      {line}
      {await next(e as never)}
    </Box>
  )
}

// エンジンが畳む読み込み・検索のまとまり（英語の集計行）も同じ1行にする
async function renderGroup(
  $: EngineInterface,
  e: RenderInput<'ToolGroup'>,
  next: (e: never) => Promise<RenderElement>,
  withButton: boolean,
): Promise<RenderElement> {
  if (e.props.isExpanded) return next(e as never)
  const { Box } = $.ui.resolve(e)
  const calls = e.props.calls
  const firstId = calls.find(c => c.tool_use_id !== undefined)?.tool_use_id
  const head = firstId === undefined ? '' : await read($, memberOf(headOf, { requestId: firstId }))
  const unfolded = () =>
    next({ ...e, props: { ...e.props, isExpanded: true } } as never)

  if (head === '') {
    return drawLine($, e, summarize(calls.map(infoFromProps)), undefined)
  }
  const isOpen = await read($, memberOf(expanded, { requestId: head }))
  const holdsHead = calls.some(c => c.tool_use_id === head)
  if (!holdsHead) {
    return isOpen ? unfolded() : <Box />
  }
  const line = drawLine(
    $,
    e,
    summarize(await readInfos($, head)),
    withButton ? { head, isOpen } : undefined,
  )
  if (!isOpen) return line
  return (
    <Box flexDirection="column">
      {line}
      {await unfolded()}
    </Box>
  )
}

// ---------- 登録 ----------

export const register: Register = on => {
  // ターンが変わればまとまりを閉じる
  on('turn.start', async ($, e, next) => {
    try {
      await update($, openHead, () => null)
    } catch {
      // 表示用の記録なので失敗しても進める
    }
    return next(e)
  })

  // モデルの応答を流しながら、テキストとツール呼び出しの並びでまとまりを決める
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    let sawText = false
    for await (const chunk of next(e)) {
      try {
        if (chunk.kind === 'text' && !sawText && chunk.text.trim() !== '') {
          sawText = true
          await update($, openHead, () => null)
        } else if (chunk.kind === 'tool') {
          const open = await read($, openHead)
          const head = open ?? chunk.id
          if (open === null) {
            await update($, memberOf(members, { requestId: head }), () => [head])
            await update($, openHead, () => head)
          } else {
            await update($, memberOf(members, { requestId: head }), list =>
              list.includes(chunk.id) ? list : [...list, chunk.id],
            )
          }
          await update($, memberOf(call, { requestId: chunk.id }), (v): CallInfo =>
              v.tool === '' ? { tool: chunk.name, status: 'running' } : v,
          )
          await update($, memberOf(headOf, { requestId: chunk.id }), () => head)
        }
      } catch {
        // 記録に失敗しても応答はそのまま流す
      }
      yield chunk
    }
  })

  // 実行結果（成否と追加・削除行数）を記録する
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    if (id === undefined || e.agentId !== undefined) {
      return next(e)
    }
    const input = e as unknown
    try {
      await update($, memberOf(call, { requestId: id }), (v): CallInfo => ({
        ...v,
        tool: e.tool,
        status: 'running',
        ...fileInfo(e.tool, input, undefined),
      }))
    } catch {
      // 表示用の記録なので無視する
    }
    const ran = await next(e)
    try {
      const failed = ran.deny !== undefined || ran.isError === true
      await update($, memberOf(call, { requestId: id }), (v): CallInfo => ({
        ...v,
        tool: e.tool,
        status: failed ? 'error' : 'done',
        ...fileInfo(e.tool, input, failed ? undefined : ran.result),
      }))
    } catch {
      // 表示用の記録なので無視する
    }
    return ran
  }).catch(($, e, next) => next(e))

  // ツール行：先頭はサマリー、ほかは隠す
  on('ui.render', { component: 'ToolUse' }, ($, e, next) =>
    renderToolUse($, e, next as never, true),
  ).catch(async ($, e, next) => {
    try {
      return await renderToolUse($, e, next as never, false)
    } catch {
      return next(e)
    }
  })

  // 結果ブロック：展開中か ctrl+o のときだけ出す
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const head = await read($, memberOf(headOf, { requestId: e.props.tool_use_id }))
    if (head !== '' && (await read($, memberOf(expanded, { requestId: head })))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  }).catch(($, e, next) => next(e))

  // エンジンが畳む読み込み・検索のまとまり（英語の集計行）も同じ1行にする
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) =>
    renderGroup($, e, next as never, true),
  ).catch(async ($, e, next) => {
    try {
      return await renderGroup($, e, next as never, false)
    } catch {
      return next(e)
    }
  })
}
