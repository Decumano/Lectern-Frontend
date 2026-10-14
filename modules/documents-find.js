// Documents: find and replace
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── DOCS: FIND & REPLACE ──
// A small panel over the editor: find (with live "n of m" count and optional
// case sensitivity), step through matches both ways, replace one or all.
// Replacements are single undo steps via the shared textarea undo controller.
//
// Matches are shown where the reader is looking. In the editor, the current
// match gets a marker drawn over the textarea at its measured position, and
// focus stays in the find box so Enter keeps stepping (it used to move into
// the document, where the next Enter typed a newline). In the preview, every
// match in the rendered text is highlighted and the current one scrolled to —
// in preview-only view those highlights are what Next/Previous walk through.

var frState = { matches: [], index: -1, previewMarks: [], previewIndexOverride: undefined };

function frPanel() { return document.getElementById('find-replace-panel'); }
function frIsOpen() { var p = frPanel(); return !!(p && p.classList.contains('open')); }
function frWriteVisible() { return editorView !== 'preview'; }
function frPreviewVisible() { return editorView === 'split' || editorView === 'preview'; }
function frPreviewOnly() { return editorView === 'preview'; }

function openFindReplace()
{
  var panel = frPanel(),
      editor = document.getElementById('editor');

  if (!panel || !editor)
    return;

  panel.classList.add('open');

  // A single-line selection in the editor becomes the initial query.
  var findInp = document.getElementById('fr-find'),
      selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);

  if (selected && selected.indexOf('\n') === -1)
    findInp.value = selected;

  findInp.focus();
  findInp.select();
  frRefresh(true);
}

function closeFindReplace()
{
  var panel = frPanel();
  if (panel) panel.classList.remove('open');

  var editor = document.getElementById('editor'),
      m = frState.matches[frState.index];

  frClearMarks();
  frState.matches = [];
  frState.index = -1;
  frState.previewIndexOverride = undefined;
  document.getElementById('fr-count').textContent = '';

  // Leave the caret on the match that was being looked at, without letting
  // focus() scroll the textarea back to wherever its caret used to be.
  editor.focus({ preventScroll: true });
  if (m && frWriteVisible())
  {
    var top = editor.scrollTop;
    editor.setSelectionRange(m.start, m.end);
    editor.scrollTop = top;
  }
}

function toggleFindReplace()
{
  if (frIsOpen())
    closeFindReplace();
  else
    openFindReplace();
}

function frQuery()
{
  return  {
            find: document.getElementById('fr-find').value,
            cs: document.getElementById('fr-case').checked
          };
}

// Every match of the query in `text`, as [{start, end}], non-overlapping.
function frFindAll(text, q)
{
  var out = [];
  if (!q.find) return out;

  var hay = q.cs ? text : text.toLowerCase(),
      needle = q.cs ? q.find : q.find.toLowerCase(),
      at = 0;

  while ((at = hay.indexOf(needle, at)) !== -1)
  {
    out.push({ start: at, end: at + needle.length });
    at += needle.length;
  }

  return out;
}

function frCountMatches()
{
  return frFindAll(document.getElementById('editor').value, frQuery()).length;
}

// Kept for the inline handlers in index.html: typing in the find box or
// toggling case re-runs the search and jumps to the nearest match.
function frUpdateCount()
{
  frRefresh(true);
}

// Recomputes the matches. With `jump`, moves to the first match at or after
// the editor caret (incremental search, as browsers do) and scrolls to it;
// otherwise stays as close to the current match as the new list allows.
function frRefresh(jump)
{
  var editor = document.getElementById('editor'),
      previous = frState.matches[frState.index];

  frState.matches = frFindAll(editor.value, frQuery());
  frState.previewIndexOverride = undefined;

  if (!frState.matches.length)
    frState.index = -1;
  else
  {
    var from = (!jump && previous) ? previous.start : editor.selectionStart,
        idx = frState.matches.findIndex(function(m){ return m.start >= from; });

    frState.index = idx === -1 ? 0 : idx;
  }

  frRender(jump);
}

function frRender(scroll)
{
  var q = frQuery(),
      countEl = document.getElementById('fr-count');

  frRenderPreviewMarks();

  var previewOnly = frPreviewOnly(),
      total = previewOnly ? frState.previewMarks.length : frState.matches.length,
      current = previewOnly ? frPreviewIndex() : frState.index;

  if (!q.find)
    countEl.textContent = '';
  else if (!total)
    countEl.textContent = 'No matches';
  else
    countEl.textContent = (current + 1) + ' of ' + total;

  countEl.classList.toggle('fr-none', !!q.find && !total);

  if (scroll)
    frScrollToCurrent();
  else
    frPositionEditorMark();
}

function frStep(delta)
{
  var q = frQuery();
  if (!q.find)
    return;

  // Re-read the matches: the document may have changed under the open panel.
  frState.matches = frFindAll(document.getElementById('editor').value, q);

  if (frPreviewOnly() && frState.previewMarks.length)
  {
    // Preview-only: walk the highlights the reader can see, and keep the
    // source index in step so Replace acts on the same occurrence.
    var pn = frState.previewMarks.length,
        pi = (Math.max(0, frPreviewIndex()) + delta + pn) % pn;

    frState.index = frSourceIndexForPreview(pi);
    frState.previewIndexOverride = pi;
  }
  else if (frState.matches.length)
  {
    var n = frState.matches.length;
    frState.index = frState.index < 0 ? (delta > 0 ? 0 : n - 1) : (frState.index + delta + n) % n;
    frState.previewIndexOverride = undefined;
  }
  else
    frState.index = -1;

  frRender(true);
}

function frFindNext() { frStep(1); }
function frFindPrev() { frStep(-1); }

// ── Editor side: exact geometry of a range inside the textarea ──
// A textarea can't report where a character is drawn, so a hidden mirror
// with the same box, font and wrapping rules lays the text out the same way
// and is measured instead. This is what makes the scroll exact: the old
// lineIndex × lineHeight estimate ignored soft-wrapped lines, so with any
// wrapped paragraph above the match it always landed short of it.
var frMirror = null;

function frRangeRects(editor, start, end)
{
  if (!frMirror)
  {
    frMirror = document.createElement('div');
    frMirror.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frMirror);
  }

  var cs = getComputedStyle(editor),
      st = frMirror.style;

  ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'fontFeatureSettings',
   'fontKerning', 'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform', 'textIndent', 'tabSize',
   'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'direction', 'textAlign', 'wordBreak']
    .forEach(function(k){ st[k] = cs[k]; });

  st.position = 'absolute';
  st.visibility = 'hidden';
  st.pointerEvents = 'none';
  st.top = '0';
  st.left = '-99999px';
  st.boxSizing = 'border-box';
  st.border = '0';
  // clientWidth excludes the scrollbar, which is the width the text wraps at.
  st.width = editor.clientWidth + 'px';
  st.whiteSpace = 'pre-wrap';
  st.overflowWrap = 'break-word';

  var value = editor.value,
      lineEnd = value.indexOf('\n', end);

  if (lineEnd === -1)
    lineEnd = value.length;

  frMirror.textContent = '';
  frMirror.appendChild(document.createTextNode(value.slice(0, start)));

  var span = document.createElement('span');
  span.textContent = value.slice(start, end) || '​';
  frMirror.appendChild(span);

  // The rest of the line decides where the match itself wraps.
  frMirror.appendChild(document.createTextNode(value.slice(end, lineEnd)));

  var base = frMirror.getBoundingClientRect();

  return Array.prototype.map.call(span.getClientRects(), function(r)
  {
    return { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height };
  });
}

function frMarkLayer()
{
  var layer = document.getElementById('fr-editor-marks');

  if (!layer)
  {
    layer = document.createElement('div');
    layer.id = 'fr-editor-marks';
    document.getElementById('write-pane').appendChild(layer);
  }

  return layer;
}

// Draws the current match over the textarea, clipped to its visible area.
function frPositionEditorMark()
{
  var layer = frMarkLayer(),
      m = frState.matches[frState.index],
      editor = document.getElementById('editor');

  layer.innerHTML = '';

  if (!m || !frIsOpen() || !frWriteVisible() || !editor.offsetParent)
    return;

  var rects = frRangeRects(editor, m.start, m.end),
      ox = editor.offsetLeft - editor.scrollLeft,
      oy = editor.offsetTop - editor.scrollTop,
      clipTop = editor.offsetTop,
      clipBottom = editor.offsetTop + editor.clientHeight;

  rects.forEach(function(r)
  {
    var top = oy + r.top,
        bottom = top + r.height;

    if (bottom <= clipTop || top >= clipBottom)
      return;

    var box = document.createElement('div');
    box.className = 'fr-editor-mark';
    box.style.left = (ox + r.left) + 'px';
    box.style.top = Math.max(top, clipTop) + 'px';
    box.style.width = Math.max(r.width, 2) + 'px';
    box.style.height = (Math.min(bottom, clipBottom) - Math.max(top, clipTop)) + 'px';
    layer.appendChild(box);
  });
}

function frScrollEditorTo(m)
{
  var editor = document.getElementById('editor'),
      rects = frRangeRects(editor, m.start, m.end);

  if (!rects.length)
    return;

  var top = rects[0].top,
      bottom = rects[rects.length - 1].top + rects[rects.length - 1].height,
      viewTop = editor.scrollTop,
      viewBottom = viewTop + editor.clientHeight,
      margin = Math.min(60, editor.clientHeight / 4);

  // Already comfortably on screen: don't move. Otherwise centre the match.
  if (top < viewTop + margin || bottom > viewBottom - margin)
    editor.scrollTop = Math.max(0, (top + bottom) / 2 - editor.clientHeight / 2);

  // Keep the caret on the match too, so closing the panel or switching views
  // carries on from here. setSelectionRange may scroll by itself; undo that.
  var keep = editor.scrollTop;
  editor.setSelectionRange(m.start, m.end);
  editor.scrollTop = keep;
}

function frScrollToCurrent()
{
  var m = frState.matches[frState.index];

  if (m && frWriteVisible())
    frScrollEditorTo(m);

  frPositionEditorMark();
  frScrollPreviewToCurrent();
}

// ── Preview side: highlight matches in the rendered document ──
// Searches the rendered text, not the Markdown, so a match is found the way
// it reads ("**bold** text" matches "bold text"), including across inline
// formatting. Rendered math and diagrams are skipped.

function frClearPreviewMarks()
{
  var content = document.getElementById('preview-content');
  frState.previewMarks = [];
  if (!content) return;

  content.querySelectorAll('mark.fr-hl').forEach(function(mark)
  {
    var parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function frClearMarks()
{
  frClearPreviewMarks();
  var layer = document.getElementById('fr-editor-marks');
  if (layer) layer.innerHTML = '';
}

function frRenderPreviewMarks()
{
  frClearPreviewMarks();

  var q = frQuery(),
      content = document.getElementById('preview-content');

  if (!q.find || !content || !frIsOpen() || !frPreviewVisible())
    return;

  var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node)
        {
          var el = node.parentElement;
          if (!el || el.closest('.katex, .mermaid, svg, script, style'))
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }),
      nodes = [],
      text = '',
      node;

  // One flat string over every text node, remembering where each starts.
  while ((node = walker.nextNode()))
  {
    nodes.push({ node: node, start: text.length });
    text += node.nodeValue;
  }

  var matches = frFindAll(text, q),
      pieces = [],
      ni = 0;

  // Each match becomes one piece per text node it covers, so a match that
  // spans formatting ("bold text" over <strong>) is still highlighted.
  matches.forEach(function(m, mi)
  {
    while (ni < nodes.length - 1 && nodes[ni + 1].start <= m.start) ni++;

    for (var k = ni; k < nodes.length && nodes[k].start < m.end; k++)
    {
      var n = nodes[k],
          a = Math.max(0, m.start - n.start),
          b = Math.min(n.node.nodeValue.length, m.end - n.start);

      if (b > a)
        pieces.push({ node: n.node, a: a, b: b, match: mi });
    }
  });

  var marks = matches.map(function(){ return []; });

  // Back to front, so splitting a node never shifts an offset still needed.
  for (var i = pieces.length - 1; i >= 0; i--)
  {
    var pc = pieces[i],
        target = pc.node;

    if (pc.b < target.nodeValue.length) target.splitText(pc.b);
    if (pc.a > 0) target = target.splitText(pc.a);

    var mark = document.createElement('mark');
    mark.className = 'fr-hl';
    target.parentNode.insertBefore(mark, target);
    mark.appendChild(target);
    marks[pc.match].unshift(mark);
  }

  frState.previewMarks = marks;

  var cur = marks[frPreviewIndex()];
  if (cur) cur.forEach(function(mk){ mk.classList.add('fr-current'); });
}

// The rendered occurrence that corresponds to the current source match. The
// two lists usually line up one to one; when they don't (Markdown syntax that
// hides or adds text), map by relative position so it stays near the right
// place.
function frPreviewIndex()
{
  var pn = frState.previewMarks.length,
      sn = frState.matches.length,
      o = frState.previewIndexOverride;

  if (!pn) return -1;
  if (o !== undefined && o < pn) return o;
  if (frState.index < 0) return 0;
  if (pn === sn) return frState.index;
  if (sn <= 1) return 0;
  return Math.min(pn - 1, Math.round(frState.index * (pn - 1) / (sn - 1)));
}

function frSourceIndexForPreview(pi)
{
  var pn = frState.previewMarks.length,
      sn = frState.matches.length;

  if (!sn) return -1;
  if (pn === sn) return pi;
  if (pn <= 1) return 0;
  return Math.min(sn - 1, Math.round(pi * (sn - 1) / (pn - 1)));
}

function frScrollPreviewToCurrent()
{
  var marks = frState.previewMarks[frPreviewIndex()],
      pane = document.getElementById('preview-pane');

  if (!marks || !marks.length || !pane || !frPreviewVisible())
    return;

  var paneRect = pane.getBoundingClientRect(),
      first = marks[0].getBoundingClientRect(),
      last = marks[marks.length - 1].getBoundingClientRect(),
      top = first.top - paneRect.top + pane.scrollTop,
      bottom = last.bottom - paneRect.top + pane.scrollTop,
      margin = Math.min(60, pane.clientHeight / 4);

  if (top < pane.scrollTop + margin || bottom > pane.scrollTop + pane.clientHeight - margin)
    pane.scrollTop = Math.max(0, (top + bottom) / 2 - pane.clientHeight / 2);
}

// The preview is rebuilt from scratch on every edit; put the highlights back.
function frAfterPreviewRender()
{
  if (frIsOpen())
    frRenderPreviewMarks();
}

function frReplaceOne()
{
  var q = frQuery();
  if (!q.find) return;

  var editor = document.getElementById('editor');

  frState.matches = frFindAll(editor.value, q);
  var m = frState.matches[frState.index];

  // Nothing current yet: the first press just lands on a match.
  if (!m)
  {
    frFindNext();
    return;
  }

  var replaceWith = document.getElementById('fr-replace').value;

  docTextUndo.forceSnapshot();
  editor.value = editor.value.slice(0, m.start) + replaceWith + editor.value.slice(m.end);
  editor.setSelectionRange(m.start + replaceWith.length, m.start + replaceWith.length);
  onEditorChange();

  // Land on the next match after the replacement (never inside it, so
  // replacing "a" with "aa" doesn't loop on its own output).
  frState.matches = frFindAll(editor.value, q);
  frState.previewIndexOverride = undefined;

  if (!frState.matches.length)
    frState.index = -1;
  else
  {
    var after = m.start + replaceWith.length,
        idx = frState.matches.findIndex(function(x){ return x.start >= after; });

    frState.index = idx === -1 ? 0 : idx;
  }

  frRender(true);
}

function frReplaceAll()
{
  var q = frQuery();
  if (!q.find || !frCountMatches()) return;

  var editor = document.getElementById('editor'),
      replaceWith = document.getElementById('fr-replace').value;

  docTextUndo.forceSnapshot();

  if (q.cs)
    editor.value = editor.value.split(q.find).join(replaceWith);
  else
  {
    var pattern = new RegExp(q.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    // Function replacement so '$' in the replacement text stays literal.
    editor.value = editor.value.replace(pattern, function(){ return replaceWith; });
  }

  onEditorChange();
  frRefresh(false);
}

function frKey(keyEvent)
{
  if (keyEvent.key === 'Enter')
  {
    keyEvent.preventDefault();
    if (keyEvent.target.id === 'fr-replace') frReplaceOne();
    else if (keyEvent.shiftKey) frFindPrev();
    else frFindNext();
  }

  if (keyEvent.key === 'Escape')
    closeFindReplace();
}

// Ctrl/Cmd+F and Ctrl/Cmd+H inside the doc editor or the preview open the
// panel; F3 / Shift+F3 step through matches while it's open.
(function()
{
  var editor = document.getElementById('editor'),
      previewPane = document.getElementById('preview-pane');

  if (!editor) return;

  function openKeys(e)
  {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'h' || e.key === 'H'))
    {
      e.preventDefault();
      openFindReplace();
    }
  }

  editor.addEventListener('keydown', openKeys);

  if (previewPane)
  {
    // Focusable, so the shortcut also works while reading in preview view.
    if (!previewPane.hasAttribute('tabindex')) previewPane.setAttribute('tabindex', '-1');
    previewPane.addEventListener('keydown', openKeys);
  }

  document.addEventListener('keydown', function(e)
  {
    if (e.key === 'F3' && frIsOpen())
    {
      e.preventDefault();
      if (e.shiftKey) frFindPrev(); else frFindNext();
    }
  });

  // The marker is drawn in pane coordinates; follow the text when it moves.
  editor.addEventListener('scroll', function(){ if (frIsOpen()) frPositionEditorMark(); });
  editor.addEventListener('input', function(){ if (frIsOpen()) frRefresh(false); });
  window.addEventListener('resize', function(){ if (frIsOpen()) frPositionEditorMark(); });
})();

function wrapSelectedText(before, after)
{
  docTextUndo.forceSnapshot();

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart,
      selectionEnd = editor.selectionEnd,
      selection = editor.value.slice(selectionStart, selectionEnd);
  
  editor.value = editor.value.slice(0, selectionStart) + before + selection + after + editor.value.slice(selectionEnd);
  editor.selectionStart = selectionStart + before.length;
  editor.selectionEnd = selectionEnd + after.length;

  editor.focus();
  onEditorChange();
}

function insertLine(prefix)
{
  docTextUndo.forceSnapshot();

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart,
      lineStart = editor.value.lastIndexOf('\n', selectionStart - 1) + 1;
  
  editor.value = editor.value.slice(0, lineStart) + prefix + editor.value.slice(lineStart);
  editor.selectionStart = editor.selectionEnd = lineStart + prefix.length + (selectionStart - lineStart);

  editor.focus();
  onEditorChange();
}

function applyHeading(prefix)
{
    if (!prefix)
      return;

    insertLine(prefix);
    document.getElementById('heading-sel').value = '';
}

function insertCodeBlock()
{
  docTextUndo.forceSnapshot();

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart,
      selectionEnd = editor.selectionEnd;

  editor.value = editor.value.slice(0, selectionStart) + '\n```\n' + editor.value.slice(selectionStart, selectionEnd) + '\n```\n' + editor.value.slice(selectionEnd);
  editor.selectionStart = editor.selectionEnd = selectionStart + 5;
  editor.focus();
  onEditorChange();
}

function openTableModal()
{
  document.getElementById('table-modal').classList.add('open');
  document.getElementById('table-rows').value = 2;
  document.getElementById('table-cols').value = 3;

  setTimeout
  (
    function()
    {
      document.getElementById('table-rows').focus();
    },
    50
  );
}

function closeTableModal()
{
  document.getElementById('table-modal').classList.remove('open');
}

function createTable()
{
  docTextUndo.forceSnapshot();

  var rows = Math.max(1, Math.min(50, parseInt(document.getElementById('table-rows').value, 10) || 1)),
      cols = Math.max(1, Math.min(20, parseInt(document.getElementById('table-cols').value, 10) || 1)),
      headerCells = [],
      dividerCells = [],
      i, j;

  for (j = 0; j < cols; j++)
  {
    headerCells.push('Column ' + (j + 1));
    dividerCells.push('----------');
  }

  var table = '\n| ' + headerCells.join(' | ') + ' |\n' +
              '| ' + dividerCells.join(' | ') + ' |\n';

  for (i = 0; i < rows; i++)
  {
    var rowCells = [];

    for (j = 0; j < cols; j++)
      rowCells.push('Cell');

    table += '| ' + rowCells.join(' | ') + ' |\n';
  }

  table += '\n';

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart;

  editor.value = editor.value.slice(0, selectionStart) + table + editor.value.slice(selectionStart);
  editor.selectionStart = editor.selectionEnd = selectionStart + table.length;

  closeTableModal();
  editor.focus();
  onEditorChange();
}

document.getElementById('table-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('table-modal'))
      closeTableModal();
  }
);

function insertLink()
{
  var url = prompt('URL:', 'https://');

  if (!url)
    return;

  wrapSelectedText('[', ']('+url+')');
}
