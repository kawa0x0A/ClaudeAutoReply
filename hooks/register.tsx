import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage, Timer } from 'claude-code'

import type { AutoreplyPending } from '../types'

const PANE = 'autoreply-countdown'
const DEFAULT_MAX_STREAK = 5
const MAX_STREAK_LIMIT = 50
const MAX_PRESETS = [1, 3, 5, 10, 20, 30, 50]
const COUNTDOWN_SECONDS = 3
const STORE_KEY = 'enabled'
const MAX_STORE_KEY = 'maxStreak'
const DONE = 'DONE'

const enabled = atom({ plugin: 'autoreply', key: 'enabled' } as const, false)
const streak = atom({ plugin: 'autoreply', key: 'streak' } as const, 0)
const maxStreak = atom({ plugin: 'autoreply', key: 'maxStreak' } as const, DEFAULT_MAX_STREAK)
const pending = atom({ plugin: 'autoreply', key: 'pending' } as const, null)
const paneShown = atom({ plugin: 'autoreply', key: 'paneShown' } as const, false)

const SYSTEM = [
  'You decide the next message a user should send to an AI coding assistant so the work keeps moving.',
  'Read the recent conversation, then write that one message: concrete, actionable, one or two sentences,',
  'in the same language the user has been writing in. Output only the message itself, no quotes or preamble.',
  'If the task looks finished, the assistant asked the user a question only they can answer,',
  `or continuing would be risky (deleting data, deploying, spending money, sending messages), output exactly ${DONE}.`,
].join(' ')

// Module-local handles: a reload starts them over (the engine drops the old timers too).
let abort: AbortController | null = null
let ticker: Timer | null = null
let run = 0

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function transcriptFor(messages: readonly SessionMessage[], answer: string): string {
  const rows = messages
    .filter(m => m.text.trim() !== '' || m.toolUses.length > 0)
    .slice(-8)
    .map(m => {
      const tools = m.toolUses.length ? ` [tools: ${m.toolUses.map(t => t.tool).join(', ')}]` : ''
      return `${m.role.toUpperCase()}:${tools}\n${clip(m.text, 1500)}`
    })
  const last = rows.at(-1) ?? ''
  if (answer && !last.includes(clip(answer, 200).replace(/…$/, ''))) {
    rows.push(`ASSISTANT:\n${clip(answer, 3000)}`)
  }
  return rows.join('\n\n')
}

async function cancel($: EngineInterface, why?: string): Promise<void> {
  run += 1
  abort?.abort()
  abort = null
  ticker?.cancel()
  ticker = null
  const had = (await read($, pending)) !== null
  await update($, pending, () => null)
  await update($, paneShown, () => false)
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  if (had && why) $.ui.toast(why)
}

async function sendNow($: EngineInterface, mine: number, text: string): Promise<void> {
  if (mine !== run) return
  ticker?.cancel()
  ticker = null
  run += 1
  await update($, pending, () => null)
  await update($, paneShown, () => false)
  await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, streak, n => (n ?? 0) + 1)
  await $.prompt.submit({ text, asUser: true })
}

async function tick($: EngineInterface, mine: number, text: string): Promise<void> {
  if (mine !== run) return
  const p = await read($, pending)
  const left = (p?.secondsLeft ?? 1) - 1
  if (left > 0) {
    await update($, pending, q => (q ? { ...q, secondsLeft: left } : q))
    return
  }
  await sendNow($, mine, text)
}

async function startCycle($: EngineInterface, answer: string): Promise<void> {
  const mine = ++run
  abort = new AbortController()
  await update($, pending, () => ({ phase: 'generating', text: '', secondsLeft: COUNTDOWN_SECONDS }))

  const messages = await $.session.messages()
  let reply: Awaited<ReturnType<EngineInterface['model']['complete']>>
  try {
    reply = await $.model.complete(
      {
        model: 'haiku',
        system: SYSTEM,
        prompt: `Recent conversation:\n\n${transcriptFor(messages, answer)}\n\nThe next user message:`,
        maxTokens: 300,
        timeoutMs: 30_000,
      },
      { signal: abort.signal },
    )
  } catch (err) {
    // A cancel aborts the call; that's not an error worth a toast.
    if (mine !== run) return
    throw err
  }
  if (mine !== run) return

  const text = reply.isAnswered ? reply.text.trim().replace(/^["「]+|["」]+$/g, '').trim() : ''
  if (!reply.isAnswered || text === '' || text === DONE) {
    await update($, pending, () => null)
    $.ui.toast(
      !reply.isAnswered
        ? `autoreply: プロンプトを生成できませんでした (${reply.reason})`
        : 'autoreply: 作業が一段落したので自動送信を止めました',
    )
    return
  }

  const shown: AutoreplyPending = { phase: 'countdown', text, secondsLeft: COUNTDOWN_SECONDS }
  await update($, pending, () => shown)

  // A focused pane with closeOnEscape is how Esc reaches a mod; the band above the prompt
  // shows the same countdown whenever the pane isn't drawn.
  const opened = await $.ui.open({ id: PANE, title: '自動送信', focus: true, closeOnEscape: true, rows: 4 })
  if (mine !== run) return
  await update($, paneShown, () => opened.isPlaced)

  ticker = $.clock.every(1000, () => {
    void tick($, mine, text)
  })
}

async function setEnabled($: EngineInterface, isOn: boolean): Promise<string> {
  await update($, enabled, () => isOn)
  await $.store.set(STORE_KEY, isOn)
  await update($, streak, () => 0)
  if (!isOn) await cancel($)
  const max = await read($, maxStreak)
  return isOn
    ? `autoreply: ON — 返答のたびに次のプロンプトを生成し、${COUNTDOWN_SECONDS}秒後に送信します (Esc でキャンセル、連続${max}回まで)`
    : 'autoreply: OFF'
}

function parseMax(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_STREAK_LIMIT ? n : null
}

async function setMax($: EngineInterface, raw: string | number): Promise<string> {
  const n = parseMax(raw)
  if (n === null) return `autoreply: 回数は 1〜${MAX_STREAK_LIMIT} の整数で指定してください (例: /autoreply max 10)`
  await update($, maxStreak, () => n)
  await $.store.set(MAX_STORE_KEY, n)
  return `autoreply: 連続送信の上限を${n}回にしました`
}

// The picker jumps to a common limit in one pick; −/+ still fine-tune between them.
function maxOptions(current: number) {
  const values = [...new Set([...MAX_PRESETS, current])].sort((a, b) => a - b)
  return values.map(n => ({ value: String(n), label: `${n}回` }))
}

function countdown(
  $: EngineInterface,
  e: Parameters<EngineInterface['ui']['resolve']>[0],
  p: AutoreplyPending,
) {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {p.phase === 'generating' ? (
        <Text dimColor>autoreply: 次のプロンプトを Haiku で生成中…</Text>
      ) : (
        <Box flexDirection="column">
          <Text>
            <Text bold>autoreply</Text>
            <Text dimColor> {p.secondsLeft}秒後に送信 — Esc でキャンセル</Text>
          </Text>
          <Text>› {p.text}</Text>
        </Box>
      )}
      <Button key="cancel" label="キャンセル" onPress={() => cancel($, 'autoreply: キャンセルしました')} />
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get(STORE_KEY)
    await update($, enabled, () => saved === true)
    const savedMax = parseMax(await $.store.get(MAX_STORE_KEY))
    await update($, maxStreak, () => savedMax ?? DEFAULT_MAX_STREAK)
    await update($, pending, () => null)
    await update($, paneShown, () => false)
    await $.command.register({
      name: 'autoreply',
      description: '返答のたびに Haiku が次のプロンプトを自動送信する (連続回数は max で変更)',
      argumentHint: 'on | off | max <回数>',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'autoreply' }, async ($, e) => {
    const [arg = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (arg === 'on' || arg === 'off') return { text: await setEnabled($, arg === 'on') }
    if (arg === 'max') return { text: await setMax($, value) }
    const isOn = await read($, enabled)
    const n = await read($, streak)
    const max = await read($, maxStreak)
    return {
      text: `autoreply: ${isOn ? 'ON' : 'OFF'} (連続送信 ${n}/${max})。使い方: /autoreply on | off | max <回数>`,
    }
  })

  // The person's own input resets the streak and cancels anything pending.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if (kind === 'composer' || kind === 'bridge' || kind === 'sdk') {
      await update($, streak, () => 0)
      await cancel($)
    }
    return next(e)
  })

  // Typing in the prompt box during the countdown means the person takes over.
  on('prompt.edit', async ($, e, next) => {
    if ((await read($, pending)) !== null) await cancel($, 'autoreply: 入力を始めたのでキャンセルしました')
    return next(e)
  })

  // Esc on the countdown pane (or its close mark) closes it as the person: that's the cancel.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await cancel($, 'autoreply: キャンセルしました')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagent turns carry an agentId; only the main loop's answers count.
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    if (!(await read($, enabled))) return result

    const max = await read($, maxStreak)
    if ((await read($, streak)) >= max) {
      $.ui.toast(`autoreply: 連続${max}回送信したので止めました。次の入力を待っています`)
      return result
    }

    // Run outside this dispatch so the turn ends now and the Haiku call carries no hook budget.
    const answer = e.answer
    $.clock.after(0, () => {
      const started = run + 1
      void startCycle($, answer).catch(async (err: unknown) => {
        if (started !== run) return
        await update($, pending, () => null)
        $.ui.toast(`autoreply: エラー ${String(err).slice(0, 120)}`)
      })
    })
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const p = await read($, pending)
    const isOn = await read($, enabled)
    const max = await read($, maxStreak)
    const { Box, Button, Select } = $.ui.resolve(e)
    // The toggle and the limit are always here; the countdown joins them whenever the pane isn't drawn.
    return (
      <Box flexDirection="column">
        {p !== null && !(await read($, paneShown)) ? countdown($, e, p) : null}
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Button
            key="toggle"
            label={`autoreply: ${isOn ? 'ON' : 'OFF'}`}
            variant={isOn ? 'primary' : 'secondary'}
            dimColor={!isOn}
            onPress={async () => $.ui.toast(await setEnabled($, !isOn))}
          />
          <Select
            key="max"
            label="上限"
            options={maxOptions(max)}
            value={String(max)}
            onSelect={value => setMax($, value)}
          />
          <Button key="max-down" label="−" dimColor onPress={() => setMax($, Math.max(1, max - 1))} />
          <Button
            key="max-up"
            label="+"
            dimColor
            onPress={() => setMax($, Math.min(MAX_STREAK_LIMIT, max + 1))}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const p = await read($, pending)
    if (p === null) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>autoreply</Text>
    }
    return countdown($, e, p)
  })
}
