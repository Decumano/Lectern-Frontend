// Documents: editor, markdown extensions, math
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── DOC ──
var docTextUndo = makeTextUndo(function(){ return document.getElementById('editor'); });

function loadDocFile(file)
{
  docTextUndo.reset();
  document.getElementById('doc-title-input').value = file.name;
  document.getElementById('editor').value = file.content || '';
  document.getElementById('toolbar-title').innerHTML = '<span>' + escHtml(file.name) + '</span>';
  updatePreview();
  updateStatus();
}

function onDocTitleChange()
{
  if ((!currentFileId) || (files[currentFileId].type !== 'doc'))
    return;

  files[currentFileId].name = (document.getElementById('doc-title-input').value || files[currentFileId].name);
  document.getElementById('toolbar-title').innerHTML = '<span>' + escHtml(files[currentFileId].name) + '</span>';
  scheduleSave();
  renderFileList();
}

function onEditorChange()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'doc')
    return;

  files[currentFileId].content = document.getElementById('editor').value;

  updatePreview();
  updateStatus();
  scheduleSave();
}

function scheduleSave()
{
  lastLocalEditAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout
  (
    function()
    {
        if (currentFileId)
        {
          files[currentFileId].modified = Date.now();
          persistFileEntry(currentFileId);

          // Keep the side pane in step while its file is being edited
          if (splitState.fileId === currentFileId)
            renderSplitPane();
        }
    },
    800
  );
}

// ── MARKDOWN EXTENSIONS (styled blocks, font spans, table of contents) ──
// Adds Pandoc-style commands on top of standard markdown:
//   :: ... ::                                               wraps a block, left-aligned
//   ::: ... :::                                             wraps a block, right-aligned
//   ;; ... ;;                                                wraps a block, centered
//   ;;; ... ;;;                                              wraps a block, justified
//   ||Georgia ... ||                                        wraps a block in a font-family div
//   :::font="Georgia" ... :::                              older keyword form, still parses
//   [text]{font="Georgia"}                                 changes the font of an inline passage
//   [TOC]                                                  expands into a generated table of contents
// Implemented as marked.js extensions (not a post-processing pass) so headings nested inside
// styled blocks are still visited in true document order, keeping TOC anchors in sync.
// Generic CSS family keywords must stay unquoted to mean what they say -
// font-family:'monospace' looks up a font literally NAMED "monospace" (and
// fails), while font-family:monospace is the actual generic fallback.
var CSS_GENERIC_FONT_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'];

function cssFontFamilyValue(name)
{
  name = (name || '').trim();

  if (CSS_GENERIC_FONT_FAMILIES.indexOf(name.toLowerCase()) !== -1)
    return name.toLowerCase();

  return "'" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function parseBlockDirectives(line)
{
  var style = '',
      re = /([A-Za-z]+)(?:=("([^"]*)"|'([^']*)'|[^\s]+))?/g,
      match;

  while ((match = re.exec(line)))
  {
    var key = match[1].toLowerCase(),
        hasValue = match[2] !== undefined,
        value = match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : match[2]);

    if (!hasValue && (key === 'left' || key === 'center' || key === 'right' || key === 'justify'))
      style += 'text-align:' + key + ';';
    else if (hasValue && key === 'font' && value)
      style += 'font-family:' + escHtml(cssFontFamilyValue(value)) + ';';
  }

  return style;
}

var checkboxRenderIndex = 0;

// ── MATH (KaTeX) ──
// LaTeX-style formulas in Documents: $inline$ and $$display$$ blocks render
// through the vendored KaTeX build. Registered as marked tokenizers (not a
// post-pass) so markdown emphasis rules never mangle the TeX source.

function katexRenderTex(tex, displayMode)
{
  if (typeof katex === 'undefined')
    return '<code>' + escHtml(tex) + '</code>';
  try { return katex.renderToString(tex, { displayMode: displayMode, throwOnError: false }); }
  catch(e) { return '<code>' + escHtml(tex) + '</code>'; }
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
  renderer: function(token) { return '<div class="math-block">' + katexRenderTex(token.text, true) + '</div>\n'; }
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
  renderer: function(token) { return katexRenderTex(token.text, false); }
};

function configureMarkedExtensions()
{
  if (typeof marked === 'undefined')
    return;

  marked.use({ extensions: [mathBlockExtension, mathInlineExtension] });

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

          return '<h' + level + (id ? (' id="' + id + '"') : '') + '>' + text + '</h' + level + '>\n';
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

          return '<div class="mermaid">' + escHtml(code.replace(/\n$/, '')) + '\n</div>\n';
        },
        checkbox: function(checked)
        {
          var idx = checkboxRenderIndex++;
          return '<input type="checkbox" class="preview-checkbox" data-idx="' + idx + '"' + (checked ? ' checked' : '') + '>';
        },
        image: function(href, title, text)
        {
          if (!href || href.indexOf(FILE_LINK_SCHEME) !== 0)
            return false;

          var id = decodeURIComponent(href.slice(FILE_LINK_SCHEME.length)),
              file = files[id];

          if (!file)
            return '<div class="embed-missing">' + escHtml('[File not found: ' + (text || id) + ']') + '</div>';

          if (file.type === 'graph')
          {
            var mermaidMatch = /```mermaid\n([\s\S]*?)```/i.exec(file.content || '');
            if (!mermaidMatch)
              return '<div class="embed-missing">' + escHtml('[No diagram in: ' + file.name + ']') + '</div>';
            return  '<figure class="embed-graph">' +
                      '<div class="mermaid">' + escHtml(mermaidMatch[1].replace(/\n$/, '')) + '</div>' +
                      (text ? '<figcaption class="embed-caption">' + escHtml(text) + '</figcaption>' : '') +
                    '</figure>';
          }

          if (file.type === 'sheet')
          {
            var defs = parseSheetChartsFromContent(file.content || '');
            if (!defs.length)
              return '<div class="embed-missing">' + escHtml('[No charts in: ' + file.name + ']') + '</div>';
            var cells = parseSheetCellsForEmbed(file.content || '');
            return  '<figure class="embed-sheet">' +
                      defs.map(function(def)
                      {
                        try
                        {
                          var config = buildChartJsConfigFromCells(def, cells);
                          return '<div class="embed-sheet-chart" data-chart-config="' + escAttr(JSON.stringify(config)) + '"><canvas></canvas></div>';
                        }
                        catch(e) { return ''; }
                      }).join('') +
                      (text ? '<figcaption class="embed-caption">' + escHtml(text) + '</figcaption>' : '') +
                    '</figure>';
          }

          return false;
        }
      },
      extensions:
      [
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
                style = match ? parseBlockDirectives(match[1]) : '';

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
          // Bare-symbol alignment blocks (see ALIGN_BLOCK_SYMBOLS near wrapBlock,
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
          // Bare-symbol font blocks (see wrapFontBlock, which is what writes
          // these): || followed directly by the font name - no "font=" keyword,
          // no quotes - closed by a bare ||. The older ":::font="..." ... :::"
          // form (parseBlockDirectives, above) still parses correctly for
          // documents written before this existed.
          name: 'fontSymbolBlock',
          level: 'block',
          start: function(src)
          {
            var match = /^\|\|[ \t]*\S[^\n]*$/m.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^\|\|[ \t]*(\S[^\n]*)\n([\s\S]*?)\n\|\|[ \t]*(?:\n+|$)/.exec(src);

            if (!match)
              return undefined;

            return  {
                      type: 'fontSymbolBlock',
                      raw: match[0],
                      style: 'font-family:' + escHtml(cssFontFamilyValue(match[1].trim())) + ';',
                      tokens: this.lexer.blockTokens(match[2], [])
                    };
          },
          renderer: function(token)
          {
            return '<div style="' + token.style + '">\n' + this.parser.parse(token.tokens) + '</div>\n';
          }
        },
        {
          name: 'fontSpan',
          level: 'inline',
          start: function(src)
          {
            var match = /\[[^\]\n]+\]\{font=/.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^\[([^\]\n]+)\]\{font=("([^"]*)"|'([^']*)'|[^\s}]+)\}/.exec(src);

            if (!match)
              return undefined;

            var fontName = match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : match[2]);

            return  {
                      type: 'fontSpan',
                      raw: match[0],
                      fontName: fontName,
                      tokens: this.lexer.inlineTokens(match[1])
                    };
          },
          renderer: function(token)
          {
            return '<span style="font-family:' + escHtml(cssFontFamilyValue(token.fontName)) + ';">' +
                   this.parser.parseInline(token.tokens) + '</span>';
          }
        },
        {
          name: 'tocBlock',
          level: 'block',
          start: function(src)
          {
            var match = /^\[TOC\][ \t]*$/im.exec(src);
            return match ? match.index : undefined;
          },
          tokenizer: function(src)
          {
            var match = /^\[TOC\][ \t]*(?:\n+|$)/i.exec(src);
            return match ? { type: 'tocBlock', raw: match[0] } : undefined;
          },
          renderer: function()
          {
            return renderTOC();
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

              var value = romanToInt(m[1]);
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
                       return '<b class="doc-field-key">' + escHtml(p.key) + '</b><span class="doc-field-value">' + escHtml(p.value) + '</span>';
                     }).join('') +
                     '</div>\n';
            }

            return '<div class="doc-fields">' +
                   token.pairs.map(function(p)
                   {
                     return '<span class="doc-field"><b>' + escHtml(p.key) + '</b> ' + escHtml(p.value) + '</span>';
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
            return '<span class="doc-tag" onclick="filterByTag(\'' + escAttr(token.tag) + '\')">#' + escHtml(token.tag) + '</span>';
          }
        }
      ]
    }
  );
}

configureMarkedExtensions();

// Loose roman-numeral parser for the romanList extension: subtractive
// notation handled, 0 returned for anything that isn't roman.
function romanToInt(text)
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

function configureMermaid()
{
  if (typeof mermaid === 'undefined')
    return;

  mermaid.initialize({ startOnLoad: false });
}

configureMermaid();

function extractPlainText(tokens)
{
  if (!tokens || !tokens.length)
    return '';

  return tokens.map
  (
    function(token)
    {
      return token.tokens ? extractPlainText(token.tokens) : (token.text || token.raw || '');
    }
  ).join('');
}

function makeSlug(text)
{
  var base = text.toLowerCase()
                  .trim()
                  .replace(/[^a-z0-9\s-]/g, '')
                  .replace(/\s+/g, '-')
                  .replace(/-+/g, '-')
                  .replace(/^-|-$/g, '') || 'section';

  var count = slugCounts[base] || 0;
  slugCounts[base] = count + 1;

  return count === 0 ? base : (base + '-' + count);
}

function collectHeadings(tokens)
{
  tokens.forEach
  (
    function(token)
    {
      if (token.type === 'heading')
      {
        var text = extractPlainText(token.tokens);

        documentHeadings.push
        (
          {
            depth: token.depth,
            text: text,
            slug: makeSlug(text)
          }
        );
      }
      else if (token.type === 'list')
      {
        token.items.forEach
        (
          function(item)
          {
            collectHeadings(item.tokens);
          }
        );
      }
      else if (token.tokens)
      {
        collectHeadings(token.tokens);
      }
    }
  );
}

function renderTOC()
{
  if (!documentHeadings.length)
    return '<div class="toc toc-empty">No headings yet.</div>';

  var minDepth = documentHeadings.reduce
  (
    function(min, h)
    {
      return Math.min(min, h.depth);
    },
    documentHeadings[0].depth
  );

  var html = '<nav class="toc">',
      openDepth = minDepth - 1;

  documentHeadings.forEach
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

      html += '<li><a href="#' + h.slug + '">' + escHtml(h.text) + '</a></li>';
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

function updatePreview()
{
  document.getElementById('preview-title').textContent = document.getElementById('doc-title-input').value;

  var source = document.getElementById('editor').value,
      html = source;

  if (typeof marked !== 'undefined')
  {
    documentHeadings = [];
    slugCounts = {};
    headingRenderCursor = 0;
    checkboxRenderIndex = 0;

    var tokens = marked.lexer(source);
    collectHeadings(tokens);

    html = marked.parser(tokens);
  }

  var previewContent = document.getElementById('preview-content');
  previewContent.innerHTML = sanitizeHtml(html);
  renderMermaidDiagrams(previewContent);
  renderEmbeddedSheetCharts(previewContent);
  renderPreviewBacklinks();
}

function renderPreviewBacklinks()
{
  var panel = document.getElementById('preview-backlinks');
  if (!panel) return;
  if (!currentFileId) { panel.style.display = 'none'; return; }

  // Merge persisted index with live scan of loaded content
  var indexed = (backlinksIndex[currentFileId] || []).filter(function(id) { return !!files[id]; });
  var live    = computeBacklinks(currentFileId).map(function(r) { return r.id; });
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
        return '<div class="pbl-item" onclick="openFile(\'' + escAttr(id) + '\')">' +
          '<span class="pbl-icon">' + fileTypeIcon(f.type) + '</span>' +
          '<span class="pbl-name">' + escHtml(f.name) + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
}

function updateStatus()
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
    var lines = editor.value.substr(0, editor.selectionStart).split('\n');
    document.getElementById('cursor-pos').textContent = 'Ln ' + lines.length + ', Col ' + (lines[lines.length - 1].length + 1);
  }
);

function handleEditorKey(keyEvent)
{
  docTextUndo.noteKeydown(keyEvent);

  if (keyEvent.ctrlKey || keyEvent.metaKey)
  {
    if (!keyEvent.shiftKey && keyEvent.key.toLowerCase() === 'z')
    {
      keyEvent.preventDefault();

      if (docTextUndo.undo())
        onEditorChange();

      return;
    }

    if (keyEvent.key.toLowerCase() === 'y' || (keyEvent.shiftKey && keyEvent.key.toLowerCase() === 'z'))
    {
      keyEvent.preventDefault();

      if (docTextUndo.redo())
        onEditorChange();

      return;
    }

    if (keyEvent.key === 'b')
    {
      keyEvent.preventDefault();
      wrapSelectedText('**','**');
    }

    if (keyEvent.key === 'i')
    {
      keyEvent.preventDefault();
      wrapSelectedText('*','*');
    }

    if (keyEvent.key === 's')
    {
      keyEvent.preventDefault();
      saveToStorage();
    }
  }

  if (keyEvent.key === 'Tab')
  {
    keyEvent.preventDefault();

    var target = keyEvent.target,
        startSelection = target.selectionStart;

    target.value = target.value.slice(0, startSelection) + '  ' + target.value.slice(target.selectionEnd);
    target.selectionStart = target.selectionEnd = startSelection + 2;
    onEditorChange();
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
      openNewModal();
    }

    if (keyEvent.key === 'Escape')
    {
      var functionHelpPanel = document.getElementById('function-help-panel');

      if (functionHelpPanel)
        functionHelpPanel.classList.remove('open');
    }
  }
);
