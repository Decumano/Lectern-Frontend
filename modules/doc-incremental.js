// Rendering only the paragraphs that changed
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.
//
// Typing used to re-lex and re-sanitize the whole document after every pause.
// On a long file that is most of the cost: the lexer is the bulk of rendering
// and DOMPurify over the finished HTML is as much again, while the parser and
// the heading pass are cheap. So the document is cut into chunks at blank
// lines, each chunk is lexed once and remembered by its text, and a chunk's
// HTML is sanitized once and remembered by the HTML itself. An edit changes one
// chunk, so one chunk is lexed and one is sanitized; everything else is looked up.
//
// What stays global and cheap, and is redone every time: the heading pass (ids,
// TOC, chapter labels) and the parser, which takes each chunk's tokens in order,
// so the counters they share come out exactly as for a single pass.
//
// The one rule that keeps this correct: a cut is only made where it certainly
// changes nothing. When in doubt two chunks are kept as one, which is always
// safe and only costs speed. A document with link-reference definitions or raw
// HTML blocks that can span blank lines isn't cut at all.

var docIncrementalEnabled = true,
    chunkCache = new Map(),      // chunk text -> { text, tokens }
    sanitizedCache = new Map();  // chunk HTML -> sanitized chunk HTML

// marked's parser writes into the tokens of a loose task list (it prepends the
// checkbox to the item text), so parsing the same tokens twice would put two
// checkboxes in. Chunks holding one are lexed afresh each time.
var cTaskItemRe = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\]/m;

// (A reference definition's label may run over lines, even blank ones.)
var cChunkUnsafeRe = /^ {0,3}\[[^\[\]]*\]:[ \t]*\S|^ {0,3}<(?:pre|script|style|textarea|!--|\?|![A-Z]|!\[CDATA\[)/im,
    cListMarkerRe = /^ {0,3}(?:[-*+]|\d{1,9}[.)]|[ivxlcdmIVXLCDM]+[.)])[ \t]/;

function fSplitIntoChunks(text)
{
  if (cChunkUnsafeRe.test(text))
    return null;

  var lines = text.split('\n'),
      pieces = [],
      start = 0,
      fence = null,
      inMath = false,
      closer = null,   // the line that ends the ::/;; block being read
      depth = 0,       // font blocks open
      sawList = false,
      htmlRun = false, // inside what may be an HTML block, which runs to the next blank line
      keyword;

  for (var i = 0; i < lines.length; i++)
  {
    var line = lines[i];

    // Is this line the first of a new, independent block?
    if (i > start && !fence && !inMath && !closer && depth === 0 && line.trim() !== '' && lines[i - 1].trim() === '' &&
        !/^[ \t]/.test(line) && !(sawList && cListMarkerRe.test(line)))
    {
      pieces.push(lines.slice(start, i).join('\n') + '\n');
      start = i;
      sawList = false;
    }

    // Raw HTML at the start of a line may open an HTML block, and inside one a
    // fence or a macro line is plain text. Whether it does depends on the tag,
    // so if such a line shows up there, don't cut this document at all.
    if (htmlRun)
    {
      if (line.trim() === '')
        htmlRun = false;
      else if (/^ {0,3}(?:`{3,}|~{3,})|\$\$|^(?:::|;;)|[\uE000\uE002]/.test(line))
        return null;

      continue;
    }

    var fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);

    if (fence)
    {
      // A closing fence carries no info string: "```js" inside a fence is text.
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && /^ {0,3}[`~]+[ \t]*$/.test(line))
        fence = null;

      continue;
    }

    // A math block starts where a block starts with $$ and ends at the next $$,
    // wherever that is. A $$ anywhere else, or several on one line while a block
    // is open, leaves it unclear where blocks begin, so don't cut the document.
    var dollars = (line.match(/\$\$/g) || []).length;

    if (inMath)
    {
      // (A fence marker inside a math block is just text, so this comes first.)
      if (dollars === 1)
        inMath = false;
      else if (dollars > 1)
        return null;

      continue;
    }

    if (fenceMatch)
    {
      fence = fenceMatch[1];
      continue;
    }

    if (dollars % 2 === 1)
    {
      if (!/^\$\$/.test(line))
        return null;

      inMath = true;
      continue;
    }

    keyword = null;

    // The ::/;; blocks open and close only at the start of a line (an indented
    // ":::" is ordinary text), with nothing but spaces after the symbol.
    if (closer)
    {
      if (line.replace(/[ \t]+$/, '') === closer)
        closer = null;
    }
    else if (/^(?:::|:::|;;|;;;)[ \t]*$/.test(line) ||
             ((keyword = /^:::[ \t]*(\S.*)$/.exec(line)) && !/[ \t]:::[ \t]*$/.test(line) && fParseBlockDirectives(keyword[1])))
    {
      // Straight after text it may only be a lazy continuation of a list item
      // or paragraph, not a block of its own; that is context only the lexer
      // has, so such a document is not cut.
      if (i > 0 && lines[i - 1].trim() !== '')
        return null;

      closer = keyword ? ':::' : line.replace(/[ \t]+$/, '');   // "::: cen" names nothing: just text
    }

    depth += (line.match(//g) || []).length - (line.match(//g) || []).length;

    if (depth < 0)
      depth = 0;

    if (cListMarkerRe.test(line))
      sawList = true;

    if (!closer && /^ {0,3}<[A-Za-z\/!?]/.test(line))
      htmlRun = true;
  }

  pieces.push(lines.slice(start).join('\n'));

  return pieces;
}

// Raw HTML the author wrote, outside code. A tag left open in one chunk is
// closed by the sanitizer at the end of that chunk, but in a whole-document pass
// it would run on into the next, so such a document is sanitized as a whole.
function fHasRawHtml(text)
{
  return /<[A-Za-z\/!?]/.test(text.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm, '').replace(/`[^`\n]*`/g, ''));
}

// { chunks: [{ text, tokens, rawHtml }], tokens: all of them in order }
function fLexDocument(text, chunked, offSignature)
{
  var pieces = chunked && docIncrementalEnabled ? fSplitIntoChunks(text) : null,
      // Where the cuts fall, as the number of lines in each chunk. When it
      // changes, the cuts have moved, which is the one thing that can go wrong.
      signature = pieces ? pieces.map(function(p) { return (p.match(/\n/g) || []).length; }).join(',') : null,
      chunks = [],
      tokens = [],
      kept = new Map();

  // A signature already found to render differently is not trusted.
  if (signature !== null && signature === offSignature)
  {
    pieces = null;
    signature = null;
  }

  (pieces || [text]).forEach
  (
    function(piece)
    {
      var reusable = chunked && docIncrementalEnabled && !cTaskItemRe.test(piece),
          chunk = reusable ? (kept.get(piece) || chunkCache.get(piece)) : null;

      if (!chunk)
        chunk = { text: piece, tokens: marked.lexer(piece), rawHtml: fHasRawHtml(piece) };

      if (reusable)
        kept.set(piece, chunk);

      chunks.push(chunk);

      for (var i = 0; i < chunk.tokens.length; i++)
        tokens.push(chunk.tokens[i]);
    }
  );

  // Only what the latest render used is kept, so the cache can't grow without
  // bound however long someone edits.
  if (chunked)
    chunkCache = kept;

  return { chunks: chunks, tokens: tokens, signature: signature };
}

// Sanitizes one chunk's HTML, or remembers that it already did.
function fSanitizeChunk(html, kept)
{
  var clean = kept.get(html);

  if (clean === undefined)
  {
    clean = sanitizedCache.get(html);

    if (clean === undefined)
      clean = fSanitizeHtml(html);
  }

  kept.set(html, clean);
  return clean;
}
