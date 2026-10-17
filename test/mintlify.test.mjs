import test from 'node:test'
import assert from 'node:assert/strict'
import {parseStream, formatAnswer, splitMessage, askAssistant} from '../src/mintlify.mjs'

const stream = [
  'data: {"type":"start","messageId":"abc"}',
  'data: {"type":"tool-output-available","toolCallId":"t1","output":{"type":"search","results":[{"path":"docs/a","content":"x"},{"path":"docs/b","content":"y"},{"path":"docs/a","content":"z"}]}}',
  'data: {"type":"text-start","id":"g"}',
  'data: {"type":"text-delta","id":"g","delta":"Hello "}',
  'data: {"type":"text-delta","id":"g","delta":"world"}',
  'data: {"type":"text-end","id":"g"}',
  'data: {"type":"finish","finishReason":"stop"}',
  'data: [DONE]',
  ''
].join('\n')

test('parseStream joins the text deltas, lists each searched page once and keeps the finish reason', () => {
  const result = parseStream(stream)
  assert.equal(result.text, 'Hello world')
  assert.deepEqual(result.sources, ['docs/a', 'docs/b'])
  assert.equal(result.finishReason, 'stop')
})

test('formatAnswer makes links absolute, lifts the suggestions block and flattens headings', () => {
  const text = '## Steps\n\nRead [the guide](/docs/guide) and [npm](https://npmjs.com).\n\n```suggestions\n(The guide)[/docs/guide]\n(Other)[/docs/other]\n```'
  const {body, related} = formatAnswer(text)
  assert.equal(body, '**Steps**\n\nRead [the guide](https://extension.js.org/docs/guide) and [npm](https://npmjs.com).')
  assert.deepEqual(related, [
    {title: 'The guide', url: 'https://extension.js.org/docs/guide'},
    {title: 'Other', url: 'https://extension.js.org/docs/other'}
  ])
})

test('splitMessage splits on paragraphs and closes an open code fence at the cut', () => {
  const code = '```js\n' + 'line\n'.repeat(60) + '```'
  const text = `intro\n\n${code}\n\noutro`
  const chunks = splitMessage(text, 200)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 210, `chunk of ${chunk.length} chars`)
    assert.equal((chunk.match(/```/g) ?? []).length % 2, 0, 'every chunk has balanced fences')
  }
  assert.equal(chunks.join('').includes('outro'), true)
})

test('askAssistant sends the conversation as text parts with a bearer key', async () => {
  let seen
  const fetchImpl = async (url, init) => {
    seen = {url, init}
    return {ok: true, status: 200, text: async () => stream}
  }
  const result = await askAssistant({apiKey: 'k', messages: [{role: 'user', text: 'hi'}, {role: 'assistant', text: 'yo'}], fetchImpl})
  assert.equal(seen.url, 'https://api.mintlify.com/discovery/v2/assistant/extensionjs/message')
  assert.equal(seen.init.headers.authorization, 'Bearer k')
  const body = JSON.parse(seen.init.body)
  assert.deepEqual(body.messages.map((m) => [m.id, m.role, m.parts[0].text]), [['m1', 'user', 'hi'], ['m2', 'assistant', 'yo']])
  assert.deepEqual(body.filter, {language: 'en'}, 'the search stays on the English pages')
  assert.equal(result.text, 'Hello world')
})

test('askAssistant throws on a non-200 answer', async () => {
  const fetchImpl = async () => ({ok: false, status: 401, text: async () => 'nope'})
  await assert.rejects(askAssistant({apiKey: 'k', messages: [{role: 'user', text: 'hi'}], fetchImpl}), /Mintlify answered 401/)
})
