import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {parseFeed, matchesFilter, stripHtml, decodeEntities} from '../src/parse.mjs'

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

test('parses RSS items with CDATA, entities and guid', async () => {
  const items = parseFeed(await fixture('rss.xml'))
  assert.equal(items.length, 2, 'the item without a link is dropped')
  const [first, second] = items
  assert.equal(first.id, 'https://blog.mozilla.org/addons/?p=1001')
  assert.equal(first.title, 'Manifest V3 & the road ahead')
  assert.equal(first.link, 'https://blog.mozilla.org/addons/2026/10/01/mv3-road-ahead/')
  assert.equal(first.summary, 'Firefox 150 ships extension changes & more.')
  assert.equal(first.date.toISOString(), '2026-10-01T16:00:00.000Z')
  assert.equal(second.id, second.link, 'falls back to the link when there is no guid')
  assert.equal(second.title, 'Welcome to the new blog')
  assert.equal(second.summary, 'A fresh start for the add-ons community')
})

test('parses Atom entries and prefers the alternate link', async () => {
  const items = parseFeed(await fixture('atom.xml'))
  assert.equal(items.length, 2)
  const [first, second] = items
  assert.equal(first.id, 'tag:github.com,2008:Grit::Commit/abc123')
  assert.equal(first.link, 'https://github.com/w3c/webextensions/commit/abc123')
  assert.equal(first.title, 'Add meeting notes for 2026-10-15')
  assert.equal(first.summary, 'Add meeting notes for 2026-10-15')
  assert.equal(first.date.toISOString(), '2026-10-15T18:02:11.000Z')
  assert.equal(second.link, 'https://github.com/w3c/webextensions/commit/def456')
  assert.equal(second.title, 'Proposal: runtime.onEnabled event')
  assert.equal(second.summary, 'A new lifecycle event')
  assert.equal(second.date.toISOString(), '2026-10-14T09:00:00.000Z')
})

test('matchesFilter is case insensitive and null keywords mean everything', () => {
  const item = {title: 'What is new in Chrome 150', summary: 'Side Panel API gets a new method'}
  assert.equal(matchesFilter(item, {keywords: null}), true)
  assert.equal(matchesFilter(item, {}), true)
  assert.equal(matchesFilter(item, {keywords: []}), true)
  assert.equal(matchesFilter(item, {keywords: ['side panel']}), true)
  assert.equal(matchesFilter(item, {keywords: ['\\bextensions?\\b']}), false)
  assert.equal(matchesFilter({title: 'Extensions in 2027', summary: ''}, {keywords: ['\\bextensions?\\b']}), true)
})

test('matchesFilter can look at the title only and honors exclude', () => {
  const webgpu = {title: 'What is new in WebGPU', summary: 'A new extension for shaders'}
  assert.equal(matchesFilter(webgpu, {keywords: ['\\bextensions?\\b']}), true)
  assert.equal(matchesFilter(webgpu, {keywords: ['\\bextensions?\\b'], in: 'title'}), false)
  const merge = {title: 'Merge pull request #1 from w3c/meeting', summary: ''}
  assert.equal(matchesFilter(merge, {exclude: ['^Merge (pull request|branch)']}), false)
  assert.equal(matchesFilter({title: 'Publish minutes', summary: ''}, {exclude: ['^Merge (pull request|branch)']}), true)
})

test('stripHtml and decodeEntities handle nested encoding', () => {
  assert.equal(stripHtml('&lt;p&gt;Hello &amp;amp; bye&lt;/p&gt;'), 'Hello & bye')
  assert.equal(decodeEntities('&#x41;&#66; &quot;q&quot; &unknown;'), 'AB "q" &unknown;')
})
