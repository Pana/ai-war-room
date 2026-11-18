# AI War Room (AI 作战室)

A daily briefing on what's happening in AI and in the Ethereum protocol and ecosystem. It collects from about 30 sources, uses an LLM to filter for relevance, merge duplicate stories and write Chinese titles and summaries, and serves the result as a web page — locally, and published to GitHub Pages every day: https://pana.wang/ai-war-room/

## Getting started

Requires Node.js 24 or later.

```bash
npm install
cp .env.example .env   # fill in the LLM endpoint, API key and model
npm run collect        # collect and build today's report
npm run web            # http://localhost:8787
```

The first run with an LLM processes everything and takes about 15 minutes; later runs only process new items and take about 2 minutes.

It also runs without an LLM: you get the original English titles and summaries, and relevance falls back to keyword matching. Items left unprocessed are picked up on the next run once the LLM is configured.

The LLM can be any OpenAI-compatible (`/chat/completions`) or Anthropic-format (`/messages`) endpoint; set `LLM_API_FORMAT` accordingly.

The collector honours the `HTTPS_PROXY` / `HTTP_PROXY` environment variables.

## What it collects

| Section | Sources |
|---|---|
| Top 10 | Techmeme, Hacker News, TechCrunch, The Verge and the official blogs, with stories about the same event merged and ranked by the LLM |
| Official blogs | OpenAI, Anthropic (news and engineering), Google DeepMind, Google AI |
| AI products | Product Hunt, Show HN, trending Hugging Face Spaces and models |
| GitHub | Trending daily / weekly (AI-related only), and AI projects created in the last 30 days |
| Podcasts | AI shows from the Apple and Spotify technology charts plus a curated list; episodes ranked by YouTube views |
| Ethereum | All Core Devs calls ACDE / ACDC / ACDT (Forkcast call notes and Ethereum Magicians agendas), top posts on Ethereum Magicians and ethresear.ch, EIP changes, client releases, ecosystem news (EF Blog, Ethereal news, The Defiant, Decrypt) |

News items carry a cover image, taken from the feed or from the article's `og:image`. Only the image URL is stored; the browser loads the image from the original site.

Source lists (official blogs, GitHub topics, curated podcasts and their YouTube channels, Ethereum clients and news feeds) live in `src/sources.ts`.

## Web views

Both views read the same report and link to each other; the light / dark setting is shared.

- `/` — three-pane reader: sections on the left, items in the middle, the article on the right. Keys: `J` / `K` next / previous item, `[` / `]` previous / next section, `O` open the original.
- `daily.html` — newspaper layout: the whole day on one page.

## Daily publishing (GitHub Actions + Pages)

`.github/workflows/daily.yml` runs every day at 00:00 UTC (08:00 Beijing time): restore the previous database → collect → export a static site (`npm run export`, writes `site/`) → save the database → deploy to GitHub Pages.

- **Secrets**: `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` under Settings → Secrets and variables → Actions. Optionally set `LLM_API_FORMAT` as a variable (defaults to `openai`).
- **Pages**: Settings → Pages → Source must be "GitHub Actions".
- **Database**: kept on the `data` branch, overwritten on each run so only the latest copy is stored. It holds the reports, LLM results, image URL cache and GitHub star snapshots.
- **Site**: rebuilt on each run with the last 60 days of reports (`EXPORT_DAYS` to change).
- **Run manually**: Actions → "每日采集" → Run workflow.

To run on your own Mac instead, `scripts/install-schedule.sh` installs a launchd job that runs `scripts/daily.sh` every day (`scripts/install-schedule.sh uninstall` removes it).

## Project layout

- `src/collectors/` — one collector per source, all returning `RawItem`
- `src/pipeline/` — LLM processing: relevance and Chinese summaries (`enrich.ts`), top stories (`topnews.ts`), cover images (`images.ts`)
- `src/collect.ts` — entry point; builds the day's report and stores it in SQLite (`data/ai.db`)
- `src/export.ts` — exports the static site
- `src/server.ts` + `public/` — local web server and pages (`index.html` reader, `daily.html` newspaper)
