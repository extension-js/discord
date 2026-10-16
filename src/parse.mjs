// Minimal RSS 2.0 and Atom reader. Dependency free on purpose: the feeds we
// read are well formed and we only need title, link, id, date and a summary.

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '}

export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
}

function unwrapCdata(text) {
  const match = text.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return match ? match[1] : text
}

function tagText(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = block.match(re)
  if (!match) return ''
  return decodeEntities(unwrapCdata(match[1])).trim()
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, 'i'))
  return match ? decodeEntities(match[1]) : ''
}

// Feeds often ship HTML inside an escaped text node, so decode before
// stripping the tags and once more after for entities the HTML carried.
export function stripHtml(html) {
  const decoded = decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(decoded).replace(/\s+/g, ' ').trim()
}

function atomLink(block) {
  const tags = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
  const alternate = tags.find((t) => /\srel=["']alternate["']/i.test(t))
  const plain = tags.find((t) => !/\srel=/i.test(t))
  const chosen = alternate || plain || tags[0]
  return chosen ? attr(chosen, 'href') : ''
}

function parseDate(text) {
  if (!text) return undefined
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml)
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || []
  const items = []
  for (const block of blocks) {
    const link = isAtom ? atomLink(block) : tagText(block, 'link')
    const id = tagText(block, 'guid') || tagText(block, 'id') || link
    const title = stripHtml(tagText(block, 'title'))
    const summary = stripHtml(
      tagText(block, 'description') ||
        tagText(block, 'summary') ||
        tagText(block, 'content:encoded') ||
        tagText(block, 'content')
    )
    const date = parseDate(
      tagText(block, 'pubDate') ||
        tagText(block, 'published') ||
        tagText(block, 'updated') ||
        tagText(block, 'dc:date')
    )
    if (!link || !title) continue
    items.push({id: id || link, title, link, summary, date})
  }
  return items
}

// A feed's filter: `keywords` (any must match, null means everything),
// `exclude` (none may match) and `in` ("title" or "title+summary").
export function matchesFilter(item, {keywords = null, exclude = null, in: scope = 'title+summary'} = {}) {
  const haystack = scope === 'title' ? item.title : `${item.title}\n${item.summary}`
  if (exclude && exclude.some((pattern) => new RegExp(pattern, 'i').test(haystack))) return false
  if (!keywords || keywords.length === 0) return true
  return keywords.some((pattern) => new RegExp(pattern, 'i').test(haystack))
}
