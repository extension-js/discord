import test from 'node:test'
import assert from 'node:assert/strict'
import {plan} from '../src/run.mjs'
import {buildPayload, postToDiscord, AVATAR_URL, USERNAME} from '../src/discord.mjs'

const rss = (items) => `<rss><channel>${items
  .map(
    (i) =>
      `<item><title>${i.title}</title><link>${i.link}</link><guid>${i.id || i.link}</guid><pubDate>${i.date}</pubDate><description>${i.summary || ''}</description></item>`
  )
  .join('')}</channel></rss>`

const feed = {id: 'a', name: 'A', site: 'https://a.test', url: 'https://a.test/feed', keywords: ['extension'], max: 2}

test('a feed without state is seeded and nothing is posted', async () => {
  const xml = rss([{title: 'extension one', link: 'https://a.test/1', date: 'Thu, 01 Oct 2026 10:00:00 GMT'}])
  const result = await plan({feeds: [feed], state: {}, readFeed: async () => xml})
  assert.deepEqual(result.posts, [])
  assert.deepEqual(result.state, {a: {seen: ['https://a.test/1']}})
})

test('new matching items are posted oldest first, capped by max, and every new id is recorded', async () => {
  const xml = rss([
    {title: 'extension four', link: 'https://a.test/4', date: 'Sun, 04 Oct 2026 10:00:00 GMT'},
    {title: 'extension three', link: 'https://a.test/3', date: 'Sat, 03 Oct 2026 10:00:00 GMT'},
    {title: 'extension two', link: 'https://a.test/2', date: 'Fri, 02 Oct 2026 10:00:00 GMT'},
    {title: 'unrelated post', link: 'https://a.test/u', date: 'Fri, 02 Oct 2026 11:00:00 GMT'},
    {title: 'extension one', link: 'https://a.test/1', date: 'Thu, 01 Oct 2026 10:00:00 GMT'}
  ])
  const state = {a: {seen: ['https://a.test/1']}}
  const result = await plan({feeds: [feed], state, readFeed: async () => xml})
  assert.deepEqual(
    result.posts.map((p) => p.item.link),
    ['https://a.test/3', 'https://a.test/4'],
    'the two newest matches, oldest first'
  )
  assert.deepEqual(
    result.state.a.seen,
    ['https://a.test/1', 'https://a.test/4', 'https://a.test/3', 'https://a.test/2', 'https://a.test/u'],
    'the unrelated and the overflow items are recorded too, so they are never posted later'
  )
  assert.deepEqual(state, {a: {seen: ['https://a.test/1']}}, 'the input state is not mutated')
})

test('a feed that fails to load is skipped and its state is kept', async () => {
  const state = {a: {seen: ['x']}}
  const logs = []
  const result = await plan({
    feeds: [feed],
    state,
    readFeed: async () => {
      throw new Error('HTTP 503')
    },
    log: (line) => logs.push(line)
  })
  assert.deepEqual(result.posts, [])
  assert.deepEqual(result.state, state)
  assert.match(logs[0], /skipped, HTTP 503/)
})

test('an empty or unparsable feed never wipes the state', async () => {
  const state = {a: {seen: ['x']}}
  const result = await plan({feeds: [feed], state, readFeed: async () => '<html>maintenance</html>'})
  assert.deepEqual(result.state, state)
})

test('buildPayload makes a single embed with the project avatar', () => {
  const payload = buildPayload(feed, {
    title: 'T',
    link: 'https://a.test/1',
    summary: 'x'.repeat(400),
    date: new Date('2026-10-01T10:00:00Z')
  })
  assert.equal(payload.username, USERNAME)
  assert.equal(payload.avatar_url, AVATAR_URL)
  assert.equal(payload.embeds.length, 1)
  const [embed] = payload.embeds
  assert.equal(embed.title, 'T')
  assert.equal(embed.url, 'https://a.test/1')
  assert.equal(embed.description.length, 300)
  assert.ok(embed.description.endsWith('…'))
  assert.equal(embed.timestamp, '2026-10-01T10:00:00.000Z')
  assert.deepEqual(embed.author, {name: 'A', url: 'https://a.test'})
})

test('postToDiscord retries after a 429 using retry_after', async () => {
  const calls = []
  const waits = []
  const responses = [
    {status: 429, ok: false, json: async () => ({retry_after: 0.5})},
    {status: 204, ok: true}
  ]
  await postToDiscord(
    'https://discord.test/hook',
    {a: 1},
    {
      fetchImpl: async (url, init) => {
        calls.push({url, init})
        return responses.shift()
      },
      sleep: async (ms) => waits.push(ms)
    }
  )
  assert.equal(calls.length, 2)
  assert.deepEqual(waits, [750])
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
})

test('postToDiscord throws on a non retryable error', async () => {
  await assert.rejects(
    postToDiscord('https://discord.test/hook', {}, {fetchImpl: async () => ({status: 404, ok: false, text: async () => 'Unknown Webhook'})}),
    /answered 404: Unknown Webhook/
  )
})
