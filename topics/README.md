# Topics and questions inbox

The main inbox is **GitHub issues**. Open an issue from the GitHub app, put the topic or
question in the title, and add the label for the show it belongs to:

| Label | Becomes | Show |
| --- | --- | --- |
| `question` | a short answer, 3 to 6 minutes | Curious Questions |
| `astronomy` | a full explainer, 10 to 15 minutes | Astronomy |
| `math` | a full explainer | Math |
| `neuroscience` | a full explainer | Neuroscience |
| `history` | a full explainer | History |
| `system-design` | a full explainer | System Design |
| `next` (extra) | jumps the queue for its show | |
| `watch` | a standing news subscription (stays open) | Watchlist |

- The issue body is optional: use it for the angle you want ("focus on cache lines").
- Every morning each show takes its oldest open issue (issues labelled `next` first),
  writes the episode, and closes the issue with a link. Up to 5 questions a day; one
  explainer per show per day.
- Only issues opened by the repo owner are used.
- Closed issues are your history of everything you asked about.

## Watchlist

Open an issue with the `watch` label to follow something specific, for example
"Marvel new comics app". The body can say what you care about ("launch date, pricing,
India availability"). Every morning the run searches Google News for each open watch
issue, skips links it has already reported, and writes one combined Watchlist episode
covering only the topics with something new. No news means no episode. The issue stays
open as your subscription; close it to stop following the topic.

## Bulk queue files

For pasting many topics at once, each explainer show also has a queue file here
(`astronomy-explained.md`, `math-explained.md`, `neuroscience-explained.md`, `history.md`,
`system-design.md`): one topic per line, top line first. Edit them on github.com in the
phone browser. Issues are used first, then these files, then the model picks a topic it
has not covered yet.

## Adding a new show

Add an entry to `EXPLAINER_CATEGORIES` in `scripts/categories.ts` with its `issueLabel`,
add the display entry in `src/lib/categories.ts`, add the show in `podcast/shows.json`,
run `python -m podcast.artwork`, and create the label on GitHub.
