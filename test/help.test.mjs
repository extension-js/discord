import test from 'node:test'
import assert from 'node:assert/strict'
import {plan, buildReply, HELP_CHANNEL_ID} from '../src/help.mjs'

const BOT = '999'
const now = new Date('2026-10-17T12:00:00Z')
const since = '2026-10-17T00:00:00Z'

// A snowflake made after the since date: (ms since the Discord epoch) << 22.
const snowflake = (iso, n = 0) => String((BigInt(new Date(iso).getTime() - 1420070400000) << 22n) + BigInt(n))

const thread = (id, extra = {}) => ({
  id,
  parent_id: HELP_CHANNEL_ID,
  name: 'content script does not reload',
  last_message_id: id,
  thread_metadata: {create_timestamp: '2026-10-17T10:00:00Z'},
  ...extra
})
const message = (id, authorId, content, extra = {}) => ({id, author: {id: authorId, bot: authorId === BOT}, content, mentions: [], ...extra})

test('a fresh post with no replies gets a first answer that quotes the title and body', async () => {
  const id = snowflake('2026-10-17T10:00:00Z')
  const result = await plan({
    threads: [thread(id)],
    state: {since},
    botId: BOT,
    now,
    readMessages: async () => [message(id, '1', 'I run extension dev and nothing reloads.')]
  })
  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0].kind, 'first')
  assert.equal(result.jobs[0].replyTo, id)
  assert.equal(result.jobs[0].messages[0].text, 'content script does not reload\n\nI run extension dev and nothing reloads.')
})

test('posts from before the bot started, pinned posts, bot posts and posts a person already answered are skipped and recorded', async () => {
  const old = snowflake('2026-10-10T10:00:00Z')
  const pinned = snowflake('2026-10-17T10:00:00Z', 1)
  const byBot = snowflake('2026-10-17T10:00:00Z', 2)
  const answered = snowflake('2026-10-17T10:00:00Z', 3)
  const other = snowflake('2026-10-17T10:00:00Z', 4)
  const threads = [
    thread(old, {thread_metadata: {create_timestamp: '2026-10-10T10:00:00Z'}}),
    thread(pinned, {flags: 2}),
    thread(byBot),
    thread(answered, {last_message_id: '9000'}),
    thread(other, {parent_id: 'another-channel'})
  ]
  const messagesByThread = {
    [byBot]: [message(byBot, BOT, 'bot post')],
    [answered]: [message(answered, '1', 'question'), message('9000', '2', 'a person answered')]
  }
  const result = await plan({threads, state: {since}, botId: BOT, now, readMessages: async (id) => messagesByThread[id] ?? []})
  assert.deepEqual(result.jobs, [])
  assert.equal(result.state.threads[old].skipped, 'older than the bot')
  assert.equal(result.state.threads[pinned], undefined, 'pinned posts are left alone without a record')
  assert.equal(result.state.threads[byBot].skipped, 'posted by a bot')
  assert.equal(result.state.threads[answered].skipped, 'a person answered first')
  assert.equal(result.state.threads[other], undefined)
})

test('a thread the bot answered is read again only when it has new messages, and a mention makes a follow-up with the whole conversation', async () => {
  const id = snowflake('2026-10-17T10:00:00Z')
  const state = {since, threads: {[id]: {answeredAt: '2026-10-17T10:05:00Z', lastMessageId: 'bot1', turns: 1}}}
  let reads = 0
  const quiet = await plan({threads: [thread(id, {last_message_id: 'bot1'})], state, botId: BOT, now, readMessages: async () => (reads++, [])})
  assert.equal(reads, 0)
  assert.deepEqual(quiet.jobs, [])

  const messages = [
    message(id, '1', 'question body'),
    message('bot1', BOT, 'first answer\n\n-# Answered from the docs by the Extension.js bot.'),
    message('2000', '1', 'thanks but what about Firefox?', {mentions: [{id: BOT}]})
  ]
  // Message ids are compared as snowflakes, so give the bot message a lower numeric id than the mention.
  messages[1].id = '1000'
  state.threads[id].lastMessageId = '1000'
  const result = await plan({threads: [thread(id, {last_message_id: '2000'})], state, botId: BOT, now, readMessages: async () => messages})
  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0].kind, 'follow-up')
  assert.equal(result.jobs[0].replyTo, '2000')
  assert.deepEqual(
    result.jobs[0].messages.map((m) => m.role),
    ['user', 'assistant', 'user']
  )
  assert.equal(result.jobs[0].messages[1].text, 'first answer', 'the footer line is stripped from the history')
})

test('a new message that does not mention the bot only moves the cursor', async () => {
  const id = snowflake('2026-10-17T10:00:00Z')
  const state = {since, threads: {[id]: {answeredAt: '2026-10-17T10:05:00Z', lastMessageId: '1000', turns: 1}}}
  const messages = [message(id, '1', 'question'), message('1000', BOT, 'answer'), message('2000', '3', 'I had the same problem')]
  const result = await plan({threads: [thread(id, {last_message_id: '2000'})], state, botId: BOT, now, readMessages: async () => messages})
  assert.deepEqual(result.jobs, [])
  assert.equal(result.state.threads[id].lastMessageId, '2000')
})

test('the reply carries the related pages and the footer, and stays under the Discord limit', () => {
  const text = 'Use `firefox:` as a prefix.\n\nSee [Browser-specific fields](/docs/features/browser-specific-fields).\n\n```suggestions\n(Browser-specific manifest fields)[/docs/features/browser-specific-fields]\n```'
  const chunks = buildReply({text, sources: []}, 'first')
  assert.equal(chunks.length, 1)
  assert.match(chunks[0], /\[Browser-specific fields\]\(https:\/\/extension\.js\.org\/docs\/features\/browser-specific-fields\)/)
  assert.match(chunks[0], /Related: \[Browser-specific manifest fields\]\(<https:\/\/extension\.js\.org\/docs\/features\/browser-specific-fields>\)/)
  assert.match(chunks[0], /-# Answered from the docs/)
  assert.doesNotMatch(chunks[0], /```suggestions/)
})
