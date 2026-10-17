// The few Discord REST calls the help bot needs, made with a bot token.
// Discord rate limits per route and answers 429 with a retry_after, so every
// call waits and tries again a couple of times before giving up.

const API = 'https://discord.com/api/v10'
// Links in an answer would each unfurl into a preview card, so every message
// is sent with embeds suppressed.
const SUPPRESS_EMBEDS = 1 << 2

export function createClient({token, fetchImpl = fetch, sleep = defaultSleep}) {
  if (!token) throw new Error('DISCORD_BOT_TOKEN is missing')

  async function request(path, {method = 'GET', body} = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetchImpl(API + path, {
        method,
        headers: {
          authorization: `Bot ${token}`,
          'content-type': 'application/json',
          'user-agent': 'DiscordBot (https://github.com/extension-js/discord, 1.0)'
        },
        body: body ? JSON.stringify(body) : undefined
      })
      if (response.status === 429) {
        let wait = 2000
        try {
          const data = await response.json()
          if (typeof data.retry_after === 'number') wait = Math.ceil(data.retry_after * 1000) + 250
        } catch {
          // keep the default wait
        }
        await sleep(wait)
        continue
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`Discord answered ${response.status} on ${method} ${path}: ${text.slice(0, 200)}`)
      }
      if (response.status === 204) return null
      return response.json()
    }
    throw new Error(`Discord kept rate limiting ${method} ${path}`)
  }

  return {
    me: () => request('/users/@me'),
    activeThreads: (guildId) => request(`/guilds/${guildId}/threads/active`).then((data) => data.threads ?? []),
    messages: (channelId, {limit = 100, after} = {}) => {
      const query = new URLSearchParams({limit: String(limit)})
      if (after) query.set('after', after)
      return request(`/channels/${channelId}/messages?${query}`)
    },
    send: (channelId, {content, replyTo}) =>
      request(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: {
          content,
          flags: SUPPRESS_EMBEDS,
          allowed_mentions: {parse: [], replied_user: true},
          ...(replyTo ? {message_reference: {message_id: replyTo, fail_if_not_exists: false}} : {})
        }
      })
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
