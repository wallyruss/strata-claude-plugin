import type { PromptComposeInput, PromptSubmitInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { deploymentOf } from './strata'

test('a deployment is named the same by the API and the web app, with its port, and not at all by what is not a URL', async () => {
  expect(deploymentOf('https://api.beta.strata.space')).toBe('beta.strata.space:443')
  expect(deploymentOf('https://app.beta.strata.space/w/acme/documents/doc_1/plan')).toBe('beta.strata.space:443')
  expect(deploymentOf('https://api.strata.space')).toBe('strata.space:443')
  expect(deploymentOf('https://user@API.strata.space:8443/')).toBe('strata.space:8443')
  expect(deploymentOf('http://localhost:18001')).toBe('localhost:18001')
  expect(deploymentOf('http://localhost:19001')).not.toBe(deploymentOf('http://localhost:18001'))
  expect(deploymentOf('http://[::1]:18001/x')).toBe('[::1]:18001')
  expect(deploymentOf('http://[::1]')).toBe('[::1]:80')
  expect(deploymentOf('http://[::1')).toBe(null)
  expect(deploymentOf('https://api.strata.space:port')).toBe(null)
  expect(deploymentOf('ftp://api.strata.space')).toBe(null)
  expect(deploymentOf('not a url')).toBe(null)
  expect(deploymentOf('')).toBe(null)
})

const READ = JSON.stringify({
  documentId: 'doc_1',
  title: 'Plan',
  format: 'markdown',
  documentVersion: 4,
  content: '# Plan\n\nIntro.\n\n## Owners\n\nNone yet.\n',
})

/** A system-prompt render's input, whole, as the test kit asks for one. */
const COMPOSE: PromptComposeInput = {
  model: 'claude-fable-5-1',
  promptModel: 'claude-fable-5-1',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
}

test('an @strata: mention reads the document into the prompt and names it in the text', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') return { value: { content: [{ type: 'text', text: READ }], isError: false } }
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const sent = await $.prompt.submit({ text: 'Summarize @strata:doc_1 in two lines.' } as PromptSubmitInput)
  expect(sent.text).toBe('Summarize the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool) in two lines.')
  expect(sent.context?.join('\n')).toContain('None yet.')
  expect(sent.context?.join('\n')).toContain('revision 4')
  expect(sent.context?.join('\n')).toContain('mcp__strata__read_document')
})

test('a mention inside a quoted line, or in a prompt a plugin submitted, is left as text', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let reads = 0
  on('mcp.call', () => {
    reads += 1
    return { value: { content: [{ type: 'text', text: READ }], isError: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const quoted = await $.prompt.submit({
    text: 'About this passage:\n\n> See @strata:doc_1 for the plan.\n\nWhat does it mean?',
  } as PromptSubmitInput)
  expect(quoted.text).toContain('> See @strata:doc_1 for the plan.')
  expect(reads).toBe(0)
  const byPlugin = await $.prompt.submit({
    text: 'Summarize @strata:doc_1',
    origin: { kind: 'plugin', name: 'other' },
  } as unknown as PromptSubmitInput)
  expect(byPlugin.text).toBe('Summarize @strata:doc_1')
  expect(reads).toBe(0)
})

test('a prompt without a mention passes untouched', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const sent = await $.prompt.submit({ text: 'Hello.' } as PromptSubmitInput)
  expect(sent.text).toBe('Hello.')
})

test('a note a hook beneath dropped leaves the document unrecorded as read', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') return { value: { content: [{ type: 'text', text: READ }], isError: false } }
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })
  // A hook beneath that strips the context, then one that passes it on.
  let isDropping = true
  on('prompt.submit', (_, e) => ({ text: e.text, context: isDropping ? [] : e.context }))
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const dropped = await $.prompt.submit({ text: 'Summarize @strata:doc_1.' } as PromptSubmitInput)
  expect(dropped.text).toBe('Summarize the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool).')
  const bare = await $.prompt.compose(COMPOSE)
  expect(bare.sections.map(section => section.text).join('\n')).not.toContain('doc_1')

  isDropping = false
  await $.prompt.submit({ text: 'Again: @strata:doc_1.' } as PromptSubmitInput)
  const noted = await $.prompt.compose(COMPOSE)
  expect(noted.sections.map(section => section.text).join('\n')).toContain('"Plan" (doc_1, via mcp__strata__read_document) read at v4')
})

test('a mention inside code, a fence, or an address is left as text; one of its own beside them is read', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let reads = 0
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') reads += 1
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: READ }], isError: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const literals = [
    'Explain this literal: `@strata:doc_1`.',
    'Or this one: ``a `@strata:doc_1` b``.',
    'Explain this log:\n```text\n@strata:doc_1\n```\nand this address https://example.org/@strata:doc_1 too.',
    'Mail me at me@strata:doc_1 and see\n~~~\n@strata:doc_1\n~~~',
    // A longer fence holds a shorter one's line; a fence never closed holds the rest.
    'A long fence:\n````\n```\n@strata:doc_1\n```\n````\nand one left open:\n```\n@strata:doc_1',
    // A code span across lines, and one whose closing run differs in length.
    'A span `across\n@strata:doc_1\nlines` here.',
    'A file @strata:doc_1.json, a host @strata:doc_1.example.org, a path @strata:doc_1/x, a word @strata:doc_1é.',
    'Indented code:\n\n    @strata:doc_1\n\tand @strata:doc_1 too',
    // A space then a tab reaches the fourth column too; a letter or a digit
    // past the basic plane (two code units) is more of the word all the same.
    'Tabbed code:\n\n \t@strata:doc_1',
    'A long letter @strata:doc_1𐐀, a long digit @strata:doc_1𝟘, and a name @strata:doc_1.𐐀 too.',
  ]
  for (const text of literals) {
    const sent = await $.prompt.submit({ text } as PromptSubmitInput)
    expect(sent.text).toBe(text)
    expect(sent.context ?? []).toEqual([])
  }
  expect(reads).toBe(0)

  // One standing on its own is read, and the literal beside it stays.
  const mixed = await $.prompt.submit({ text: 'Compare `@strata:doc_1` with (@strata:doc_1).' } as PromptSubmitInput)
  expect(mixed.text).toBe('Compare `@strata:doc_1` with (the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)).')
  expect(reads).toBe(1)
  expect(mixed.context?.join('\n')).toContain('None yet.')
  // Sentence punctuation after one, a backtick never closed before one, and
  // a list item or a line of its own around one leave it a mention.
  const prose = await $.prompt.submit({
    text: 'Unclosed ` then @strata:doc_1? Yes: @strata:doc_1.\n- @strata:doc_1\n@strata:doc_1',
  } as PromptSubmitInput)
  const named = 'the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)'
  expect(prose.text).toBe(`Unclosed \` then ${named}? Yes: ${named}.\n- ${named}\n${named}`)
  expect(reads).toBe(2)
})
