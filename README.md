# discord

The bots behind the [Extension.js Discord](https://discord.gg/BRqbPDfPxb). Both run as GitHub Actions on a schedule, with no server and no dependencies beyond Node 22.

| Bot | What it does | Where |
| --- | --- | --- |
| Feed | Posts browser extension news from RSS and Atom feeds | `#feed`, every hour |
| Help | Answers new posts in the help forum from the docs | `#help`, every five minutes |

## Help

A new post in `#help` gets a first answer within minutes, written by the [Mintlify assistant](https://www.mintlify.com/docs/api/assistant/create-assistant-message-v2) behind [extension.js.org](https://extension.js.org). The answer comes from the docs and links the pages it used, so the person has something to try right away and a maintainer can follow up with the thread already in context.

Each run of `src/help.mjs`:

1. lists the active threads of the forum through the Discord API
2. answers the posts nobody has replied to yet, as a reply to the post
3. answers follow-ups that mention the bot, with the whole thread as the conversation
4. records the threads it touched in `state/help.json`, which the job commits back

What it leaves alone: pinned posts, posts made by bots, posts a person already answered, posts older than the bot, and threads that reached six turns. At most five answers go out per run.

The bot needs the `Message Content` intent and these permissions on the forum: View Channels, Send Messages, Send Messages in Threads, Read Message History.

## Feed

Every hour `src/run.mjs` reads the feeds in `feeds.json`, keeps the items that match each feed's keywords, and posts the new ones through a Discord webhook. What it has already seen lives in `state/seen.json`.

| Feed | Filter |
| --- | --- |
| Chrome for Developers blog | titles about extensions, Manifest V3, the Chrome Web Store or the side panel |
| Mozilla Add-ons Community Blog | everything |
| Microsoft Edge blog | posts about extensions or add-ons |
| WebKit blog | posts about extensions |
| W3C WebExtensions Community Group | every commit except merges, so proposals and meeting notes |
| Chrome Releases | stable channel desktop updates |

To change the feeds, edit `feeds.json`. Each entry has:

- `id`: a stable key for the state file
- `name` and `site`: shown as the author line of the post
- `url`: the RSS or Atom feed
- `keywords`: regular expressions, any of which must match, case insensitive, or `null` for no filter
- `exclude`: regular expressions, none of which may match, optional
- `in`: where the patterns look, `title` or `title+summary` (the default)
- `max`: the most items posted from that feed in one run

A new feed is seeded on its first run, so its existing items are recorded and nothing is posted.

## Running locally

```sh
npm test
npm run feed:dry
npm run help:dry
```

A dry run logs what would be posted and leaves the state files alone. The feed needs `DISCORD_FEED_WEBHOOK_URL`. The help bot needs `DISCORD_BOT_TOKEN` and `MINTLIFY_ASSISTANT_KEY`, and a dry run still reads the forum and asks the assistant.

## License

MIT
