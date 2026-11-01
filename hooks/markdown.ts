// Markdown helpers for the document pane: the outline a document's headings
// make, the slice of one section, and what the terminal does with the html
// embeds Strata documents carry. Pure functions: no `$`, no state.

import type { StrataOutlineEntry } from '../types'

/**
 * A line of Markdown is a fence delimiter when it opens or closes a code
 * block: up to three blanks, the list markers a fence may open an item
 * under (`- ```text`, each with one to four blanks after it), the
 * delimiter, and its info string. The mention scanner reads fences through
 * these same functions, so the two never disagree about where code is.
 */
const FENCE = /^( {0,3})((?:(?:[-+*]|\d{1,9}[.)])[ \t]{1,4})*)(`{3,}|~{3,})(.*)$/

/**
 * A fence open: its delimiter, its info string, and the column its item's
 * text starts at (`indent`: the width of the list markers it opened under,
 * with the blanks before and after them, a tab reaching the next multiple
 * of four; zero for a fence of its own). Its close may be indented from
 * that column to three past it; a line of text indented less ends the
 * item, and the fence with it.
 */
export type Fence = { delimiter: string; info: string; indent: number }

/** The columns `prefix` spans from the line's start, a tab reaching the next multiple of four. */
export function columnsOf(prefix: string): number {
  return columnsFrom(prefix, 0)
}

/** The column `prefix` reaches when it starts at column `from`, a tab reaching the next multiple of four. */
export function columnsFrom(prefix: string, from: number): number {
  let columns = from
  for (const char of prefix) columns = char === '\t' ? columns + 4 - (columns % 4) : columns + 1
  return columns
}

/** The line without the carriage return a CRLF ending leaves on it. */
function withoutReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * The fence `raw` opens, if any: a backtick delimiter's info string holds
 * no backtick, and each list marker before the delimiter is padded by one
 * to four columns (a tab reaching the next tab stop from where it stands;
 * five or more columns leave indented code, no fence).
 */
export function opensFence(raw: string): Fence | null {
  const delimiter = FENCE.exec(withoutReturn(raw))
  if (!delimiter) return null
  const mark = delimiter[3] ?? ''
  const info = delimiter[4] ?? ''
  if (mark[0] === '`' && info.includes('`')) return null
  const markers = delimiter[2] ?? ''
  let column = columnsOf(delimiter[1] ?? '')
  for (const marker of markers.matchAll(/([-+*]|\d{1,9}[.)])([ \t]{1,4})/g)) {
    const markerEnd = columnsFrom(marker[1] ?? '', column)
    column = columnsFrom(marker[2] ?? '', markerEnd)
    if (column - markerEnd > 4) return null
  }
  return { delimiter: mark, info, indent: markers === '' ? 0 : column }
}

/**
 * An ATX heading: its marks, then its title, with an optional closing run of
 * hashes that only counts when a space precedes it (`# C#` is titled `C#`).
 */
const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/

/**
 * How a line after the fence `open` reads: `content`; `close`, a delimiter
 * of the same character, at least as long, indented from the item's column
 * to three past it, with nothing but whitespace after it (a delimiter
 * followed by text, ` ```html `, is content); or `end`, a line of text
 * indented less than the item the fence opened under, which ends the item
 * and the fence with it, and is read anew as what it is.
 */
export function insideFence(raw: string, open: Fence): 'content' | 'close' | 'end' {
  const line = withoutReturn(raw)
  // Blanks, as Markdown has them: spaces and tabs alone.
  if (/^[ \t]*$/.test(line)) return 'content'
  const leading = /^[ \t]*/.exec(line)?.[0] ?? ''
  const columns = columnsOf(leading)
  if (columns < open.indent) return 'end'
  if (columns > open.indent + 3) return 'content'
  const delimiter = /^(`{3,}|~{3,})(.*)$/.exec(line.slice(leading.length))
  if (!delimiter) return 'content'
  const mark = delimiter[1] ?? ''
  const isClose = mark[0] === open.delimiter[0] && mark.length >= open.delimiter.length && /^[ \t]*$/.test(delimiter[2] ?? '')
  return isClose ? 'close' : 'content'
}

/**
 * Where the fence opened at line `from` of `lines` runs to: `end` is the
 * line of its close, or the first line outside it (its item's end, or the
 * text's); `last` is the first line after the fence, close included.
 */
export function fenceEnd(lines: readonly string[], from: number, open: Fence): { end: number; last: number } {
  for (let at = from + 1; at < lines.length; at += 1) {
    const inside = insideFence(lines[at] ?? '', open)
    if (inside === 'close') return { end: at, last: at + 1 }
    if (inside === 'end') return { end: at, last: at }
  }
  return { end: lines.length, last: lines.length }
}

/**
 * The headings of `markdown`, outside code fences, each with the heading path
 * `read_document` takes in `sections` (titles joined by ` > `).
 */
export function outlineOf(markdown: string): StrataOutlineEntry[] {
  const entries: StrataOutlineEntry[] = []
  const trail: string[] = []
  let fence: Fence | null = null
  for (const line of markdown.split('\n')) {
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    const opened = opensFence(line)
    if (opened !== null) {
      fence = opened
      continue
    }
    const heading = HEADING.exec(line)
    if (!heading) continue
    const level = (heading[1] ?? '#').length
    const title = (heading[2] ?? '').trim()
    trail.length = Math.max(0, level - 1)
    while (trail.length < level - 1) trail.push('')
    trail[level - 1] = title
    const path = trail.filter(part => part !== '').join(' > ')
    entries.push({ level, title, path })
  }
  return entries
}

/** The headings of `markdown`, outside code fences, with the line each is on. */
function headingsOf(markdown: string): { level: number; title: string; line: number }[] {
  const out: { level: number; title: string; line: number }[] = []
  let fence: Fence | null = null
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    const opened = opensFence(line)
    if (opened !== null) {
      fence = opened
      continue
    }
    const heading = HEADING.exec(line)
    if (!heading) continue
    out.push({ level: (heading[1] ?? '#').length, title: (heading[2] ?? '').trim(), line: i })
  }
  return out
}

/**
 * The paths the whole document gives headings of sections read on their
 * own: a section's text starts at its heading, so the paths its headings
 * make lack the ancestors above it. The returned sections come in order,
 * each starting at its own heading: at each such root the ancestry restarts
 * from that section's path, and the headings under it hang from it by their
 * levels. The next root is a heading with its title at or above the current
 * root's level: a heading deeper than the root is one of its descendants,
 * even when it shares a later section's title. Only when no such heading
 * follows before the section after it begins (a section returned from
 * deeper in the document than the one before it) does a deeper heading
 * with that title count as the root: the one at the level the path's
 * length names, when exactly one is (the server returns a section's
 * heading at its own level); else the last that is no descendant of a
 * candidate before it (a same-titled child of a root is its own child), at
 * whatever level, since documents skip levels and a path's length need not
 * match a heading's level.
 * One path (its parts) per heading, in order; a heading before any root,
 * or beside one and no root, keeps the path its own level gives it among
 * its neighbours.
 */
function rebasePaths(headings: readonly { level: number; title: string }[], sectionsReturned: readonly string[]): string[][] {
  return rebase(headings, sectionsReturned).paths
}

/**
 * Whether text held as sections (`sectionsReturned`) has a heading that
 * could begin a returned section or belong to the one before it: a deeper
 * root chosen among several same-titled candidates. The choice is a guess
 * then, and nothing should anchor to the text by it.
 */
export function heldHeadingsAmbiguous(markdown: string, sectionsReturned: readonly string[]): boolean {
  return rebase(headingsOf(markdown), sectionsReturned).isAmbiguous
}

function rebase(
  headings: readonly { level: number; title: string }[],
  sectionsReturned: readonly string[],
): { paths: string[][]; isAmbiguous: boolean } {
  let isAmbiguous = false
  const roots = sectionsReturned.map(path => {
    const parts = path.split(' > ')
    return { title: parts[parts.length - 1] ?? '', ancestors: parts.slice(0, -1) }
  })
  const out: string[][] = []
  let nextRoot = 0
  let base: string[] = []
  let trail: string[] = []
  let rootLevel = 0
  const own: string[] = []
  // Whether heading `i` begins root `k`: at or above the current root's level
  // it does; deeper, only as the candidate chosen among the headings with
  // that title before the section after it begins (a heading with the next
  // root's title at or above the current root's level; a deeper one is a
  // candidate itself, not a boundary): the one at the level the path's
  // length names when exactly one is, else the last that is no descendant
  // of the candidate chosen before it. Chosen once, at the first candidate,
  // so every later one is judged against the same choice.
  const chosen = new Map<number, number>()
  const levelOf = (j: number): number => headings[j]?.level ?? 0
  const begins = (i: number, k: number): boolean => {
    const root = roots[k]
    const heading = headings[i]
    if (root === undefined || heading === undefined || root.title !== heading.title) return false
    if (rootLevel === 0 || heading.level <= rootLevel) return true
    const known = chosen.get(k)
    if (known !== undefined) return known === i
    const after = roots[k + 1]
    const candidates: number[] = []
    for (let j = i; j < headings.length; j += 1) {
      const later = headings[j]
      if (later === undefined) continue
      if (j > i && after !== undefined && later.title === after.title && later.level <= rootLevel) break
      if (later.title === root.title) candidates.push(j)
    }
    // Several candidates: the choice below is a guess, and the text says so.
    if (candidates.length > 1) isAmbiguous = true
    const depth = root.ancestors.length + 1
    const atDepth = candidates.filter(j => levelOf(j) === depth)
    let pick = i
    if (atDepth.length === 1) {
      pick = atDepth[0] ?? i
    } else {
      for (const j of candidates) {
        if (j === pick) continue
        let isDescendant = levelOf(j) > levelOf(pick)
        for (let m = pick + 1; isDescendant && m < j; m += 1) {
          if (levelOf(m) <= levelOf(pick)) isDescendant = false
        }
        if (!isDescendant) pick = j
      }
    }
    chosen.set(k, pick)
    return pick === i
  }
  for (const [index, heading] of headings.entries()) {
    // The path the heading's own level gives it, the way `outlineOf` reads the text.
    own.length = Math.max(0, heading.level - 1)
    while (own.length < heading.level - 1) own.push('')
    own[heading.level - 1] = heading.title
    const at = roots.findIndex((_, k) => k >= nextRoot && begins(index, k))
    if (at >= 0) {
      const root = roots[at]
      nextRoot = at + 1
      base = root === undefined ? [] : root.ancestors
      rootLevel = heading.level
      trail = [heading.title]
      out.push([...base, ...trail])
      continue
    }
    if (rootLevel === 0 || heading.level <= rootLevel) {
      out.push(own.filter(part => part !== ''))
      continue
    }
    const depth = heading.level - rootLevel
    trail.length = Math.min(trail.length, depth)
    while (trail.length < depth) trail.push('')
    trail[depth] = heading.title
    out.push([...base, ...trail.filter(part => part !== '')])
  }
  return { paths: out, isAmbiguous }
}

/**
 * Where each thread's quoted text lies among the drawn blocks: the block the
 * quote starts in, when the text occurs exactly once in `drawn` (the text
 * the blocks were cut from); a quote found nowhere, or in two places, is
 * `loose`, since a guess would put it under a paragraph it may not belong to.
 */
export function placeThreads<T extends { id: string; quotedText: string }>(
  drawn: string,
  blocks: readonly MarkdownBlock[],
  threads: readonly T[],
): { perBlock: T[][]; loose: T[] } {
  const lineStart: number[] = [0]
  for (const line of drawn.split('\n')) lineStart.push((lineStart[lineStart.length - 1] ?? 0) + line.length + 1)
  const perBlock: T[][] = blocks.map(() => [])
  const loose: T[] = []
  for (const thread of threads) {
    if (thread.quotedText === '') {
      loose.push(thread)
      continue
    }
    const first = drawn.indexOf(thread.quotedText)
    const again = first < 0 ? -1 : drawn.indexOf(thread.quotedText, first + 1)
    const at =
      first < 0 || again >= 0
        ? -1
        : blocks.findIndex(
            block =>
              block.kind !== 'embed' && first >= (lineStart[block.start] ?? 0) && first < (lineStart[block.end] ?? Number.POSITIVE_INFINITY),
          )
    if (at < 0) loose.push(thread)
    else perBlock[at]?.push(thread)
  }
  return { perBlock, loose }
}

/** The outline of sections read on their own, with the paths the whole document gives them (`rebasePaths`). */
export function rebaseOutline(entries: readonly StrataOutlineEntry[], sectionsReturned: readonly string[]): StrataOutlineEntry[] {
  if (sectionsReturned.length === 0) return [...entries]
  const paths = rebasePaths(entries, sectionsReturned)
  return entries.map((entry, index) => ({ ...entry, path: (paths[index] ?? [entry.title]).join(' > ') }))
}

/**
 * The heading path (its parts) in force at line `at` of text made of sections
 * read on their own, as the whole document names it; empty before any heading.
 */
export function heldPathAt(markdown: string, at: number, sectionsReturned: readonly string[]): string[] {
  const headings = headingsOf(markdown)
  const paths = rebasePaths(headings, sectionsReturned)
  let path: string[] = []
  for (const [index, heading] of headings.entries()) {
    if (heading.line > at) break
    path = paths[index] ?? []
  }
  return path
}

/**
 * Where the section the whole document names `path` lies in text held as
 * sections (`sectionsReturned`), whose headings lack their ancestors: the
 * first heading whose rebased path is `path`, to the next heading at its
 * level or above. Null when the text holds no such heading. A path search
 * over the held text would be wrong here: the held `## A` of `A > A` reads
 * as plain `A`, and its own `### A` as `A > A`.
 */
export function heldSectionRange(
  markdown: string,
  path: string,
  sectionsReturned: readonly string[],
): { start: number; end: number } | null {
  const headings = headingsOf(markdown)
  const folded = rebasePaths(headings, sectionsReturned).map(parts => foldPath(parts.join(' > ')))
  const wanted = foldPath(path)
  const at = folded.indexOf(wanted)
  const heading = headings[at]
  if (heading === undefined) return null
  // The section ends at the next heading at its level or above, or at one the
  // whole document places outside it: another returned section's root sits
  // under its own ancestors there, however deep its heading is here.
  const after = headings.findIndex(
    (later, i) => i > at && (later.level <= heading.level || !(folded[i] ?? '').startsWith(`${wanted} > `)),
  )
  const end = headings[after]?.line
  return { start: heading.line, end: after === -1 || end === undefined ? markdown.split('\n').length : end }
}

/**
 * The heading paths in force through `markdown`, once for the whole text:
 * each heading's line, in order, and the path (joined by ` > `) it begins,
 * as the whole document names it when the text is sections returned
 * (`sectionsReturned`, empty for the whole document). A line is under the
 * last heading at or before it, and under none before the first.
 */
export function headingPathsByLine(markdown: string, sectionsReturned: readonly string[]): { lines: number[]; paths: string[] } {
  const headings = headingsOf(markdown)
  return {
    lines: headings.map(heading => heading.line),
    paths: rebasePaths(headings, sectionsReturned).map(parts => parts.join(' > ')),
  }
}

/** A heading path as the server compares it: trimmed parts, case folded. */
function foldPath(path: string): string {
  return path
    .split('>')
    .map(part => part.trim().toLowerCase())
    .filter(part => part !== '')
    .join(' > ')
}

/**
 * Where the section at `path` lies in `markdown`: its heading line, and the
 * line after its last. Paths match as the server matches them, regardless of
 * case and of spacing around the separators.
 */
export function sectionRange(markdown: string, path: string): { start: number; end: number } | null {
  const lines = markdown.split('\n')
  const wanted = foldPath(path)
  const trail: string[] = []
  let fence: Fence | null = null
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    const opened = opensFence(line)
    if (opened !== null) {
      fence = opened
      continue
    }
    const heading = HEADING.exec(line)
    if (!heading) continue
    const thisLevel = (heading[1] ?? '#').length
    if (start >= 0 && thisLevel <= level) return { start, end: i }
    if (start >= 0) continue
    const title = (heading[2] ?? '').trim()
    trail.length = Math.max(0, thisLevel - 1)
    while (trail.length < thisLevel - 1) trail.push('')
    trail[thisLevel - 1] = title
    if (foldPath(trail.filter(part => part !== '').join(' > ')) === wanted) {
      start = i
      level = thisLevel
    }
  }
  return start >= 0 ? { start, end: lines.length } : null
}

/**
 * The section of `markdown` under the heading at `path`: from its heading line
 * to the next heading of the same or a higher level. The whole text for a null
 * path, and for a path the text does not hold.
 */
export function sectionSlice(markdown: string, path: string | null): string {
  if (path === null) return markdown
  const range = sectionRange(markdown, path)
  if (range === null) return markdown
  return markdown.split('\n').slice(range.start, range.end).join('\n')
}

/** The heading path (its parts) in force at line `at` of `markdown`; empty before any heading. */
export function headingPathAt(markdown: string, at: number): string[] {
  const lines = markdown.split('\n')
  const trail: string[] = []
  let fence: Fence | null = null
  for (let i = 0; i <= Math.min(at, lines.length - 1); i += 1) {
    const line = lines[i] ?? ''
    if (fence !== null) {
      const inside = insideFence(line, fence)
      if (inside !== 'end') {
        if (inside === 'close') fence = null
        continue
      }
      fence = null
    }
    const opened = opensFence(line)
    if (opened !== null) {
      fence = opened
      continue
    }
    if (fence !== null) continue
    const heading = HEADING.exec(line)
    if (!heading) continue
    const level = (heading[1] ?? '#').length
    trail.length = Math.max(0, level - 1)
    while (trail.length < level - 1) trail.push('')
    trail[level - 1] = (heading[2] ?? '').trim()
  }
  return trail.filter(part => part !== '')
}

/** What kind of block a run of Markdown lines is, as the pane's cursor treats it. */
export type BlockKind = 'heading' | 'paragraph' | 'code' | 'embed'

/** One block of Markdown the pane's cursor can rest on: a run of lines, and where it lies. */
export type MarkdownBlock = {
  /** The block's first line, 0-based, in the text it was cut from. */
  start: number
  /** The line after its last. */
  end: number
  /** The lines, joined; what a comment quotes. */
  text: string
  kind: BlockKind
}

/**
 * The blocks of `markdown`: each heading alone, each fenced code block whole,
 * and otherwise each run of non-blank lines. A folded html placeholder (what
 * `degradeHtml` leaves) and a revealed html fence are `embed`: shown, never
 * quoted, since the document's text there is not what the terminal draws.
 */
/** The line `degradeHtml` leaves for a folded html fence. */
const PLACEHOLDER = /^> \*\*html block \d+\*\*/

export function blocksOf(markdown: string): MarkdownBlock[] {
  const lines = markdown.split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0
  const push = (start: number, end: number, kind: BlockKind) => {
    const text = lines.slice(start, end).join('\n')
    if (text.trim() !== '') blocks.push({ start, end, text, kind })
  }
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i += 1
      continue
    }
    const opened = opensFence(line)
    if (opened !== null) {
      const { last } = fenceEnd(lines, i, opened)
      const isHtml = /^\s*html\b/i.test(opened.info)
      push(i, last, isHtml ? 'embed' : 'code')
      i = last
      continue
    }
    if (/^#{1,6}\s+\S/.test(line)) {
      push(i, i + 1, 'heading')
      i += 1
      continue
    }
    if (PLACEHOLDER.test(line)) {
      push(i, i + 1, 'embed')
      i += 1
      continue
    }
    // A paragraph ends before a fence, a heading, or a folded placeholder
    // (an html fence right under a paragraph, with no blank line between):
    // the placeholder stays an embed of its own, never quoted with the text.
    let end = i + 1
    while (end < lines.length) {
      const next = lines[end] ?? ''
      if (next.trim() === '' || opensFence(next) !== null || /^#{1,6}\s+\S/.test(next) || PLACEHOLDER.test(next)) break
      end += 1
    }
    push(i, end, 'paragraph')
    i = end
  }
  return blocks
}

/** An html embed the pane folded or showed, by its index among the text's html fences. */
export type HtmlFence = {
  index: number
  lines: number
  uses: string[]
  isRevealed: boolean
}

/**
 * Strata html embeds (```html fences, optionally `uses="a,b"`) cannot run in a
 * terminal. Each one folds to a one-line placeholder naming its size and what
 * it uses, unless its index is in `revealed`, when its source is drawn as
 * code. Binding markers (`<!-- strata:name=x -->`) are hidden; the named data
 * fences they bind stay, since they read as data. A fence of another kind
 * passes through whole, an html fence inside it included: it is code, not an
 * embed. `origin[i]` is the line of `markdown` that line `i` of the text came
 * from (a placeholder's is its fence's opening line), so a block of the
 * text can be found in the document as written.
 */
export function degradeHtml(
  markdown: string,
  revealed: readonly number[],
): { text: string; fences: HtmlFence[]; origin: number[] } {
  const out: string[] = []
  const origin: number[] = []
  const fences: HtmlFence[] = []
  const lines = markdown.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (/^\s*<!--\s*strata:[^>]*-->\s*$/.test(line)) {
      i += 1
      continue
    }
    const opened = opensFence(line)
    const isHtml = opened !== null && /^\s*html\b/i.test(opened.info)
    if (opened !== null && !isHtml) {
      // A code fence that is not an embed: copied whole, to its close.
      const { last } = fenceEnd(lines, i, opened)
      for (let at = i; at < last; at += 1) {
        out.push(lines[at] ?? '')
        origin.push(at)
      }
      i = last
      continue
    }
    if (opened === null) {
      out.push(line)
      origin.push(i)
      i += 1
      continue
    }
    const attrs = opened.info.replace(/^\s*html\b/i, '')
    const { end, last } = fenceEnd(lines, i, opened)
    const body = lines.slice(i + 1, end)
    const uses = (/uses\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '')
      .split(',')
      .map(name => name.trim())
      .filter(name => name !== '')
    const index = fences.length
    const isRevealed = revealed.includes(index)
    fences.push({ index, lines: body.length, uses, isRevealed })
    if (isRevealed) {
      for (let at = i; at < last; at += 1) {
        out.push(lines[at] ?? '')
        origin.push(at)
      }
    } else {
      const using = uses.length > 0 ? `, uses ${uses.join(', ')}` : ''
      out.push(`> **html block ${index + 1}** (${body.length} lines${using}): runs in the web app`)
      origin.push(i)
    }
    i = last
  }
  return { text: out.join('\n'), fences, origin }
}

/** What `read_document` answered, in the two shapes it has. */
export type ReadResult = {
  id: string
  title: string
  version: number
  format: 'markdown' | 'outline'
  /** The Markdown read; empty for an outline answer. */
  markdown: string
  /** The server's outline, when the answer carried one. */
  outline: StrataOutlineEntry[]
  /** The heading paths a sectioned read returned. */
  sectionsReturned: string[]
}

/** Parse the JSON `read_document` answers; null for anything else. */
export function parseReadResult(text: string): ReadResult | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const id = record.documentId
  const title = record.title
  if (typeof id !== 'string' || typeof title !== 'string') return null
  const version = typeof record.documentVersion === 'number' ? record.documentVersion : 0
  const format = record.format === 'outline' ? 'outline' : 'markdown'
  const markdown = typeof record.content === 'string' ? record.content : ''
  const outline = Array.isArray(record.outline)
    ? record.outline.flatMap(entry => {
        if (typeof entry !== 'object' || entry === null) return []
        const row = entry as Record<string, unknown>
        const path = typeof row.path === 'string' ? row.path : null
        if (path === null || path === '') return []
        const heading = typeof row.heading === 'string' ? row.heading : path.split(' > ').pop() ?? path
        const level = typeof row.headingLevel === 'number' ? row.headingLevel : path.split(' > ').length
        return [{ level: Math.max(1, level), title: heading, path }]
      })
    : []
  const sectionsReturned = Array.isArray(record.sectionsReturned)
    ? record.sectionsReturned.filter((entry): entry is string => typeof entry === 'string')
    : []
  return { id, title, version, format, markdown, outline, sectionsReturned }
}
