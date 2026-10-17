// Answers new posts in the #help forum from the docs. Every run lists the
// active threads of the forum, answers the posts nobody has replied to yet,
// answers follow-ups that mention the bot, and records what it did in
// state/help.json so the next run picks up where this one stopped.

import {readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {createClient} from './discord-api.mjs'
import {askAssistant, formatAnswer, splitMessage} from './mintlify.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const STATE_PATH = join(ROOT, 'state', 'help.json')
export const GUILD_ID = '1253608412890271755'
export const HELP_CHANNEL_ID = '1560460463349833799'
const ANSWERS_PER_RUN = 5
const TURNS_PER_THREAD = 6
const THREADS_KEPT = 400
const PINNED_FLAG = 1 << 1

const FIRST_FOOTER =
  '-# Answered from the docs by the Extension.js bot. Mention @Extension.js here for a follow-up. A maintainer reads every post, and if this solved it, add the `solved` tag so the next person finds it.'
const FOLLOW_UP_FOOTER = '-# From the docs. Mention @Extension.js again to keep going.'

// Pure core: looks at the active forum threads and the state, reads the
// messages it needs through readMessages, and returns the answers to write.
export async function plan({threads, state, botId, readMessages, now = new Date(), log = () => {}}) {
  const nextState = {since: state.since ?? now.toISOString(), threads: {...(state.threads ?? {})}}
  const since = new Date(nextState.since)
  const jobs = []
  const posts = threads.filter((thread) => thread.parent_id === HELP_CHANNEL_ID)
  for (const thread of posts) {
    if (jobs.length >= ANSWERS_PER_RUN) break
    if ((thread.flags ?? 0) & PINNED_FLAG) continue
    const entry = nextState.threads[thread.id]
    if (entry && entry.lastMessageId === thread.last_message_id) continue
    if (!entry && createdAt(thread) < since) {
      nextState.threads[thread.id] = {skipped: 'older than the bot', lastMessageId: thread.last_message_id}
      continue
    }
    const messages = (await readMessages(thread.id)).slice().sort(bySnowflake)
    const starter = messages.find((message) => message.id === thread.id) ?? messages[0]
    if (!starter) continue
    const turns = conversation(messages, botId)
    if (!entry) {
      if (starter.author?.bot) {
        nextState.threads[thread.id] = {skipped: 'posted by a bot', lastMessageId: thread.last_message_id}
        continue
      }
      const answered = messages.some((message) => message.author?.id === botId)
      const repliedByHuman = messages.some((message) => message.id !== starter.id && !message.author?.bot)
      if (answered || repliedByHuman) {
        nextState.threads[thread.id] = {skipped: answered ? 'already answered' : 'a person answered first', lastMessageId: thread.last_message_id}
        continue
      }
      jobs.push({
        threadId: thread.id,
        kind: 'first',
        replyTo: starter.id,
        question: questionText(thread, starter),
        messages: [{role: 'user', text: questionText(thread, starter)}]
      })
      log(`${thread.id}: new post "${thread.name}", answering`)
      continue
    }
    const newer = messages.filter((message) => BigInt(message.id) > BigInt(entry.lastMessageId ?? '0'))
    const followUp = newer.filter((message) => !message.author?.bot && mentionsBot(message, botId)).pop()
    if (!followUp) {
      entry.lastMessageId = thread.last_message_id
      continue
    }
    if ((entry.turns ?? 1) >= TURNS_PER_THREAD) {
      log(`${thread.id}: follow-up skipped, ${TURNS_PER_THREAD} turns reached`)
      entry.lastMessageId = thread.last_message_id
      continue
    }
    jobs.push({
      threadId: thread.id,
      kind: 'follow-up',
      replyTo: followUp.id,
      question: followUp.content,
      messages: [{role: 'user', text: questionText(thread, starter)}, ...turns.filter((turn) => turn.id !== starter.id).map(({role, text}) => ({role, text}))]
    })
    log(`${thread.id}: follow-up in "${thread.name}", answering`)
  }
  return {jobs, state: prune(nextState)}
}

function createdAt(thread) {
  const stamp = thread.thread_metadata?.create_timestamp
  if (stamp) return new Date(stamp)
  return new Date(Number((BigInt(thread.id) >> 22n) + 1420070400000n))
}

function bySnowflake(a, b) {
  return BigInt(a.id) < BigInt(b.id) ? -1 : 1
}

function questionText(thread, starter) {
  const body = (starter.content ?? '').trim()
  return body ? `${thread.name}\n\n${body}` : thread.name
}

function mentionsBot(message, botId) {
  if ((message.mentions ?? []).some((user) => user.id === botId)) return true
  return message.referenced_message?.author?.id === botId
}

// The thread as a conversation: the bot's own messages are assistant turns,
// everything a person wrote is a user turn.
function conversation(messages, botId) {
  const turns = []
  for (const message of messages) {
    const text = (message.content ?? '').replace(/^-# .*$/gm, '').trim()
    if (!text) continue
    if (message.author?.id === botId) {
      const last = turns[turns.length - 1]
      if (last && last.role === 'assistant') last.text += '\n\n' + text
      else turns.push({id: message.id, role: 'assistant', text})
    } else if (!message.author?.bot) {
      turns.push({id: message.id, role: 'user', text})
    }
  }
  return turns
}

function prune(state) {
  const ids = Object.keys(state.threads).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
  for (const id of ids.slice(0, Math.max(0, ids.length - THREADS_KEPT))) delete state.threads[id]
  return state
}

// The footer rides on the last message, and the related list only names
// pages the answer did not link already.
export function buildReply(answer, kind) {
  const {body, related} = formatAnswer(answer.text)
  const parts = [body]
  const unseen = related.filter((page) => !body.includes(page.url))
  if (unseen.length > 0) parts.push('Related: ' + unseen.map((page) => `[${page.title}](<${page.url}>)`).join(' · '))
  const footer = kind === 'first' ? FIRST_FOOTER : FOLLOW_UP_FOOTER
  const chunks = splitMessage(parts.join('\n\n'))
  const last = chunks[chunks.length - 1]
  if (last.length + footer.length + 2 <= 2000) chunks[chunks.length - 1] = `${last}\n\n${footer}`
  else chunks.push(footer)
  return chunks
}

export async function main({env = process.env, log = console.log} = {}) {
  const dryRun = env.DRY_RUN === 'true'
  const state = JSON.parse(await readFile(STATE_PATH, 'utf8').catch(() => '{}'))
  const discord = createClient({token: env.DISCORD_BOT_TOKEN})
  const me = await discord.me()
  const threads = await discord.activeThreads(GUILD_ID)
  const {jobs, state: nextState} = await plan({
    threads,
    state,
    botId: me.id,
    readMessages: (threadId) => discord.messages(threadId),
    log
  })
  log(`${threads.filter((t) => t.parent_id === HELP_CHANNEL_ID).length} active help thread(s), ${jobs.length} answer(s) to write`)
  for (const job of jobs) {
    const answer = await askAssistant({apiKey: env.MINTLIFY_ASSISTANT_KEY, messages: job.messages, fp: `discord-${job.threadId}`})
    if (!answer.text) {
      log(`${job.threadId}: the assistant returned nothing, left for a person`)
      continue
    }
    const chunks = buildReply(answer, job.kind)
    log(`${job.threadId}: ${job.kind} answer, ${answer.text.length} chars in ${chunks.length} message(s), sources ${answer.sources.join(', ') || 'none'}`)
    if (dryRun) {
      log(chunks.join('\n---\n'))
      continue
    }
    let last = null
    for (const [index, content] of chunks.entries()) {
      last = await discord.send(job.threadId, {content, replyTo: index === 0 ? job.replyTo : undefined})
    }
    const entry = nextState.threads[job.threadId] ?? {}
    nextState.threads[job.threadId] = {
      ...entry,
      answeredAt: new Date().toISOString(),
      lastMessageId: last.id,
      turns: (entry.turns ?? 0) + 1
    }
  }
  if (dryRun) {
    log('dry run, state not written')
    return
  }
  await writeFile(STATE_PATH, JSON.stringify(nextState, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
