// Topic queues kept in the Obsidian vault (the private obsidian-library repo).
//
// The workflow checks the vault out into VAULT_DIR (default ./vault) when the
// OBSIDIAN_TOKEN secret is set. Without it everything here is a no-op and the
// run falls back to GitHub issues and topics/*.md.
//
// Vault layout:
//   Podcast/<Show>.md   one queue note per show:
//                         ## Up next   "- [ ] Topic" lines, top first ("Topic :: angle" adds an angle)
//                         ## Done      "- [x] Topic · [episode](url) · date", added by the run
//   Podcast/Watchlist.md  ## Following  "- Topic :: what I care about" (delete a line to stop)
//   Inbox/*.md          items shared from the phone. Those whose category starts with
//                       "Podcast/" are moved into the matching queue note here; every
//                       other category is processed by the PC (see _tools/inbox in the vault).
//
// The workflow commits and pushes whatever this module changes in the vault.

import fs from 'fs'
import path from 'path'

export const VAULT_DIR = path.resolve(process.env.VAULT_DIR || 'vault')
const PODCAST = 'Podcast'
const INBOX = 'Inbox'
export const QUESTIONS_NOTE = 'Curious Questions'
export const WATCHLIST_NOTE = 'Watchlist'

export function vaultEnabled(): boolean {
  return fs.existsSync(path.join(VAULT_DIR, PODCAST))
}

function notePath(note: string): string {
  return path.join(VAULT_DIR, PODCAST, `${note}.md`)
}

function readLines(note: string): string[] | null {
  const p = notePath(note)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').split('\n') : null
}

function writeLines(note: string, lines: string[]) {
  const text = lines.join('\n')
  fs.writeFileSync(notePath(note), text.endsWith('\n') ? text : `${text}\n`, 'utf-8')
}

// Index of the "## <name>" heading line, or -1.
function sectionStart(lines: string[], name: string): number {
  return lines.findIndex((l) => new RegExp(`^##\\s+${name}\\s*$`, 'i').test(l.trim()))
}

// Line range [start, end) of a section's body.
function sectionRange(lines: string[], name: string): [number, number] | null {
  const head = sectionStart(lines, name)
  if (head < 0) return null
  let end = lines.findIndex((l, i) => i > head && /^#{1,2}\s/.test(l))
  if (end < 0) end = lines.length
  return [head + 1, end]
}

const OPEN_ITEM = /^\s*[-*]\s+\[ \]\s+(.+?)\s*$/
const BULLET = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/

// "Topic :: angle" or "Topic — angle"
function splitDetails(text: string): { title: string; details?: string } {
  const m = text.match(/^(.*?)\s+(?:::|—)\s+(.+)$/)
  const clean = (s: string) => s.replace(/\*\*/g, '').trim()
  return m ? { title: clean(m[1]), details: clean(m[2]) } : { title: clean(text) }
}

export interface VaultTopic {
  title: string
  details?: string
  vaultNote: string
  vaultLine: string
  dialogue: boolean // line starts with "Interview:"
}

// Open items under "## Up next" (or anywhere before "## Done" if the heading is missing), top first.
export function openTopics(note: string): VaultTopic[] {
  const lines = readLines(note)
  if (!lines) return []
  const range = sectionRange(lines, 'Up next') ?? [0, sectionStart(lines, 'Done') >= 0 ? sectionStart(lines, 'Done') : lines.length]
  const out: VaultTopic[] = []
  for (let i = range[0]; i < range[1]; i++) {
    const m = lines[i].match(OPEN_ITEM)
    if (!m) continue
    let text = m[1]
    const dialogue = /^interview\s*:\s*/i.test(text)
    text = text.replace(/^interview\s*:\s*/i, '')
    const { title, details } = splitDetails(text)
    if (title) out.push({ title, details, vaultNote: note, vaultLine: lines[i], dialogue })
  }
  return out
}

// Move a finished topic from "Up next" to the top of "Done", with a link to its episode.
export function markDone(note: string, line: string, title: string, url: string, date: string) {
  const lines = readLines(note)
  if (!lines) return
  const idx = lines.indexOf(line)
  if (idx >= 0) lines.splice(idx, 1)
  let done = sectionStart(lines, 'Done')
  if (done < 0) {
    if (lines[lines.length - 1]?.trim() !== '') lines.push('')
    lines.push('## Done', '')
    done = lines.length - 2
  }
  // keep one blank line after the heading, newest first
  let at = done + 1
  if (lines[at]?.trim() === '') at++
  lines.splice(at, 0, `- [x] ${title} · [episode](${url}) · ${date}`)
  writeLines(note, lines)
}

export interface Watch {
  key: string // stable id for the seen-links map
  title: string
  focus: string
}

export function watches(): Watch[] {
  const lines = readLines(WATCHLIST_NOTE)
  if (!lines) return []
  const range = sectionRange(lines, 'Following')
  if (!range) return []
  const out: Watch[] = []
  for (let i = range[0]; i < range[1]; i++) {
    const m = lines[i].match(BULLET)
    if (!m) continue
    const { title, details } = splitDetails(m[1])
    if (title) out.push({ key: `vault:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title, focus: details ?? '' })
  }
  return out
}

// Insert lines at the top of a section (creating the section if missing).
function insertAtTop(note: string, section: string, newLines: string[]) {
  let lines = readLines(note)
  if (!lines) {
    lines = ['---', 'tags: ["podcast"]', '---', '', `# ${note}`, '', `## ${section}`, '']
  }
  let head = sectionStart(lines, section)
  if (head < 0) {
    const done = sectionStart(lines, 'Done')
    const at = done >= 0 ? done : lines.length
    lines.splice(at, 0, `## ${section}`, '', '')
    head = at
  }
  let at = head + 1
  if (lines[at]?.trim() === '') at++
  lines.splice(at, 0, ...newLines)
  writeLines(note, lines)
}

// Parse an inbox file: one "key: <JSON string>" per frontmatter line (written by the phone shortcut).
export function parseInbox(raw: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/)
  const block = m ? m[1] : raw
  for (const line of block.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    try {
      value = value.startsWith('"') ? String(JSON.parse(value)) : value
    } catch {
      /* keep raw */
    }
    fields[kv[1]] = value
  }
  return fields
}

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/

// Move Inbox items meant for the podcast into their queue notes. Returns how many were moved.
export function ingestInbox(knownNotes: string[]): number {
  const dir = path.join(VAULT_DIR, INBOX)
  if (!fs.existsSync(dir)) return 0
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort() // file names start with a timestamp, so this is oldest first
  const byNote = new Map<string, string[]>()
  const moved: string[] = []
  for (const f of files) {
    const fields = parseInbox(fs.readFileSync(path.join(dir, f), 'utf-8'))
    const category = (fields.category ?? '').trim()
    if (!/^podcast\//i.test(category)) continue
    const wanted = category.replace(/^podcast\//i, '').trim()
    const note = knownNotes.find((n) => n.toLowerCase() === wanted.toLowerCase()) ?? wanted
    const shared = (fields.shared ?? '').replace(/\s+/g, ' ').trim()
    const typed = (fields.note ?? '').replace(/\s+/g, ' ').trim()
    // The typed text is the topic; a shared link or text becomes the angle.
    const title = typed || (URL_ONLY.test(shared) ? '' : shared)
    if (!title) {
      console.log(`[vault] ${f}: no topic text (only a link), left in the Inbox`)
      continue
    }
    const angle = typed && shared ? shared : ''
    const line = note === WATCHLIST_NOTE ? `- ${title}${angle ? ` :: ${angle}` : ''}` : `- [ ] ${title}${angle ? ` :: ${angle}` : ''}`
    byNote.set(note, [...(byNote.get(note) ?? []), line])
    moved.push(f)
  }
  for (const [note, lines] of byNote) {
    insertAtTop(note, note === WATCHLIST_NOTE ? 'Following' : 'Up next', lines)
    console.log(`[vault] ${lines.length} inbox item(s) → Podcast/${note}.md`)
  }
  for (const f of moved) fs.unlinkSync(path.join(dir, f))
  return moved.length
}
