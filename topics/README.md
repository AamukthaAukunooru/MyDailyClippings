# Explainer topic queues

Each file here is the queue for one daily explainer series:

| File | Series |
| --- | --- |
| `astronomy-explained.md` | Astronomy Explained |
| `math-explained.md` | Math Explained |
| `neuroscience-explained.md` | Neuroscience Explained |
| `history.md` | History Explained |
| `system-design.md` | System Design Explained |

- One topic per line (a leading `- ` is fine). Lines starting with `#` are ignored.
- Every morning the run takes the first topic, writes the episode, and deletes that line.
- If a queue is empty, the model picks a fresh topic that the series has not covered yet
  (covered topics are read from the `topic:` field of past episodes).
- Edit these files from the GitHub mobile app whenever you think of something.

## Curious questions

For one-off questions ("why is the sky blue?"), open a GitHub issue on this repo and add the
`question` label. The next morning's run answers it as a short episode in the Curious Questions
show and closes the issue with a link. Only issues opened by the repo owner are answered.
