// What the mod knows about Strata's MCP surface: which server a tool call
// went through, the text a tool answered, the document link, and the shape
// of a `find` info answer. Pure functions: no `$`, no state.

import type { StrataExplorerResult, StrataThread } from '../types'

/** The server segment of an MCP tool name, `mcp__<server>__<tool>`. */
export function serverOf(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const cut = tool.lastIndexOf('__')
  if (cut <= 5) return null
  return tool.slice(5, cut)
}

/** The tool segment of an MCP tool name. */
export function toolOf(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const cut = tool.lastIndexOf('__')
  if (cut <= 5) return null
  return tool.slice(cut + 2)
}

/**
 * The document's link in the web app: the workspace chooser's deep link,
 * since MCP results carry a document id but no workspace slug.
 */
export function docUrl(documentId: string): string {
  return `https://app.strata.space/workspaces?next=%2Fdocuments%2F${encodeURIComponent(documentId)}`
}

/**
 * The deployment a Strata URL points at: its host and port, the host less
 * the `api.` or `app.` in front (`beta.strata.space:443` for the API and
 * the web app of beta alike), so the CLI's API and a document's link in the
 * web app name one deployment the same way. An address with a port keeps
 * it (two local stacks differ by port alone), and a bracketed IPv6 host is
 * kept whole. Null for anything that is not such a URL: no watch is started
 * on what cannot be told apart.
 */
export function deploymentOf(url: string): string | null {
  const match = /^(https?):\/\/([^/?#]*)/i.exec(url.trim())
  if (match === null) return null
  const scheme = (match[1] ?? '').toLowerCase()
  let authority = match[2] ?? ''
  const userEnd = authority.lastIndexOf('@')
  if (userEnd !== -1) authority = authority.slice(userEnd + 1)
  let host: string
  let port: string
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    if (close === -1) return null
    host = authority.slice(0, close + 1).toLowerCase()
    const rest = authority.slice(close + 1)
    if (rest !== '' && !rest.startsWith(':')) return null
    port = rest.slice(1)
  } else {
    const colon = authority.lastIndexOf(':')
    host = (colon === -1 ? authority : authority.slice(0, colon)).toLowerCase()
    port = colon === -1 ? '' : authority.slice(colon + 1)
  }
  if (host === '' || (port !== '' && !/^\d{1,5}$/.test(port))) return null
  const named = host.startsWith('[') ? host : host.replace(/^(api|app)\./, '')
  return `${named}:${port === '' ? (scheme === 'https' ? '443' : '80') : port}`
}

/** One content block an MCP tool answers with. */
type ContentBlock = { type?: unknown; text?: unknown }

/** The text blocks of an MCP tool's answer, joined. */
export function textOf(result: { content: readonly ContentBlock[]; structuredContent?: unknown }): string {
  const texts = result.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
  if (texts.length > 0) return texts.join('\n')
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent)
  return ''
}

/** What a `find` with `intent: 'info'` on a document answers, as the mod reads it. */
export type DocumentInfo = {
  id: string
  title: string
  version: number
  url: string | null
  openComments: number
  pendingSuggestions: number
  viewing: number
}

/**
 * Parse an info answer: the summary at the top level, or under a key the
 * server may wrap it in. Null when the text is no such answer.
 */
export function infoOf(text: string): DocumentInfo | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const candidates: unknown[] = [value]
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    for (const key of ['document', 'info', 'result']) candidates.push(record[key])
    if (Array.isArray(record.results)) candidates.push(record.results[0])
    if (Array.isArray(record.documents)) candidates.push(record.documents[0])
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const row = candidate as Record<string, unknown>
    if (typeof row.documentId !== 'string' || typeof row.documentVersion !== 'number') continue
    const presence = row.presence
    const viewing =
      typeof presence === 'object' && presence !== null && typeof (presence as Record<string, unknown>).count === 'number'
        ? ((presence as Record<string, unknown>).count as number)
        : 0
    return {
      id: row.documentId,
      title: typeof row.title === 'string' ? row.title : '',
      version: row.documentVersion,
      url: typeof row.url === 'string' ? row.url : null,
      openComments: typeof row.openCommentCount === 'number' ? row.openCommentCount : 0,
      pendingSuggestions: typeof row.pendingSuggestionCount === 'number' ? row.pendingSuggestionCount : 0,
      viewing,
    }
  }
  return null
}

/** The root comments a `list_comments` answer carries, as the pane draws them; replies are left out. */
export function threadsOf(text: string): StrataThread[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof value !== 'object' || value === null) return []
  const rows = (value as Record<string, unknown>).comments
  if (!Array.isArray(rows)) return []
  const threads: StrataThread[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const item = row as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.body !== 'string') continue
    if (typeof item.parentCommentId === 'string' && item.parentCommentId !== '') continue
    const anchor = typeof item.anchor === 'object' && item.anchor !== null ? (item.anchor as Record<string, unknown>) : {}
    threads.push({
      id: item.id,
      author:
        typeof item.authorDisplayName === 'string' && item.authorDisplayName !== ''
          ? item.authorDisplayName
          : typeof item.authorEmail === 'string'
            ? item.authorEmail
            : 'someone',
      body: item.body,
      quotedText: typeof anchor.quotedText === 'string' ? anchor.quotedText : '',
      status: item.status === 'resolved' ? 'resolved' : 'active',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    })
  }
  return threads
}

/** An id a tool's JSON answer carries, under any of `keys`, at its top or one level down. */
export function idIn(text: string, keys: readonly string[]): string | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const candidates: unknown[] = [value]
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (typeof nested === 'object' && nested !== null) candidates.push(nested)
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const row = candidate as Record<string, unknown>
    for (const key of keys) {
      if (typeof row[key] === 'string' && row[key] !== '') return row[key] as string
    }
  }
  return null
}

/** The documents a `find` search answered, as the explorer lists them. */
export function searchResults(text: string): StrataExplorerResult[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  const rows = Array.isArray(record.documents)
    ? record.documents
    : Array.isArray(record.results)
      ? record.results
      : Array.isArray(record.items)
        ? record.items
        : []
  const seen = new Set<string>()
  const out: StrataExplorerResult[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const item = row as Record<string, unknown>
    const id =
      typeof item.documentId === 'string'
        ? item.documentId
        : typeof item.docId === 'string'
          ? item.docId
          : typeof item.id === 'string'
            ? item.id
            : null
    if (id === null || seen.has(id)) continue
    seen.add(id)
    const title = typeof item.title === 'string' ? item.title : typeof item.docTitle === 'string' ? item.docTitle : id
    const spaces = Array.isArray(item.spaceNames) ? item.spaceNames.filter((one): one is string => typeof one === 'string') : []
    const snippet = typeof item.snippet === 'string' ? item.snippet : ''
    const detail = spaces.length > 0 ? spaces.join(', ') : clip(snippet.replace(/\s+/g, ' ').trim(), 48)
    out.push({ id, title, detail })
  }
  return out
}

/** A title cut to `width` cells for a band or a tab. */
export function clip(text: string, width: number): string {
  if (text.length <= width) return text
  return `${text.slice(0, Math.max(1, width - 1))}…`
}

/** A `@strata:doc_…` mention a person typed: which document, and where it stands in the text. */
export type MentionSpan = { id: string; start: number; end: number }

/** What may stand right before a mention of its own: nothing, space, or an opening mark. */
const BEFORE_MENTION = /[\s([{<"'*“‘]/
/** What may not follow one: more of a word in any script, a path, or an address. Tested on the text after the mention, so a character of two code units counts whole. */
const AFTER_MENTION = /^[\p{L}\p{N}\p{M}_/\\@~-]/u
/** A dot or a colon with more of a word after it: a file name, a domain, a path. No mention either. */
const AFTER_MENTION_JOINED = /^[.:][\p{L}\p{N}_]/u

/** The columns a line's leading blanks take, a tab reaching the next stop of four, as Markdown counts an indented code line. */
function indentOf(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/**
 * The mentions in a prompt that stand on their own, in order: outside fenced
 * code, outside indented code, outside inline code, outside quoted lines
 * (`> `), and not part of a longer word, path or address. A document's text
 * the pane quoted, a pasted log, a URL, a file name or a literal in
 * backticks spells no mention, so nothing is read for it and the text is
 * left as typed.
 */
export function mentionSpans(text: string): MentionSpan[] {
  // Block level, as Markdown reads it: which stretches of the text are
  // paragraphs of the person's own prose. A fence (a run of three or more
  // backticks or tildes, closed only by a run of the same mark at least as
  // long on a line of its own; a backtick fence's info string holds no
  // backtick) holds code to its close, or to the end; an indented line after
  // a paragraph's end is code; a quoted line is not prose of the person's;
  // a blank line ends a paragraph.
  const paragraphs: { start: number; end: number }[] = []
  let open: { start: number; end: number } | null = null
  let fence: { mark: string; length: number } | null = null
  const endParagraph = (): void => {
    if (open !== null) paragraphs.push(open)
    open = null
  }
  let at = 0
  for (const line of text.split('\n')) {
    const lineStart = at
    at += line.length + 1
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
      const run = close?.[1] ?? ''
      if (run !== '' && run[0] === fence.mark && run.length >= fence.length) fence = null
      continue
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    const mark = opening?.[1]?.[0]
    if (opening !== null && mark !== undefined && !(mark === '`' && (opening[2] ?? '').includes('`'))) {
      endParagraph()
      fence = { mark, length: opening[1]?.length ?? 3 }
      continue
    }
    if (/^\s*>/.test(line) || line.trim() === '') {
      endParagraph()
      continue
    }
    if (open === null && indentOf(line) >= 4) continue
    if (open === null) open = { start: lineStart, end: lineStart + line.length }
    else open.end = lineStart + line.length
  }
  endParagraph()
  // Inline level, per paragraph: a code span (a run of backticks closed by
  // a run of the same length, across line breaks within the paragraph; a
  // run never closed is literal text) is skipped, and a mention elsewhere
  // counts when it stands on its own.
  const spans: MentionSpan[] = []
  const scan = (from: number, to: number): void => {
    for (const match of text.slice(from, to).matchAll(/@strata:(doc_[A-Za-z0-9]+)/g)) {
      const index = from + (match.index ?? 0)
      const end = index + match[0].length
      const before = index === 0 ? '' : (text[index - 1] ?? '')
      if (before !== '' && !BEFORE_MENTION.test(before)) continue
      // Enough of what follows to hold a mark and a whole character after it.
      const after = text.slice(end, end + 3)
      if (AFTER_MENTION.test(after) || AFTER_MENTION_JOINED.test(after)) continue
      spans.push({ id: match[1] ?? '', start: index, end })
    }
  }
  for (const paragraph of paragraphs) {
    const runs = [...text.slice(paragraph.start, paragraph.end).matchAll(/`+/g)].map(run => ({
      at: paragraph.start + (run.index ?? 0),
      length: run[0].length,
    }))
    let cursor = paragraph.start
    let i = 0
    while (i < runs.length) {
      const opener = runs[i]
      if (opener === undefined) break
      let j = i + 1
      while (j < runs.length && runs[j]?.length !== opener.length) j += 1
      const closer = runs[j]
      if (closer === undefined) {
        i += 1
        continue
      }
      scan(cursor, opener.at)
      cursor = closer.at + closer.length
      i = j + 1
    }
    scan(cursor, paragraph.end)
  }
  return spans.filter(span => span.id !== '')
}
