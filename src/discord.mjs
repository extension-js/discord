// Builds and sends one webhook message per feed item. Discord allows about
// 30 webhook posts a minute, so a short pause between posts keeps us clear.

export const AVATAR_URL = 'https://media.extension.land/track/extension-js.png'
export const USERNAME = 'Extension.js'
const COLOR = 0x3b82f6

function truncate(text, max) {
  if (!text || text.length <= max) return text || ''
  return text.slice(0, max - 1).trimEnd() + '…'
}

export function buildPayload(feed, item) {
  const embed = {
    title: truncate(item.title, 256),
    url: item.link,
    color: COLOR,
    author: {name: feed.name, url: feed.site}
  }
  const description = truncate(item.summary, 300)
  if (description) embed.description = description
  if (item.date) embed.timestamp = item.date.toISOString()
  return {username: USERNAME, avatar_url: AVATAR_URL, embeds: [embed]}
}

export async function postToDiscord(webhookUrl, payload, {fetchImpl = fetch, sleep = defaultSleep} = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload)
    })
    if (response.status === 429) {
      let wait = 2000
      try {
        const body = await response.json()
        if (typeof body.retry_after === 'number') wait = Math.ceil(body.retry_after * 1000) + 250
      } catch {
        // fall back to the default wait
      }
      await sleep(wait)
      continue
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Discord webhook answered ${response.status}: ${text.slice(0, 200)}`)
    }
    return
  }
  throw new Error('Discord webhook kept rate limiting the post')
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
