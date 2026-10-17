# Resource inventory

## What was found in the repository

When this project started the repository was **empty**, so the app shipped with its own original content only
(`resources/original/`, below). The learner has since added their own study material under `resources/local/`:

| File (`resources/local/…`) | What it is | How it is ingested | Source / license (from `sources.json`) |
| --- | --- | --- | --- |
| `hanabira_jlpt_n5_grammar.csv` | 136 JLPT N5 grammar points (meaning, formation, example + romaji + translation) | Grammar concepts; *Grammar meaning*, *Spot the grammar* and flashcard exercises are generated from each row | hanabira.org; license not stated inside the CSV |
| `hanabira_jlpt_n5_vocabulary.pdf` | 662 N5 words: reading, gloss, definition, example sentence | Dictionary-entry layout parsed into vocabulary, with example sentences and the one-line definition (shown in the Library) | hanabira.org, CC BY 4.0 |
| `jlpt-n5-vocabulary-list.pdf` | 743 N5 words: reading, meaning | Word-list layout parsed into vocabulary; 29 meanings truncated in the PDF keep only their complete parts; 13 repeated words skipped | Nihongo Master; free download, no license stated |
| `jlpt-n5-kanji-list.pdf` | 103 N5 kanji: meaning, on/kun, stroke count | Kanji-list layout parsed into kanji | Nihongo Master; free download, no license stated |
| `hanabira_jlpt_n5_kanji_writing.pdf` | 79 kanji writing sheets with step-by-step stroke order | Parsed into kanji, and each kanji is linked to **its stroke-order page** (`REFERENCES {page}`) | hanabira.org, CC BY-SA 4.0 |
| `kana-stroke-order/…workbook….pdf` | NIHONGO ICHIBAN hiragana + katakana workbook | Each practice page is labelled with the character's Unicode code point ("Search code: 3042" = あ); all 92 kana are linked to their stroke-order page | © Chinriu Honten Ltd., all rights reserved: personal use only, not redistributable |

The app still parses no stroke *coordinates* and animates nothing: stroke-order pages are references the learner opens.

**Overlapping lists.** The first resource to define a concept owns it (`primarySource`). A later file that lists the same
word or kanji only fills properties that are still empty (e.g. an example sentence, a definition or a missing on'yomi) and never
overwrites the original content or generates a second set of exercises for it. A JLPT level is never copied onto another
file's concept, so the original vocabulary keeps `level = unknown`. Levels are normalised (`JLPT N5` → `N5`). Concepts from non-original files are ordered after the
curated ones, so the planner introduces the original material first.

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
| CSV / TSV | Delimiter auto-detected (RFC-4180 quoting); **actual headers and values are inspected** (aliases such as `word/vocab/japanese`, `reading/kana`, `meaning/english`, `grammar point/formation/example (japanese)`; spreadsheet headers like `Example (English)` are normalised to `example_english`) and classified as vocabulary / kanji / kana / exercise / grammar. A `kanji` column of multi-character words is treated as vocabulary. Unrecognised layouts → `unparsed`, linked as a file only. Rows missing a word are skipped; missing reading/meaning are flagged. |
| JSON / JSONL | Arrays of objects classified the same way; the Lazy Benkyou catalog shape is recognised; invalid lines are reported and skipped. |
| Markdown / text | Stored as a linked reference (title extracted); not split into concepts automatically. |
| PDF (study lists) | With poppler, the text is first checked for known study-list layouts (`server/ingestion/pdf-layouts.js`): `# / Word / Reading / Meaning` tables, `# / Kanji / Meaning / On'yomi / Kun'yomi / Strokes` tables, `word 【reading】 — gloss` dictionary entries with examples, kanji writing sheets (`音`/`訓` blocks, linked to their page), and kana pages labelled with a Unicode code point. Matching rows become concepts exactly like CSV rows. |
| PDF (other) | `pdfinfo`/`pdftotext` (poppler) when installed: page count and text are extracted; kanji already in the library are linked to the **pages** they appear on (`REFERENCES {page}`), only for pages with ≤ 12 distinct known kanji so dense prose pages don't create noise. Whole PDFs are never put in graph properties. Image-only PDFs are linked as visual references. Without poppler the PDF is linked as a file. |
| Images | PNG/JPEG signature checked; a kanji in the file name (e.g. `日.png`) links the image to that kanji. |
| Audio / video | Linked only; not transcribed or redistributed. |
| Anything else | `unparsed` with a reason; never fatal. |

Every file gets a SHA-256 checksum; unchanged files are skipped on re-ingestion (`--force` re-parses; all writes are `MERGE`, so
counts never grow). Files removed from disk are marked `missing`. Provenance/licensing comes from `resources/sources.json`
(unlisted files default to *license unknown — kept local, never redistributed*).

Verified with real runs: the PDF path was exercised with a generated PDF containing Japanese text
(`tests/fixtures/kanji-sample.pdf`) and a corrupt PDF, and every study-list layout against the real PDFs in `resources/local/`
(unit tests in `tests/unit.test.js` cover each layout with synthetic text).

## Discovered files (generated by `npm run ingest`)

<!-- BEGIN GENERATED -->
_Generated by `npm run ingest` on 2026-10-17T11:41:59.966Z. 12 file(s) discovered under `resources/`._

| File | Format | Size | Status | Detected as | Records | Source / license |
| --- | --- | ---: | --- | --- | --- | --- |
| `local/hanabira_jlpt_n5_grammar.csv` | csv | 39419 | indexed | grammar | 136 grammar, 408 exercises | hanabira.org — JLPT N5 grammar (CSV export) — Not stated inside the CSV. hanabira.org publishes its companion N5 PDFs under CC BY 4.0; verify before redistributing. |
| `original/kanji.csv` | csv | 2055 | indexed | kanji | 26 kanji, 52 exercises | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `original/vocabulary.csv` | csv | 6739 | indexed | vocabulary | 56 vocabulary, 330 exercises | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `external/lazybenkyou_videos.json` | json | 11148 | indexed | listening-catalog | 15 lessons | Lazy Benkyou — Content © Lazy Benkyou Studios LLC. Only titles, ids, dates and thumbnail URLs are stored; videos stay on YouTube. |
| `original/grammar.json` | json | 7447 | indexed | grammar | 16 grammar | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `original/kana.json` | json | 7264 | indexed | kana | 92 kana, 184 exercises | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `original/exercises.jsonl` | jsonl | 8046 | indexed | exercise | 26 exercises | Nihongo Graph — original content — MIT (same as this repository). Written for this project; not copied from any textbook or website. |
| `local/hanabira_jlpt_n5_kanji_writing.pdf` | pdf | 1228511 | indexed | kanji | 79 kanji, 112 exercises, 79 references | hanabira.org — JLPT N5 Kanji Writing Practice (PDF) — CC BY-SA 4.0, as printed in the file. Attribution: hanabira.org. |
| `local/hanabira_jlpt_n5_vocabulary.pdf` | pdf | 1505237 | indexed | vocabulary | 662 vocabulary, 3344 exercises | hanabira.org — JLPT N5 Vocabulary List (PDF) — CC BY 4.0, as printed in the file (definitions and example sentences © hanabira.org; JLPT lists based on Jonathan Waller's JLPT Resources, CC BY). Attribution: hanabira.org. |
| `local/jlpt-n5-kanji-list.pdf` | pdf | 323111 | indexed | kanji | 103 kanji, 42 exercises | Nihongo Master — JLPT N5 lists (PDF) — Free to download from nihongomaster.com; no license is stated in the file. Kept local; not redistributed by this app. |
| `local/jlpt-n5-vocabulary-list.pdf` | pdf | 476420 | partial | vocabulary | 730 vocabulary, 1078 exercises | Nihongo Master — JLPT N5 lists (PDF) — Free to download from nihongomaster.com; no license is stated in the file. Kept local; not redistributed by this app. |
| `local/kana-stroke-order/toaz_info_hiragana_and_katakana_workbook_pr_8bef5ec94774c4e7175ff453da45e03a.pdf` | pdf | 4776634 | indexed | kana-reference | 92 references | NIHONGO ICHIBAN — Print-Yourself Hiragana + Katakana Workbook (PDF) — © 2011 Chinriu Honten Limited, all rights reserved. For personal printing/study only; must not be redistributed. |

### Parser notes and flagged records

- `local/hanabira_jlpt_n5_kanji_writing.pdf` (indexed):
  - 23 kanji entries were already defined by another resource: only empty fields were filled.
  - Recognised layout: kanji writing sheets (stroke-order pages); 79 entries parsed from 18 page(s).
- `local/hanabira_jlpt_n5_vocabulary.pdf` (indexed):
  - 51 vocabulary entries were already defined by another resource: only empty fields were filled.
  - Recognised layout: dictionary entries (word 【reading】 — gloss + example); 662 entries parsed from 58 page(s).
- `local/jlpt-n5-kanji-list.pdf` (indexed):
  - 82 kanji entries were already defined by another resource: only empty fields were filled.
  - Recognised layout: kanji list (# / kanji / meaning / on / kun / strokes); 103 entries parsed from 4 page(s).
- `local/jlpt-n5-vocabulary-list.pdf` (partial):
  - 541 vocabulary entries were already defined by another resource: only empty fields were filled.
  - Recognised layout: word list (# / word / reading / meaning); 743 entries parsed from 24 page(s).
  - 29 meaning(s) were cut off ("…") in the PDF; kept the complete parts only.
  - row 62, page 2: duplicate of v:家, skipped
  - row 143, page 5: duplicate of v:外, skipped
  - row 631, page 20: duplicate of v:何方, skipped
  - … 10 more
- `local/kana-stroke-order/toaz_info_hiragana_and_katakana_workbook_pr_8bef5ec94774c4e7175ff453da45e03a.pdf` (indexed):
  - Recognised layout: kana stroke-order pages (code point labels); 92 pages linked from 108 page(s).

### Files that could not be parsed

_None in the current run._
<!-- END GENERATED -->
