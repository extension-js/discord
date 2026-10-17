// Asks the docs assistant one question from the command line and prints the
// answer the help bot would post, with the pages it searched. Handy for
// checking an answer without touching Discord.

import {askAssistant} from './mintlify.mjs'
import {buildReply} from './help.mjs'

const question = process.argv.slice(2).join(' ').trim()
if (!question) {
  console.error('usage: node src/ask.mjs <question>')
  process.exit(1)
}

const answer = await askAssistant({apiKey: process.env.MINTLIFY_ASSISTANT_KEY, messages: [{role: 'user', text: question}], fp: 'ask-cli'})
console.log(`sources: ${answer.sources.join(', ') || 'none'}`)
console.log(`finish: ${answer.finishReason}`)
console.log('')
console.log(buildReply(answer, 'first').join('\n---\n'))
