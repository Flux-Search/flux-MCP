# Examples

Three short articles to try the tools on. They are invented for this repo: the companies, councils and people in them do not exist. Each one is written to show what Lineage does, so it has people referred to as "she" or "the company", and dates such as "last April" or "next spring" that depend on when the piece was published.

| File | Published | What to ask |
|---|---|---|
| `01-company-update.txt` | 2026-04-14 | Why is Northwind raising prices? |
| `02-council-meeting.txt` | 2026-03-11 | Who opposed the bridge, and why? |
| `03-research-note.txt` | 2026-02-19 | What caused the seagrass to recover? |

Pass the published date with `published`, so Lineage can turn "last April" into a real month.

These prompts work in Claude and Codex once the `flux` server is connected. Setup is in the main [README](../README.md).

## Prompts to try

Answer a question. Only the passages that answer it come back.

> Use lineage on examples/01-company-update.txt, published 2026-04-14, with the question "why is Northwind raising prices?"

Ask several questions at once. Each question is a separate pass and is billed as one.

> Use lineage on examples/02-council-meeting.txt, published 2026-03-11, with the questions "who opposed the bridge?" and "how is it paid for?"

Read everything. With no question, every passage comes back, so the result is longer than the document.

> Use lineage on examples/03-research-note.txt, published 2026-02-19, with no question, and list every person and date it mentions.

Read a page from a link. Flux fetches the page itself.

> Use lineage on https://en.wikipedia.org/wiki/Seagrass and tell me why seagrass stores carbon.

Search the web. Pages Flux reads come back with the passages that answer the query.

> Search for the latest UK inflation figure and tell me where it comes from.

Get links only. `enrich: 0` skips reading the pages and is the fastest search.

> Search for "rust mcp server examples" without reading the pages. Just give me the links.

Fetch a whole page.

> Fetch https://en.wikipedia.org/wiki/Retrieval-augmented_generation and summarise the history section.

Check the balance before a large job.

> What is my Flux balance?

## What to look for

- Mentions resolved to a full name, shown with an arrow under the passage: `she -> Priya Raman`, `the company -> Northwind Robotics`.
- Dates written in where the text was vague: "last April" becomes `Apr 2025` when the article was published in March 2026.
- How much was cut when you asked a question. A dense article where every sentence is relevant loses very little, and that is correct.
