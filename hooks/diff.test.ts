import { expect, test } from 'claude-code/testing'

import { DIFF_LINES_MAX, diffLines, hunkSides, toUnified } from './diff'
import type { Diff } from './diff'

/** A diff the test expects to exist. */
function must(diff: Diff | null): Diff {
  if (diff === null) throw new Error('no diff')
  return diff
}

test('equal texts make no hunks', async () => {
  const diff = must(diffLines('a\nb\nc', 'a\nb\nc'))
  expect(diff.hunks).toEqual([])
  expect(toUnified(diff)).toBe('')
})

test('a changed line makes one hunk with its context, counted', async () => {
  const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n')
  const after = ['one', 'two', 'three', 'FOUR', 'five', 'six', 'seven', 'eight'].join('\n')
  const diff = must(diffLines(before, after))
  expect(diff.added).toBe(1)
  expect(diff.removed).toBe(1)
  expect(diff.hunks.length).toBe(1)
  const hunk = diff.hunks[0]
  expect(hunk?.oldStart).toBe(1)
  expect(hunk?.oldLines).toBe(7)
  expect(hunk?.newLines).toBe(7)
  expect(toUnified(diff)).toContain('@@ -1,7 +1,7 @@')
  expect(toUnified(diff)).toContain('-four\n+FOUR')
  const sides = hunkSides(hunk ?? { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, lines: [] })
  expect(sides.before).toBe('one\ntwo\nthree\nfour\nfive\nsix\nseven')
  expect(sides.after).toBe('one\ntwo\nthree\nFOUR\nfive\nsix\nseven')
})

test('far-apart changes make separate hunks; adjacent ones merge', async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
  const changed = [...lines]
  changed[2] = 'changed 3'
  changed[25] = 'changed 26'
  const diff = must(diffLines(lines.join('\n'), changed.join('\n')))
  expect(diff.hunks.length).toBe(2)
  const near = [...lines]
  near[10] = 'changed 11'
  near[13] = 'changed 14'
  expect(must(diffLines(lines.join('\n'), near.join('\n'))).hunks.length).toBe(1)
})

test('insertions and deletions count without touching the other side', async () => {
  const inserted = must(diffLines('a\nb', 'a\nx\ny\nb'))
  expect(inserted.added).toBe(2)
  expect(inserted.removed).toBe(0)
  expect(hunkSides(inserted.hunks[0] ?? { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, lines: [] }).before).toBe('a\nb')
  const deleted = must(diffLines('a\nx\nb', 'a\nb'))
  expect(deleted.added).toBe(0)
  expect(deleted.removed).toBe(1)
  const whole = must(diffLines('old body', 'new body'))
  expect(whole.added).toBe(1)
  expect(whole.removed).toBe(1)
})

test('a diff past the bounds is declined rather than attempted', async () => {
  const many = Array.from({ length: DIFF_LINES_MAX / 2 + 1 }, (_, i) => `line ${i}`).join('\n')
  expect(diffLines(many, `${many}\nmore`)).toBe(null)
  // Within the line bound but every line different: more edit steps than the search keeps.
  const left = Array.from({ length: 1000 }, (_, i) => `left ${i}`).join('\n')
  const right = Array.from({ length: 1000 }, (_, i) => `right ${i}`).join('\n')
  expect(diffLines(left, right)).toBe(null)
})
