/** 1回のツール呼び出しについて、先頭行のサマリーが読む情報。 */
export type CallInfo = {
  tool: string
  /** 'running' | 'done' | 'error' */
  status: 'running' | 'done' | 'error'
  /** Edit / Write の対象ファイル名（basename） */
  file?: string
  /** Write の新規作成なら true */
  created?: boolean
  added?: number
  removed?: number
}

declare module 'claude-code' {
  interface PluginState {
    'compact-tools': {
      /** tool_use_id -> そのまとまりの先頭 tool_use_id */
      headOf: StateFamily<string>
      /** 先頭 tool_use_id -> まとまりの全 tool_use_id（呼び出し順） */
      members: StateFamily<string[]>
      /** tool_use_id -> 呼び出しの情報 */
      call: StateFamily<CallInfo>
      /** 先頭 tool_use_id -> 展開中か */
      expanded: StateFamily<boolean>
      /** いま開いているまとまりの先頭（テキストやターン境界で null） */
      openHead: string | null
    }
  }
}
