// Spreadsheet: tabs, cell colors and merges
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── SHEET TABS (pages) ──

function renderSheetPageTabs()
{
  var bar = document.getElementById('sheet-tabs');
  if (!bar) return;

  bar.innerHTML = sheetPages.map(function(p, i)
  {
    // mousedown-default is prevented so a mid-formula edit keeps focus while
    // the user switches tabs to pick a cell from another page.
    return '<div class="sheet-tab' + (i === sheetPageIdx ? ' active' : '') + '" onmousedown="event.preventDefault()" onclick="switchSheetPage(' + i + ')" ondblclick="renameSheetPage(' + i + ')" title="Double-click to rename">' +
      escHtml(p.name) +
      (sheetPages.length > 1 ? '<button class="sheet-tab-del" onclick="deleteSheetPage(event,' + i + ')" title="Delete tab">×</button>' : '') +
    '</div>';
  }).join('') +
  '<button class="sheet-tab-add" onclick="addSheetPage()" title="New tab">+</button>' +
  '<span class="sheet-tab-hint">' +
    (formulaPickCtx
      ? 'Click a cell to insert it into the formula on “' + escHtml(sheetPages[formulaPickCtx.pageIdx].name) + '”'
      : 'Reference other tabs in formulas: [Tab name](A1)') +
  '</span>';
}

function aliasActiveSheetPage()
{
  var page = sheetPages[sheetPageIdx];
  if (!page.colors) page.colors = {};
  if (!page.textColors) page.textColors = {};
  if (!page.merges) page.merges = {};
  sheetData = page.data;
  sheetColors = page.colors;
  sheetTextColors = page.textColors;
  sheetMerges = page.merges;
  clearEvalCache();
}

function switchSheetPage(i)
{
  if (i === sheetPageIdx || !sheetPages[i]) return;

  // Leaving a tab mid-edit: keep the typed value, and if it's a formula,
  // arm pick mode so a cell click on the destination tab inserts a
  // [Tab name](REF) reference and returns here (see cellMouseDown). The tab
  // buttons prevent mousedown-default, so the editing input hasn't blurred.
  var pickCtx = null;
  if (editingCell)
  {
    var editInp = document.getElementById('inp-' + editingCell);
    if (editInp)
    {
      sheetData[editingCell] = editInp.value;
      if (editInp.value.startsWith('='))
        pickCtx = { pageIdx: sheetPageIdx, ref: editingCell, insertStart: editInp.selectionStart, insertLen: 0 };
      editInp.readOnly = true;
    }
    editingCell = null;
  }
  else
  {
    // Formula-BAR editing gets the same treatment: leave mid-formula, click
    // a cell on the destination tab, and come back to the bar.
    var pickBar = document.getElementById('formula-bar');
    if (document.activeElement === pickBar && pickBar.value.startsWith('='))
    {
      var barRef = document.getElementById('cell-ref').value;
      sheetData[barRef] = pickBar.value;
      pickCtx = { pageIdx: sheetPageIdx, ref: barRef, insertStart: pickBar.selectionStart, insertLen: 0, viaBar: true };
    }
  }

  sheetPageIdx = i;
  aliasActiveSheetPage();
  formulaPickCtx = pickCtx;
  // Undo snapshots belong to the page they were taken on; restoring one onto
  // a different page would corrupt it, so the stacks reset per page.
  sheetUndoStack = [];
  sheetRedoStack = [];

  renderSheetPageTabs();
  ensureGridFitsData(sheetData);
  refreshAllCellDisplays();
  selectCell('A1');
  renderSheetCharts();
}

function uniqueSheetPageName(base, excludeIdx)
{
  var name = base, n = 2;
  function taken(candidate)
  {
    return sheetPages.some(function(p, i){ return i !== excludeIdx && p.name.trim().toLowerCase() === candidate.trim().toLowerCase(); });
  }
  while (taken(name)) name = base + ' ' + n++;
  return name;
}

function addSheetPage()
{
  var page = { name: uniqueSheetPageName('Sheet ' + (sheetPages.length + 1), -1), data: {}, colors: {}, textColors: {}, merges: {} };
  sheetPages.push(page);
  switchSheetPage(sheetPages.length - 1);
  saveSheetToFile();
}

function renameSheetPage(i)
{
  var page = sheetPages[i];
  if (!page) return;

  openDataModal
  (
    'Rename tab',
    '<label class="field-label">Tab name<input class="modal-input" id="sheet-tab-name" value="' + escAttr(page.name) + '"></label>' +
    '<div style="color:var(--text3);font-size:12px;margin-top:8px">Formulas on other tabs reference this one by name — e.g. [' + escHtml(page.name) + '](A1) — and don\'t update automatically when it changes.</div>',
    function()
    {
      var name = document.getElementById('sheet-tab-name').value.trim();
      if (!name) return;
      var oldName = page.name;
      page.name = uniqueSheetPageName(name, i);
      // Charts follow their tab through renames.
      sheetCharts.forEach(function(c){ if (c.page === oldName) c.page = page.name; });
      closeDataModal();
      renderSheetPageTabs();
      refreshAllCellDisplays(); // refs to the old name now show #REF
      saveSheetToFile();
    }
  );
}

function deleteSheetPage(e, i)
{
  e.stopPropagation();
  if (sheetPages.length <= 1) return;
  if (!confirm('Delete tab "' + sheetPages[i].name + '" and everything on it?')) return;

  sheetPages.splice(i, 1);
  if (sheetPageIdx >= sheetPages.length) sheetPageIdx = sheetPages.length - 1;
  else if (i < sheetPageIdx) sheetPageIdx--;

  aliasActiveSheetPage();
  sheetCharts = sheetCharts.filter(function(c){ return !c.page || sheetPages.some(function(p){ return p.name === c.page; }); });
  sheetUndoStack = [];
  sheetRedoStack = [];

  renderSheetPageTabs();
  refreshAllCellDisplays();
  selectCell('A1');
  renderSheetCharts();
  saveSheetToFile();
}

function loadSheetFile(f)
{
  sheetData = {};
  sheetPages = [];
  sheetPageIdx = 0;
  sheetCharts = [];
  sheetUndoStack = [];
  sheetRedoStack = [];

  var lines = (f.content || '').split('\n'),
      dataStart = 0;

  if(lines[0]==='---')
  {
    var end = lines.indexOf('---',1);
    dataStart = end + 2;
  }

  // A '```charts' marker ends the cell-data section - everything from there
  // is the chart block, not cell lines. Found explicitly (rather than just
  // skipping any line without '=') since a chart's JSON could itself contain
  // an '=' (e.g. in a title) and would otherwise get misread as a cell.
  var cellLines = lines.slice(dataStart),
      chartsMarker = cellLines.indexOf('```charts');

  if (chartsMarker !== -1)
  {
    var chartsEnd = cellLines.indexOf('```', chartsMarker + 1);

    if (chartsEnd !== -1)
    {
      try
      {
        sheetCharts = JSON.parse(cellLines.slice(chartsMarker + 1, chartsEnd).join('\n')) || [];
      }
      catch(e)
      {
        console.warn('Sheet charts parse error', e);
        sheetCharts = [];
      }
    }

    cellLines = cellLines.slice(0, chartsMarker);
  }

  var curPage = null;

  cellLines.forEach
  (
    function(line)
    {
      if(!line.trim())
        return;

      // `# name` starts a new tab/page. Files from before multi-tab support
      // have no heading and fall into an implicit first page below.
      if (line.charAt(0) === '#')
      {
        curPage = { name: line.replace(/^#+\s*/, '').trim() || ('Sheet ' + (sheetPages.length + 1)), data: {}, colors: {}, textColors: {}, merges: {} };
        sheetPages.push(curPage);
        return;
      }

      var refEnd = line.indexOf('=');

      if(refEnd === -1)
        return;

      if (!curPage)
      {
        curPage = { name: 'Sheet 1', data: {}, colors: {}, textColors: {}, merges: {} };
        sheetPages.push(curPage);
      }

      var ref = line.slice(0, refEnd),
          stripped = stripCellSuffixes(line.slice(refEnd + 1)),
          rest = stripped.rest,
          formulaEnd = rest.indexOf('=');

      if (stripped.color)     curPage.colors[ref] = stripped.color;
      if (stripped.textColor) curPage.textColors[ref] = stripped.textColor;
      if (stripped.merged)    curPage.merges[ref] = stripped.merged;

      // Formula cells are written as ref=formula=result; the result is informational
      // (recomputed on load), so only the formula half is kept, with '=' restored.
      if (rest !== '')
        curPage.data[ref] = (formulaEnd === -1) ? rest : ('=' + rest.slice(0, formulaEnd));
    }
  );

  if (!sheetPages.length)
    sheetPages = [{ name: 'Sheet 1', data: {}, colors: {}, textColors: {}, merges: {} }];

  sheetPageIdx = 0;
  aliasActiveSheetPage();

  // Charts made before per-tab charts existed carry no page name; pin them
  // to the first tab so they don't float over every page.
  sheetCharts.forEach(function(c){ if (!c.page) c.page = sheetPages[0].name; });

  renderSheetPageTabs();
  ensureGridFitsData(sheetData);
  refreshAllCellDisplays();
  selectCell('A1');
  renderSheetCharts();
}

function refreshAllCellDisplays()
{
  clearEvalCache();

  for (var i = 1; i <= ROWS; i++)
    for (var j = 0; j < COLS; j++)
    {
      var ref = colName(j) + i,
          v = sheetData[ref] || '',
          inp = document.getElementById('inp-' + ref);

      if (inp)
      {
        inp.value = v.startsWith('=')
                    ?
                      evalCell(ref, v)
                    :
                      v;

        inp.classList.toggle('formula-result', v.startsWith('='));
      }
    }

  applyCellDecorations();
}

// ── CELL DECORATIONS (background colors + merged cells) ──

// Refs whose <td> was touched by the previous decoration pass, so a page
// switch / undo / unmerge can cheaply reset exactly those cells.
var decoratedCellRefs = [];

function applyCellDecorations()
{
  decoratedCellRefs.forEach(function(ref)
  {
    var td = document.getElementById('cell-' + ref);
    if (!td) return;
    td.style.background = '';
    td.style.display = '';
    td.removeAttribute('colspan');
    td.removeAttribute('rowspan');
    // Text color lives on the input (inputs don't inherit the td's color).
    var inp = document.getElementById('inp-' + ref);
    if (inp) inp.style.color = '';
  });
  decoratedCellRefs = [];

  Object.keys(sheetTextColors).forEach(function(ref)
  {
    var inp = document.getElementById('inp-' + ref);
    if (!inp || !sheetTextColors[ref]) return;
    inp.style.color = sheetTextColors[ref];
    decoratedCellRefs.push(ref);
  });

  Object.keys(sheetColors).forEach(function(ref)
  {
    var td = document.getElementById('cell-' + ref);
    if (!td || !sheetColors[ref]) return;
    td.style.background = sheetColors[ref];
    decoratedCellRefs.push(ref);
  });

  Object.keys(sheetMerges).forEach(function(anchor)
  {
    var covered = sheetMerges[anchor];
    if (!covered || !covered.length) return;

    // The merge is rendered as the bounding rectangle of anchor + covered
    // cells (colspan/rowspan on the anchor, everything else hidden), so even
    // a hand-written non-rectangular list ends up displayable.
    var pa = parseName(anchor);
    if (!pa) return;
    var minRow = pa.row, maxRow = pa.row,
        minCol = colIndex(pa.col), maxCol = colIndex(pa.col);

    covered.forEach(function(ref)
    {
      var pc = parseName(ref);
      if (!pc) return;
      minRow = Math.min(minRow, pc.row); maxRow = Math.max(maxRow, pc.row);
      minCol = Math.min(minCol, colIndex(pc.col)); maxCol = Math.max(maxCol, colIndex(pc.col));
    });

    ensureGridFits(maxRow, maxCol);

    var anchorTd = document.getElementById('cell-' + anchor);
    if (!anchorTd) return;

    anchorTd.colSpan = maxCol - minCol + 1;
    anchorTd.rowSpan = maxRow - minRow + 1;
    decoratedCellRefs.push(anchor);

    for (var r = minRow; r <= maxRow; r++)
      for (var c = minCol; c <= maxCol; c++)
      {
        var ref = colName(c) + r;
        if (ref === anchor) continue;
        var td = document.getElementById('cell-' + ref);
        if (td)
        {
          td.style.display = 'none';
          decoratedCellRefs.push(ref);
        }
      }
  });
}

// Applies (or clears, with null) a background color to every cell in the
// current selection rectangle.
function applyCellColor(color)
{
  if (!selectionAnchor) return;
  sheetSnapshotForUndo();

  var box = getSelectionBoundingBox();
  for (var r = box.rowStart; r <= box.rowEnd; r++)
    for (var c = box.colStart; c <= box.colEnd; c++)
    {
      var ref = colName(c) + r;
      if (color) sheetColors[ref] = color;
      else delete sheetColors[ref];
    }

  applyCellDecorations();
  saveSheetToFile();
}

function clearCellColor() { applyCellColor(null); }

// Applies (or clears, with null) a text color to every cell in the current
// selection rectangle — same shape as applyCellColor, different map.
function applyCellTextColor(color)
{
  if (!selectionAnchor) return;
  sheetSnapshotForUndo();

  var box = getSelectionBoundingBox();
  for (var r = box.rowStart; r <= box.rowEnd; r++)
    for (var c = box.colStart; c <= box.colEnd; c++)
    {
      var ref = colName(c) + r;
      if (color) sheetTextColors[ref] = color;
      else delete sheetTextColors[ref];
    }

  applyCellDecorations();
  saveSheetToFile();
}

function clearCellTextColor() { applyCellTextColor(null); }

// ── Bucket split-button ──
// The bucket itself paints the current selection with the last-chosen color;
// the thin arrow beside it opens the color chooser. Choosing a color both
// remembers it (per browser) and applies it right away.

var currentCellColor = (function()
{
  try { return localStorage.getItem('lk_bucket_color') || '#3a5a40'; }
  catch(e) { return '#3a5a40'; }
})();

function paintBucketSwatch()
{
  var sw = document.getElementById('bucket-swatch');
  if (sw) sw.style.background = currentCellColor;
  var inp = document.getElementById('cell-color-input');
  if (inp) inp.value = currentCellColor;
}

function applyBucketColor()
{
  applyCellColor(currentCellColor);
}

function onBucketColorChosen(color)
{
  currentCellColor = color;
  try { localStorage.setItem('lk_bucket_color', color); } catch(e) {}
  paintBucketSwatch();
  applyCellColor(color);
}

// ── Text-color split-button ──
// Works exactly like the bucket above, but colors the cells' text instead of
// their background.

var currentTextColor = (function()
{
  try { return localStorage.getItem('lk_text_color') || '#d4a843'; }
  catch(e) { return '#d4a843'; }
})();

function paintTextSwatch()
{
  var sw = document.getElementById('text-swatch');
  if (sw) sw.style.background = currentTextColor;
  var inp = document.getElementById('text-color-input');
  if (inp) inp.value = currentTextColor;
}

function applyTextColor()
{
  applyCellTextColor(currentTextColor);
}

function onTextColorChosen(color)
{
  currentTextColor = color;
  try { localStorage.setItem('lk_text_color', color); } catch(e) {}
  paintTextSwatch();
  applyCellTextColor(color);
}

// Merges the selected rectangle into one big cell (top-left becomes the
// anchor), or splits it back apart when the selection sits on an existing
// merge.
function toggleMergeSelection()
{
  if (!selectionAnchor) return;

  var box = getSelectionBoundingBox();

  // Unmerge: any existing anchor inside the selection wins.
  var existing = Object.keys(sheetMerges).find(function(anchor)
  {
    var pa = parseName(anchor);
    return pa && pa.row >= box.rowStart && pa.row <= box.rowEnd &&
           colIndex(pa.col) >= box.colStart && colIndex(pa.col) <= box.colEnd;
  });

  sheetSnapshotForUndo();

  if (existing)
  {
    delete sheetMerges[existing];
  }
  else
  {
    if (box.rowStart === box.rowEnd && box.colStart === box.colEnd)
      return; // a single cell has nothing to merge with

    var anchor = colName(box.colStart) + box.rowStart,
        covered = [];

    for (var r = box.rowStart; r <= box.rowEnd; r++)
      for (var c = box.colStart; c <= box.colEnd; c++)
      {
        var ref = colName(c) + r;
        if (ref !== anchor) covered.push(ref);
      }

    sheetMerges[anchor] = covered;
  }

  applyCellDecorations();
  saveSheetToFile();
  selectCell(existing || (colName(box.colStart) + box.rowStart));
}

function sheetSnapshotForUndo()
{
  sheetUndoStack.push({ data: JSON.parse(JSON.stringify(sheetData)), charts: JSON.parse(JSON.stringify(sheetCharts)), colors: JSON.parse(JSON.stringify(sheetColors)), textColors: JSON.parse(JSON.stringify(sheetTextColors)), merges: JSON.parse(JSON.stringify(sheetMerges)) });
  sheetRedoStack = [];

  if (sheetUndoStack.length > 100)
    sheetUndoStack.shift();
}

function sheetRestoreSnapshot(fromStack, toStack)
{
  if (!fromStack.length)
    return;

  toStack.push({ data: JSON.parse(JSON.stringify(sheetData)), charts: JSON.parse(JSON.stringify(sheetCharts)), colors: JSON.parse(JSON.stringify(sheetColors)), textColors: JSON.parse(JSON.stringify(sheetTextColors)), merges: JSON.parse(JSON.stringify(sheetMerges)) });

  var snap = fromStack.pop();

  sheetData = snap.data;
  sheetColors = snap.colors || {};
  sheetTextColors = snap.textColors || {};
  sheetMerges = snap.merges || {};
  var snapPage = sheetPages[sheetPageIdx]; // keep the page aliases in sync
  snapPage.data = sheetData;
  snapPage.colors = sheetColors;
  snapPage.textColors = sheetTextColors;
  snapPage.merges = sheetMerges;
  sheetCharts = snap.charts;
  ensureGridFitsData(sheetData);

  // Mid-edit cell state belongs to whatever was being typed, which the
  // snapshot doesn't track - drop back to read-only rather than leaving a
  // stale editable input pointed at a ref that may no longer make sense.
  if (editingCell)
  {
    var inp = document.getElementById('inp-' + editingCell);

    if (inp)
      inp.readOnly = true;

    editingCell = null;
  }

  refreshAllCellDisplays();
  renderSheetCharts();
  evaluateFormulas();
  saveSheetToFile();
  refreshRefHighlights();
}

function sheetUndo()
{
  sheetRestoreSnapshot(sheetUndoStack, sheetRedoStack);
}

function sheetRedo()
{
  sheetRestoreSnapshot(sheetRedoStack, sheetUndoStack);
}

// Serializing + persisting on every step of a drag (ref-box moves, fill
// drags, chart drags all save as they go) is wasted work: mark the sheet
// dirty instead and let the post-drag flush below write once.
var sheetSaveDeferred = false;

// Persisting (disk/network write, backlink scan, sidebar re-render) is also
// too heavy to run per keystroke — files[..].content is always updated
// synchronously, only the persist itself trails behind.
var sheetPersistTimer = null;
var sheetPersistId = null;

function scheduleSheetPersist(id)
{
  sheetPersistId = id;
  clearTimeout(sheetPersistTimer);
  sheetPersistTimer = setTimeout(function()
  {
    sheetPersistTimer = null;
    persistFileEntry(id);
  }, 400);
}

window.addEventListener('beforeunload', function()
{
  if (sheetPersistTimer)
  {
    clearTimeout(sheetPersistTimer);
    sheetPersistTimer = null;
    persistFileEntry(sheetPersistId);
  }
});

function saveSheetToFile()
{
  // The grid is always live even when no spreadsheet is open, so without the
  // type check an empty sheet would serialize itself over whatever file
  // happens to be current (e.g. the document opened before switching tabs).
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'sheet')
    return;

  if (sheetDragActive())
  {
    sheetSaveDeferred = true;
    return;
  }

  var out = '---\ntype: spreadsheet\n---\n\n';

  sheetPages.forEach(function(page, p)
  {
    if (p > 0) out += '\n';
    out += '# ' + page.name + '\n';

    // Iterate the page's own cells (row-major) rather than the grid bounds:
    // the grid is sized for the ACTIVE page, and clipping another page's
    // far-out cells to it would silently drop them from the file. Cells with
    // only a color/merge (no value) still get a line, so the decoration keeps.
    var colors = page.colors || {},
        textColors = page.textColors || {},
        merges = page.merges || {},
        cellKeys = {};
    Object.keys(page.data).forEach(function(ref){ if (page.data[ref]) cellKeys[ref] = true; });
    Object.keys(colors).forEach(function(ref){ if (colors[ref]) cellKeys[ref] = true; });
    Object.keys(textColors).forEach(function(ref){ if (textColors[ref]) cellKeys[ref] = true; });
    Object.keys(merges).forEach(function(ref){ if (merges[ref] && merges[ref].length) cellKeys[ref] = true; });

    // Alias the page in once for the whole loop (rather than per formula via
    // evalCellOnPage) so the eval cache holds across its cells.
    var savedData = sheetData;
    sheetData = page.data;
    if (savedData !== page.data) clearEvalCache();

    Object.keys(cellKeys)
      .map(function(ref){ return { ref: ref, at: parseName(ref) }; })
      .filter(function(c){ return !!c.at; })
      .sort(function(a, b){ return a.at.row - b.at.row || colIndex(a.at.col) - colIndex(b.at.col); })
      .forEach(function(c)
      {
        var val = page.data[c.ref] || '';
        var cellLine = val.startsWith('=')
                       ? c.ref + '=' + val.slice(1) + '=' + evalCell(c.ref, val)
                       : c.ref + '=' + val;
        if (merges[c.ref] && merges[c.ref].length) cellLine += ':' + merges[c.ref].join(',');
        if (colors[c.ref]) cellLine += ';' + colors[c.ref];
        if (textColors[c.ref]) cellLine += ';txt' + textColors[c.ref];
        out += cellLine + '\n';
      });

    sheetData = savedData;
    if (savedData !== page.data) clearEvalCache();
  });

  if (sheetCharts.length)
    out += '\n```charts\n' + JSON.stringify(sheetCharts) + '\n```\n';

  files[currentFileId].content = out;
  files[currentFileId].modified = Date.now();

  scheduleSheetPersist(currentFileId);
}
