// Documents: editor, markdown extensions, math
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── DOC ──
var docTextUndo = fMakeTextUndo(function(){ return document.getElementById('editor'); });

function fLoadDocFile(file)
{
  docTextUndo.reset();
  document.getElementById('doc-title-input').value = file.name;
  document.getElementById('editor').value = file.content || '';
  document.getElementById('toolbar-title').innerHTML = '<span>' + fEscHtml(file.name) + '</span>';
  fUpdatePreview();
  fUpdateStatus();
}

function fOnDocTitleChange()
{
  if ((!currentFileId) || (files[currentFileId].type !== 'doc'))
    return;

  files[currentFileId].name = (document.getElementById('doc-title-input').value || files[currentFileId].name);
  document.getElementById('toolbar-title').innerHTML = '<span>' + fEscHtml(files[currentFileId].name) + '</span>';
  fScheduleSave();
  fRenderFileList();
}

function fOnEditorChange()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'doc')
    return;

  files[currentFileId].content = document.getElementById('editor').value;

  fSchedulePreviewUpdate();
  fScheduleSave();
}

// Re-rendering the whole preview (markdown lex/parse, sanitize, innerHTML,
// mermaid, backlink scan across every file) on every keystroke freezes long
// documents. Typing now only queues the work: the preview/status refresh runs
// once typing pauses, with a delay that grows with document length, and the
// backlink scan (the heaviest part, O(all files)) waits for a longer pause.
var previewTimer = null,
    backlinkTimer = null;

function fSchedulePreviewUpdate()
{
  var length = files[currentFileId].content.length,
      delay = Math.min(700, 80 + Math.floor(length / 150));

  clearTimeout(previewTimer);
  previewTimer = setTimeout
  (
    function()
    {
      previewTimer = null;
      fUpdatePreview(true);
      fUpdateStatus();
    },
    delay
  );
}

// Run any queued preview refresh right now (used before something reads it).
function fFlushPreviewUpdate()
{
  if (previewTimer === null)
    return;

  clearTimeout(previewTimer);
  previewTimer = null;
  fUpdatePreview(true);
  fUpdateStatus();
}

function fScheduleSave()
{
  lastLocalEditAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout
  (
    async function()
    {
        var id = currentFileId;

        if (id)
        {
          // Fold in anything that arrived from someone else first, so this
          // save can't overwrite it.
          if (typeof fLiveSyncBeforeSave === 'function')
          {
            try { await fLiveSyncBeforeSave(id); } catch(e) {}
          }

          if (!files[id]) return;

          files[id].modified = Date.now();
          fPersistFileEntry(id);

          // Keep the side pane in step while its file is being edited
          if (splitState.fileId === id)
            fRenderSplitPane();
        }
    },
    typeof fAutosaveDelay === 'function' ? fAutosaveDelay() : 800
  );
}

// ── MARKDOWN EXTENSIONS (styled blocks, font spans, table of contents) ──
// Adds Pandoc-style commands on top of standard markdown:
//   :: ... ::                                               wraps a block, left-aligned
//   ::: ... :::                                             wraps a block, right-aligned
//   ;; ... ;;                                                wraps a block, centered
//   ;;; ... ;;;                                              wraps a block, justified
//   ||font=Georgia size=12 spacing=1.4 ... ||              sets the font; the ONLY way to change it, nests
//   [text]{size=Huge color=#a00}                           formats an inline passage (never the font family)
//   [TOC]                                                  expands into a generated table of contents
// Implemented as marked.js extensions (not a post-processing pass) so headings nested inside
// styled blocks are still visited in true document order, keeping TOC anchors in sync.
// Generic CSS family keywords must stay unquoted to mean what they say -
// font-family:'monospace' looks up a font literally NAMED "monospace" (and
// fails), while font-family:monospace is the actual generic fallback.
var cCssGenericFontFamilies = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'];

function fCssFontFamilyValue(name)
{
  name = (name || '').trim();

  if (cCssGenericFontFamilies.indexOf(name.toLowerCase()) !== -1)
    return name.toLowerCase();

  return "'" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// LaTeX size names -> multiples of the body size (the 10pt class ratios), so a
// converted \Huge heading keeps its proportions whatever the body size is.
var cNamedSizes = { tiny: 0.5, scriptsize: 0.7, footnotesize: 0.8, small: 0.9, normalsize: 1, large: 1.2, Large: 1.44, LARGE: 1.73, huge: 2.07, Huge: 2.49 };

// Accepts a LaTeX name (Huge), a bare number (points: 24) or a number with a
// unit (1.5em, 18px, 120%). Anything else yields '' so it can't inject CSS.
function fCssSizeValue(value)
{
  value = (value || '').trim();

  if (Object.prototype.hasOwnProperty.call(cNamedSizes, value))
    return cNamedSizes[value] + 'em';

  if (Object.prototype.hasOwnProperty.call(cNamedSizes, value.toLowerCase()))
    return cNamedSizes[value.toLowerCase()] + 'em';

  var m = /^(\d+(?:\.\d+)?)(pt|px|em|rem|%|cm|mm|in)?$/i.exec(value);

  return m ? (m[1] + (m[2] ? m[2].toLowerCase() : 'pt')) : '';
}

function fCssLengthValue(value)
{
  var m = /^(\d+(?:\.\d+)?|\.\d+)(pt|px|em|rem|%|cm|mm|in)?$/i.exec((value || '').trim());

  return m ? (m[1] + (m[2] ? m[2].toLowerCase() : 'pt')) : '';
}

function fCssWeightValue(value)
{
  value = (value || '').trim().toLowerCase();

  return /^(normal|bold|bolder|lighter|[1-9]00)$/.test(value) ? value : '';
}

function fCssColorValue(value)
{
  value = (value || '').trim();

  return /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([\d\s.,%]+\))$/i.test(value) ? value : '';
}

// Tokenises "left size=Huge color=#a00 bold" into
// [{key, hasValue, value}] - the shared syntax of block lines (::: ...),
// inline spans ({...}), headings ({...}) and the [PAGE ...] / [TOC ...] macros.
function fParseDirectiveTokens(line)
{
  var out = [],
      re = /([A-Za-z][\w-]*)(?:=("([^"]*)"|'([^']*)'|[^\s"']+))?/g,
      match;

  while ((match = re.exec(line)))
  {
    out.push
    (
      {
        key: match[1].toLowerCase(),
        hasValue: match[2] !== undefined,
        value: match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : (match[2] || ''))
      }
    );
  }

  return out;
}

// One text-style directive -> CSS, or '' when the key isn't a style.
function fDirectiveStyle(key, hasValue, value)
{
  var css;

  if (!hasValue)
  {
    if (key === 'left' || key === 'center' || key === 'right' || key === 'justify')
      return 'text-align:' + key + ';';
    if (key === 'bold')       return 'font-weight:bold;';
    // CSS's relative and absolute weights: bolder/lighter step from the surrounding text.
    if (key === 'normal' || key === 'bolder' || key === 'lighter') return 'font-weight:' + key + ';';
    if (key === 'italic')     return 'font-style:italic;';
    if (key === 'underline')  return 'text-decoration:underline;';
    if (key === 'smallcaps')  return 'font-variant:small-caps;';
    return '';
  }

  if (key === 'size' && (css = fCssSizeValue(value)))
    return 'font-size:' + css + ';';
  // weight=normal|bold|bolder|lighter|100…900  (bold=… is the same thing)
  if ((key === 'weight' || key === 'bold') && (css = fCssWeightValue(value)))
    return 'font-weight:' + css + ';';
  // A hairline outline in the text colour: a little heavier than regular,
  // for fonts that come in one weight and so can't do anything in between.
  if (key === 'stroke' && (css = fCssLengthValue(value)))
    return '-webkit-text-stroke:' + css + ' currentColor;';
  if (key === 'color' && (css = fCssColorValue(value)))
    return 'color:' + css + ';';
  if (key === 'align' && /^(left|center|right|justify)$/i.test(value))
    return 'text-align:' + value.toLowerCase() + ';';
  if (key === 'spacing' && /^\d+(\.\d+)?$/.test(value))
    return 'line-height:' + value + ';';
  if (key === 'tracking' && (css = fCssLengthValue(value)))
    return 'letter-spacing:' + css + ';';

  return '';
}

function fParseBlockDirectives(line)
{
  return fParseDirectiveTokens(line).map
  (
    function(t) { return fDirectiveStyle(t.key, t.hasValue, t.value); }
  ).join('');
}

// Keys that make a "{...}" group count as inline/heading formatting rather
// than ordinary braced text.
var cInlineAttrKeys = /^(?:size|color|bold|bolder|lighter|normal|weight|stroke|italic|underline|smallcaps|tracking)\b/i;
var cHeadingAttrKeys = /^(?:size|color|bold|bolder|lighter|normal|weight|stroke|italic|underline|smallcaps|tracking|align|left|center|right|notoc|nolabel|pagebreak|nopagebreak|fill|space)\b/i;

function fUnescapeEntities(text)
{
  return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Splits "Title {size=Huge center}" into the clean title and the
// parsed attributes. Works on plain text and on already-rendered heading HTML.
function fSplitHeadingAttrs(text)
{
  var m = /\s*\{([^{}\n]*)\}\s*$/.exec(text);

  if (!m)
    return { text: text, tokens: [], style: '' };

  var inner = fUnescapeEntities(m[1]).trim();

  if (!cHeadingAttrKeys.test(inner))
    return { text: text, tokens: [], style: '' };

  var tokens = fParseDirectiveTokens(inner);

  return  {
            text: text.slice(0, m.index),
            tokens: tokens,
            style: tokens.map(function(t) { return fDirectiveStyle(t.key, t.hasValue, t.value); }).join('')
          };
}

function fHasToken(tokens, key)
{
  return tokens.some(function(t) { return t.key === key && !t.hasValue; });
}

// ── FONT BLOCKS ──
//   ||font=Fette Fraktur size=12 spacing=1.4
//   text
//   ||
// The only way to change a font. All three options are optional (at least one
// is required); blocks nest. A block is not a paragraph: its marker lines vanish
// and the text flows on, so only a blank line separates paragraphs, and a block
// may start mid-paragraph or run across several paragraphs, headings and lists.
//
// That doesn't fit a marked block extension (which would need balanced content
// per block), so the marker lines become invisible private-use markers before
// lexing, and fApplyFontMarkers resolves them on the rendered DOM by wrapping
// each run of text in a span carrying the styles of the blocks open around it.
var cFontOpenMark = '', cFontOpenMarkEnd = '', cFontCloseMark = '';

function fParseFontBlockOptions(text)
{
  var re = /(font|size|spacing|weight)=("[^"]*"|'[^']*'|.*?)(?=\s+(?:font|size|spacing|weight)=|\s*$)/gi,
      style = {},
      found = false,
      match;

  while ((match = re.exec(text)))
  {
    var key = match[1].toLowerCase(),
        value = match[2].replace(/^(["'])(.*)\1$/, '$2').trim(),
        css = '';

    if (key === 'font' && value)
      css = fCssFontFamilyValue(value);
    else if (key === 'size')
      css = fCssSizeValue(value);
    else if (key === 'spacing' && /^\d+(\.\d+)?(pt|px|em|rem|%|cm|mm|in)?$/i.test(value))
      css = value.toLowerCase();
    else if (key === 'weight')
      css = fCssWeightValue(value);

    if (css)
    {
      style[key] = css;
      found = true;
    }
  }

  return found ? style : null;
}

// One-line form, options in parentheses:
//   Some ||(font=Georgia size=14 spacing=1.5) text in Georgia || and back again.
// The closer is a `||` not followed by `(`, and pairs with the nearest opener
// on the same line, so these nest. An opener with nothing after it on its
// line starts an ordinary multi-line block instead; any other unpaired opener
// is left as literal text. Code spans are left alone.
// Returns { text, opened } (opened: 1 when a multi-line block was started), or
// null when the line has nothing to convert.
function fInlineFontMacros(line, styles)
{
  var codeRanges = [],
      codeRe = /`[^`\n]*`/g,
      match;

  while ((match = codeRe.exec(line)))
    codeRanges.push([match.index, match.index + match[0].length]);

  var inCode = function(at)
  {
    return codeRanges.some(function(r) { return at >= r[0] && at < r[1]; });
  };

  var re = /\|\|\(([^()\n]*)\)|\|\|(?!\()/g,
      open = [],      // unpaired openers, innermost last
      edits = [];     // { start, end, kind: 'open'|'close'|'drop', style }

  while ((match = re.exec(line)))
  {
    if (inCode(match.index))
      continue;

    if (match[1] !== undefined)
    {
      var style = fParseFontBlockOptions(match[1]);

      if (style)
        open.push({ start: match.index, end: match.index + match[0].length, style: style });
    }
    else if (open.length)
    {
      var opener = open.pop();

      edits.push({ start: opener.start, end: opener.end, kind: 'open', style: opener.style });
      edits.push({ start: match.index, end: match.index + 2, kind: 'close' });
    }
  }

  var opened = 0;

  if (open.length)
  {
    var last = open[open.length - 1];

    if (!line.slice(last.end).trim())
    {
      edits.push({ start: last.start, end: last.end, kind: 'open', style: last.style });
      opened = 1;
    }
  }

  if (!edits.length)
    return null;

  edits.sort(function(a, b) { return a.start - b.start; });

  var text = '', at = 0;

  edits.forEach
  (
    function(edit)
    {
      text += line.slice(at, edit.start);

      if (edit.kind === 'open')
      {
        text += cFontOpenMark + styles.length + cFontOpenMarkEnd;
        styles.push(edit.style);
      }
      else
        text += cFontCloseMark;

      at = edit.end;
    }
  );

  return { text: text + line.slice(at), opened: opened };
}

function fPreprocessFontBlocks(source, styles)
{
  styles = styles || [];

  if (source.indexOf('||') === -1)
    return { text: source, styles: styles };

  var lines = source.split('\n'),
      out = [],
      depth = 0,
      fence = null,
      inMath = false;

  for (var i = 0; i < lines.length; i++)
  {
    var line = lines[i],
        fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);

    if (fence)
    {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
    }
    else if (fenceMatch)
      fence = fenceMatch[1];
    else if (((line.match(/\$\$/g) || []).length) % 2 === 1)
      inMath = !inMath;

    var marker = null;

    if (!fence && !fenceMatch && !inMath)
    {
      var open = /^ {0,3}\|\|[ \t]*(?:\(([^()\n]*)\)|((?:font|size|spacing|weight)=.*?))[ \t\r]*$/i.exec(line);

      if (open)
      {
        var style = fParseFontBlockOptions(open[1] !== undefined ? open[1] : open[2]);

        if (style)
        {
          marker = cFontOpenMark + styles.length + cFontOpenMarkEnd;
          styles.push(style);
          depth++;
        }
      }
      else if (depth > 0 && /^ {0,3}\|\|[ \t\r]*$/.test(line))
      {
        marker = cFontCloseMark;
        depth--;
      }
      else if (line.indexOf('||(') !== -1)
      {
        var inline = fInlineFontMacros(line, styles);

        if (inline)
        {
          depth += inline.opened;
          out.push(inline.text);
          continue;
        }
      }
    }

    if (marker === null)
    {
      out.push(line);
      continue;
    }

    // A marker line must not be swallowed as a table row, or turn the line
    // before it into a setext heading.
    var next = lines[i + 1] || '',
        prev = out.length ? out[out.length - 1] : '';

    if (/^\s*\|/.test(prev))
      out.push('');

    out.push(marker);

    if (/^\s*\|/.test(next) || /^ {0,3}(-{2,}|={2,})[ \t\r]*$/.test(next))
      out.push('');
  }

  return { text: out.join('\n'), styles: styles };
}

function fFontRunCss(stack, styles)
{
  var merged = {},
      extra = ''; // free CSS from the document's own definitions, in order

  stack.forEach
  (
    function(index)
    {
      var style = styles[index];

      Object.keys(style).forEach
      (
        function(k)
        {
          if (k === 'css')
            extra += style.css;
          else
            merged[k] = style[k];
        }
      );
    }
  );

  return  (merged.font ? 'font-family:' + merged.font + ';' : '') +
          (merged.size ? 'font-size:' + merged.size + ';' : '') +
          (merged.spacing ? 'line-height:' + merged.spacing + ';' : '') +
          (merged.weight ? 'font-weight:' + merged.weight + ';' : '') +
          extra;
}

// text-align belongs to the block, not to a run of text inside it.
function fFontRunAlign(stack, styles)
{
  for (var i = stack.length - 1; i >= 0; i--)
    if (styles[stack[i]].align)
      return styles[stack[i]].align;

  return null;
}

function fFontRunSpacing(stack, styles)
{
  for (var i = stack.length - 1; i >= 0; i--)
    if (styles[stack[i]].spacing)
      return styles[stack[i]].spacing;

  return null;
}

function fApplyFontMarkers(html, styles)
{
  if (!styles.length || html.indexOf(cFontOpenMark) === -1)
    return html;

  var template = document.createElement('template');
  template.innerHTML = html;

  var walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT),
      nodes = [],
      node;

  while ((node = walker.nextNode()))
    nodes.push(node);

  var stack = [],
      blocks = new Map(),
      markerRe = /(\d+)|/g,
      cBlockSelector = 'p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,figcaption,nav,div';

  nodes.forEach
  (
    function(textNode)
    {
      var text = textNode.nodeValue,
          parent = textNode.parentNode,
          hasMarker = /[]/.test(text);

      if (!hasMarker && (!stack.length || !text.trim()))
        return;

      // Math, diagrams and code keep their own typography.
      var parentElement = parent.nodeType === 1 ? parent : null;

      if (!hasMarker && parentElement && parentElement.closest('.katex,.mermaid,pre,code,svg'))
        return;

      var fragment = document.createDocumentFragment(),
          last = 0,
          match,
          addRun = function(run)
          {
            if (!run)
              return;

            var runCss = stack.length ? fFontRunCss(stack, styles) : '';

            if (!runCss || !run.trim())
            {
              fragment.appendChild(document.createTextNode(run));
            }
            else
            {
              var span = document.createElement('span');
              span.setAttribute('style', runCss);
              span.textContent = run;
              fragment.appendChild(span);
            }

            if (run.trim() && parentElement)
            {
              var block = parentElement.closest(cBlockSelector);

              if (block)
              {
                if (!blocks.has(block)) blocks.set(block, []);
                blocks.get(block).push({ spacing: fFontRunSpacing(stack, styles), align: fFontRunAlign(stack, styles) });
              }
            }
          };

      markerRe.lastIndex = 0;

      while ((match = markerRe.exec(text)))
      {
        addRun(text.slice(last, match.index));
        last = match.index + match[0].length;

        if (match[1] !== undefined)
          stack.push(parseInt(match[1], 10));
        else
          stack.pop();
      }

      addRun(text.slice(last));
      parent.replaceChild(fragment, textNode);
    }
  );

  // line-height on an inline span can only ever grow a line, because the
  // paragraph's own line-height is the floor. When a whole block shares one
  // spacing, set it on the block too so smaller spacings work as well.
  blocks.forEach
  (
    function(runs, block)
    {
      if (runs[0].spacing && runs.every(function(r) { return r.spacing === runs[0].spacing; }))
        block.style.lineHeight = runs[0].spacing;

      if (runs[0].align && runs.every(function(r) { return r.align === runs[0].align; }))
        block.style.textAlign = runs[0].align;
    }
  );

  // A marker with a blank line on either side leaves an empty paragraph.
  Array.prototype.forEach.call
  (
    template.content.querySelectorAll('p'),
    function(p)
    {
      if (!p.textContent.trim() && !p.querySelector('img,input,svg,br'))
        p.parentNode.removeChild(p);
    }
  );

  return template.innerHTML;
}

// For renderers that have no document-level state (slides, diagram notes).
function fRenderMarkdownFragment(source)
{
  var pre = fPreprocessFontBlocks(source);

  return fApplyFontMarkers(marked.parser(marked.lexer(pre.text)), pre.styles);
}

// ── PAGE SETUP ([PAGE ...]) ──
// A document-level directive describing how the document looks as a page:
//   [PAGE size=A4 margin=2.5cm spacing=1.2 paragraph=0.8em fontsize=12
//         header="Lore and Chaos" footer="Chapter notes" numbers=bottom-center
//         chapter-label="Chapter" h1-size=Huge h1-center h1-bold]
// It is invisible in the exported document. Layout options apply to the
// preview and the export; header/footer/numbers/size/margin only exist on
// paper, so they take effect in the exported PDF.
var cPaperSizes = /^(a[0-9]|b[0-9]|c[0-9]|letter|legal|ledger|tabloid)$/i;
var cNumberSlots = { 'top-left': 1, 'top-center': 1, 'top-right': 1, 'bottom-left': 1, 'bottom-center': 1, 'bottom-right': 1 };

function fParsePageOptions(line)
{
  var o = { headings: {} };

  fParseDirectiveTokens(line || '').forEach
  (
    function(t)
    {
      var k = t.key, v = t.value, css, m;

      if (k === 'size' && cPaperSizes.test(v))                     o.size = /^[a-z]\d$/i.test(v) ? v.toUpperCase() : v.toLowerCase();
      else if (k === 'orientation' && /^(portrait|landscape)$/i.test(v)) o.orientation = v.toLowerCase();
      else if (k === 'landscape' && !t.hasValue)                   o.orientation = 'landscape';
      else if (k === 'margin')
      {
        var parts = v.split(/\s+/).map(fCssLengthValue);
        if (parts.length >= 1 && parts.length <= 4 && parts.every(Boolean)) o.margin = parts.join(' ');
      }
      else if (k === 'spacing' && /^\d+(\.\d+)?$/.test(v))         o.spacing = v;
      else if (k === 'paragraph' && (css = fCssLengthValue(v)))    o.paragraph = css;
      else if (k === 'indent' && (css = fCssLengthValue(v)))       o.indent = css;
      else if (k === 'fontsize' && (css = fCssSizeValue(v)))       o.fontSize = css;
      else if (k === 'header')                                     o.header = v;
      else if (k === 'footer')                                     o.footer = v;
      else if (k === 'header-align' && /^(left|center|right)$/i.test(v)) o.headerAlign = v.toLowerCase();
      else if (k === 'footer-align' && /^(left|center|right)$/i.test(v)) o.footerAlign = v.toLowerCase();
      else if (k === 'header-size' && (css = fCssSizeValue(v)))    o.headerSize = css;
      else if (k === 'footer-size' && (css = fCssSizeValue(v)))    o.footerSize = css;
      else if (k === 'numbers')
      {
        var n = v.toLowerCase();
        if (n === 'on' || n === 'true' || n === 'yes' || n === 'bottom') o.numbers = 'bottom-center';
        else if (n === 'top') o.numbers = 'top-center';
        else if (cNumberSlots[n]) o.numbers = n;
      }
      else if (k === 'newpage' && /^(h[1-6]|none)$/i.test(v))      o.newPage = v.toLowerCase();
      else if (k === 'chapter-label')                              o.chapterLabel = v || 'Chapter';
      else if (k === 'first-page')
      {
        // first-page=plain (no header, footer or number), first-page=uncounted
        // (the next page is page 1), or both: first-page=plain,uncounted
        var firsts = v.toLowerCase().split(/[,+]/);

        if (firsts.indexOf('plain') !== -1)     o.firstPagePlain = true;
        if (firsts.indexOf('uncounted') !== -1) o.firstPageUncounted = true;
      }
      else if (k === 'header-skip' || k === 'footer-skip' || k === 'numbers-skip')
      {
        // Pages that go without: first, toc, h1…h6 (a page that opens with that
        // heading; chapter is h1). e.g. header-skip=first,toc,h1
        var skips = v.toLowerCase().split(/[,+]/).map(function(w) { return w === 'chapter' ? 'h1' : w; })
                     .filter(function(w) { return /^(first|toc|h[1-6])$/.test(w); });

        if (skips.length)
          o[k === 'header-skip' ? 'headerSkip' : k === 'footer-skip' ? 'footerSkip' : 'numbersSkip'] = skips;
      }
      else if (k === 'title' && /^(off|no|false|none)$/i.test(v))  o.hideTitle = true;
      else if ((m = /^h([1-6])-(.+)$/.exec(k)))
      {
        var level = m[1], style = fDirectiveStyle(m[2], t.hasValue, v);
        if (style) o.headings[level] = (o.headings[level] || '') + style;
      }
    }
  );

  return o;
}

// "Page {page} of {pages} - {title}" -> a CSS content value for @page margin boxes.
function fMarginContent(text, title)
{
  var out = [];

  text.split(/(\{page\}|\{pages\}|\{title\})/i).forEach
  (
    function(part)
    {
      var lower = part.toLowerCase();

      if (lower === '{page}')        out.push('counter(page)');
      else if (lower === '{pages}')  out.push('counter(pages)');
      else if (lower === '{title}')  out.push(fCssString(title || ''));
      else if (part)                 out.push(fCssString(part));
    }
  );

  return out.join(' ') || '""';
}

function fCssString(text)
{
  return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

// scope: CSS selector the layout rules attach to ('#preview-content' in the
// editor, 'body' in an export). mode: 'screen' for the live preview; 'paged' when
// the export is laid out by fPaginateDocument, which draws pages itself; 'paper'
// when a CSS paged-media engine does it (the server's headless Chromium).
function fBuildPageCss(o, scope, mode, title)
{
  var css = '', body = '';

  if (o.fontSize)  body += 'font-size:' + o.fontSize + ';';
  if (o.spacing)   body += 'line-height:' + o.spacing + ';';

  if (body)
    css += scope + '{' + body + '}\n';

  if (o.paragraph)
    css += scope + ' p{margin:0 0 ' + o.paragraph + ';}\n';

  if (o.indent)
    css += scope + ' p + p{text-indent:' + o.indent + ';}\n';

  Object.keys(o.headings || {}).forEach
  (
    function(level)
    {
      css += scope + ' h' + level + '{' + o.headings[level] + '}\n';
    }
  );

  if (mode === 'paper')
  {
    var breakLevel = o.newPage || 'h1';

    if (breakLevel !== 'none')
      css += scope + ' ' + breakLevel + '{break-before:page;}\n' + scope + ' ' + breakLevel + ':first-child{break-before:auto;}\n';

    var size = [o.size, o.orientation].filter(Boolean).join(' '),
        slots = {},
        addSlot = function(name, text) { (slots[name] = slots[name] || []).push(text); };

    if (o.header) addSlot('top-' + (o.headerAlign || 'center'), fMarginContent(o.header, title));
    if (o.footer) addSlot('bottom-' + (o.footerAlign || 'center'), fMarginContent(o.footer, title));
    if (o.numbers) addSlot(o.numbers, 'counter(page)');

    var rules = '', clear = '';

    Object.keys(slots).forEach
    (
      function(name)
      {
        var top = name.indexOf('top') === 0,
            fsize = top ? o.headerSize : o.footerSize;

        rules += '@' + name + '{content:' + slots[name].join(' "  \\00b7  " ') + ';' +
                 'font-size:' + (fsize || '10pt') + ';color:#444;}';
        clear += '@' + name + '{content:none;}';
      }
    );

    if (size || o.margin || rules)
      css += '@page{' + (size ? 'size:' + size + ';' : '') + (o.margin ? 'margin:' + o.margin + ';' : '') + rules + '}\n';

    if (o.firstPagePlain && rules)
      css += '@page :first{' + clear + '}\n';
  }

  return css;
}

var docPageSettings = {};
var chapterRenderCount = 0;

// The one place a document is turned into HTML: resets the per-render state
// the extensions rely on (heading ids, task checkboxes, chapter counter, [PAGE]
// settings), lexes, collects headings, and parses.
function fRenderMarkdownDoc(source)
{
  documentHeadings = [];
  slugCounts = {};
  headingRenderCursor = 0;
  checkboxRenderIndex = 0;
  chapterRenderCount = 0;
  docPageSettings = { headings: {} };

  // Definitions at the top of the file (see doc-definitions.js) become the same
  // markers the font blocks use, so both share one style table.
  var styles = [],
      definitions = fParseDocumentDefinitions(source),
      pre = fPreprocessFontBlocks(definitions ? fExpandDefinitions(definitions, styles) : source, styles),
      tokens = marked.lexer(pre.text);

  // The TOC adds font-only styles to this same table (see fRenderTOC).
  fontStyleTable = pre.styles;
  tocFontIndexByCss = {};

  fCollectHeadings(tokens, []);

  // Looks inside wrappers, so a centered "# Title" counts as opening with a title.
  var first = tokens.filter(function(t) { return t.type !== 'space' && t.type !== 'pageSetup'; })[0];

  while (first && first.type !== 'heading' && first.tokens && first.tokens.length)
    first = first.tokens.filter(function(t) { return t.type !== 'space'; })[0];

  var result =  {
                  html: fApplyFontMarkers(marked.parser(tokens), pre.styles),
                  settings: docPageSettings,
                  startsWithTitle: !!(first && first.type === 'heading' && first.depth === 1)
                };

  // Other renderers (slides, diagrams) share the heading renderer; don't let
  // this document's chapter-label setting leak into them.
  docPageSettings = { headings: {} };

  return result;
}

// ── PDF SPACING (\\ , \\N , {fill} , {space}) ──
// Space that only exists on paper, written the same three ways as a page break:
// a line of its own, or an attribute on a heading (where it goes before it).
//   fixed   \\ or \\2cm      {space} or {space=2cm}     LaTeX \vspace
//   fill    \\1 or \\1.5     {fill} or {fill=1.5}       LaTeX \vfill
// Fills on one page split what is left of it in proportion to their weights, so
// "\\1 / title / \\1" centres the title and "\\1 / text" sets it at the bottom.
var cDefaultSpace = '1.5em';

// Returns the markup for one spacer. `amount` is '' (the default), a length
// ("2cm") or, for a fill, a bare weight ("1.5"). `kind` says which an empty or
// bare value means: 'space' (a default length) or 'fill' (weight 1).
function fPdfSpaceHtml(amount, kind)
{
  var bare = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(amount);

  // From a "\\N" line a bare number is a fill; from {space=N} it is em.
  if (kind === 'space' && bare)
    return '<div class="pdf-fill" data-fill="' + parseFloat(amount) + '" style="height:0"></div>\n';
  if (kind === 'fill')
    return '<div class="pdf-fill" data-fill="' + (bare ? parseFloat(amount) : 1) + '" style="height:0"></div>\n';

  var length = !amount ? cDefaultSpace : (fCssLengthValue(amount) || cDefaultSpace);
  return '<div class="pdf-space" style="height:' + length + '"></div>\n';
}

var checkboxRenderIndex = 0;

// ── MATH (KaTeX) ──
// LaTeX-style formulas in Documents: $inline$ and $$display$$ blocks render
// through the vendored KaTeX build. Registered as marked tokenizers (not a
// post-pass) so markdown emphasis rules never mangle the TeX source.

function fKatexRenderTex(tex, displayMode)
{
  if (typeof katex === 'undefined')
    return '<code>' + fEscHtml(tex) + '</code>';
  try { return katex.renderToString(tex, { displayMode: displayMode, throwOnError: false }); }
  catch(e) { return '<code>' + fEscHtml(tex) + '</code>'; }
}

var mathBlockExtension =
{
  name: 'mathBlock',
  level: 'block',
  start: function(src) { var i = src.indexOf('$$'); return i === -1 ? undefined : i; },
  tokenizer: function(src)
  {
    var m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
  },
  renderer: function(token) { return '<div class="math-block">' + fKatexRenderTex(token.text, true) + '</div>\n'; }
};

var mathInlineExtension =
{
  name: 'mathInline',
  level: 'inline',
  start: function(src) { var i = src.indexOf('$'); return i === -1 ? undefined : i; },
  tokenizer: function(src)
  {
    // Pandoc-style guard against currency ("$5 and $10"): the TeX must not
    // start or end with whitespace, and the closing $ can't precede a digit.
    var m = /^\$(?!\s)((?:\\\$|[^$\n])+?)\$(?!\d)/.exec(src);
    if (m && !/\s$/.test(m[1])) return { type: 'mathInline', raw: m[0], text: m[1].replace(/\\\$/g, '$') };
  },
  renderer: function(token) { return fKatexRenderTex(token.text, false); }
};

// marked asks every block extension "where in this text could you start?" for
// each paragraph, handing over everything left of the document. A search that
// runs to the end of a megabyte each time makes lexing quadratic: a 1 MB
// document spent 4 s in the lexer and 25 ms rendering. A paragraph ends at the
// first blank line, so nothing past it can interrupt it, and the search is cut
// there. (A block that begins right after a blank line is found by its
// tokenizer, which never uses start().)
function fBoundExtensionStart(extension)
{
  if (extension.level !== 'block' || typeof extension.start !== 'function')
    return extension;

  var start = extension.start;

  extension.start = function(src)
  {
    var end = src.indexOf('\n\n');

    return start.call(this, end === -1 ? src : src.slice(0, end + 1));
  };
  extension.start.unbounded = start; // for comparing the two in tests

  return extension;
}

function fConfigureMarkedExtensions()
{
  if (typeof marked === 'undefined')
    return;

  marked.use({ extensions: [mathBlockExtension, mathInlineExtension].map(fBoundExtensionStart) });

  marked.use
  (
    {
      renderer:
      {
        heading: function(text, level)
        {
          var entry = documentHeadings[headingRenderCursor],
              id = '';

          if (entry)
          {
            id = entry.slug;
            headingRenderCursor++;
          }

          // Trailing "{size=... center}" formats just this heading.
          // (Parsed from the plain text at collection time: in the rendered HTML a
          // "#a00" colour would already have been turned into a tag pill.)
          var parts = entry ? { tokens: entry.tokens, style: entry.style } : { tokens: [], style: '' },
              label = '',
              classes = [];

          if (level === 1 && docPageSettings.chapterLabel && !fHasToken(parts.tokens, 'nolabel'))
          {
            chapterRenderCount++;
            label = '<span class="chapter-label">' + fEscHtml(docPageSettings.chapterLabel + ' ' + chapterRenderCount) + '</span>';
          }

          if (fHasToken(parts.tokens, 'pagebreak'))   classes.push('force-break');
          if (fHasToken(parts.tokens, 'nopagebreak')) classes.push('no-break');

          // {fill} / {space} put that spacer before the heading.
          var spacers = '';
          parts.tokens.forEach(function(t)
          {
            if (t.key === 'fill')
              spacers += fPdfSpaceHtml(t.hasValue ? t.value : '', 'fill');
            else if (t.key === 'space')
            {
              // {space=2} means 2em here; a unit makes it a length.
              var amount = t.hasValue && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t.value) ? t.value + 'em' : (t.hasValue ? t.value : '');
              spacers += fPdfSpaceHtml(amount, 'heading-space');
            }
          });

          return spacers + '<h' + level + (id ? (' id="' + id + '"') : '') +
                 (classes.length ? ' class="' + classes.join(' ') + '"' : '') +
                 (parts.style ? ' style="' + parts.style + '"' : '') + '>' +
                 label + (parts.tokens.length ? text.replace(/\s*\{[^{}]*\}\s*$/, '') : text) + '</h' + level + '>\n';
        },
        code: function(code, infostring)
        {
          var lang = (infostring || '').match(/^\S*/);
          lang = lang ? lang[0].toLowerCase() : '';

          // Mermaid blocks render to a live diagram instead of a literal code
          // block; returning false for any other language falls back to
          // marked's default <pre><code> rendering.
          if (lang !== 'mermaid')
            return false;

          return '<div class="mermaid">' + fEscHtml(code.replace(/\n$/, '')) + '\n</div>\n';
        },
        checkbox: function(checked)
        {
          var idx = checkboxRenderIndex++;
          return '<input type="checkbox" class="preview-checkbox" data-idx="' + idx + '"' + (checked ? ' checked' : '') + '>';
        },
        image: function(href, title, text)
        {
          if (!href || href.indexOf(cFileLinkScheme) !== 0)
            return false;

          var id = decodeURIComponent(href.slice(cFileLinkScheme.length)),
              file = files[id];

          if (!file)
            return '<div class="embed-missing">' + fEscHtml('[File not found: ' + (text || id) + ']') + '</div>';

          if (file.type === 'graph')
          {
            var mermaidMatch = /```mermaid\n([\s\S]*?)```/i.exec(file.content || '');
            if (!mermaidMatch)
              return '<div class="embed-missing">' + fEscHtml('[No diagram in: ' + file.name + ']') + '</div>';
            return  '<figure class="embed-graph">' +
                      '<div class="mermaid">' + fEscHtml(mermaidMatch[1].replace(/\n$/, '')) + '</div>' +
                      (text ? '<figcaption class="embed-caption">' + fEscHtml(text) + '</figcaption>' : '') +
                    '</figure>';
          }

          if (file.type === 'sheet')
          {
            var defs = fParseSheetChartsFromContent(file.content || '');
            if (!defs.length)
              return '<div class="embed-missing">' + fEscHtml('[No charts in: ' + file.name + ']') + '</div>';
            var cells = fParseSheetCellsForEmbed(file.content || '');
            return  '<figure class="embed-sheet">' +
                      defs.map(function(def)
                      {
                        try
                        {
                          var config = fBuildChartJsConfigFromCells(def, cells);
                          return '<div class="embed-sheet-chart" data-chart-config="' + fEscAttr(JSON.stringify(config)) + '"><canvas></canvas></div>';
                        }
                        catch(e) { return ''; }
                      }).join('') +
                      (text ? '<figcaption class="embed-caption">' + fEscHtml(text) + '</figcaption>' : '') +
                    '</figure>';
          }

          return false;
        }
      },
      extensions:
      [
        {
          // The one-line form of the alignment symbols and of the ::: keyword
          // form, the symbol repeated after the text:
          //   ;; centered ;;            ;;; justified ;;;
          //   :::(center bold) text :::   options go in parentheses, no space before them
          // Tried before the block forms below, which it would otherwise
          // collide with (":::(...)" and "::: text :::" both open a ::: block).
          name: 'alignOneLine',
          level: 'block',
          start: function(src)
          {
            var match = /^(?:::(?!:)|:::(?!:)|;;(?!;)|;;;(?!;))(?:\([^()\n]*\)[ \t]*|[ \t]+)\S[^\n]*?[ \t]+(?:::|;;)[ \t]*$/m.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^(::(?!:)|:::(?!:)|;;(?!;)|;;;(?!;))(?:\(([^()\n]*)\)[ \t]*|[ \t]+)(\S[^\n]*?)[ \t]+\1[ \t]*(?:\n+|$)/.exec(src);

            if (!match)
              return undefined;

            var align = { '::': 'left', ':::': 'right', ';;': 'center', ';;;': 'justify' }[match[1]],
                extra = match[2] !== undefined ? fParseBlockDirectives(match[2]) : '';

            if (match[2] !== undefined && !extra)
              return undefined;

            return  {
                      type: 'alignOneLine',
                      raw: match[0],
                      style: 'text-align:' + align + ';' + extra,
                      tokens: this.lexer.blockTokens(match[3], [])
                    };
          },
          renderer: function(token)
          {
            return '<div style="' + token.style + '">\n' + this.parser.parse(token.tokens) + '</div>\n';
          }
        },
        {
          name: 'styledBlock',
          level: 'block',
          start: function(src)
          {
            var match = /^:::[ \t]*\S[^\n]*$/m.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^:::[ \t]*(\S[^\n]*)\n([\s\S]*?)\n:::(?:\n+|$)/.exec(src),
                style = match ? fParseBlockDirectives(match[1]) : '';

            if (!match || !style)
              return undefined;

            return  {
                      type: 'styledBlock',
                      raw: match[0],
                      style: style,
                      tokens: this.lexer.blockTokens(match[2], [])
                    };
          },
          renderer: function(token)
          {
            return '<div style="' + token.style + '">\n' + this.parser.parse(token.tokens) + '</div>\n';
          }
        },
        {
          // Bare-symbol alignment blocks (see ALIGN_BLOCK_SYMBOLS near fWrapBlock,
          // which is what writes these). The symbol must be alone on its line -
          // no trailing text - and the closer must repeat the exact same symbol
          // (matched via the \1 backreference), so this never collides with the
          // ":::keyword" form above (which always requires extra text after :::).
          name: 'alignSymbolBlock',
          level: 'block',
          start: function(src)
          {
            var match = /^(?:::(?!:)|:::(?!:)|;;(?!;)|;;;(?!;))[ \t]*$/m.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^(::(?!:)|:::(?!:)|;;(?!;)|;;;(?!;))[ \t]*\n([\s\S]*?)\n\1[ \t]*(?:\n+|$)/.exec(src);

            if (!match)
              return undefined;

            var align = { '::': 'left', ':::': 'right', ';;': 'center', ';;;': 'justify' }[match[1]];

            return  {
                      type: 'alignSymbolBlock',
                      raw: match[0],
                      style: 'text-align:' + align + ';',
                      tokens: this.lexer.blockTokens(match[2], [])
                    };
          },
          renderer: function(token)
          {
            return '<div style="' + token.style + '">\n' + this.parser.parse(token.tokens) + '</div>\n';
          }
        },
        {
          // Inline formatting: [text]{size=Huge}, [text]{size=24 color=#a00 bold}.
          // Fonts are the one thing this can't do: see fPreprocessFontBlocks.
          name: 'styleSpan',
          level: 'inline',
          start: function(src)
          {
            var match = /\[[^\]\n]+\]\{(?:size|color|bold|bolder|lighter|normal|weight|stroke|italic|underline|smallcaps|tracking)\b/i.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^\[([^\]\n]+)\]\{([^{}\n]*)\}/.exec(src);

            if (!match || !cInlineAttrKeys.test(match[2].trim()))
              return undefined;

            var style = fParseBlockDirectives(match[2]);

            if (!style)
              return undefined;

            return  {
                      type: 'styleSpan',
                      raw: match[0],
                      style: style,
                      tokens: this.lexer.inlineTokens(match[1])
                    };
          },
          renderer: function(token)
          {
            return '<span style="' + token.style + '">' + this.parser.parseInline(token.tokens) + '</span>';
          }
        },
        {
          // [TOC] or [TOC title="Contents:" size=Large center numbers=on depth=2]
          name: 'tocBlock',
          level: 'block',
          start: function(src)
          {
            var match = /^\[TOC(?:[ \t][^\]\n]*)?\][ \t]*$/im.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^\[TOC(?:[ \t]+([^\]\n]*))?\][ \t]*(?:\n+|$)/i.exec(src);
            return match ? { type: 'tocBlock', raw: match[0], opts: match[1] || '' } : undefined;
          },
          renderer: function(token)
          {
            return fRenderTOC(token.opts);
          }
        },
        {
          // A line holding just \\\ : a new page in the PDF, nothing at all on screen.
          name: 'pdfPageBreak',
          level: 'block',
          start: function(src)
          {
            var match = /^ {0,3}\\\\\\[ \t]*$/m.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^ {0,3}\\\\\\[ \t]*(?:\n+|$)/.exec(src);
            return match ? { type: 'pdfPageBreak', raw: match[0] } : undefined;
          },
          renderer: function()
          {
            return '<div class="page-break pdf-only"></div>\n';
          }
        },
        {
          // A line holding two backslashes and an optional amount, PDF only
          // (nothing shows on screen):
          //   \\        a fixed vertical space, one blank line (LaTeX \vspace)
          //   \\2cm     a fixed vertical space of that size
          //   \\1.5     flexible space with weight 1.5, which shares what is left of
          //             the page with the other fills on it (LaTeX \vfill)
          // A number with no unit is a fill weight; one with a unit is a length.
          // Three backslashes stay the page break above.
          name: 'pdfSpace',
          level: 'block',
          start: function(src)
          {
            var match = /^ {0,3}\\\\(?!\\)/m.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^ {0,3}\\\\((?:\d+(?:\.\d+)?|\.\d+)(?:pt|px|em|rem|cm|mm|in)?)?[ \t]*(?:\n+|$)/.exec(src);
            return match ? { type: 'pdfSpace', raw: match[0], amount: match[1] || '' } : undefined;
          },
          renderer: function(token)
          {
            return fPdfSpaceHtml(token.amount, 'space');
          }
        },
        {
          // [PAGE size=A4 margin=2.5cm ...]: document-wide page layout; see fParsePageOptions.
          name: 'pageSetup',
          level: 'block',
          start: function(src)
          {
            var match = /^\[PAGE[ \t][^\]\n]*\][ \t]*$/im.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^\[PAGE[ \t]+([^\]\n]*)\][ \t]*(?:\n+|$)/i.exec(src);
            return match ? { type: 'pageSetup', raw: match[0], opts: match[1] } : undefined;
          },
          renderer: function(token)
          {
            return '<div class="page-setup-note">Page setup: ' + fEscHtml(token.opts.trim()) + '</div>\n';
          }
        },
        {
          // Roman-numeral ordered lists: consecutive lines like "i. item" or
          // "II) item" render as a real <ol> with roman markers (lowercase
          // and uppercase are separate lists). Arabic "1." lists are standard
          // Markdown and unchanged. A lone item only counts when it starts
          // at i/I, so abbreviations like "c. 1450" stay plain text.
          name: 'romanList',
          level: 'block',
          start: function(src)
          {
            var m = /^ {0,3}[ivxlcdmIVXLCDM]+[.)][ \t]/m.exec(src);
            return m ? m.index : undefined;
          },
          tokenizer: function(src)
          {
            var itemRe = /^ {0,3}([ivxlcdm]+|[IVXLCDM]+)[.)][ \t]+([^\n]*)(?:\n|$)/,
                rest = src,
                raw = '',
                items = [],
                lower = null,
                startNum = 0;

            while (true)
            {
              var m = itemRe.exec(rest);
              if (!m) break;

              var isLower = m[1] === m[1].toLowerCase();
              if (lower === null) lower = isLower;
              else if (lower !== isLower) break; // case switch = new list

              var value = fRomanToInt(m[1]);
              if (!value) break;
              if (!items.length) startNum = value;

              raw += m[0];
              items.push(m[2]);
              rest = rest.slice(m[0].length);
            }

            if (!items.length) return undefined;
            if (items.length === 1 && startNum !== 1) return undefined;

            var lexer = this.lexer;
            return {
              type: 'romanList',
              raw: raw,
              lower: lower,
              startNum: startNum,
              items: items.map(function(text){ return lexer.inlineTokens(text); })
            };
          },
          renderer: function(token)
          {
            var parser = this.parser;
            return '<ol style="list-style-type:' + (token.lower ? 'lower-roman' : 'upper-roman') + ';" start="' + token.startNum + '">' +
                   token.items.map(function(tokens){ return '<li>' + parser.parseInline(tokens) + '</li>'; }).join('') +
                   '</ol>\n';
          }
        },
        {
          // Doc metadata fields: key: value pairs in braces, rendered as a
          // styled card. One line — {type: Character, status: Active} — lays
          // the fields out side by side; putting the braces on their own
          // lines with one "key: value," per line renders the same card
          // vertically, one field per row.
          name: 'docFields',
          level: 'block',
          start: function(src)
          {
            var m = /^\{/m.exec(src);
            return m ? m.index : undefined;
          },
          tokenizer: function(src)
          {
            // Single-line form: everything inside one pair of braces.
            var match = /^\{([^{}\n]+)\}[ \t]*(?:\n|$)/.exec(src);
            if (match)
            {
              var pairs = [];
              match[1].split(',').forEach(function(part)
              {
                var colon = part.indexOf(':');
                if (colon > -1)
                {
                  var key = part.slice(0, colon).trim(),
                      val = part.slice(colon + 1).trim();
                  if (key) pairs.push({ key: key, value: val });
                }
              });

              if (!pairs.length) return undefined;

              return { type: 'docFields', raw: match[0], pairs: pairs, vertical: false };
            }

            // Multi-line form: '{' alone on its line, one pair per line, '}'
            // alone on its line. Every non-empty inner line must look like
            // "key: value" (trailing comma optional) — anything else is left
            // for other tokenizers, so stray braced text stays untouched.
            match = /^\{[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\}[ \t]*(?:\r?\n|$)/.exec(src);
            if (!match) return undefined;

            var vPairs = [], valid = true;

            match[1].split('\n').forEach(function(line)
            {
              var text = line.trim().replace(/,+$/, '');
              if (!text) return;

              var colon = text.indexOf(':');
              if (colon < 1) { valid = false; return; }

              vPairs.push({ key: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() });
            });

            if (!valid || !vPairs.length) return undefined;

            return { type: 'docFields', raw: match[0], pairs: vPairs, vertical: true };
          },
          renderer: function(token)
          {
            if (token.vertical)
            {
              return '<div class="doc-fields doc-fields-vertical">' +
                     token.pairs.map(function(p)
                     {
                       return '<b class="doc-field-key">' + fEscHtml(p.key) + '</b><span class="doc-field-value">' + fEscHtml(p.value) + '</span>';
                     }).join('') +
                     '</div>\n';
            }

            return '<div class="doc-fields">' +
                   token.pairs.map(function(p)
                   {
                     return '<span class="doc-field"><b>' + fEscHtml(p.key) + '</b> ' + fEscHtml(p.value) + '</span>';
                   }).join('') +
                   '</div>\n';
          }
        },
        {
          // Inline doc tag: #tagname renders as a clickable pill that filters the sidebar.
          // Only matches #word (no space after #), so it never collides with headings.
          name: 'docTag',
          level: 'inline',
          start: function(src) { return src.indexOf('#'); },
          tokenizer: function(src)
          {
            var match = /^#([\w-]+)/.exec(src);
            return match ? { type: 'docTag', raw: match[0], tag: match[1] } : undefined;
          },
          renderer: function(token)
          {
            return '<span class="doc-tag" onclick="fFilterByTag(\'' + fEscAttr(token.tag) + '\')">#' + fEscHtml(token.tag) + '</span>';
          }
        }
      ].map(fBoundExtensionStart)
    }
  );
}

fConfigureMarkedExtensions();

// Loose roman-numeral parser for the romanList extension: subtractive
// notation handled, 0 returned for anything that isn't roman.
function fRomanToInt(text)
{
  var values = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 },
      total = 0,
      prev = 0;

  text = text.toLowerCase();

  for (var k = text.length - 1; k >= 0; k--)
  {
    var v = values[text[k]];
    if (!v) return 0;

    if (v < prev)
      total -= v;
    else
    {
      total += v;
      prev = v;
    }
  }

  return (total > 0 && total < 4000) ? total : 0;
}

function fConfigureMermaid()
{
  if (typeof mermaid === 'undefined')
    return;

  mermaid.initialize({ startOnLoad: false });
}

fConfigureMermaid();

function fExtractPlainText(tokens)
{
  if (!tokens || !tokens.length)
    return '';

  return tokens.map
  (
    function(token)
    {
      return token.tokens ? fExtractPlainText(token.tokens) : (token.text || token.raw || '');
    }
  ).join('');
}

function fMakeSlug(text)
{
  // Font markers (and the style number inside them) are not part of a name.
  var base = text.replace(/\uE000\d+\uE001|\uE002/g, '')
                  .toLowerCase()
                  .trim()
                  .replace(/[^a-z0-9\s-]/g, '')
                  .replace(/\s+/g, '-')
                  .replace(/-+/g, '-')
                  .replace(/^-|-$/g, '') || 'section';

  var count = slugCounts[base] || 0;
  slugCounts[base] = count + 1;

  return count === 0 ? base : (base + '-' + count);
}

// The font blocks open around each heading, read from the markers in the
// tokens before it, so the TOC can show an entry in its heading's font.
function fAdvanceFontStack(stack, raw)
{
  var re = /\uE000(\d+)\uE001|\uE002/g,
      match;

  while ((match = re.exec(raw || '')))
  {
    if (match[1] !== undefined)
      stack.push(parseInt(match[1], 10));
    else
      stack.pop();
  }
}

function fCollectHeadings(tokens, stack)
{
  stack = stack || [];

  tokens.forEach
  (
    function(token)
    {
      if (token.type === 'pageSetup')
      {
        var opts = fParsePageOptions(token.opts);
        Object.keys(opts.headings).forEach(function(l) { docPageSettings.headings[l] = (docPageSettings.headings[l] || '') + opts.headings[l]; });
        Object.keys(opts).forEach(function(k) { if (k !== 'headings') docPageSettings[k] = opts[k]; });
      }
      else if (token.type === 'heading')
      {
        var parts = fSplitHeadingAttrs(fExtractPlainText(token.tokens)),
            text = parts.text;

        documentHeadings.push
        (
          {
            depth: token.depth,
            text: text,
            slug: fMakeSlug(text),
            tokens: parts.tokens,
            style: parts.style,
            inToc: !fHasToken(parts.tokens, 'notoc'),
            fontStack: stack.slice()
          }
        );
      }
      else if (token.type === 'list')
      {
        token.items.forEach
        (
          function(item)
          {
            fCollectHeadings(item.tokens, stack.slice());
          }
        );
      }
      else if (token.tokens)
      {
        fCollectHeadings(token.tokens, stack.slice());
      }

      fAdvanceFontStack(stack, token.raw);
    }
  );
}

// An entry in the TOC takes the font of its heading, and only the font: a
// 40pt title does not make a 40pt contents line.
function fTocFontIndex(styleIndex)
{
  var css = (fontStyleTable[styleIndex] || {}).font || '';

  if (!(css in tocFontIndexByCss))
  {
    fontStyleTable.push(css ? { font: css } : {});
    tocFontIndexByCss[css] = fontStyleTable.length - 1;
  }

  return tocFontIndexByCss[css];
}

function fTocEntryHtml(h)
{
  // Inline ||(font=…) text|| inside the heading keeps its markers; restyle them.
  var html = fEscHtml(h.text).replace(/\uE000(\d+)\uE001/g, function(all, index)
  {
    return cFontOpenMark + fTocFontIndex(parseInt(index, 10)) + cFontOpenMarkEnd;
  });

  // Blocks around the heading (||font=… / # Title / ||).
  var around = (h.fontStack || []).filter(function(index) { return (fontStyleTable[index] || {}).font; });

  return around.map(function(index) { return cFontOpenMark + fTocFontIndex(index) + cFontOpenMarkEnd; }).join('') +
         html +
         around.map(function() { return cFontCloseMark; }).join('');
}

function fRenderTOC(optionText)
{
  var opts = {};

  fParseDirectiveTokens(optionText || '').forEach(function(t) { opts[t.key] = t; });

  var entries = documentHeadings.filter(function(h) { return h.inToc !== false; });

  if (opts.depth && /^[1-6]$/.test(opts.depth.value))
  {
    var maxDepth = parseInt(opts.depth.value, 10);
    entries = entries.filter(function(h) { return h.depth <= maxDepth; });
  }

  if (!entries.length)
    return '<div class="toc toc-empty">No headings yet.</div>';

  // [TOC pages] (or pages=on) adds the page each entry is on, flush right, in
  // a PDF. leader=none drops the dots between title and number.
  var withPages = !!opts.pages && (!opts.pages.hasValue || /^(on|true|yes)$/i.test(opts.pages.value)),
      leaders = !(opts.leader && /^(none|off|no)$/i.test(opts.leader.value));

  if (withPages)
    docPageSettings.tocPages = true;

  var style = fParseBlockDirectives((optionText || '').replace(/\b(?:title|numbers|depth|pages|leader)=("[^"]*"|'[^']*'|\S+)/gi, '')),
      numbered = opts.numbers && /^(on|true|yes)$/i.test(opts.numbers.value),
      counters = [0, 0, 0, 0, 0, 0, 0],
      minDepth = entries.reduce(function(min, h) { return Math.min(min, h.depth); }, entries[0].depth);

  var html = '<nav class="toc' + (withPages ? ' toc-with-pages' : '') + (withPages && !leaders ? ' toc-no-leader' : '') + '"' + (style ? ' style="' + style + '"' : '') + '>',
      openDepth = minDepth - 1;

  if (opts.title && opts.title.value)
    html += '<div class="toc-title">' + fEscHtml(opts.title.value) + '</div>';

  entries.forEach
  (
    function(h)
    {
      while (openDepth < h.depth)
      {
        html += '<ul>';
        openDepth++;
      }

      while (openDepth > h.depth)
      {
        html += '</ul>';
        openDepth--;
      }

      var number = '';

      if (numbered)
      {
        counters[h.depth]++;
        for (var d = h.depth + 1; d < counters.length; d++) counters[d] = 0;
        number = '<span class="toc-num">' + counters.slice(minDepth, h.depth + 1).join('.') + '</span> ';
      }

      html += withPages
        ? '<li><a href="#' + h.slug + '"><span class="toc-title">' + number + fTocEntryHtml(h) + '</span><span class="toc-leader"></span><span class="toc-page" data-toc-target="' + h.slug + '"></span></a></li>'
        : '<li><a href="#' + h.slug + '">' + number + fTocEntryHtml(h) + '</a></li>';
    }
  );

  while (openDepth >= minDepth)
  {
    html += '</ul>';
    openDepth--;
  }

  html += '</nav>';

  return html;
}

// Brings the preview up to date by replacing only the blocks that changed.
// Typing touches one place, so the blocks before and after it are left alone:
// no re-parse, no re-layout, and an unchanged diagram, formula or chart keeps
// what it had drawn. The unchanged stretch at each end is found by comparing
// the new blocks with the live ones; everything between is swapped.
function fSameBlock(live, fresh)
{
  if (live.nodeType !== fresh.nodeType)
    return false;

  // A rendered diagram no longer looks like its source; compare by the source
  // it was drawn from.
  if (live.nodeType === 1 && live.classList.contains('mermaid') && fresh.classList.contains('mermaid'))
    return live.getAttribute('data-mermaid-src') === fresh.textContent;

  return live.isEqualNode(fresh);
}

function fPatchPreview(container, html)
{
  var template = document.createElement('template');

  template.innerHTML = html;

  var fresh = Array.prototype.slice.call(template.content.childNodes),
      live = Array.prototype.slice.call(container.childNodes),
      head = 0,
      freshEnd = fresh.length,
      liveEnd = live.length;

  while (head < freshEnd && head < liveEnd && fSameBlock(live[head], fresh[head]))
    head++;

  while (freshEnd > head && liveEnd > head && fSameBlock(live[liveEnd - 1], fresh[freshEnd - 1]))
  {
    freshEnd--;
    liveEnd--;
  }

  var before = liveEnd < live.length ? live[liveEnd] : null;

  for (var i = head; i < liveEnd; i++)
    container.removeChild(live[i]);

  for (var j = head; j < freshEnd; j++)
    container.insertBefore(fresh[j], before);
}

function fUpdatePreview(deferBacklinks)
{
  // A direct call supersedes any queued typing refresh.
  if (previewTimer !== null)
  {
    clearTimeout(previewTimer);
    previewTimer = null;
  }

  document.getElementById('preview-title').textContent = document.getElementById('doc-title-input').value;

  var source = document.getElementById('editor').value,
      html = source;

  var pageCss = '';

  if (typeof marked !== 'undefined')
  {
    var rendered = fRenderMarkdownDoc(source);

    html = rendered.html;
    pageCss = fBuildPageCss(rendered.settings, '#preview-content', 'screen');
  }

  fSetPreviewPageStyle(pageCss);

  var previewContent = document.getElementById('preview-content');
  fPatchPreview(previewContent, fSanitizeHtml(html));
  fRenderMermaidDiagrams(previewContent);
  fRenderEmbeddedSheetCharts(previewContent);

  clearTimeout(backlinkTimer);

  if (deferBacklinks)
    backlinkTimer = setTimeout(fRenderPreviewBacklinks, 1500);
  else
    fRenderPreviewBacklinks();

  if (typeof fFrAfterPreviewRender === 'function')
    fFrAfterPreviewRender();
}

// The [PAGE ...] layout options (fonts, spacing, heading styles) restyle the
// live preview through one <style> element that is rewritten on each render.
function fSetPreviewPageStyle(css)
{
  var tag = document.getElementById('doc-page-style');

  if (!tag)
  {
    if (!css)
      return;

    tag = document.createElement('style');
    tag.id = 'doc-page-style';
    document.head.appendChild(tag);
  }

  if (tag.textContent !== css)
    tag.textContent = css;
}

function fRenderPreviewBacklinks()
{
  var panel = document.getElementById('preview-backlinks');
  if (!panel) return;
  if (!currentFileId) { panel.style.display = 'none'; return; }

  // Merge persisted index with live scan of loaded content
  var indexed = (backlinksIndex[currentFileId] || []).filter(function(id) { return !!files[id]; });
  var live    = fComputeBacklinks(currentFileId).map(function(r) { return r.id; });
  var allIds  = indexed.slice();
  live.forEach(function(id) { if (allIds.indexOf(id) < 0) allIds.push(id); });

  if (!allIds.length) { panel.style.display = 'none'; return; }

  panel.style.display = '';
  panel.innerHTML =
    '<div class="pbl-header">' +
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3"/><path d="M10 2h4v4"/><line x1="14" y1="2" x2="7" y2="9"/></svg>' +
      'Mentioned in' +
    '</div>' +
    '<div class="pbl-list">' +
      allIds.map(function(id)
      {
        var f = files[id];
        return '<div class="pbl-item" onclick="fOpenFile(\'' + fEscAttr(id) + '\')">' +
          '<span class="pbl-icon">' + fFileTypeIcon(f.type) + '</span>' +
          '<span class="pbl-name">' + fEscHtml(f.name) + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
}

function fUpdateStatus()
{
  var text = document.getElementById('editor').value;
  var words = text.trim() ? text.trim().split(/\s+/).length : 0;

  document.getElementById('word-count').textContent = words;
  document.getElementById('char-count').textContent = text.length;
}

document.getElementById('editor').addEventListener
(
  'keyup',
  function(target)
  {
    var editor = target.target;
    // Count newlines up to the caret without splitting the whole prefix.
    var caret = editor.selectionStart,
        line = 1,
        lineStart = 0,
        nl = -1;

    while ((nl = editor.value.indexOf('\n', nl + 1)) !== -1 && nl < caret)
    {
      line++;
      lineStart = nl + 1;
    }

    document.getElementById('cursor-pos').textContent = 'Ln ' + line + ', Col ' + (caret - lineStart + 1);
  }
);

function fHandleEditorKey(keyEvent)
{
  docTextUndo.fNoteKeydown(keyEvent);

  if (keyEvent.ctrlKey || keyEvent.metaKey)
  {
    if (!keyEvent.shiftKey && keyEvent.key.toLowerCase() === 'z')
    {
      keyEvent.preventDefault();

      if (docTextUndo.undo())
        fOnEditorChange();

      return;
    }

    if (keyEvent.key.toLowerCase() === 'y' || (keyEvent.shiftKey && keyEvent.key.toLowerCase() === 'z'))
    {
      keyEvent.preventDefault();

      if (docTextUndo.redo())
        fOnEditorChange();

      return;
    }

    if (keyEvent.key === 'b')
    {
      keyEvent.preventDefault();
      fWrapSelectedText('**','**');
    }

    if (keyEvent.key === 'i')
    {
      keyEvent.preventDefault();
      fWrapSelectedText('*','*');
    }

    if (keyEvent.key === 's')
    {
      keyEvent.preventDefault();
      fSaveToStorage();
    }
  }

  if (keyEvent.key === 'Tab')
  {
    keyEvent.preventDefault();

    var target = keyEvent.target,
        startSelection = target.selectionStart;

    target.value = target.value.slice(0, startSelection) + '  ' + target.value.slice(target.selectionEnd);
    target.selectionStart = target.selectionEnd = startSelection + 2;
    fOnEditorChange();
  }
}

document.addEventListener
(
  'keydown',
  function(keyEvent)
  {
    if ((keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key==='n')
    {
      keyEvent.preventDefault();
      fOpenNewModal();
    }

    if (keyEvent.key === 'Escape')
    {
      var functionHelpPanel = document.getElementById('function-help-panel');

      if (functionHelpPanel)
        functionHelpPanel.classList.remove('open');
    }
  }
);
