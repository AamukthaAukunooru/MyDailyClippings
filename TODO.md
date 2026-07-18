# TODO

Ideas and planned features for My Daily Clippings.

## Next up

- [ ] **Link to Android Auto to listen while commuting to work** — generate an audio edition of each day's newsletter with text-to-speech, publish it as a podcast RSS feed. Any podcast app that supports private RSS feeds (Pocket Casts, AntennaPod, Podcast Addict) will then surface it in Android Auto automatically. No Android-specific code needed, the podcast feed is the integration point.
- [ ] **Read from the saved major company blogs** — partially done 2026-07-18: generation now pulls candidate stories from curated RSS feeds including OpenAI, Google DeepMind, Google Research, Hugging Face, and NASA (see `feeds` in `scripts/categories.ts`). Expand over time; note Anthropic and Meta AI publish no RSS feed, so those need a scraper or a third-party mirror.
- [ ] **"Ask my archive" (RAG)** — embed all newsletters at build time and add a question-answering page over the archive. Plan: precompute embeddings into a static index, run a small embedding model client-side (transformers.js) so semantic search works on GitHub Pages with no server and no API key in the browser.
- [ ] **Real personalization loop to learn my tastes** — add a way to star/save stories (a JSON file in the repo works as the database), then train a small ranker on embeddings of starred vs. skipped stories and use it to reorder or weight candidate articles during generation.

## Backlog

- [ ] Weekly + monthly digest pipeline ("The Week in Physics") generated from the dailies
- [ ] Full-text search with Pagefind (built for static sites, works on GitHub Pages)
- [ ] Generation validation + failure alerts — open a GitHub issue automatically when a category fails; 22 daily issues were silently missing as of 2026-07-18
- [ ] Second-pass "editor" LLM call that fact-checks and tightens the draft against its sources
- [ ] RSS/Atom feed output for the site itself, plus optional email delivery
- [ ] Story threading ("Previously in Clippings") and entity pages built on the embedding index
- [ ] Trends page: topic/entity frequency across the archive over time
- [ ] PWA manifest so the site installs on a phone home screen
