// Reads every feed in feeds.json, posts the new items that match the feed's
// keywords to the Discord webhook, and records what it has seen in
// state/seen.json. A feed with no state yet is seeded silently so a fresh
// feed never floods the channel with its whole history.

import {readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {parseFeed, matchesFilter} from './parse.mjs'
import {buildPayload, postToDiscord} from './discord.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const FEEDS_PATH = join(ROOT, 'feeds.json')
export const STATE_PATH = join(ROOT, 'state', 'seen.json')
const SEEN_LIMIT = 500
const TOTAL_LIMIT = 12
const USER_AGENT = 'Extension.js feed bot (+https://github.com/extension-js/discord)'

export async function fetchText(url, {fetchImpl = fetch, timeoutMs = 20000} = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: {'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml'},
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function byDate(a, b) {
  return (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0)
}

// Pure core: takes feeds and state, returns the posts to make and the new state.
export async function plan({feeds, state, readFeed, log = () => {}}) {
  const nextState = structuredClone(state)
  const posts = []
  for (const feed of feeds) {
    let items
    try {
      items = parseFeed(await readFeed(feed))
    } catch (error) {
      log(`${feed.id}: skipped, ${error.message}`)
      continue
    }
    if (items.length === 0) {
      log(`${feed.id}: skipped, no items parsed`)
      continue
    }
    const entry = nextState[feed.id]
    if (!entry) {
      nextState[feed.id] = {seen: items.map((item) => item.id).slice(-SEEN_LIMIT)}
      log(`${feed.id}: seeded with ${items.length} items, nothing posted`)
      continue
    }
    const seen = new Set(entry.seen)
    const fresh = items.filter((item) => !seen.has(item.id))
    const matching = fresh.filter((item) => matchesFilter(item, feed)).sort(byDate)
    const chosen = matching.slice(-(feed.max ?? 5))
    for (const item of chosen) posts.push({feed, item})
    entry.seen = [...entry.seen, ...fresh.map((item) => item.id)].slice(-SEEN_LIMIT)
    log(`${feed.id}: ${items.length} items, ${fresh.length} new, ${matching.length} match, ${chosen.length} to post`)
  }
  return {posts: posts.slice(0, TOTAL_LIMIT), state: nextState}
}

export async function main({env = process.env, log = console.log} = {}) {
  const feeds = JSON.parse(await readFile(FEEDS_PATH, 'utf8'))
  const state = JSON.parse(await readFile(STATE_PATH, 'utf8'))
  const dryRun = String(env.DRY_RUN || '').toLowerCase() === 'true'
  const webhookUrl = env.DISCORD_FEED_WEBHOOK_URL
  if (!dryRun && !webhookUrl) throw new Error('DISCORD_FEED_WEBHOOK_URL is not set')

  const result = await plan({feeds, state, readFeed: (feed) => fetchText(feed.url), log})

  for (const {feed, item} of result.posts) {
    if (dryRun) {
      log(`would post [${feed.name}] ${item.title} ${item.link}`)
      continue
    }
    await postToDiscord(webhookUrl, buildPayload(feed, item))
    log(`posted [${feed.name}] ${item.title}`)
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  if (!dryRun) {
    await writeFile(STATE_PATH, JSON.stringify(result.state, null, 2) + '\n')
  }
  log(`${result.posts.length} post(s)${dryRun ? ' (dry run, state not written)' : ''}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
