// A line diff for the write guard: what a proposed body changes against the
// current one, as unified hunks the pane draws and the suggestions are cut
// from. Myers' algorithm on lines; pure functions, no `$`.

export type DiffLine = { kind: ' ' | '-' | '+'; text: string }

export type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export type Diff = {
  hunks: DiffHunk[]
  added: number
  removed: number
}

/**
 * Lines (both sides together) beyond which no diff is attempted, and edit
 * steps beyond which the search stops: Myers keeps one frontier per step to
 * trace the path back, so the memory it holds grows with both. Past either
 * bound the guard asks without a diff rather than exhaust memory.
 */
export const DIFF_LINES_MAX = 4000
export const DIFF_STEPS_MAX = 800

/** The edit script between two line lists: equal, delete and insert steps; null past the step bound. */
function edits(a: readonly string[], b: readonly string[]): DiffLine[] | null {
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max
  // V arrays per D, kept to trace the path back.
  const trace: Int32Array[] = []
  let v = new Int32Array(2 * max + 2)
  v[offset + 1] = 0
  let done = false
  for (let d = 0; d <= max && !done; d += 1) {
    if (d > DIFF_STEPS_MAX) return null
    const snapshot = new Int32Array(v)
    trace.push(snapshot)
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        done = true
        break
      }
    }
  }
  // Walk the trace back from the end.
  const out: DiffLine[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const vd = trace[d] ?? v
    const k = x - y
    const down = k === -d || (k !== d && (vd[offset + k - 1] ?? 0) < (vd[offset + k + 1] ?? 0))
    const prevK = down ? k + 1 : k - 1
    const prevX = vd[offset + prevK] ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x -= 1
      y -= 1
      out.push({ kind: ' ', text: a[x] ?? '' })
    }
    if (d > 0) {
      if (down) {
        y -= 1
        out.push({ kind: '+', text: b[y] ?? '' })
      } else {
        x -= 1
        out.push({ kind: '-', text: a[x] ?? '' })
      }
    }
  }
  out.reverse()
  return out
}

/**
 * The unified diff of `before` against `after`, with `context` lines around
 * each change; null when the texts are past DIFF_LINES_MAX lines together
 * or differ by more than DIFF_STEPS_MAX edit steps.
 */
export function diffLines(before: string, after: string, context = 3): Diff | null {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length + b.length > DIFF_LINES_MAX) return null
  const script = edits(a, b)
  if (script === null) return null
  const hunks: DiffHunk[] = []
  let added = 0
  let removed = 0
  let oldLine = 1
  let newLine = 1
  let current: DiffHunk | null = null
  let trailing = 0
  const close = () => {
    if (current === null) return
    // Drop context past the last change beyond `context` lines.
    while (trailing > context) {
      current.lines.pop()
      current.oldLines -= 1
      current.newLines -= 1
      trailing -= 1
    }
    hunks.push(current)
    current = null
    trailing = 0
  }
  for (let i = 0; i < script.length; i += 1) {
    const step = script[i] ?? { kind: ' ' as const, text: '' }
    if (step.kind === ' ') {
      if (current !== null) {
        current.lines.push(step)
        current.oldLines += 1
        current.newLines += 1
        trailing += 1
        if (trailing > context * 2) close()
      }
      oldLine += 1
      newLine += 1
      continue
    }
    if (current === null) {
      // Open a hunk with the preceding context.
      const lead: DiffLine[] = []
      for (let j = i - 1; j >= 0 && lead.length < context; j -= 1) {
        const prior = script[j]
        if (prior === undefined || prior.kind !== ' ') break
        lead.unshift(prior)
      }
      current = {
        oldStart: oldLine - lead.length,
        oldLines: lead.length,
        newStart: newLine - lead.length,
        newLines: lead.length,
        lines: [...lead],
      }
    } else if (trailing > 0) {
      trailing = 0
    }
    current.lines.push(step)
    if (step.kind === '-') {
      current.oldLines += 1
      removed += 1
      oldLine += 1
    } else {
      current.newLines += 1
      added += 1
      newLine += 1
    }
    trailing = 0
  }
  close()
  return { hunks, added, removed }
}

/** The hunks as a unified diff, the form `Code` draws under `format: 'diff'`. */
export function toUnified(diff: Diff, oldName = 'current', newName = 'proposed'): string {
  if (diff.hunks.length === 0) return ''
  const out = [`--- ${oldName}`, `+++ ${newName}`]
  for (const hunk of diff.hunks) {
    out.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    for (const line of hunk.lines) out.push(`${line.kind}${line.text}`)
  }
  return out.join('\n')
}

/** One hunk's two sides: what it reads now and what it would read. */
export function hunkSides(hunk: DiffHunk): { before: string; after: string } {
  const before = hunk.lines.filter(line => line.kind !== '+').map(line => line.text)
  const after = hunk.lines.filter(line => line.kind !== '-').map(line => line.text)
  return { before: before.join('\n'), after: after.join('\n') }
}
