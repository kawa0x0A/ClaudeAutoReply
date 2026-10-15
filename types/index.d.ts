export type AutoreplyPending = {
  phase: 'generating' | 'countdown'
  text: string
  secondsLeft: number
}

declare module 'claude-code' {
  interface PluginState {
    autoreply: {
      enabled: boolean
      streak: number
      pending: AutoreplyPending | null
      paneShown: boolean
    }
  }
}
