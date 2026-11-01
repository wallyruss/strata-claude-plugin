import { expect, test } from 'claude-code/testing'

import { diffLines } from './diff'
import { describeWrite, proposedBody, suggestionsOf } from './guard'

const DOC = ['# Plan', '', 'Intro.', '', '## Risks', '', 'The gate reads p95 alone.', '', '## Owners', '', 'None yet.', ''].join('\n')

test('each write tool leaves the body the server would', async () => {
  expect(proposedBody('rewrite_document', { newContent: 'all new' }, DOC)).toBe('all new')
  expect(proposedBody('replace_document_text', { oldString: 'p95 alone', newString: 'p95 and errors' }, DOC)).toContain(
    'The gate reads p95 and errors.',
  )
  expect(proposedBody('replace_document_text', { oldString: 'absent text', newString: 'x' }, DOC)).toBe(null)
  const after = proposedBody(
    'insert_document_section',
    { position: { kind: 'afterSection', sectionPath: 'Plan > Risks' }, markdown: '## Rollback\n\nScripted.' },
    DOC,
  )
  expect(after?.indexOf('## Rollback')).toBeGreaterThan(after?.indexOf('## Risks') ?? 0)
  expect(after?.indexOf('## Rollback')).toBeLessThan(after?.indexOf('## Owners') ?? 0)
  const before = proposedBody(
    'insert_document_section',
    { position: { kind: 'beforeSection', sectionPath: 'Plan > Owners' }, markdown: '## Rollback' },
    DOC,
  )
  expect(before?.indexOf('## Rollback')).toBeLessThan(before?.indexOf('## Owners') ?? 0)
  const end = proposedBody('insert_document_section', { position: { kind: 'endOfDocument' }, markdown: '## Notes' }, DOC)
  expect(end?.trimEnd().endsWith('## Notes')).toBe(true)
  expect(proposedBody('insert_document_section', { position: { kind: 'afterSection', sectionPath: 'Nowhere' }, markdown: 'x' }, DOC)).toBe(null)
})

test('a diff becomes one suggestion per hunk, anchored under its heading', async () => {
  const proposed = proposedBody('replace_document_text', { oldString: 'None yet.', newString: '10%: Priya.' }, DOC) ?? ''
  const diff = diffLines(DOC, proposed)
  if (diff === null) throw new Error('no diff')
  const drafts = suggestionsOf(diff, DOC)
  expect(drafts.length).toBe(1)
  expect(drafts[0]?.originalText).toContain('None yet.')
  expect(drafts[0]?.replacementText).toContain('10%: Priya.')
  expect(drafts[0]?.headingContext).toEqual(['Plan', 'Owners'])
  expect(DOC).toContain(drafts[0]?.originalText ?? '???')
})

test('the question names the tool, the document, the revision and the size', async () => {
  const diff = diffLines(DOC, 'new')
  const question = describeWrite('rewrite_document', 'Plan', 7, diff)
  expect(question).toContain('Replace the whole body of "Plan" (v7)?')
  expect(question).toContain('−')
  expect(describeWrite('insert_document_section', 'Plan', 0, null)).toContain('no diff could be drawn')
})
