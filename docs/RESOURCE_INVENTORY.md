# Resource inventory

## What was found in the repository

When this project started the repository was **empty** (no commits, no files). There were therefore **no pre-existing
local learning materials** — no PDFs, CSVs, stroke-order sheets, images or audio — to inspect or ingest. Nothing here
pretends otherwise:

| Question | Answer |
| --- | --- |
| Local stroke-order PDFs / images? | **None existed.** The app shows stroke *counts* (from `kanji.csv`) only and never claims stroke-order animation or coordinates. The ingestion pipeline can link stroke-order PDFs/images dropped into `resources/local/` (see below). |
| Local vocabulary / grammar CSVs? | None existed. `resources/original/` contains content **written for this project**, labelled *original* everywhere in the UI. |
| Local audio? | None. No audio is bundled or downloaded. |

## Content created for the app (`resources/original/`, MIT, authored for this project)

| File | Contents | Used for |
| --- | --- | --- |
| `vocabulary.csv` | 56 beginner words (reading, romaji, meaning, topic, example sentence + translation) | flashcards, quizzes, library, topic links |
| `kanji.csv` | 26 common kanji (meaning, on/kun readings, stroke **count**) | kanji exercises, library |
| `kana.json` | 46 hiragana + 46 katakana with romaji | kana exercises |
| `grammar.json` | 16 beginner grammar concepts with prerequisites (`REQUIRES`) and confusable pairs (`CONTRASTS_WITH`) | grammar practice, graph reasoning |
| `exercises.jsonl` | 26 authored grammar-selection / sentence-completion exercises | quizzes (labelled *original*) |

Vocabulary, kana and kanji exercises are **generated mechanically from those rows** (answers come straight from the data,
distractors are picked by a stable hash) and are labelled *generated from source data*. No level (e.g. JLPT) is claimed for
the original vocabulary: `level = unknown`. `kanji.csv` carries a note that "N5-level" is the author's classification.

## External: Lazy Benkyou

| Item | Detail |
| --- | --- |
| Website | <https://lazybenkyou.com/> and start page <https://lazybenkyou.com/start> |
| Official YouTube channel | <https://www.youtube.com/@LazyBenkyou> (linked from both pages; channel id `UCzMTW1vcB1IoPC5GzD0wqoQ` read from the channel page's RSS link) |
| Story Reader (linked only) | <https://read.lazybenkyou.com> |
| Catalog | `resources/external/lazybenkyou_videos.json` — 15 videos; ids, titles and dates from the channel's **public YouTube RSS feed**; each `embeddable` flag from YouTube's **oEmbed** endpoint (HTTP 200). Rebuild with `npm run catalog`. |
| Levels | A level is recorded **only when the video title states it** (all 15 current titles say "JLPT N5", so they are labelled `N5`, evidence "Stated in the video title"). Otherwise `unknown`. The catalog builder and a unit test enforce this. |
| Transcripts | **None.** The websites' pages show no transcripts and nothing is generated or attributed to Lazy Benkyou. |
| License / terms | The site footer reads "© 2026 Lazy Benkyou Studios LLC"; no reuse terms were found. We therefore store only titles, ids, dates and thumbnail URLs, embed through YouTube's official player (privacy-enhanced `youtube-nocookie.com`), link to the original, and never download or re-host audio/video. |
| Scraping | No scraping of the website. One request each to the channel page (to read the channel id), the RSS feed and oEmbed per video. |

## Supported formats and behaviour

| Format | Handling |
| --- | --- |
| CSV / TSV | Delimiter auto-detected (RFC-4180 quoting); **actual headers and values are inspected** (aliases such as `word/vocab/japanese`, `reading/kana`, `meaning/english`) and classified as vocabulary / kanji / kana / exercise / grammar. A `kanji` column of multi-character words is treated as vocabulary. Unrecognised layouts → `unparsed`, linked as a file only. Rows missing a word are skipped; missing reading/meaning are flagged. |
| JSON / JSONL | Arrays of objects classified the same way; the Lazy Benkyou catalog shape is recognised; invalid lines are reported and skipped. |
| Markdown / text | Stored as a linked reference (title extracted); not split into concepts automatically. |
| PDF | `pdfinfo`/`pdftotext` (poppler) when installed: page count and text are extracted; kanji already in the library are linked to the **pages** they appear on (`REFERENCES {page}`), only for pages with ≤ 12 distinct known kanji so dense prose pages don't create noise. Whole PDFs are never put in graph properties. Image-only PDFs are linked as visual references. Without poppler the PDF is linked as a file. |
| Images | PNG/JPEG signature checked; a kanji in the file name (e.g. `日.png`) links the image to that kanji. |
| Audio / video | Linked only; not transcribed or redistributed. |
| Anything else | `unparsed` with a reason; never fatal. |

Every file gets a SHA-256 checksum; unchanged files are skipped on re-ingestion (`--force` re-parses; all writes are `MERGE`, so
counts never grow). Files removed from disk are marked `missing`. Provenance/licensing comes from `resources/sources.json`
(unlisted files default to *license unknown — kept local, never redistributed*).

Verified with real runs: the PDF path was exercised with a generated PDF containing Japanese text
(`tests/fixtures/kanji-sample.pdf`) and a corrupt PDF; there is **no real stroke-order PDF** in the repository to test against.

## Discovered files (generated by `npm run ingest`)

<!-- BEGIN GENERATED -->
_Generated by `npm run ingest` on 2026-10-17T08:00:09.676Z. 6 file(s) discovered under `resources/`._

| File | Format | Size | Status | Detected as | Records | Source / license |
| --- | --- | ---: | --- | --- | --- | --- |
| `original/kanji.csv` | csv | 2055 | indexed | kanji | 26 kanji, 52 exercises | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `original/vocabulary.csv` | csv | 6739 | indexed | vocabulary | 56 vocabulary, 330 exercises | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `external/lazybenkyou_videos.json` | json | 11148 | indexed | listening-catalog | 15 lessons | Lazy Benkyou — Content © Lazy Benkyou Studios LLC. Only titles, ids, dates and thumbnail URLs are stored; videos stay on YouTube. |
| `original/grammar.json` | json | 7447 | indexed | grammar | 16 grammar | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `original/kana.json` | json | 7264 | indexed | kana | 92 kana, 184 exercises | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `original/exercises.jsonl` | jsonl | 8046 | indexed | exercise | 26 exercises | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |

### Files that could not be parsed

_None in the current run._
<!-- END GENERATED -->
