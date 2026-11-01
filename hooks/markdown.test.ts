import { expect, test } from 'claude-code/testing'

import {
  blocksOf,
  degradeHtml,
  heldHeadingsAmbiguous,
  heldPathAt,
  heldSectionRange,
  outlineOf,
  parseReadResult,
  placeThreads,
  rebaseOutline,
  sectionSlice,
} from './markdown'

const DOC = [
  '# Plan',
  '',
  'Intro.',
  '',
  '## Risks',
  '',
  'The gate reads p95 alone.',
  '',
  '```ts',
  '# not a heading',
  '```',
  '',
  '### Rollback',
  '',
  'Manual.',
  '',
  '## Owners',
  '',
  'None yet.',
  '',
].join('\n')

test('a trailing hash is part of the title unless a space sets it off as a closing run', async () => {
  const text = '# C#\n\nSharp.\n\n## A ##\n\nClosed.\n\n## B#\n\nAlso sharp.'
  expect(outlineOf(text).map(entry => entry.title)).toEqual(['C#', 'A', 'B#'])
  expect(outlineOf(text).map(entry => entry.path)).toEqual(['C#', 'C# > A', 'C# > B#'])
  expect(sectionSlice(text, 'C# > B#').trim()).toBe('## B#\n\nAlso sharp.')
})

test('headings make the paths read_document takes in sections', async () => {
  expect(outlineOf(DOC).map(entry => entry.path)).toEqual([
    'Plan',
    'Plan > Risks',
    'Plan > Risks > Rollback',
    'Plan > Owners',
  ])
  expect(outlineOf(DOC).map(entry => entry.level)).toEqual([1, 2, 3, 2])
})

test('a section runs to the next heading of its level or above', async () => {
  const risks = sectionSlice(DOC, 'Plan > Risks')
  expect(risks.startsWith('## Risks')).toBe(true)
  expect(risks).toContain('### Rollback')
  expect(risks).not.toContain('## Owners')
  expect(sectionSlice(DOC, 'Plan > Owners').trim()).toBe('## Owners\n\nNone yet.')
  // Paths match as the server matches them: case folded, spacing around the separator free.
  expect(sectionSlice(DOC, 'plan>OWNERS').trim()).toBe('## Owners\n\nNone yet.')
  expect(sectionSlice(DOC, null)).toBe(DOC)
  expect(sectionSlice(DOC, 'Nowhere')).toBe(DOC)
})

test('blocks: each heading alone, each fence whole, else runs of lines; embeds marked', async () => {
  const blocks = blocksOf(DOC)
  expect(blocks.map(block => block.kind)).toEqual([
    'heading',
    'paragraph',
    'heading',
    'paragraph',
    'code',
    'heading',
    'paragraph',
    'heading',
    'paragraph',
  ])
  expect(blocks[4]?.text).toBe('```ts\n# not a heading\n```')
  expect(blocks[3]?.start).toBe(6)
  expect(blocks[3]?.text).toBe('The gate reads p95 alone.')
  const embed = 'A.\n\n```html\n<div/>\n```\n\nB.'
  expect(blocksOf(degradeHtml(embed, []).text).map(block => block.kind)).toEqual(['paragraph', 'embed', 'paragraph'])
  expect(blocksOf(degradeHtml(embed, [0]).text).map(block => block.kind)).toEqual(['paragraph', 'embed', 'paragraph'])
  expect(blocksOf('one\ntwo\n\nthree').map(block => block.text)).toEqual(['one\ntwo', 'three'])
})

test('each drawn line knows the document line it came from, markers and folds included', async () => {
  const original = ['A.', '', '<!-- strata:name=x -->', '```html', '<div>A.</div>', '```', '', 'B.'].join('\n')
  const folded = degradeHtml(original, [])
  expect(folded.text.split('\n')).toEqual(['A.', '', '> **html block 1** (1 lines): runs in the web app', '', 'B.'])
  expect(folded.origin).toEqual([0, 1, 3, 6, 7])
  const shown = degradeHtml(original, [0])
  expect(shown.origin).toEqual([0, 1, 3, 4, 5, 6, 7])
})

test('a code fence of another kind passes whole, an html fence inside it included', async () => {
  const text = ['````md', '```html', '<x/>', '```', '````', '', 'After.'].join('\n')
  const folded = degradeHtml(text, [])
  expect(folded.fences).toEqual([])
  expect(folded.text).toBe(text)
  expect(folded.origin).toEqual([0, 1, 2, 3, 4, 5, 6])
})

test('a delimiter with text after it inside a fence is content, not its close', async () => {
  const text = ['# A', '', '```', '```html', '## Fake', '```', '', '## B'].join('\n')
  expect(outlineOf(text).map(entry => entry.path)).toEqual(['A', 'A > B'])
  expect(degradeHtml(text, []).fences).toEqual([])
  expect(blocksOf(text).map(block => block.kind)).toEqual(['heading', 'code', 'heading'])
})

test("a sectioned read's headings go back under the ancestors the whole document gives them", async () => {
  const entries = outlineOf('## Risks\n\nThe gate.\n\n### Rollback\n\nManual.')
  expect(entries.map(entry => entry.path)).toEqual(['Risks', 'Risks > Rollback'])
  const rebased = rebaseOutline(entries, ['Plan > Risks'])
  expect(rebased.map(entry => entry.path)).toEqual(['Plan > Risks', 'Plan > Risks > Rollback'])
  expect(rebased.map(entry => entry.level)).toEqual([2, 3])
  expect(rebaseOutline(entries, []).map(entry => entry.path)).toEqual(['Risks', 'Risks > Rollback'])
  // Two sections of different depths, read together: each restarts the ancestry at its own root.
  const mixed = outlineOf('## Risks\n\nThe gate.\n\n### Deadlines\n\nSoon.\n\n#### Q3\n\nJuly.')
  expect(rebaseOutline(mixed, ['Plan > Risks', 'Plan > Owners > Deadlines']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Owners > Deadlines',
    'Plan > Owners > Deadlines > Q3',
  ])
  // A sub-heading that shares a later section's title is a descendant, not that section.
  const text = '## Risks\n\nThe gate.\n\n### Summary\n\nShort.\n\n## Summary\n\nAll.\n\nMore.'
  const shared = outlineOf(text)
  expect(rebaseOutline(shared, ['Plan > Risks', 'Owners > Summary']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Risks > Summary',
    'Owners > Summary',
  ])
  // Even when the later section's path is as deep as the sub-heading: the real one is the last such heading.
  const deeper = outlineOf('## Risks\n\nThe gate.\n\n### Summary\n\nShort.\n\n### Summary\n\nAll.')
  expect(rebaseOutline(deeper, ['Plan > Risks', 'Owners > Notes > Summary']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Risks > Summary',
    'Owners > Notes > Summary',
  ])
  // A same-titled heading inside a later returned section is past the boundary and does not count.
  const bounded = outlineOf('## Risks\n\nThe gate.\n\n### Summary\n\nShort.\n\n## Owners\n\nWho.\n\n### Summary\n\nTheirs.')
  expect(
    rebaseOutline(bounded, ['Plan > Risks', 'Other > Notes > Summary', 'Plan > Owners']).map(entry => entry.path),
  ).toEqual(['Plan > Risks', 'Other > Notes > Summary', 'Plan > Owners', 'Plan > Owners > Summary'])
  // A deeper heading with the following section's title is no boundary. Among
  // the candidates before a real one, the heading at the level the path's
  // length names wins when there is exactly one: the server returns a
  // section's heading at its own level, so `### Summary` is `Plan > Other >
  // Summary`, and the `#### Summary` under it is its own child.
  const nested = outlineOf('## Risks\n\nA.\n\n### Summary\n\nB.\n\n#### Owners\n\nC.\n\n#### Summary\n\nD.\n\n## Owners\n\nE.')
  expect(rebaseOutline(nested, ['Plan > Risks', 'Plan > Other > Summary', 'Plan > Owners']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Other > Summary',
    'Plan > Other > Summary > Owners',
    'Plan > Other > Summary > Summary',
    'Plan > Owners',
  ])
  // A same-titled child of a returned section's root cannot displace the root.
  const child = outlineOf('## Risks\n\nA.\n\n### Schedule\n\nB.\n\n#### Schedule\n\nC.')
  expect(rebaseOutline(child, ['Plan > Risks', 'Plan > Owners > Schedule']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Owners > Schedule',
    'Plan > Owners > Schedule > Schedule',
  ])
  expect(heldSectionRange('## Risks\n\nA.\n\n### Schedule\n\nB.\n\n#### Schedule\n\nC.', 'Plan > Risks', ['Plan > Risks', 'Plan > Owners > Schedule'])).toEqual({
    start: 0,
    end: 4,
  })
  // A document that skips levels: the section's heading level need not match its path's length.
  const skipped = outlineOf('## Risks\n\nThe gate.\n\n#### Schedule\n\nQ3.')
  expect(rebaseOutline(skipped, ['Plan > Risks', 'Plan > Owners > Schedule']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Owners > Schedule',
  ])
})

test('a thread sits under the block its quote starts in, and nowhere when found twice or not at all', async () => {
  const drawn = 'Summary.\n\nThe full summary is Summary.\n\nTwice.\n\nTwice.'
  const blocks = blocksOf(drawn)
  const threads = [
    { id: 'a', quotedText: 'The full summary is Summary.' },
    { id: 'b', quotedText: 'Summary.' },
    { id: 'c', quotedText: 'Twice.' },
    { id: 'd', quotedText: 'Nowhere.' },
    { id: 'e', quotedText: '' },
  ]
  const placed = placeThreads(drawn, blocks, threads)
  expect(placed.perBlock.map(list => list.map(thread => thread.id))).toEqual([[], ['a'], [], []])
  expect(placed.loose.map(thread => thread.id)).toEqual(['b', 'c', 'd', 'e'])
})

test('the breadcrumbs in force at a line of held text name the section the line is under', async () => {
  const text = '## Risks\n\nThe gate.\n\n### Summary\n\nShort.\n\n## Summary\n\nAll.\n\nMore.'
  const lines = text.split('\n')
  expect(heldPathAt(text, lines.indexOf('The gate.'), ['Plan > Risks', 'Owners > Summary'])).toEqual(['Plan', 'Risks'])
  expect(heldPathAt(text, lines.indexOf('Short.'), ['Plan > Risks', 'Owners > Summary'])).toEqual(['Plan', 'Risks', 'Summary'])
  expect(heldPathAt(text, lines.indexOf('More.'), ['Plan > Risks', 'Owners > Summary'])).toEqual(['Owners', 'Summary'])
  expect(heldPathAt('No heading.', 0, ['Plan > Risks'])).toEqual([])
})

test('a tilde line inside a backtick fence closes nothing, so a heading in the fence is not a heading', async () => {
  const text = ['# A', '', '```', '~~~', '## Fake', '```', '', '## B', '', 'b'].join('\n')
  expect(outlineOf(text).map(entry => entry.path)).toEqual(['A', 'A > B'])
  // The fake heading is no section: asking for it answers the whole text, and B's section starts at the real heading.
  expect(sectionSlice(text, 'A > Fake')).toBe(text)
  expect(sectionSlice(text, 'A > B').trim()).toBe('## B\n\nb')
})

test('html embeds fold to a placeholder until shown, and binding markers hide', async () => {
  const text = [
    'Before.',
    '',
    '<!-- strata:name=sales -->',
    '```json name=sales',
    '{"a": 1}',
    '```',
    '',
    '```html uses="sales"',
    '<div>chart</div>',
    '<script>draw()</script>',
    '```',
    '',
    'After.',
  ].join('\n')
  const folded = degradeHtml(text, [])
  expect(folded.fences).toEqual([{ index: 0, lines: 2, uses: ['sales'], isRevealed: false }])
  expect(folded.text).not.toContain('strata:name')
  expect(folded.text).toContain('```json name=sales')
  expect(folded.text).toContain('html block 1')
  expect(folded.text).not.toContain('<script>')
  const shown = degradeHtml(text, [0])
  expect(shown.text).toContain('<script>draw()</script>')
  expect(shown.fences[0]?.isRevealed).toBe(true)
})

test('a read answer parses in both of its shapes', async () => {
  const markdown = parseReadResult(
    JSON.stringify({ documentId: 'doc_1', title: 'Plan', format: 'markdown', documentVersion: 4, content: DOC }),
  )
  expect(markdown?.version).toBe(4)
  expect(markdown?.markdown).toBe(DOC)
  const outline = parseReadResult(
    JSON.stringify({
      documentId: 'doc_1',
      title: 'Plan',
      format: 'outline',
      documentVersion: 5,
      outline: [
        { heading: 'Plan', headingLevel: 1, path: 'Plan', tokenCount: 10, preview: '' },
        { heading: 'Risks', headingLevel: 2, path: 'Plan > Risks', tokenCount: 20, preview: '' },
      ],
    }),
  )
  expect(outline?.format).toBe('outline')
  expect(outline?.outline.map(entry => entry.title)).toEqual(['Plan', 'Risks'])
  expect(parseReadResult('not json')).toBe(null)
  expect(parseReadResult('{"title":"x"}')).toBe(null)
})

test('a held section is found by the name the whole document gives it, not by a path search over the held text', () => {
  // Read as `A > A` of a document whose `# A` holds `## A` holds `### A`: the
  // held text starts at `## A`, which a path search would call plain `A`, and
  // whose own `### A` it would call `A > A`.
  const held = '## A\n\nOwn.\n\n### A\n\nNested.\n\n## B\n\nOther.\n'
  expect(heldSectionRange(held, 'A > A', ['A > A', 'A > B'])).toEqual({ start: 0, end: 8 })
  expect(heldSectionRange(held, 'a > a > a', ['A > A', 'A > B'])).toEqual({ start: 4, end: 8 })
  expect(heldSectionRange(held, 'A > B', ['A > A', 'A > B'])).toEqual({ start: 8, end: 12 })
  expect(heldSectionRange(held, 'A', ['A > A', 'A > B'])).toBeNull()
})

test('a held section ends where the whole document places the next returned section, however deep its heading', () => {
  // `Plan > Risks` and `Plan > Owners > Schedule` read together: Schedule's
  // heading is deeper than Risks', yet it is no part of Risks.
  const held = '## Risks\n\nR.\n\n#### Schedule\n\nS.\n'
  const sections = ['Plan > Risks', 'Plan > Owners > Schedule']
  expect(heldSectionRange(held, 'Plan > Risks', sections)).toEqual({ start: 0, end: 4 })
  expect(heldSectionRange(held, 'Plan > Owners > Schedule', sections)).toEqual({ start: 4, end: 8 })
})

test('a folded html placeholder right under a paragraph stays an embed of its own', () => {
  // No blank line between the paragraph and the fence: the placeholder must
  // not be quoted along with the paragraph, since it stands for hidden source.
  const folded = degradeHtml('Intro.\n```html\n<b>x</b>\n```\n\nAfter.', []).text
  const blocks = blocksOf(folded)
  expect(blocks.map(block => block.kind)).toEqual(['paragraph', 'embed', 'paragraph'])
  expect(blocks[0]?.text).toBe('Intro.')
})

test('sections read together are ambiguous when a deeper root is chosen among several same-titled headings', () => {
  const sections = ['Plan > Risks', 'Plan > Owners > Schedule']
  // Two headings could begin `Plan > Owners > Schedule`: the choice is a guess.
  expect(heldHeadingsAmbiguous('## Risks\n\nA.\n\n### Schedule\n\nB.\n\n#### Schedule\n\nC.', sections)).toBe(true)
  // One heading can: no guess.
  expect(heldHeadingsAmbiguous('## Risks\n\nA.\n\n#### Schedule\n\nC.', sections)).toBe(false)
  // A root at or above the current root's level is never a guess.
  expect(heldHeadingsAmbiguous('## Risks\n\nA.\n\n## Schedule\n\nC.', sections)).toBe(false)
  expect(heldHeadingsAmbiguous('## Risks\n\nA.', ['Plan > Risks'])).toBe(false)
})
