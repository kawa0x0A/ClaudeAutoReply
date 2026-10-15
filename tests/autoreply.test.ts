import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

function world(on: On, reply = '次はテストを追加してください') {
  const clock = mock.clock(on)
  mock.store(on)
  const sent: string[] = []
  const asked: string[] = []
  on('model.complete', (_$, e) => {
    asked.push(e.model)
    return { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })
  on('session.messages', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'test' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.run', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  return { clock, sent, asked }
}

function finish($: Engine, agentId?: string) {
  return $.turn.complete({
    answer: '実装しました。',
    durationMs: 10,
    isAborted: false,
    turnId: `t${Math.random()}`,
    reason: 'answer',
    ...(agentId ? { agentId } : {}),
  })
}

function start($: Engine) {
  return $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

function run($: Engine, args: string) {
  return $.command.run({
    command: 'autoreply',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
}

test('sends the Haiku-written prompt 3 seconds after a turn, only when on', async ($, on) => {
  const { clock, sent, asked } = world(on)
  await start($)

  await finish($)
  await clock.advance(5000)
  expect(sent).toEqual([])

  await run($, 'on')
  await finish($)
  await clock.settle()
  expect(asked).toEqual(['haiku'])
  await clock.advance(2000)
  expect(sent).toEqual([])
  await clock.advance(1000)
  expect(sent).toEqual(['次はテストを追加してください'])
})

test('stops after 5 in a row', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await run($, 'on')
  for (let i = 0; i < 7; i++) {
    await finish($)
    await clock.advance(3500)
  }
  expect(sent.length).toBe(5)
})

test('ignores subagent turns and DONE', async ($, on) => {
  const { clock, sent } = world(on, 'DONE')
  await start($)
  await run($, 'on')
  await finish($, 'agent-1')
  await clock.advance(3500)
  await finish($)
  await clock.advance(3500)
  expect(sent).toEqual([])
})

test('off cancels a countdown in flight', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await run($, 'on')
  await finish($)
  await clock.advance(1000)
  await run($, 'off')
  await clock.advance(5000)
  expect(sent).toEqual([])
})

test('a subagent turn never triggers a generation', async ($, on) => {
  const { clock, sent, asked } = world(on)
  await start($)
  await run($, 'on')
  await finish($, 'agent-1')
  await clock.advance(5000)
  expect(asked).toEqual([])
  expect(sent).toEqual([])
})

test('the band above the prompt shows the countdown and its button cancels', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await run($, 'on')
  for (const surface of ['terminal', 'desktop'] as const) {
    await finish($)
    await clock.settle()
    const ui = await $.ui.mount({
      plugin: 'autoreply',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 9 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /次はテストを追加/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await clock.advance(5000)
    expect(sent).toEqual([])
    await ui.unmount()
  }
})
