// PDF pagination: lays a rendered document out into real pages
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.
//
// Why this exists: the desktop webviews can't be left to paginate on their own.
// WebKitGTK ignores @page margins (the print dialog's win), never draws CSS margin
// boxes, so no running headers or page numbers, and emits a blank page for a
// forced break at the start of a document. So the print-preview frame builds the
// pages itself, one fixed-size box per sheet with the header, footer and number
// drawn inside it, and measures in the same engine that prints. The web app's
// server-side renderer is headless Chromium, which handles all of this natively
// from CSS (see fBuildPageCss), so this only runs for desktop exports.

var cPaperSizesMm =
{
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
  B4: [250, 353], B5: [176, 250],
  letter: [215.9, 279.4], legal: [215.9, 355.6], ledger: [279.4, 431.8], tabloid: [279.4, 431.8]
};

var cDefaultMarginMm = 20;

function fCssLengthToMm(value)
{
  var m = /^([\d.]+)(mm|cm|in|pt|px)$/.exec(value);

  if (!m)
    return null;

  return parseFloat(m[1]) * { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 }[m[2]];
}

// CSS order: 1 to 4 lengths. Relative units can't describe paper, so they are
// rejected and the default applies.
function fParseMarginsMm(text)
{
  var parts = (text || '').trim().split(/\s+/).map(fCssLengthToMm),
      d = cDefaultMarginMm;

  if (!text || !parts.every(function(v) { return v !== null; }))
    return { top: d, right: d, bottom: d, left: d };

  var top = parts[0],
      right = parts.length > 1 ? parts[1] : top,
      bottom = parts.length > 2 ? parts[2] : top,
      left = parts.length > 3 ? parts[3] : right;

  return { top: top, right: right, bottom: bottom, left: left };
}

function fPageLayoutFromSettings(settings, title)
{
  var size = cPaperSizesMm[settings.size] || cPaperSizesMm.A4,
      landscape = settings.orientation === 'landscape';

  return  {
            widthMm: landscape ? size[1] : size[0],
            heightMm: landscape ? size[0] : size[1],
            margins: fParseMarginsMm(settings.margin),
            newPage: settings.newPage === 'none' ? null : (settings.newPage || 'h1'),
            header: settings.header || '',
            footer: settings.footer || '',
            headerAlign: settings.headerAlign || 'center',
            footerAlign: settings.footerAlign || 'center',
            headerSize: settings.headerSize || '10pt',
            footerSize: settings.footerSize || '10pt',
            numbers: settings.numbers || '',
            firstPagePlain: !!settings.firstPagePlain,
            title: title || ''
          };
}

function fPageSlotText(text, page, pages, title)
{
  return text.replace(/\{page\}/gi, page).replace(/\{pages\}/gi, pages).replace(/\{title\}/gi, title);
}

function fPaginationCss(l)
{
  var m = l.margins;

  return  '@page{size:' + l.widthMm + 'mm ' + l.heightMm + 'mm;margin:0;}\n' +
          'html,body{margin:0;padding:0;max-width:none;}\n' +
          '.pdf-page{position:relative;width:' + l.widthMm + 'mm;height:' + (l.heightMm - 0.2) + 'mm;overflow:hidden;background:#fff;break-after:page;break-inside:avoid;}\n' +
          '.pdf-page:last-child{break-after:auto;}\n' +
          '.pdf-content{position:absolute;display:flow-root;top:' + m.top + 'mm;left:' + m.left + 'mm;' +
            'width:' + (l.widthMm - m.left - m.right) + 'mm;height:' + (l.heightMm - m.top - m.bottom) + 'mm;}\n' +
          '.pdf-content>:first-child{margin-top:0;}\n' +
          '.pdf-band{position:absolute;display:flex;left:' + m.left + 'mm;right:' + m.right + 'mm;color:#444;line-height:1.2;transform:translateY(-50%);}\n' +
          '.pdf-band-top{top:' + (m.top / 2) + 'mm;}\n' +
          '.pdf-band-bottom{top:' + (l.heightMm - m.bottom / 2) + 'mm;}\n' +
          '.pdf-band span{flex:1;min-width:0;white-space:nowrap;}\n' +
          '.pdf-slot-center{text-align:center;}\n' +
          '.pdf-slot-right{text-align:right;}\n' +
          'p,li,td,th,pre,h1,h2,h3,h4,h5,h6{overflow-wrap:anywhere;}\n' +
          '.pdf-cont{text-indent:0!important;margin-top:0!important;}\n' +
          'li.pdf-cont{list-style:none;}\n' +
          '.pdf-page table{table-layout:auto;max-width:100%;}\n' +
          '.pdf-page img,.pdf-page svg{max-width:100%;}\n' +
          '@media screen{html{background:#6b6b6b;}body{padding:16px 0;}.pdf-page{margin:0 auto 16px;box-shadow:0 1px 6px rgba(0,0,0,.45);}}\n';
}

var cHeadingTags = /^H[1-6]$/;
var cSplittableContainers = /^(DIV|BLOCKQUOTE|NAV|UL|OL|DL|SECTION|ARTICLE|LI|TBODY)$/;
var cLineSplitTags = /^(P|LI|DIV|H[1-6]|PRE|DD|DT|FIGCAPTION)$/;
var cAtomicDivs = 'mermaid-diagram math-block doc-fields embed-sheet-chart embed-missing'.split(' ');

function fIsInlineNode(node)
{
  if (node.nodeType === 3)
    return !!node.nodeValue.trim();

  if (node.nodeType !== 1)
    return false;

  return !/^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|UL)$/.test(node.tagName);
}

function fHasBlockChild(el)
{
  return Array.prototype.some.call(el.children, function(c) { return !fIsInlineNode(c); });
}

function fIsAtomic(el)
{
  if (/^(TABLE|FIGURE|HR|IMG|SVG|CANVAS|TR)$/i.test(el.tagName))
    return true;

  return cAtomicDivs.some(function(c) { return el.classList.contains(c); });
}

// Lets a container's children be flowed one by one: runs of inline content
// beside block children (a list item's text above its nested list) get a wrapper.
function fBlockChildren(el, doc)
{
  var out = [], run = null;

  Array.prototype.slice.call(el.childNodes).forEach
  (
    function(node)
    {
      if (fIsInlineNode(node))
      {
        if (!run)
        {
          run = doc.createElement('div');
          out.push(run);
        }

        run.appendChild(node);
      }
      else
      {
        if (node.nodeType === 1)
          out.push(node);
        else if (run && node.nodeType === 3)
          run.appendChild(node);
        else if (node.parentNode)
          node.parentNode.removeChild(node);

        if (node.nodeType === 1)
          run = null;
      }
    }
  );

  return out;
}

function fPaginateDocument(doc, l)
{
  var style = doc.createElement('style');
  style.textContent = fPaginationCss(l);
  doc.head.appendChild(style);

  Array.prototype.forEach.call(doc.querySelectorAll('.page-setup-note'), function(n) { n.parentNode.removeChild(n); });

  var body = doc.body,
      source = fBlockChildren(body, doc),
      pages = [],
      content = null,
      contentRect = null,
      cur = null,
      chain = [];

  source.forEach(function(n) { if (n.parentNode) n.parentNode.removeChild(n); });

  function fReopenChain()
  {
    cur = content;

    chain.forEach
    (
      function(wrapper, i)
      {
        var clone = wrapper.src.cloneNode(false);
        clone.removeAttribute('id');

        if (wrapper.started)
          clone.classList.add('pdf-cont');

        wrapper.started = true;
        cur.appendChild(clone);

        // A table carries its header row onto every page it reaches.
        if (wrapper.thead && i === chain.length - 2)
          clone.appendChild(wrapper.thead.cloneNode(true));

        wrapper.el = clone;
        cur = clone;
      }
    );
  }

  function fPruneEmpty(el)
  {
    while (el && el !== content && !el.textContent.trim() && !el.querySelector('img,svg,hr,canvas,input'))
    {
      var parent = el.parentNode;
      parent.removeChild(el);
      el = parent;
    }
  }

  // True when the current page began because text ran off the one before it,
  // not because the author asked for a break: a \\ space at the top of such a
  // page is dropped, as LaTeX drops a \vspace there.
  var topIsAuto = false;

  function fNewPage(explicit)
  {
    topIsAuto = !explicit && pages.length > 0;

    if (cur && content)
      fPruneEmpty(cur);

    var page = doc.createElement('div');
    page.className = 'pdf-page';

    content = doc.createElement('div');
    content.className = 'pdf-content';

    page.appendChild(content);
    body.appendChild(page);
    pages.push(page);

    contentRect = content.getBoundingClientRect();

    fReopenChain();
  }

  // True when nothing has been placed on this page yet, ignoring the empty
  // wrappers reopened for a container that continues from the previous page.
  function fPageIsEmpty()
  {
    return !content.textContent.trim() && !content.querySelector('img,svg,hr,canvas');
  }

  function fFits(el)
  {
    return el.getBoundingClientRect().bottom <= contentRect.bottom + 0.5;
  }

  function fWantsBreakBefore(el)
  {
    for (var node = el; node; node = node.firstElementChild)
    {
      if (node.classList.contains('pdf-cont') || node.classList.contains('no-break'))
        return false;

      if (node.classList.contains('force-break'))
        return true;

      if (l.newPage && node.tagName.toLowerCase() === l.newPage)
        return true;

      if (!/^(DIV|SECTION|ARTICLE)$/.test(node.tagName) || fIsAtomic(node))
        return false;
    }

    return false;
  }

  // Keep-with-next: a heading never sits alone at the bottom of a page.
  function fNewPageCarryingHeading()
  {
    var last = cur.lastElementChild,
        carry = (last && cHeadingTags.test(last.tagName) && !fPageIsOnly(last)) ? last : null;

    if (carry)
      carry.parentNode.removeChild(carry);

    fNewPage();

    if (carry)
      cur.appendChild(carry);
  }

  function fPageIsOnly(el)
  {
    return el.parentNode === content && content.children.length === 1;
  }

  // The text nodes a line break may fall in; formulas never split.
  function fSplittableTextNodes(el)
  {
    var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT),
        out = [],
        node;

    while ((node = walker.nextNode()))
      if (node.nodeValue.length && !(node.parentNode.closest && node.parentNode.closest('.katex,svg')))
        out.push(node);

    return out;
  }

  function fCharBottom(range, nodes, index)
  {
    // index is [node, offset]; whitespace collapsed away reports no rects.
    range.setStart(nodes[index[0]], index[1]);
    range.setEnd(nodes[index[0]], index[1] + 1);

    var rects = range.getClientRects();

    return rects.length ? rects[rects.length - 1].bottom : null;
  }

  // Finds where el crosses the page bottom and moves everything past that point
  // into a continuation element, cutting only between lines. Returns the
  // continuation, or null when too little of el fits to be worth leaving here.
  function fSplitAtLine(el, force)
  {
    var nodes = fSplittableTextNodes(el);

    if (!nodes.length)
      return null;

    var positions = [];

    nodes.forEach
    (
      function(n, i)
      {
        for (var o = 0; o < n.nodeValue.length; o++)
          positions.push([i, o]);
      }
    );

    var cs = doc.defaultView.getComputedStyle(el),
        lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4,
        range = doc.createRange(),
        limit = contentRect.bottom,
        elTop = el.getBoundingClientRect().top,
        elBottom = el.getBoundingClientRect().bottom,
        cut = -1;

    function fFindCut(lim)
    {
      var lo = 0, hi = positions.length - 1, found = -1;

      while (lo <= hi)
      {
        var mid = (lo + hi) >> 1,
            probe = mid,
            bottom = null;

        while (probe <= hi && (bottom = fCharBottom(range, nodes, positions[probe])) === null)
          probe++;

        if (bottom === null)
        {
          hi = mid - 1;
        }
        else if (bottom > lim)
        {
          found = probe;
          hi = mid - 1;
        }
        else
        {
          lo = probe + 1;
        }
      }

      return found;
    }

    cut = fFindCut(limit);

    if (cut <= 0)
      return null;

    // Widows: at least two lines must travel, so give up a line here if needed.
    if ((elBottom - limit) < lineHeight * 1.5)
    {
      limit -= lineHeight;
      cut = fFindCut(limit);

      if (cut <= 0)
        return null;
    }

    // Orphans: at least two lines must stay, unless nothing else is on the page.
    if (!force && (limit - elTop) < lineHeight * 1.8)
      return null;

    var at = positions[cut],
        tailRange = doc.createRange();

    tailRange.setStart(nodes[at[0]], at[1]);
    tailRange.setEndAfter(el.lastChild);

    var tail = el.cloneNode(false);
    tail.removeAttribute('id');
    tail.classList.add('pdf-cont');
    tail.appendChild(tailRange.extractContents());

    // The line left at the end of a justified page should still fill the measure.
    if (cs.textAlign === 'justify')
      el.style.textAlignLast = 'justify';

    el.style.marginBottom = '0';

    return tail;
  }

  // Something unbreakable that is too big for a whole page or too wide for the
  // measure: scale it down rather than let the page edge cut it off.
  function fShrinkToFit(el)
  {
    var r = el.getBoundingClientRect(),
        scale = Math.min(1, contentRect.width / (r.width || 1), contentRect.height / (r.height || 1));

    if (scale < 1)
      el.style.zoom = Math.max(0.1, scale).toFixed(3);
  }

  function fFlowChildren(el)
  {
    var record = { src: el, started: false };

    // Numbering would restart on each page; pin every item to its own number.
    if (el.tagName === 'OL')
    {
      var n = el.hasAttribute('start') ? parseInt(el.getAttribute('start'), 10) : 1;

      Array.prototype.forEach.call(el.children, function(li) { if (li.tagName === 'LI' && !li.hasAttribute('value')) li.setAttribute('value', n++); });
    }

    var children = fBlockChildren(el, doc);

    children.forEach(function(c) { if (c.parentNode) c.parentNode.removeChild(c); });

    chain.push(record);

    var clone = el.cloneNode(false);
    clone.removeAttribute('id');
    record.started = true;
    record.el = clone;
    cur.appendChild(clone);
    cur = clone;

    children.forEach(fPlace);

    chain.pop();

    var finished = cur;
    cur = finished.parentNode;

    fPruneEmpty(finished);

    // fPruneEmpty may have removed the parent chain's now-empty level too.
    if (!cur.isConnected)
      fReopenChain();
  }

  function fFlowTable(table)
  {
    var thead = table.querySelector(':scope > thead'),
        rows = [];

    Array.prototype.forEach.call
    (
      table.querySelectorAll(':scope > tbody, :scope > tfoot'),
      function(section) { rows = rows.concat(Array.prototype.slice.call(section.children)); }
    );

    if (!rows.length)
      return false;

    var shell = table.cloneNode(false),
        bodyEl = doc.createElement('tbody');

    Array.prototype.forEach.call(table.querySelectorAll(':scope > colgroup'), function(c) { shell.appendChild(c.cloneNode(true)); });

    // Two levels in the chain: the table, then its body, whose rows flow.
    var tableRecord = { src: shell, started: false, thead: thead },
        bodyRecord = { src: bodyEl, started: false };

    chain.push(tableRecord, bodyRecord);
    fReopenChain();

    rows.forEach
    (
      function(row)
      {
        cur.appendChild(row);

        if (fFits(row))
          return;

        cur.removeChild(row);
        fNewPage();
        cur.appendChild(row);
        fShrinkToFit(row);
      }
    );

    chain.pop();
    chain.pop();

    var lastTable = tableRecord.el;
    cur = lastTable.parentNode;

    return true;
  }

  function fPlace(el)
  {
    if (el.classList.contains('pdf-space'))
    {
      if (fPageIsEmpty() && topIsAuto)
        return;

      cur.appendChild(el);

      if (!fFits(el))
        cur.removeChild(el);  // no room: the space is lost at the page break

      return;
    }

    if (el.classList.contains('pdf-fill'))
    {
      cur.appendChild(el);  // stretched once the page is complete (fResolveFills)
      return;
    }

    if (el.classList.contains('page-break'))
    {
      if (!fPageIsEmpty())
        fNewPage(true);

      return;
    }

    if (fWantsBreakBefore(el) && !fPageIsEmpty())
      fNewPage(true);

    cur.appendChild(el);

    if (fFits(el) && el.getBoundingClientRect().width <= contentRect.width + 1)
      return;

    if (fFits(el))
    {
      fShrinkToFit(el);
      return;
    }

    var empty = fPageIsOnlyEmptyBesides(el);

    if (el.tagName === 'TABLE' && !fIsTooTallRowOnly(el))
    {
      cur.removeChild(el);

      if (fFlowTable(el))
        return;

      cur.appendChild(el);
    }

    if (!fIsAtomic(el) && cSplittableContainers.test(el.tagName) && fHasBlockChild(el))
    {
      cur.removeChild(el);
      fFlowChildren(el);
      return;
    }

    if (!fIsAtomic(el) && cLineSplitTags.test(el.tagName))
    {
      var tail = fSplitAtLine(el, empty);

      if (tail)
      {
        fNewPage();
        fPlace(tail);
        return;
      }
    }

    // Nothing of it can stay: it starts on the next page instead.
    if (!empty)
    {
      cur.removeChild(el);
      fNewPageCarryingHeading();
      cur.appendChild(el);

      if (fFits(el))
        return;

      // Still too big for a full page: split it if it can be, else scale it.
      if (!fIsAtomic(el) && cLineSplitTags.test(el.tagName))
      {
        var rest = fSplitAtLine(el, true);

        if (rest)
        {
          fNewPage();
          fPlace(rest);
          return;
        }
      }
    }

    fShrinkToFit(el);
  }

  function fIsTooTallRowOnly(table)
  {
    return table.rows.length < 2;
  }

  function fPageIsOnlyEmptyBesides(el)
  {
    var parent = el.parentNode;
    parent.removeChild(el);

    var empty = fPageIsEmpty();

    parent.appendChild(el);

    return empty;
  }

  fNewPage();
  source.forEach(fPlace);

  // Remove a trailing page left empty by a break at the very end.
  if (pages.length > 1 && fPageIsEmpty())
    pages.pop().parentNode.removeChild(content.parentNode);

  // Top margins of first blocks nested inside wrappers.
  pages.forEach
  (
    function(page)
    {
      var box = page.querySelector('.pdf-content');

      for (var node = box && box.firstElementChild; node; node = node.firstElementChild)
      {
        node.style.marginTop = '0';

        if (!/^(DIV|SECTION|ARTICLE|BLOCKQUOTE)$/.test(node.tagName))
          break;
      }
    }
  );

  fResolveFills(pages);
  fDrawPageBands(doc, pages, l);

  return pages.length;
}

// Gives each page's fills (\\1, {fill}) their share of what is left of the page,
// in proportion to their weights. Done once the page is final, so the space
// they take is exactly what the text didn't.
function fResolveFills(pages)
{
  pages.forEach
  (
    function(page)
    {
      var box = page.querySelector('.pdf-content'),
          fills = box ? box.querySelectorAll('.pdf-fill') : [];

      if (!fills.length)
        return;

      var boxRect = box.getBoundingClientRect(),
          bottom = boxRect.top,
          total = 0;

      Array.prototype.forEach.call
      (
        box.querySelectorAll('*'),
        function(el)
        {
          if (!el.classList.contains('pdf-fill'))
            bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
        }
      );

      Array.prototype.forEach.call(fills, function(f) { total += parseFloat(f.getAttribute('data-fill')) || 1; });

      var spare = boxRect.bottom - bottom;

      if (spare < 1)
        return;

      Array.prototype.forEach.call
      (
        fills,
        function(f)
        {
          var weight = parseFloat(f.getAttribute('data-fill')) || 1;
          // A hair short of the whole, so rounding can never tip the page over.
          f.style.height = (spare * weight / total * 0.995).toFixed(2) + 'px';
        }
      );
    }
  );
}

// For the server's CSS-paginated PDF, which cannot stretch space across a page
// by itself: the text between two forced breaks that holds a fill becomes one
// page-height flex column, in which each fill grows with its weight. (A segment
// longer than a page just flows on as ordinary text, the fills collapsing.)
function fWrapFillSections(html, settings, title)
{
  var layout = fPageLayoutFromSettings(settings, title),
      sheetMm = layout.heightMm - layout.margins.top - layout.margins.bottom - 3,
      template = document.createElement('template');

  template.innerHTML = html;

  var breakTag = layout.newPage,
      segments = [[]],
      isBreakBefore = function(node)
      {
        return node.nodeType === 1 &&
               (node.classList.contains('force-break') ||
                (breakTag && node.tagName.toLowerCase() === breakTag));
      };

  Array.prototype.slice.call(template.content.childNodes).forEach
  (
    function(node)
    {
      if (node.nodeType === 1 && node.classList.contains('page-break'))
      {
        segments.push([node], []);          // the marker stands alone
        return;
      }

      if (isBreakBefore(node) && segments[segments.length - 1].length)
        segments.push([]);

      segments[segments.length - 1].push(node);
    }
  );

  var out = document.createElement('div');

  segments.forEach
  (
    function(nodes)
    {
      var hasFill = nodes.some(function(n) { return n.nodeType === 1 && (n.classList.contains('pdf-fill') || n.querySelector('.pdf-fill')); });

      if (!hasFill)
      {
        nodes.forEach(function(n) { out.appendChild(n); });
        return;
      }

      var sheet = document.createElement('div');

      sheet.className = 'pdf-sheet';
      sheet.style.minHeight = sheetMm + 'mm';

      nodes.forEach
      (
        function(n)
        {
          if (n.nodeType === 1 && n.classList.contains('pdf-fill'))
            n.style.flex = (parseFloat(n.getAttribute('data-fill')) || 1) + ' 1 0';

          sheet.appendChild(n);
        }
      );
      out.appendChild(sheet);
    }
  );

  return out.innerHTML;
}

function fDrawPageBands(doc, pages, l)
{
  var slots = {};

  function fAdd(slot, text) { (slots[slot] = slots[slot] || []).push(text); }

  if (l.header) fAdd('top-' + l.headerAlign, l.header);
  if (l.footer) fAdd('bottom-' + l.footerAlign, l.footer);
  if (l.numbers) fAdd(l.numbers, '{page}');

  pages.forEach
  (
    function(page, index)
    {
      if (l.firstPagePlain && index === 0)
        return;

      ['top', 'bottom'].forEach
      (
        function(edge)
        {
          var names = ['left', 'center', 'right'],
              used = names.some(function(n) { return slots[edge + '-' + n]; });

          if (!used)
            return;

          var band = doc.createElement('div');

          band.className = 'pdf-band pdf-band-' + edge;
          band.style.fontSize = edge === 'top' ? l.headerSize : l.footerSize;

          names.forEach
          (
            function(n)
            {
              var cell = doc.createElement('span');

              cell.className = 'pdf-slot-' + n;

              if (slots[edge + '-' + n])
                cell.textContent = slots[edge + '-' + n].map
                (
                  function(t) { return fPageSlotText(t, index + 1, pages.length, l.title); }
                ).join('  ·  ');

              band.appendChild(cell);
            }
          );

          page.appendChild(band);
        }
      );
    }
  );
}
