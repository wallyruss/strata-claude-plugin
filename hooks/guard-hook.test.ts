import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { ToolCallArgs } from 'claude-code'

/**
 * A write as the public plugin's `strata` server gets it. Its tool names are
 * not in this session's list (the types hold the servers connected here), so
 * the input is cast once, here.
 */
function write($: Parameters<TestBody>[0], input: Record<string, unknown>) {
  return $.tool.call(input as unknown as ToolCallArgs)
}

const DOC = ['# Plan', '', 'Intro.', '', '## Owners', '', 'None yet.', ''].join('\n')

const READ = JSON.stringify({
  documentId: 'doc_1',
  title: 'Plan',
  format: 'markdown',
  documentVersion: 7,
  content: DOC,
})

/**
 * The engine beneath the mod: a read answers the document, a proposal answers
 * an id, the person answers the guard's question (a tool call of
 * AskUserQuestion), and the write itself, when let through, is applied.
 */
function server(
  on: Parameters<TestBody>[1],
  answer: string,
  proposals: string[],
  asks: { count: number },
) {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') return { value: { content: [{ type: 'text', text: READ }], isError: false } }
    if (e.tool === 'propose_suggestion') {
      proposals.push(JSON.stringify(e.args))
      return {
        value: { content: [{ type: 'text', text: JSON.stringify({ suggestionId: `sg_${proposals.length}` }) }], isError: false },
      }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      asks.count += 1
      const questions = (e as { questions?: { question?: string }[] }).questions ?? []
      const question = questions[0]?.question ?? ''
      return { result: { questions, answers: { [question]: answer } } }
    }
    return { result: { content: [{ type: 'text', text: 'applied' }], isError: false }, text: 'applied' }
  })
}

test('cancelling the guard denies the write', async ($, on) => {
  server(on, 'Cancel', [], { count: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await write($, {
    tool: 'mcp__strata__replace_document_text',
    documentId: 'doc_1',
    oldString: 'None yet.',
    newString: '10%: Priya.',
  })
  expect(ran.deny).toContain('declined')
})

test('applying lets the write through', async ($, on) => {
  server(on, 'Apply', [], { count: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await write($, {
    tool: 'mcp__strata__replace_document_text',
    documentId: 'doc_1',
    oldString: 'None yet.',
    newString: '10%: Priya.',
  })
  expect(ran.deny).toBeUndefined()
  expect(ran.text).toBe('applied')
  expect(ran.context?.join('\n')).toContain('chose Apply')
})

test('proposing turns the diff into suggestions and answers the model itself', async ($, on) => {
  const proposals: string[] = []
  server(on, 'Propose as suggestion', proposals, { count: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await write($, {
    tool: 'mcp__strata__replace_document_text',
    documentId: 'doc_1',
    oldString: 'None yet.',
    newString: '10%: Priya.',
  })
  expect(ran.deny).toBeUndefined()
  expect(proposals.length).toBe(1)
  const args = JSON.parse(proposals[0] ?? '{}')
  expect(args.originalText).toContain('None yet.')
  expect(args.replacementText).toContain('10%: Priya.')
  expect(args.headingContext).toEqual(['Plan', 'Owners'])
  expect(args.baseVersion).toBe(7)
  const text = JSON.stringify(ran.result)
  expect(text).toContain('sg_1')
  expect(text).toContain('unchanged')
})

test('with no one to ask, the write goes through and the model is told it was not reviewed', async ($, on) => {
  const asks = { count: 0 }
  server(on, 'Cancel', [], asks)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  const ran = await write($, {
    tool: 'mcp__strata__replace_document_text',
    documentId: 'doc_1',
    oldString: 'None yet.',
    newString: '10%: Priya.',
  })
  expect(asks.count).toBe(0)
  expect(ran.text).toBe('applied')
  expect(ran.context?.join('\n')).toContain('no one to ask')
})

test('a replacement the guard cannot work out is still asked about, with no diff', async ($, on) => {
  const asks = { count: 0 }
  server(on, 'Cancel', [], asks)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await write($, {
    tool: 'mcp__strata__replace_document_text',
    documentId: 'doc_1',
    oldString: 'absent text',
    newString: 'x',
  })
  expect(asks.count).toBe(1)
  expect(ran.deny).toContain('declined')
})

test('an insertion names its section as the server matches it, regardless of case', async ($, on) => {
  const proposals: string[] = []
  server(on, 'Propose as suggestion', proposals, { count: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await write($, {
    tool: 'mcp__strata__insert_document_section',
    documentId: 'doc_1',
    position: { kind: 'afterSection', sectionPath: 'plan > OWNERS' },
    markdown: '## Rollback\n\nScripted.',
  })
  expect(ran.deny).toBeUndefined()
  expect(proposals.length).toBe(1)
  expect(JSON.parse(proposals[0] ?? '{}').replacementText).toContain('## Rollback')
})

test('a second guarded write while one is being asked is refused with the reason, never asked over it', async ($, on) => {
  const asks = { count: 0 }
  server(on, 'Cancel', [], asks)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const [first, second] = await Promise.all([
    write($, { tool: 'mcp__strata__replace_document_text', documentId: 'doc_1', oldString: 'None yet.', newString: 'A.' }),
    write($, { tool: 'mcp__strata__replace_document_text', documentId: 'doc_1', oldString: 'Intro.', newString: 'B.' }),
  ])
  expect(asks.count).toBe(1)
  const denies = [first?.deny ?? '', second?.deny ?? ''].sort()
  expect(denies[0]).toContain('awaiting')
  expect(denies[1]).toContain('declined')
})

test('an edit landing while the question is open brings a fresh diff and a second question', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let checks = 0
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') return { value: { content: [{ type: 'text', text: READ }], isError: false } }
    if (e.tool === 'find') {
      checks += 1
      // The first check after Apply finds a newer revision; the second finds the one the diff was for.
      const info = { documentId: 'doc_1', title: 'Plan', documentVersion: checks === 1 ? 8 : 7 }
      return { value: { content: [{ type: 'text', text: JSON.stringify(info) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })
  const asks = { count: 0 }
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      asks.count += 1
      const questions = (e as { questions?: { question?: string }[] }).questions ?? []
      return { result: { questions, answers: { [questions[0]?.question ?? '']: 'Apply' } } }
    }
    return { result: { content: [{ type: 'text', text: 'applied' }], isError: false }, text: 'applied' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await write($, {
    tool: 'mcp__strata__replace_document_text',
    documentId: 'doc_1',
    oldString: 'None yet.',
    newString: '10%: Priya.',
  })
  expect(asks.count).toBe(2)
  expect(checks).toBe(2)
  expect(ran.text).toBe('applied')
})

test('a write that would change nothing is answered without being made', async ($, on) => {
  const asks = { count: 0 }
  server(on, 'Apply', [], asks)
  let writes = 0
  on('tool.call', { tool: /rewrite_document$/ }, () => {
    writes += 1
    return { result: { content: [{ type: 'text', text: 'applied' }], isError: false }, text: 'applied' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await write($, { tool: 'mcp__strata__rewrite_document', documentId: 'doc_1', newContent: DOC })
  expect(asks.count).toBe(0)
  expect(writes).toBe(0)
  expect(JSON.stringify(ran.result)).toContain('nothing was written')
})
