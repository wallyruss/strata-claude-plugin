// The write guard's reasoning: what a write tool's call would leave the
// document reading, the diff against what it reads now, how to say it, and
// the suggestions a diff makes. Pure functions: no `$`, no state.

import type { Diff, DiffHunk } from './diff'
import { hunkSides } from './diff'
import { headingPathAt, sectionRange } from './markdown'

export type WriteTool = 'rewrite_document' | 'replace_document_text' | 'insert_document_section'

export const WRITE_TOOLS: readonly WriteTool[] = [
  'rewrite_document',
  'replace_document_text',
  'insert_document_section',
]

export function isWriteTool(name: string | null): name is WriteTool {
  return name !== null && (WRITE_TOOLS as readonly string[]).includes(name)
}

/**
 * The body `args` would leave `current` reading, or null when the call cannot
 * apply as written (text it replaces is absent, a section it names is not
 * there): the server refuses those itself, so the guard has nothing to ask.
 */
export function proposedBody(tool: WriteTool, args: Record<string, unknown>, current: string): string | null {
  switch (tool) {
    case 'rewrite_document':
      return typeof args.newContent === 'string' ? args.newContent : null
    case 'replace_document_text': {
      const before = args.oldString
      const after = args.newString
      if (typeof before !== 'string' || typeof after !== 'string' || before === '') return null
      if (!current.includes(before)) return null
      return args.replaceAll === true ? current.split(before).join(after) : current.replace(before, () => after)
    }
    case 'insert_document_section': {
      const markdown = args.markdown
      const position = args.position
      if (typeof markdown !== 'string' || typeof position !== 'object' || position === null) return null
      const where = position as { kind?: unknown; sectionPath?: unknown }
      if (where.kind === 'endOfDocument') return `${current.replace(/\s+$/, '')}\n\n${markdown}\n`
      if (typeof where.sectionPath !== 'string') return null
      const range = sectionRange(current, where.sectionPath)
      if (range === null) return null
      const lines = current.split('\n')
      const at = where.kind === 'beforeSection' ? range.start : range.end
      return [...lines.slice(0, at), '', ...markdown.split('\n'), '', ...lines.slice(at)].join('\n')
    }
  }
}

/** The one-line question the guard asks, with what the diff comes to. */
export function describeWrite(tool: WriteTool, title: string, version: number, diff: Diff | null): string {
  const verb =
    tool === 'rewrite_document'
      ? 'Replace the whole body of'
      : tool === 'replace_document_text'
        ? 'Replace text in'
        : 'Insert a section in'
  const at = version > 0 ? ` (v${version})` : ''
  const size =
    diff === null
      ? 'no diff could be drawn (the current text could not be read, the change is too large to diff, or the text to replace was not found as written)'
      : `+${diff.added} −${diff.removed} lines in ${diff.hunks.length} place${diff.hunks.length === 1 ? '' : 's'}`
  return `${verb} "${title}"${at}? ${size}.`
}

/** One suggestion a hunk makes: the hunk's two sides, under the heading it lies in. */
export type SuggestionDraft = {
  originalText: string
  replacementText: string
  headingContext: string[]
}

/**
 * The suggestions a diff makes, one per hunk, each replacing the hunk's old
 * side (its context included, so the text is found once) with its new side.
 * The context before the heading over the hunk's first change goes, so the
 * old side starts inside the section the change lies in, and the headings
 * over its start (`headingContext`, by which the server places the text)
 * are the headings over the change. A hunk whose old side is blank (the
 * document was empty) makes none.
 */
export function suggestionsOf(diff: Diff, current: string): SuggestionDraft[] {
  const lines = current.split('\n')
  const drafts: SuggestionDraft[] = []
  for (const hunk of diff.hunks) {
    const trimmed = withinSection(hunk, lines)
    const sides = hunkSides(trimmed)
    if (sides.before.trim() === '') continue
    drafts.push({
      originalText: sides.before,
      replacementText: sides.after,
      headingContext: headingPathAt(current, Math.max(0, trimmed.oldStart - 1)),
    })
  }
  return drafts
}

/**
 * The hunk less the context lines before the heading over its first change,
 * and that heading line itself when it is context. A changed line is never
 * dropped; a hunk with no heading before its change is as it was.
 */
function withinSection(hunk: DiffHunk, lines: readonly string[]): DiffHunk {
  const first = firstChangedLine(hunk)
  let headingLine = -1
  for (let i = 0; i <= Math.min(first, lines.length - 1); i += 1) {
    if (/^#{1,6}\s+\S/.test(lines[i] ?? '')) headingLine = i
  }
  if (headingLine === -1) return hunk
  let dropped = 0
  let oldLine = hunk.oldStart - 1
  for (const row of hunk.lines) {
    if (row.kind !== ' ' || oldLine > headingLine) break
    dropped += 1
    oldLine += 1
  }
  if (dropped === 0) return hunk
  return {
    ...hunk,
    oldStart: hunk.oldStart + dropped,
    oldLines: hunk.oldLines - dropped,
    newStart: hunk.newStart + dropped,
    newLines: hunk.newLines - dropped,
    lines: hunk.lines.slice(dropped),
  }
}

/** The 0-based line in the old text where a hunk's first change lies. */
function firstChangedLine(hunk: DiffHunk): number {
  let line = hunk.oldStart - 1
  for (const row of hunk.lines) {
    if (row.kind !== ' ') return Math.max(0, line)
    line += 1
  }
  return Math.max(0, hunk.oldStart - 1)
}

