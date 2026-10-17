// Asks the Mintlify assistant behind extension.js.org a question and turns
// its streamed answer into a Discord message. The assistant answers from the
// docs and links the pages it used, so every reply carries its sources.

export const DEFAULT_DOMAIN = 'extensionjs'
export const SITE = 'https://extension.js.org'
const ENDPOINT = (domain) => `https://api.mintlify.com/discovery/v2/assistant/${domain}/message`

export async function askAssistant({
  apiKey,
  messages,
  domain = DEFAULT_DOMAIN,
  fp = 'discord-help',
  fetchImpl = fetch,
  timeoutMs = 120000
}) {
  if (!apiKey) throw new Error('MINTLIFY_ASSISTANT_KEY is missing')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(ENDPOINT(domain), {
      method: 'POST',
      headers: {authorization: `Bearer ${apiKey}`, 'content-type': 'application/json'},
      body: JSON.stringify({
        fp,
        messages: messages.map((message, index) => ({
          id: `m${index + 1}`,
          role: message.role,
          parts: [{type: 'text', text: message.text}]
        }))
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Mintlify answered ${response.status}: ${text.slice(0, 200)}`)
    }
    return parseStream(await response.text())
  } finally {
    clearTimeout(timer)
  }
}

// The stream is the AI SDK event format: one `data: {...}` JSON object per
// line. The answer arrives as text-delta events and the docs it searched as
// the output of the search tool.
export function parseStream(raw) {
  let text = ''
  const sources = []
  let finishReason = null
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let event
    try {
      event = JSON.parse(payload)
    } catch {
      continue
    }
    if (event.type === 'text-delta') text += event.delta ?? ''
    if (event.type === 'tool-output-available' && event.output?.type === 'search') {
      for (const result of event.output.results ?? []) {
        if (result.path && !sources.includes(result.path)) sources.push(result.path)
      }
    }
    if (event.type === 'finish') finishReason = event.finishReason ?? null
  }
  return {text: text.trim(), sources, finishReason}
}

// Turns the assistant's markdown into Discord markdown: absolute links, the
// trailing suggestions block lifted into a related list, no stray headings.
export function formatAnswer(text, {site = SITE} = {}) {
  const related = []
  let body = text.replace(/```suggestions\s*([\s\S]*?)```/g, (_, block) => {
    for (const line of block.split('\n')) {
      const match = line.match(/^\(([^)]+)\)\[([^\]]+)\]\s*$/)
      if (match) related.push({title: match[1].trim(), url: absolute(match[2].trim(), site)})
    }
    return ''
  })
  body = body.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `[${label}](${absolute(href, site)})`)
  body = body.replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
  body = body.replace(/\n{3,}/g, '\n\n').trim()
  return {body, related}
}

function absolute(href, site) {
  if (/^https?:\/\//.test(href)) return href
  if (href.startsWith('/')) return site + href
  return href
}

// Discord caps a message at 2000 characters. Split on paragraphs and keep
// code fences balanced across the pieces.
export function splitMessage(text, limit = 1900) {
  if (text.length <= limit) return [text]
  const chunks = []
  let current = ''
  for (const paragraph of text.split('\n\n')) {
    const pieces = paragraph.length > limit ? hardSplit(paragraph, limit) : [paragraph]
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece
      if (candidate.length > limit && current) {
        chunks.push(current)
        current = piece
      } else {
        current = candidate
      }
    }
  }
  if (current) chunks.push(current)
  const balanced = []
  let open = false
  for (let chunk of chunks) {
    if (open) chunk = '```\n' + chunk
    const fences = (chunk.match(/```/g) ?? []).length
    open = fences % 2 === 1
    if (open) chunk += '\n```'
    balanced.push(chunk)
  }
  return balanced
}

function hardSplit(text, limit) {
  const pieces = []
  for (let i = 0; i < text.length; i += limit) pieces.push(text.slice(i, i + limit))
  return pieces
}
