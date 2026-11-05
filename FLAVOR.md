# Lectern Flavor

The file format spec for every app in the suite.

Lectern never invents a binary format. Every file it writes is UTF-8 text you
can open in any editor, diff in git, and — for the document and diagram types —
read in a plain Markdown viewer without losing the words. This document is the
reference for what is actually written to disk, so a file stays readable even if
this app disappears.

Everything here is implemented in [`main.js`](main.js); the Markdown extensions
specifically live in `fConfigureMarkedExtensions`. The base parser is
[marked](https://github.com/markedjs/marked) v9.1.6 with GFM enabled, so
**everything CommonMark and GitHub Flavored Markdown support works unchanged** —
tables, task lists, strikethrough, fenced code, autolinks. The extensions below
are additions, never replacements.

## File types

| Extension | App | Format |
|---|---|---|
| `.mdp` | Documents | Markdown + the extensions below |
| `.mdg` | Diagrams | Markdown wrapper around one Mermaid block |
| `.mds` | Sheets | Line-oriented text with a YAML front-matter header |
| `.mdn` | Notebook / Maps | Markdown wrapper around a JSON block |
| `.mdd` | Slides | Line-oriented text: YAML front matter, `--- N ---` slides |
| `.mdl` | Glossary | JSON |
| `.mdc` | Calendar | JSON |
| `.mde` | Economy | JSON |
| `.mdb` | Bestiary | JSON |

The first four degrade gracefully: rename a `.mdp` to `.md` and GitHub renders
it. The last four carry an `.md*` extension for consistency with the rest of the
suite, but their contents are plain JSON, not Markdown — see
[Structured data files](#structured-data-files).

---

# Documents (`.mdp`)

## Math — KaTeX

```
Inline: $E = mc^2$ appears mid-sentence.

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$
```

Registered as parser-level tokenizers rather than a post-render pass, so
Markdown emphasis rules never mangle TeX source (`a_1` and `b_2` on one line
does not become italics).

Inline math uses Pandoc's currency guard: the TeX must not begin or end with
whitespace, and the closing `$` must not be followed by a digit. So `$5 and $10`
stays literal text. Write `\$` for a literal dollar sign inside math.

If KaTeX fails to parse the expression, the source is rendered as inline code
rather than throwing.

## Diagrams — Mermaid

A fenced block tagged `mermaid` renders as a live diagram:

````
```mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Continue]
    B -->|No| D[Stop]
```
````

Every other language falls through to normal `<pre><code>` rendering.

## Alignment blocks

Two spellings exist for the same thing. The keyword form is explicit; the
symbol form is what the toolbar buttons write, because it is quieter in raw
text.

**Keyword form** — `:::` followed by one or more directives on the opening line,
closed by a bare `:::`:

```
::: center
Centered paragraph, and **all Markdown inside still works**.
:::

::: right italic
Right-aligned, in italics.
:::
```

Recognized directives: the bare words `left`, `center`, `right`, `justify`,
`bold`, `italic`, `underline`, `smallcaps`, and the keyed `size=<size>`, `color=<css colour>`, `spacing=<line-height>` and
`tracking=<letter-spacing>` (see [Sizes](#sizes-and-text-formatting)). Unrecognized directives
are ignored, and if a block's opening line yields no recognized directive at all
the block is not treated as a container — the `:::` lines stay literal text.

**Symbol form** — the symbol alone on its own line, closed by the exact same
symbol:

| Symbol | Effect |
|---|---|
| `::` | Align left |
| `:::` | Align right |
| `;;` | Align center |
| `;;;` | Justify |

```
;;
This paragraph is centered.
;;

::
This paragraph is left-aligned.
::
```

The symbol form requires nothing after the symbol on the opening line, which is
what keeps `:::` (right-align) from colliding with `::: center` (keyword form) —
the keyword form always has trailing text.

## Fonts

A font block is the **only** way to change the font, in any file type that
renders Markdown:

```
||font=Fette Fraktur size=14 spacing=1.5
Text in Fette Fraktur, 14pt, line-height 1.5.
||
```

| Option | Meaning |
|---|---|
| `font=<name>` | The font's name. Spaces need no quotes. Generic families (`serif`, `monospace`…) work. The font must be installed (or, on the web app, uploaded under Settings → Custom fonts). |
| `size=<n>` | Size in points. |
| `spacing=<v>` | CSS `line-height`: a multiplier (`1.5`) or a length (`20pt`). |

Each option is optional, but one is required; a bare `||` closes the block.

**Blocks nest, and they aren't paragraphs.** The marker lines disappear and the
text flows on, so only a blank line separates paragraphs:

```
||font=font1
test
||font=font2
testing
||
tested
||
```

is the single line *test testing tested*, with "testing" in font2 and the rest in
font1. A blank line after `test` would make it two paragraphs, *test* and
*testing tested*, in the same fonts. A block may also start mid-paragraph or run
across headings, lists and tables. Inner blocks inherit whichever options they
don't set. Code and math keep their own typography.

A block's `size` applies to everything inside it, headings included. A `||` with
no block open stays literal text, and so does the old `||Georgia` form.

## Sizes and text formatting

Everything except the font can be set in three places: a keyword block, an inline
span and a heading.

```
::: center size=Huge bold
Lore and Chaos
:::

[Big words]{size=18 color=#a00} in a sentence.
[Small caps]{smallcaps} and [wide]{tracking=2pt}.

# The War {size=Huge center}
```

| Directive | Meaning |
|---|---|
| `size=<size>` | A LaTeX name (`tiny`, `scriptsize`, `footnotesize`, `small`, `normalsize`, `large`, `Large`, `LARGE`, `huge`, `Huge` — names are relative to the surrounding size, using the 10pt class ratios), a bare number (points: `size=24`), or a number with a unit (`1.5em`, `18px`, `120%`). |
| `color=<colour>` | `#rgb`, `#rrggbb`, a colour name, or `rgb(…)` / `hsl(…)`. |
| `bold` `italic` `underline` `smallcaps` | Flags. |
| `spacing=<n>` | Line height multiplier (blocks). |
| `tracking=<length>` | Letter spacing. |
| `left` `center` `right` `justify` (or `align=…`) | Alignment (blocks and headings). |

Inline spans only count as formatting when the braces hold at least one of
`size`, `color`, `bold`, `italic`, `underline`, `smallcaps` or `tracking`; any
other `[text]{…}` is left as literal text.

**Heading attributes.** A trailing `{…}` on a heading styles that heading and is
removed from its text, its anchor and its table-of-contents entry. Besides the
formatting directives it accepts `notoc` (leave it out of `[TOC]`), `nolabel`
(no chapter label, see below), `pagebreak` (start a new page before it),
`nopagebreak`, and `fill` / `space` (PDF spacing before it, see
[Spacing](#spacing)).

## PDF output

Exporting a Document to PDF opens a dialog for paper, orientation, margins, page
numbers, header, footer and chapter breaks, prefilled from the `[PAGE]` line.

- Every `#` heading starts a new page, unless it is already at the top of one.
  Turn this off with the dialog, `newpage=none`, or `{nopagebreak}` on one heading.
- Margins are exact, whatever a print dialog would default to.
- Text is never cut. A paragraph, list or table that doesn't fit carries on at the
  next page, splitting only between lines or rows, and tables repeat their header
  row. Something that can't split (a diagram, a formula) moves to the next page
  whole, and is scaled down if it is bigger than a page.
- A heading is never left alone at the bottom of a page.

### Page breaks

A line holding only three backslashes starts a new page in the PDF and shows
nothing at all in the editor preview:

```
\\\
```

The toolbar button inserts it.

### Spacing

Space that exists only on paper (nothing shows in the editor), for covers,
signature blocks and the like. Two backslashes make a fixed space; a number after
them makes a flexible one:

| Line | Meaning | LaTeX |
|---|---|---|
| `\\` | A fixed vertical space of one blank line | `\vspace` |
| `\\2cm` | A fixed space of that length (`pt`, `px`, `em`, `rem`, `cm`, `mm`, `in`) | `\vspace{2cm}` |
| `\\1` or `\\1.5` | A fill with that weight: it takes a share of whatever is left of the page, in proportion to the weights of the other fills on it | `\vfill` |

A number with no unit is a fill weight; with a unit, a length. The same things can
hang off a heading, which puts them before it: `# Title {fill}`, `{fill=1.5}`,
`{space}`, `{space=2cm}`.

```
\\1

;;
# {size=Huge}
The Lore of Chaos
;;

\\1

;;
An Account in Six Volumes
;;

\\2

\\\
```

centres the title between two equal fills and sets the subtitle with twice as much
room below it. A space that falls at the top of a page the text merely ran onto is
dropped (as LaTeX drops a `\vspace` there); one after a deliberate page break is
kept. On the server's PDF a fill is stretched within the text between two page
breaks, so it needs that much room to work in.

### Page setup

```
[PAGE size=A4 margin="2.5cm 2cm" spacing=1.2 paragraph=0.8em fontsize=12
      header="Lore and Chaos" footer="Page {page} of {pages}"
      numbers=bottom-center chapter-label="Chapter"
      h1-size=Huge h1-center h1-bold]
```

One line, anywhere in the document (conventionally the first). It never prints.
Text options restyle the live preview too; `size`, `margin`, `header`, `footer`,
`numbers`, `first-page` and `newpage` only exist in the PDF.

| Option | Effect |
|---|---|
| `size=A4` | Paper size: `A3`–`A6`, `B4`/`B5`, `letter`, `legal`, `ledger`, `tabloid`. |
| `landscape` / `orientation=landscape` | Paper orientation. |
| `margin=2cm` | One to four lengths (`"2cm 3cm"`, CSS order) in `mm`, `cm`, `in`, `pt` or `px`. Default 2cm. |
| `fontsize=<size>` | Body size (`fontsize=12` is 12pt). |
| `spacing=1.2` | Line spacing. |
| `paragraph=0.8em` | Space after each paragraph. |
| `indent=1.5em` | First-line indent for every paragraph after the first in a run. |
| `header="…"` `footer="…"` | Running header/footer text. Placeholders: `{page}`, `{pages}`, `{title}`. |
| `header-align=` `footer-align=` | `left`, `center` (default) or `right`. |
| `header-size=` `footer-size=` | Size of the running text (default 10pt). |
| `numbers=bottom-center` | Page number position: `top-`/`bottom-` + `left`/`center`/`right`; `on`/`bottom` = bottom-center; omitted = none. Shares a slot with header/footer text if they coincide. |
| `first-page=plain` | No header, footer or number on the first page. |
| `newpage=h1` | Which heading level starts a new page: `h1` (default) to `h6`, or `none`. |
| `chapter-label="Chapter"` | Puts "Chapter N" above every level-1 heading (counting from 1; `nolabel` opts one out). |
| `h1-…` … `h6-…` | Any text directive for that heading level: `h1-size=`, `h1-color=`, `h1-center`, `h1-bold`… |
| `title=off` | Don't print the file name as a title at the top of the export. (Also skipped automatically when the document itself starts with a level-1 heading.) |

## Table of contents

```
[TOC]
[TOC title="Contents:" size=Large center numbers=on depth=2]
```

Alone on its line, case-insensitive. Expands to a nested list of every heading
in the document, linked to the heading anchors. Headings are given `id`
attributes derived from their text: lowercased, non-alphanumerics stripped,
spaces collapsed to `-`. Repeated headings are disambiguated with a numeric
suffix — the second `## Notes` in a file gets `id="notes-1"`.

Options: `title="…"` adds a heading above the list; `numbers=on` numbers the
entries `1`, `1.1`, …; `depth=N` limits it to heading levels up to `N`; the
text directives above (`size`, `color`, alignment…) style the whole block. Headings marked `notoc` are skipped. Entries carry no page numbers.

## Roman-numeral lists

```
i. First
ii. Second
iii. Third
```

Renders as a real ordered list with roman markers. Both `.` and `)` terminate
the marker. Lowercase and uppercase are separate lists — a case switch starts a
new one. A *single* roman item only counts as a list when it starts at `i`/`I`,
so prose like `c. 1450` is left alone. Arabic `1.` lists are standard Markdown
and behave exactly as they always did.

## Field cards

Key–value metadata rendered as a styled card rather than a paragraph.

One line, fields laid out side by side:

```
{type: Character, status: Active, faction: Ironhold, race: Human}
```

Braces on their own lines, one field per row:

```
{
type: Location,
region: Northmarch,
climate: Subarctic,
}
```

The multi-line form requires *every* non-empty inner line to look like
`key: value` (a trailing comma is optional). If any line does not, the block is
left as ordinary text — so stray braced content in a document is never eaten.

Field cards are what the built-in document templates (Character, Faction,
Location, Event, Region) put at the top of a new file.

## Tags

```
This entry is a #character from #northmarch.
```

`#word` renders as a clickable pill that filters the sidebar to files carrying
that tag. Matching requires a word character immediately after the `#`
(`[\w-]+`), so ATX headings — which always have a space — never collide.

## Task lists

Standard GFM task list syntax, but the rendered checkboxes are live: ticking one
in the preview writes the change back to the source.

```
- [ ] Draft the siege chapter
- [x] Name the river
```

## Cross-file links and embeds

Links between files in the workspace use a private URL scheme:

```
lorekeep://file/<url-encoded file id>
```

Written by the link toolbar, not by hand. Two forms:

**Link** — `[Kaelith Vance](lorekeep://file/f_1737059412345)` navigates to that
file.

**Embed** — the image form pulls live content out of another file *into* this
document:

```
![Trade routes](lorekeep://file/f_1737059412345)
```

- Target is a **Diagram** → its Mermaid block is rendered inline as a figure,
  with the alt text as the caption.
- Target is a **Sheet** → every chart defined in that sheet is rendered inline
  from the sheet's live cell values.
- Target is missing → a visible `[File not found: …]` placeholder, never a
  silent blank.

Any `href` that is not this scheme is treated as a normal link, so ordinary web
URLs and relative paths are untouched.

### Backlinks

Backlinks are derived, not authored. The app scans file contents for mentions of
other files by name and stores the resulting index in `_lkbl.json` at the
work-folder root (shape: `{ targetFileId: [sourceFileId, …] }`). **Files are
never modified to record backlink data** — delete `_lkbl.json` and it is rebuilt.

---

# Diagrams (`.mdg`)

A type marker comment followed by a single Mermaid block:

````
<!-- type: graph -->

```mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Continue]
    B -->|No| D[Stop]
```
````

When a document embeds a diagram file, the *first* Mermaid block in the file is
the one that gets rendered.

---

# Sheets (`.mds`)

YAML front matter, then one section per tab, then an optional chart block.

```
---
type: spreadsheet
---

# Population
A1=Region
B1=Households
A2=Northmarch
B2=1400
B9=SUM(B2:B8)=9310
```

## Cell lines

One line per non-empty cell, `REF=VALUE`, sorted row-major. Cells are written
from each page's own contents rather than clipped to the visible grid, so a
value far outside the current viewport is never silently dropped.

**Formulas serialize with their last computed result appended:**

```
B9=SUM(B2:B8)=9310
```

That is `REF` `=` `formula body` `=` `cached value`. The cached value is what
lets another tool — or a document embedding this sheet's chart — read meaningful
numbers without implementing the formula engine. On load the formula is
authoritative and the cache is recomputed.

## Cell decorations

Suffixes on the cell line, in any order:

| Suffix | Meaning | Example |
|---|---|---|
| `:REF,REF,…` | Merge — this cell is the anchor, the listed refs are covered | `B1=Totals:B2,B3,B4` |
| `;#rrggbb` | Background color | `B1=5;#FAFAFA` |
| `;txt#rrggbb` | Text color | `B1=5;txt#FF0000` |

A cell that has only a decoration and no value still gets a line, so formatting
survives a round trip.

## Multiple tabs

Each tab is a `#` heading followed by its cells:

```
# Population
A1=Northmarch

# Trade
A1=Silk
```

Formulas reference another tab with a link-like syntax — `[Tab name](REF)`:

```
B2=[Population](B9) * 0.4=3724
```

## Charts

Chart definitions are appended as a single fenced JSON block:

````
```charts
[{"id":"c1","type":"bar","range":"A1:B8"}]
```
````

Live Chart.js instances are never serialized — they are rebuilt from these
definitions and the current cell values on every render.

## Formula language

79 functions across six categories — Aggregate, Math, Trigonometry, Lookup, Text
and Logical. The in-app function reference (the `fx` button) is generated from
the same table that implements them, so it is always current;
`cSheetFunctionGroups` in `main.js` is the source of truth.

Ranges use the usual `A1:B8` notation, with `$` absolute markers.

An `@` prefix on a range makes an expression element-wise, which is how the sheet
does array math without an array-formula mode:

- **Inside an aggregate function** (`SUM`, `AVG`, `MAX`, `MIN`, `MEDIAN`,
  `PRODUCT`, `STDEV`, `VAR`, `COUNT`, `COUNTA`, `LARGE`, `SMALL`), the segment is
  expanded one element per line and passed as a value list —
  `=SUM(@I18:I22*@J18:J22)` becomes `SUM(I18*J18, I19*J19, …)`, a SUMPRODUCT-style
  single result.
- **Anywhere else**, `@range` picks the one value on the formula's own row or
  column, so `=@A1:A9*@B1:B9` filled down computes each line's pair.

All `@` ranges in one expression must be the same size; scalars repeat on every
line.

---

# Slides (`.mdd`)

YAML front matter, then one section per slide. A presentation is text like
every other format: it diffs line by line, and each slide reads top to bottom
as its look followed by its words.

```
---
type: presentation
size: 1280x720
---

--- 1 ---
{
background-color: #1b2a41;
background-image: url(assets/Campaign/ocean.png);
color: #f0ede6;
line: 120, 470, 1160, 470, #d4a843, 4;
}
[120, 220, 1040, 160, ;;
# The Northmarch Campaign
;;]
[120, 500, 1040, 120, A world of **ice** and *iron*.]

--- 2 ---
[100, 90, 1080, 100, ## Factions]
```

`size` is the slide's coordinate space, `WIDTHxHEIGHT` (default `1280x720`).
Every position below is in these units, whatever size the slide is shown at.

## Slides

A line `--- N ---` starts a slide, and it runs until the next such line. The
number is a label: the app renumbers slides 1, 2, 3… when it saves, so
reordering them never leaves gaps.

## Slide style

An optional `{ … }` block straight after the slide header styles the slide.
It is written like CSS — `property: value;`, one or several per line — and
must come before the slide's first text box (so a [field card](#field-cards)
inside a box is never mistaken for it).

These properties are applied to the slide as CSS:

`background`, `background-color`, `background-image`, `background-size`,
`background-position`, `background-repeat`, `background-blend-mode`, `color`,
`font-family`, `font-size`, `font-weight`, `font-style`, `line-height`,
`letter-spacing`, `text-align`, `text-shadow`.

`color`, the `font-*` properties and `line-height` set the defaults for the
slide's text. Any other property is kept in the file but has no effect.
`background/color` is accepted as another spelling of `background-color`.

**Background images** are written `url(path)`. `background-image: [path]` and a
bare `background-image: path` mean the same. A relative path is relative to the
work folder's root. An image chosen in the app — from the computer, from a web
address, or dropped on the slide — is copied into the work folder under
`assets/<presentation name>/`, so the presentation never depends on a file
somewhere else or a site staying up. Without a work folder there is no project
to copy into, and the image is embedded in the file as a `data:` URL instead.

An image covers the slide by default (`background-size: cover`, centred, no
repeat); set those properties to change it. CSS gradients work anywhere an
image does — `background-image: linear-gradient(135deg, #1b2a41, #324a5f)`.

## Decorations

Four more declarations draw on the slide, over the background and under the
text, in the order they are written. Unlike CSS properties they can repeat:
each line is one shape. Colors are any CSS color, or `none`.

| Declaration | Values |
|---|---|
| `line` | `x1, y1, x2, y2, color, width` |
| `rect` | `x, y, width, height, fill, stroke, strokeWidth` |
| `ellipse` | `x, y, width, height, fill, stroke, strokeWidth` (the box it fits in) |
| `stroke` | `color, width, x y, x y, x y, …` |

`stroke` is freehand ink — what the pen tool draws — smoothed the same way as
Notebook ink.

```
{
rect: 60, 60, 1160, 600, none, #324a5f, 2;
ellipse: 1040, 60, 160, 160, #d4a84333, #d4a843, 3;
stroke: #d4a843, 5, 100 600, 140 580, 180 610, 220 585;
}
```

## Text boxes

```
[x, y, width, height, text]
```

A line beginning `[` and four numbers starts a text box at (`x`, `y`) of the
given size. The text is [Documents Markdown](#documents-mdp) with every
extension — headings, lists, alignment and font blocks, math, Mermaid, field
cards — and may run over several lines. It ends at the last `]` before the
next text box, the next slide, or the end of the file, so text that itself ends
in `]` (a `[TOC]`, a link label) needs nothing special.

Text that overflows its box is clipped, as it would be on a projected slide.

---

# Notebook and Maps (`.mdn`)

A type marker comment followed by one fenced JSON block:

````
<!-- type: notebook -->

```notebook
{"version":1,"pdfData":null,"pages":[]}
```
````

The payload:

| Key | Meaning |
|---|---|
| `version` | Format version, currently `1` |
| `pdfData` | An imported PDF being annotated, or `null` |
| `pages` | Ordered array of page objects |

A page:

| Key | Meaning |
|---|---|
| `width`, `height` | Page size in points (default 816 × 1056 — US Letter at 96 dpi) |
| `background` | `{ type: 'ruled' }` and other background styles |
| `strokes` | Freehand ink |
| `shapes` | Lines, ellipses and other vector shapes |
| `texts` | Positioned text boxes |
| `type` | `'map'` on world-map pages; absent on ordinary pages |

A map page is an ordinary page plus an image background, location pins linked to
Document files, a scale reference and a travel-time calculator. Drawing tools
still work on top of the map image, which is why it is a page variant rather than
a separate file type.

---

# Structured data files

Glossary (`.mdl`), Calendar (`.mdc`), Economy (`.mde`) and Bestiary (`.mdb`) are
**pretty-printed JSON**, not Markdown. They back grid and form UIs rather than a
text editor, and a line-oriented text format would have bought nothing but
parsing bugs. They keep the `.md*` prefix so the whole workspace shares one
naming scheme and one file picker.

Every one of them carries a `name` field, which is the display title shown in the
app.

**Glossary** — `{ name, entries, roots }`. `roots` holds constructed-language
root words that entries can derive from.

**Calendar** — `{ name, daysPerYear, epochFictionYear, epochRealDate, seasons, months, holidays }`.
`epochFictionYear` and `epochRealDate` (an ISO `YYYY-MM-DD`) together anchor the
fictional calendar to the real one, which is what makes "today, in-world" a
computable date.

**Economy** — `{ name, currencies, exchangeRates, tradeGoods, regions }`.

**Bestiary** — `{ name, beasts }`.

---

# Compatibility notes

**In a plain Markdown viewer**, a `.mdp` file reads correctly as prose. Math
shows as `$…$`, the `:::` and `||` fences show as literal lines, field cards show
as braced text, and `[TOC]` shows as literal text. Nothing is lost, and no
content is hidden inside HTML comments or attributes.

**Round-tripping**: documents are stored as the literal text you typed and are
never reformatted. Sheets and the JSON-backed types are rewritten from the parsed
model on save, which normalizes cell ordering and key order.

**What is not in the files**: tags are read out of document text, backlinks live
in `_lkbl.json`, and open tabs, themes and window layout live in `localStorage`.
The workspace folder holds documents, not app state — copying it to another
machine moves the work and nothing else.
