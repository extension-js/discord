# discord-feed

Posts browser extension news to the `#feed` channel of the [Extension.js Discord](https://discord.gg/BRqbPDfPxb).

Every hour a GitHub Actions job reads the feeds in `feeds.json`, keeps the items that match each feed's keywords, and posts the new ones through a Discord webhook. What it has already seen lives in `state/seen.json`, which the job commits back after each run.

## Sources

| Feed | Filter |
| --- | --- |
| Chrome for Developers blog | titles about extensions, Manifest V3, the Chrome Web Store or the side panel |
| Mozilla Add-ons Community Blog | everything |
| Microsoft Edge blog | posts about extensions or add-ons |
| WebKit blog | posts about extensions |
| W3C WebExtensions Community Group | every commit except merges, so proposals and meeting notes |
| Chrome Releases | stable channel desktop updates |

## Changing the feeds

Edit `feeds.json`. Each entry has:

- `id`: a stable key for the state file
- `name` and `site`: shown as the author line of the post
- `url`: the RSS or Atom feed
- `keywords`: regular expressions, any of which must match, case insensitive, or `null` for no filter
- `exclude`: regular expressions, none of which may match, optional
- `in`: where the patterns look, `title` or `title+summary` (the default)
- `max`: the most items posted from that feed in one run

A new feed is seeded on its first run, so its existing items are recorded and nothing is posted. Only items published after that reach the channel.

## Running it locally

```sh
npm test
DRY_RUN=true node src/run.mjs
```

The dry run prints what would be posted and leaves the state file alone. A real run needs `DISCORD_FEED_WEBHOOK_URL`.

## License

MIT
