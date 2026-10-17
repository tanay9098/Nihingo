# Resources

Everything under this directory is discovered by `npm run ingest`.

| Folder | Contents | Provenance |
| --- | --- | --- |
| `original/` | Vocabulary, kanji, kana, grammar and exercises written for this project | Original, MIT |
| `external/` | Verified metadata catalogs for third-party content (Lazy Benkyou videos) | Links/metadata only |
| `local/` | **Drop your own files here** (CSV/TSV, JSON/JSONL, Markdown/text, PDF, images, audio) | Unknown until you add a rule to `sources.json` |

Supported formats and what happens to them are described in `docs/RESOURCE_INVENTORY.md`.
PDF study lists in `local/` (word lists, kanji lists, dictionary entries, kanji writing sheets, kana pages labelled with a
code point) are parsed into concepts; other PDFs/images are linked to the kanji they mention (by page, or by file name such
as `日.png`). A local file never overwrites a word/kanji another resource already defined; it only fills empty fields.
The app never invents stroke data.
