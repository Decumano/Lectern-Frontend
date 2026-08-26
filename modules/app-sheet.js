// Spreadsheet: grid, growth, fill handle, reference highlights
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── SHEET ──
document.addEventListener
(
  'mouseup',
  function()
  {
    isDragging = false;

    if (isRefDragging)
    {
      isRefDragging = false;
      formulaInsertStart = null;
      formulaInsertLength = 0;

      var inp = refDragViaBar ? document.getElementById('formula-bar')
                              : document.getElementById('inp-' + editingCell);
      refDragViaBar = false;

      if (inp)
        inp.focus();
    }

    if (isFillDragging)
    {
      isFillDragging = false;

      if (fillRange)
        performFill();

      clearFillPreview();
      fillRange = null;
      fillSourceBox = null;
    }
  }
);

document.addEventListener
(
  'copy',
  function(copyEvent)
  {
    // Let native copy behavior run while editing (e.g. copying part of a
    // formula's text) or when focus isn't on the grid at all.
    if (editingCell)
      return;

    var active = document.activeElement;

    if (!active || !active.closest('#sheet-body'))
      return;

    if (!selectionAnchor || !selectionEnd)
      return;

    copyEvent.preventDefault();
    copyEvent.clipboardData.setData('text/plain', buildRangeTSV(selectionAnchor, selectionEnd));
  }
);

document.addEventListener
(
  'paste',
  function(pasteEvent)
  {
    // Same guard as the copy handler above: let native paste run while
    // editing a single cell/formula, or when focus isn't on the grid at all
    // (e.g. pasting into the formula bar should just paste text normally).
    if (editingCell)
      return;

    var active = document.activeElement;

    if (!active || !active.closest('#sheet-body'))
      return;

    if (!selectionAnchor || !pasteEvent.clipboardData)
      return;

    var text = pasteEvent.clipboardData.getData('text/plain');

    if (!text)
      return;

    pasteEvent.preventDefault();
    pasteTSVAt(selectionAnchor, text);
  }
);

document.addEventListener
(
  'keydown',
  function(e)
  {
    if (currentAppType !== 'sheet')
      return;

    // Mid-edit (a cell or the formula bar), let native text-undo run instead
    // of jumping back through the sheet-wide stack - same exclusion the
    // copy/paste handlers above already use.
    if (editingCell || document.activeElement === document.getElementById('formula-bar'))
      return;

    if (!(e.ctrlKey || e.metaKey))
      return;

    if (!e.shiftKey && e.key.toLowerCase() === 'z')
    {
      e.preventDefault();
      sheetUndo();
    }
    else if (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
    {
      e.preventDefault();
      sheetRedo();
    }
  }
);

// Writes tab/newline-delimited clipboard text (the format every major
// spreadsheet - Excel, Google Sheets, OnlyOffice - puts on the clipboard for
// a copied range) into the grid starting at anchorRef, growing right/down.
function pasteTSVAt(anchorRef, text)
{
  var anchor = parseName(anchorRef);

  if (!anchor)
    return;

  sheetSnapshotForUndo();

  var rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Spreadsheets terminate clipboard TSV with a trailing newline - without
  // dropping it, the paste would write one extra (empty) row past the data.
  if (rows.length > 1 && rows[rows.length - 1] === '')
    rows.pop();

  var startCol = colIndex(anchor.col),
      startRow = anchor.row,
      lastRef = anchorRef;

  rows.forEach
  (
    function(rowText, r)
    {
      rowText.split('\t').forEach
      (
        function(cellText, c)
        {
          var col = startCol + c,
              row = startRow + r;

          // Pasted blocks push the grid outward instead of being clipped.
          ensureGridFits(row, col);

          if (col >= COLS || row > ROWS)
            return;

          var ref = colName(col) + row;

          sheetData[ref] = cellText;
          lastRef = ref;

          var inp = document.getElementById('inp-' + ref);

          if (inp)
          {
            inp.value = cellText.startsWith('=') ? evalCell(ref, cellText) : cellText;
            inp.classList.toggle('formula-result', cellText.startsWith('='));
          }
        }
      );
    }
  );

  // evaluateFormulas recalculates every formula cell on the sheet (not just
  // the pasted ones) - needed since other formulas may reference cells that
  // just changed - and also refreshes any charts built from this range.
  evaluateFormulas();
  saveSheetToFile();

  selectCell(anchorRef);
  selectionEnd = lastRef;
  renderRangeSelection();
}

function getDisplayValue(ref)
{
  var val = sheetData[ref] || '';
  return val.startsWith('=') ? evalCell(ref, val) : val;
}

function buildRangeTSV(anchorRef, endRef)
{
  var anchor = parseName(anchorRef),
      end = parseName(endRef);

  if (!anchor || !end)
    return '';

  var anchorCol = colIndex(anchor.col),
      endCol = colIndex(end.col),
      rowStart = Math.min(anchor.row, end.row),
      rowEnd = Math.max(anchor.row, end.row),
      colStart = Math.min(anchorCol, endCol),
      colEnd = Math.max(anchorCol, endCol),
      rows = [];

  for (var r = rowStart; r <= rowEnd; r++)
  {
    var cells = [];

    for (var c = colStart; c <= colEnd; c++)
      cells.push(getDisplayValue(colName(c) + r));

    rows.push(cells.join('\t'));
  }

  return rows.join('\n');
}

function buildSheet()
{
  var head = document.getElementById('sheet-head');

  var tableHeadNames ='<tr>'+
                        '<th class="row-header" style="top: 0; left: 0; z-index: 4;">'+
                        '</th>';

  for (var i = 0; i < COLS; i++)
    tableHeadNames +=   '<th class="col-header" id="colh-' + i + '" onmousedown="colHeaderMouseDown(event,' + i + ')">' +
                          colName(i) +
                        '</th>';

  head.innerHTML = tableHeadNames +
                      '</tr>';

  var body = document.getElementById('sheet-body'),
      html = '';

  for (var i = 1; i <= ROWS; i++)
  {
    html += '<tr>' +
              '<th class="row-header" id="rowh-' + i + '" onmousedown="rowHeaderMouseDown(event,' + i + ')" style="position: sticky; left: 0; z-index: 1;">' +
                i +
              '</th>';

    for (var j = 0; j < COLS; j++)
      html += sheetCellHtml(colName(j) + i);

    html += '</tr>';
  }

  document.getElementById('sheet-body').innerHTML = html;

  paintBucketSwatch();
  paintTextSwatch();
}

function sheetCellHtml(ref)
{
  return '<td id="cell-' + ref + '" onmousedown="cellMouseDown(event,\'' + ref + '\')" onmouseenter="cellMouseEnter(\'' + ref + '\')" ondblclick="cellDblClick(\'' + ref + '\')">'+
           '<input class="cell-input" id="inp-' + ref + '" value="" readonly onkeydown="cellKey(event, \'' + ref + '\')" onfocus="onCellFocus(\'' + ref + '\')" oninput="onCellInput(\'' + ref + '\')" onblur="onCellBlur(\'' + ref + '\')">'+
         '</td>';
}

// ── GRID GROWTH ──
// The grid isn't fixed-size: whenever content or the selection gets close to
// an edge, more rows/columns are appended (chunked, to keep DOM churn low).
// Columns run past Z into two-letter names, up to ZZ.

var MAX_SHEET_COLS = 702; // "ZZ"
var GROW_ROW_CHUNK = 12;
var GROW_COL_CHUNK = 4;

function growSheetGrid(targetRows, targetCols)
{
  targetCols = Math.min(targetCols, MAX_SHEET_COLS);
  if (targetRows <= ROWS && targetCols <= COLS)
    return;

  var head = document.getElementById('sheet-head'),
      body = document.getElementById('sheet-body');

  if (!head || !body || !head.rows.length)
  {
    ROWS = Math.max(ROWS, targetRows);
    COLS = Math.max(COLS, targetCols);
    return;
  }

  // New columns first: header cell plus a td on every existing row, so the
  // new rows below are built at the full width.
  if (targetCols > COLS)
  {
    var headRow = head.rows[0];
    for (var j = COLS; j < targetCols; j++)
    {
      var th = document.createElement('th');
      th.className = 'col-header';
      th.id = 'colh-' + j;
      th.setAttribute('onmousedown', 'colHeaderMouseDown(event,' + j + ')');
      th.textContent = colName(j);
      headRow.appendChild(th);
    }
    for (var r = 0; r < body.rows.length; r++)
    {
      var rowNum = r + 1, cells = '';
      for (var jj = COLS; jj < targetCols; jj++)
        cells += sheetCellHtml(colName(jj) + rowNum);
      body.rows[r].insertAdjacentHTML('beforeend', cells);
    }
    COLS = targetCols;
  }

  if (targetRows > ROWS)
  {
    var html = '';
    for (var i = ROWS + 1; i <= targetRows; i++)
    {
      html += '<tr><th class="row-header" id="rowh-' + i + '" onmousedown="rowHeaderMouseDown(event,' + i + ')" style="position: sticky; left: 0; z-index: 1;">' + i + '</th>';
      for (var j2 = 0; j2 < COLS; j2++)
        html += sheetCellHtml(colName(j2) + i);
      html += '</tr>';
    }
    body.insertAdjacentHTML('beforeend', html);
    ROWS = targetRows;
  }
}

/// Grows the grid so (row, col) sits comfortably inside it — being within a
/// couple of cells of an edge already triggers the next chunk.
function ensureGridFits(row, col)
{
  var targetRows = ROWS, targetCols = COLS;
  while (row > targetRows - 3) targetRows += GROW_ROW_CHUNK;
  while (col > targetCols - 3 && targetCols < MAX_SHEET_COLS) targetCols += GROW_COL_CHUNK;
  growSheetGrid(targetRows, targetCols);
}

function ensureGridFitsData(data)
{
  var maxRow = 0, maxCol = 0;
  Object.keys(data || {}).forEach(function(ref)
  {
    var p = parseName(ref);
    if (!p) return;
    if (p.row > maxRow) maxRow = p.row;
    var ci = colIndex(p.col);
    if (ci > maxCol) maxCol = ci;
  });
  if (maxRow || maxCol) ensureGridFits(maxRow, maxCol);
}

// Bijective base-26 column names: 0..25 = A..Z, 26 = AA, 27 = AB, … 701 = ZZ.
function colName(i)
{
    if (i < 26)
      return String.fromCharCode(65 + i);
    return String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

function colIndex(name)
{
    if (name.length === 1)
      return name.charCodeAt(0) - 65;
    return (name.charCodeAt(0) - 65 + 1) * 26 + (name.charCodeAt(1) - 65);
}

function parseName(cellReference)
{
    // '$' (absolute-reference markers, e.g. $A$1) carry no meaning for lookups,
    // only for how shiftFormulaRefs treats them during a fill-drag.
    var matched = cellReference.match(/^\$?([A-Z]+)\$?(\d+)$/);

    if(!matched)
      return null;

    return {
      col: matched[1],
      row: parseInt(matched[2])
    };
}

function selectCell(name)
{
  document.querySelectorAll('#sheet-body td.active').forEach
  (
    function(activeSheetCell)
    {
      activeSheetCell.classList.remove('active');
    }
  );

  document.querySelectorAll('#sheet-body td.selected').forEach
  (
    function(selectedSheetCell)
    {
      selectedSheetCell.classList.remove('selected');
    }
  );

  var parsedName = parseName(name);

  if(!parsedName)
    return;

  activeCell = {
    row: parsedName.row,
    col: colIndex(parsedName.col)
  };

  // Selection moving near an edge pulls more rows/columns into existence.
  ensureGridFits(activeCell.row, activeCell.col);

  selectionAnchor = name;
  selectionEnd = name;

  var selectedCell = document.getElementById('cell-' + name);

  if(selectedCell)
    selectedCell.classList.add('active');

  document.getElementById('cell-ref').value = name;
  document.getElementById('formula-bar').value = sheetData[name] || '';

  refreshFillHandle();
  updateHeaderHighlights();
  refreshRefHighlights();
}

// Marks the row/column header cells spanning the current selection, so the
// margins always show where you are.
function updateHeaderHighlights()
{
  document.querySelectorAll('#sheet-grid th.hl').forEach
  (
    function(th)
    {
      th.classList.remove('hl');
    }
  );

  if (!selectionAnchor)
    return;

  var box = getSelectionBoundingBox();
  if (!box)
    return;

  for (var r = box.rowStart; r <= box.rowEnd; r++)
  {
    var rh = document.getElementById('rowh-' + r);
    if (rh) rh.classList.add('hl');
  }

  for (var c = box.colStart; c <= box.colEnd; c++)
  {
    var ch = document.getElementById('colh-' + c);
    if (ch) ch.classList.add('hl');
  }
}

function cellMouseDown(mouseEvent, name)
{
  if (mouseEvent.button !== 0)
    return;

  var inp = document.getElementById('inp-' + name);

  // A cell mid-edit (double-clicked, readOnly removed) should keep native
  // text-caret/selection behavior instead of starting a range drag.
  if (inp && !inp.readOnly)
    return;

  // Cross-tab pick mode: a formula is pending on another tab; insert this
  // cell as [Tab name](REF) into it and jump back to where it was typed.
  if (formulaPickCtx && !editingCell)
  {
    mouseEvent.preventDefault();

    var ctx = formulaPickCtx;
    formulaPickCtx = null;

    var srcPage = sheetPages[ctx.pageIdx];
    if (!srcPage) return;

    var refText = '[' + sheetPages[sheetPageIdx].name + '](' + name + ')',
        srcVal = srcPage.data[ctx.ref] || '=',
        insertAt = Math.min(ctx.insertStart, srcVal.length);

    srcPage.data[ctx.ref] = srcVal.slice(0, insertAt) + refText + srcVal.slice(insertAt + ctx.insertLen);

    var caretPos = insertAt + refText.length,
        backRef = ctx.ref;

    switchSheetPage(ctx.pageIdx);

    if (ctx.viaBar)
    {
      // Resume in the formula bar: selectCell repopulates it from
      // sheetData (which now holds the formula with the inserted ref).
      selectCell(backRef);
      var backBar = document.getElementById('formula-bar');
      backBar.focus();
      backBar.setSelectionRange(caretPos, caretPos);
    }
    else
    {
      enterEditMode(backRef);
      var backInp = document.getElementById('inp-' + backRef);
      if (backInp) backInp.setSelectionRange(caretPos, caretPos);
    }
    return;
  }

  // While editing a formula, clicking/dragging other cells is a range
  // picker: it inserts the reference at the caret instead of navigating.
  if (editingCell && (sheetData[editingCell] || '').startsWith('='))
  {
    mouseEvent.preventDefault();

    var editingInput = document.getElementById('inp-' + editingCell);

    isRefDragging = true;
    refDragViaBar = false;
    selectionAnchor = name;
    selectionEnd = name;
    formulaInsertStart = editingInput ? editingInput.selectionStart : 0;
    formulaInsertLength = 0;

    insertFormulaRef(name, name);
    return;
  }

  // The same picker for formula-BAR editing: with the bar focused and
  // holding a formula, clicking cells inserts references instead of moving
  // the selection away (which used to clobber the half-typed formula).
  // Focus is still on the bar at mousedown time; preventDefault keeps it.
  var formulaBar = document.getElementById('formula-bar');
  if (document.activeElement === formulaBar && formulaBar.value.startsWith('='))
  {
    mouseEvent.preventDefault();

    isRefDragging = true;
    refDragViaBar = true;
    selectionAnchor = name;
    selectionEnd = name;
    formulaInsertStart = formulaBar.selectionStart;
    formulaInsertLength = 0;

    insertFormulaRef(name, name);
    return;
  }

  isDragging = true;
  selectCell(name);
}

// Clicking a column letter or row number in the margins: while a formula is
// being typed it inserts the whole-column/row range (A:A / 4:4) at the caret,
// mirroring cellMouseDown's cell picker; otherwise it selects the whole
// column or row.
function colHeaderMouseDown(mouseEvent, col)
{
  var letter = colName(col);
  headerMouseDown(mouseEvent, letter + ':' + letter, letter + '1', letter + ROWS);
}

function rowHeaderMouseDown(mouseEvent, row)
{
  headerMouseDown(mouseEvent, row + ':' + row, 'A' + row, colName(COLS - 1) + row);
}

function headerMouseDown(mouseEvent, rangeText, selAnchor, selEnd)
{
  if (mouseEvent.button !== 0)
    return;

  // Mid-formula in a cell: insert the range at the caret, keep typing.
  if (editingCell && (sheetData[editingCell] || '').startsWith('='))
  {
    mouseEvent.preventDefault();

    var editingInput = document.getElementById('inp-' + editingCell);
    refDragViaBar = false;
    formulaInsertStart = editingInput ? editingInput.selectionStart : 0;
    formulaInsertLength = 0;
    insertFormulaText(rangeText);
    formulaInsertStart = null;
    formulaInsertLength = 0;
    if (editingInput) editingInput.focus();
    return;
  }

  // Mid-formula in the formula bar: same insertion there.
  var formulaBar = document.getElementById('formula-bar');
  if (document.activeElement === formulaBar && formulaBar.value.startsWith('='))
  {
    mouseEvent.preventDefault();

    refDragViaBar = true;
    formulaInsertStart = formulaBar.selectionStart;
    formulaInsertLength = 0;
    insertFormulaText(rangeText);
    refDragViaBar = false;
    formulaInsertStart = null;
    formulaInsertLength = 0;
    formulaBar.focus();
    return;
  }

  // Otherwise: select the whole row/column.
  selectCell(selAnchor);
  selectionEnd = selEnd;
  renderRangeSelection();
}

function cellMouseEnter(name)
{
  if (isFillDragging)
  {
    updateFillPreview(name);
    return;
  }

  if (isRefDragging)
  {
    selectionEnd = name;
    insertFormulaRef(selectionAnchor, name);
    return;
  }

  if (!isDragging)
    return;

  selectionEnd = name;
  renderRangeSelection();
}

function insertFormulaRef(anchorRef, endRef)
{
  var refText = (anchorRef === endRef) ? anchorRef : (anchorRef + ':' + endRef);
  insertFormulaText(refText);
}

function insertFormulaText(refText)
{
  // The picker serves two editing surfaces: the in-cell input, or the
  // formula bar (refDragViaBar) — same insertion logic either way.
  var targetRef = refDragViaBar ? document.getElementById('cell-ref').value : editingCell,
      inp = refDragViaBar ? document.getElementById('formula-bar')
                          : document.getElementById('inp-' + editingCell);

  if (!inp || !targetRef)
    return;

  var before = inp.value.slice(0, formulaInsertStart),
      after = inp.value.slice(formulaInsertStart + formulaInsertLength);

  inp.value = before + refText + after;
  formulaInsertLength = refText.length;

  var caretPos = formulaInsertStart + formulaInsertLength;
  inp.setSelectionRange(caretPos, caretPos);

  sheetData[targetRef] = inp.value;

  // Bar editing: mirror the raw formula into the cell's own input too.
  if (refDragViaBar)
  {
    var cellInp = document.getElementById('inp-' + targetRef);
    if (cellInp) cellInp.value = inp.value;
  }

  evaluateFormulas(targetRef);
  saveSheetToFile();

  renderRangeSelection();
  refreshRefHighlights();
}

function renderRangeSelection()
{
  document.querySelectorAll('#sheet-body td.selected').forEach
  (
    function(selectedSheetCell)
    {
      selectedSheetCell.classList.remove('selected');
    }
  );

  if (!selectionAnchor || !selectionEnd || selectionAnchor === selectionEnd)
  {
    updateHeaderHighlights();
    return;
  }

  var anchor = parseName(selectionAnchor),
      end = parseName(selectionEnd);

  if (!anchor || !end)
    return;

  var anchorCol = colIndex(anchor.col),
      endCol = colIndex(end.col),
      rowStart = Math.min(anchor.row, end.row),
      rowEnd = Math.max(anchor.row, end.row),
      colStart = Math.min(anchorCol, endCol),
      colEnd = Math.max(anchorCol, endCol);

  for (var r = rowStart; r <= rowEnd; r++)
    for (var c = colStart; c <= colEnd; c++)
    {
      var cellRef = colName(c) + r,
          td = document.getElementById('cell-' + cellRef);

      if (td && cellRef !== selectionAnchor)
        td.classList.add('selected');
    }

  document.getElementById('cell-ref').value = selectionAnchor + ':' + selectionEnd;

  refreshFillHandle();
  updateHeaderHighlights();
}

// ── FILL HANDLE (drag-fill, like Excel/Sheets) ──
function refreshFillHandle()
{
  if (editingCell)
    removeFillHandle();
  else
    updateFillHandlePosition();
}

function updateFillHandlePosition()
{
  var endRef = selectionEnd || selectionAnchor;

  if (!endRef)
  {
    removeFillHandle();
    return;
  }

  var td = document.getElementById('cell-' + endRef);

  if (!td)
  {
    removeFillHandle();
    return;
  }

  var handle = document.getElementById('fill-handle');

  if (!handle)
  {
    handle = document.createElement('div');
    handle.id = 'fill-handle';
    handle.className = 'fill-handle';
    handle.addEventListener('mousedown', fillHandleMouseDown);
  }

  td.appendChild(handle);
}

function removeFillHandle()
{
  var handle = document.getElementById('fill-handle');

  if (handle)
    handle.remove();
}

// ── FORMULA REFERENCE HIGHLIGHTS ──
// While a formula is being edited (in-cell or in the bar) — or a cell holding
// one is selected — every cell/range reference in it gets a colored box on
// the grid. The boxes are live: dragging an edge moves the reference,
// dragging a range's corner handle resizes it, and the formula text updates
// as you go. Only box edges/handles take pointer events, so the cells inside
// stay clickable.

var REF_BOX_COLORS = ['#4a7fa8', '#c0574a', '#5a9a6e', '#9d6fd1', '#d18b3f', '#3fa7b0', '#d4a843'];

var refHighlights = [];  // tokens of the highlighted formula, in text order
var refBoxDrag = null;   // active box drag: {index, mode, src, lastRow, lastCol, anchorRow, anchorCol}

// Where the highlighted formula lives right now: the in-cell edit, the
// formula bar, or (fallback) the selected cell's stored value.
function refHighlightSource()
{
  if (editingCell)
  {
    var inp = document.getElementById('inp-' + editingCell);
    if (inp && !inp.readOnly)
      return { ref: editingCell, inp: inp, viaBar: false, editing: true };
  }

  var bar = document.getElementById('formula-bar');
  if (document.activeElement === bar && bar.value.startsWith('='))
    return { ref: document.getElementById('cell-ref').value, inp: bar, viaBar: true, editing: true };

  if (selectionAnchor && (!selectionEnd || selectionEnd === selectionAnchor))
    return { ref: selectionAnchor, inp: null, viaBar: false, editing: false };

  return null;
}

function refSourceText(src)
{
  return src.inp ? src.inp.value : (sheetData[src.ref] || '');
}

// Classifies one matched reference and normalizes it into a grid box
// (r1<=r2, c1<=c2). d holds the '$' markers so moving/resizing keeps them.
function refTokenInfo(text)
{
  var m;

  if ((m = text.match(/^(\$?)([A-Z]{1,2})(\$?)(\d+):(\$?)([A-Z]{1,2})(\$?)(\d+)$/)))
  {
    var ca = colIndex(m[2]), cb = colIndex(m[6]), ra = +m[4], rb = +m[8];
    return { kind: 'range', c1: Math.min(ca, cb), c2: Math.max(ca, cb),
             r1: Math.min(ra, rb), r2: Math.max(ra, rb), d: [m[1], m[3], m[5], m[7]] };
  }

  if ((m = text.match(/^(\$?)([A-Z]{1,2}):(\$?)([A-Z]{1,2})$/)))
  {
    var cc = colIndex(m[2]), cd = colIndex(m[4]);
    return { kind: 'col', c1: Math.min(cc, cd), c2: Math.max(cc, cd), d: [m[1], m[3]] };
  }

  if ((m = text.match(/^(\$?)(\d+):(\$?)(\d+)$/)))
  {
    var re = +m[2], rf = +m[4];
    if (re < 1 || rf < 1) return null;
    return { kind: 'row', r1: Math.min(re, rf), r2: Math.max(re, rf), d: [m[1], m[3]] };
  }

  if ((m = text.match(/^(\$?)([A-Z]{1,2})(\$?)(\d+)$/)))
    return { kind: 'cell', c1: colIndex(m[2]), c2: colIndex(m[2]), r1: +m[4], r2: +m[4], d: [m[1], m[3]] };

  return null;
}

function refTokenText(tok)
{
  var d = tok.d;

  if (tok.kind === 'cell') return d[0] + colName(tok.c1) + d[1] + tok.r1;
  if (tok.kind === 'col')  return d[0] + colName(tok.c1) + ':' + d[1] + colName(tok.c2);
  if (tok.kind === 'row')  return d[0] + tok.r1 + ':' + d[1] + tok.r2;

  return d[0] + colName(tok.c1) + d[1] + tok.r1 + ':' + d[2] + colName(tok.c2) + d[3] + tok.r2;
}

// Parses cell refs (A3), ranges (A1:B3) and whole-column/row ranges (A:A,
// 4:4) out of a formula's text, with their offsets, so each can later be
// replaced in place. Quoted strings and cross-tab [Tab](A1) links are masked
// (same length, so offsets hold) to keep their contents from reading as refs.
function parseFormulaRefTokens(text)
{
  if (!text || !text.startsWith('='))
    return [];

  var masked = text
    .replace(/"[^"]*"|'[^']*'/g, function(m){ return m.replace(/./g, ' '); })
    .replace(/\[[^\]]*\]\([^)]*\)/g, function(m){ return m.replace(/./g, ' '); });

  var re = /(?<![A-Za-z0-9_$:])(?:\$?[A-Z]{1,2}\$?\d+:\$?[A-Z]{1,2}\$?\d+|\$?[A-Z]{1,2}:\$?[A-Z]{1,2}|\$?\d+:\$?\d+|\$?[A-Z]{1,2}\$?\d+)(?![A-Za-z0-9_$:])/g,
      tokens = [],
      m;

  while ((m = re.exec(masked)))
  {
    var info = refTokenInfo(m[0]);
    if (!info) continue;

    info.start = m.index;
    info.end = m.index + m[0].length;
    info.text = m[0];
    tokens.push(info);
  }

  return tokens;
}

// Pixel geometry of a token's box, relative to the ref layer (which sits at
// the grid's content origin). Whole-column/row boxes span the current grid.
function refBoxGeometry(tok)
{
  var r1 = tok.kind === 'col' ? 1 : tok.r1,
      r2 = tok.kind === 'col' ? ROWS : Math.min(tok.r2, ROWS),
      c1 = tok.kind === 'row' ? 0 : tok.c1,
      c2 = tok.kind === 'row' ? COLS - 1 : Math.min(tok.c2, COLS - 1);

  if (r1 > ROWS || c1 > COLS - 1)
    return null;

  var layer = document.getElementById('sheet-ref-layer'),
      tdA = document.getElementById('cell-' + colName(c1) + r1),
      tdB = document.getElementById('cell-' + colName(c2) + r2);

  // Cells hidden by a merge report zero size; skip rather than draw a
  // zero-anchored box.
  if (!layer || !tdA || !tdB || !tdA.offsetWidth || !tdB.offsetWidth)
    return null;

  var la = layer.getBoundingClientRect(),
      ra = tdA.getBoundingClientRect(),
      rb = tdB.getBoundingClientRect();

  return { left: ra.left - la.left, top: ra.top - la.top,
           width: rb.right - ra.left, height: rb.bottom - ra.top };
}

function buildRefBoxElement(tok, index)
{
  var geo = refBoxGeometry(tok);
  if (!geo)
    return null;

  var color = REF_BOX_COLORS[index % REF_BOX_COLORS.length],
      box = document.createElement('div');

  box.className = 'ref-box';
  box.style.left = geo.left + 'px';
  box.style.top = geo.top + 'px';
  box.style.width = geo.width + 'px';
  box.style.height = geo.height + 'px';
  box.style.borderColor = color;
  box.style.background = color + '14';

  ['top', 'right', 'bottom', 'left'].forEach(function(side)
  {
    var edge = document.createElement('div');
    edge.className = 'ref-box-edge ' + side;
    edge.addEventListener('mousedown', function(e){ startRefBoxDrag(e, index, 'move'); });
    box.appendChild(edge);
  });

  if (tok.kind !== 'cell')
  {
    var handle = document.createElement('div');
    handle.className = 'ref-box-size';
    handle.style.background = color;
    handle.addEventListener('mousedown', function(e){ startRefBoxDrag(e, index, 'resize'); });
    box.appendChild(handle);
  }

  return box;
}

function refreshRefHighlights()
{
  var layer = document.getElementById('sheet-ref-layer');
  if (!layer)
    return;

  layer.innerHTML = '';
  refHighlights = [];

  var src = refHighlightSource();
  if (!src)
    return;

  refHighlights = parseFormulaRefTokens(refSourceText(src));

  refHighlights.forEach(function(tok, i)
  {
    var el = buildRefBoxElement(tok, i);
    if (el) layer.appendChild(el);
  });
}

// The grid cell under a viewport point, looked up through whatever element
// is there (usually the cell's own input).
function sheetCellFromPoint(x, y)
{
  var el = document.elementFromPoint(x, y);

  while (el && el !== document.body)
  {
    if (el.id && el.id.indexOf('cell-') === 0)
    {
      var p = parseName(el.id.slice(5));
      if (p) return { row: p.row, col: colIndex(p.col) };
    }
    el = el.parentElement;
  }

  return null;
}

function startRefBoxDrag(mouseEvent, index, mode)
{
  if (mouseEvent.button !== 0)
    return;

  var src = refHighlightSource(),
      tok = refHighlights[index];

  if (!src || !tok)
    return;

  // Keeps focus (and the mid-edit state) in whichever input holds the formula.
  mouseEvent.preventDefault();
  mouseEvent.stopPropagation();

  // Dragging on a committed (not-being-edited) formula rewrites it in place,
  // so it gets its own undo step; an active edit already snapshotted.
  if (!src.editing)
    sheetSnapshotForUndo();

  var cell = sheetCellFromPoint(mouseEvent.clientX, mouseEvent.clientY);

  refBoxDrag = {
    index: index,
    mode: mode,
    src: src,
    lastRow: cell ? cell.row : (tok.kind === 'col' ? 1 : tok.r1),
    lastCol: cell ? cell.col : (tok.kind === 'row' ? 0 : tok.c1),
    anchorRow: tok.kind === 'col' ? 1 : tok.r1,
    anchorCol: tok.kind === 'row' ? 0 : tok.c1
  };

  var layer = document.getElementById('sheet-ref-layer');
  if (layer) layer.classList.add('dragging');
}

// Writes the (moved/resized) token back into the formula text and refreshes
// everything that mirrors it.
function applyRefTokenEdit(tok)
{
  var src = refBoxDrag.src,
      text = refSourceText(src),
      newText = refTokenText(tok),
      full = text.slice(0, tok.start) + newText + text.slice(tok.end);

  if (src.inp)
  {
    src.inp.value = full;
    var caret = tok.start + newText.length;
    src.inp.setSelectionRange(caret, caret);
  }

  sheetData[src.ref] = full;

  // Bar editing mirrors the raw text into the cell input; the committed-cell
  // case mirrors it into the bar instead.
  if (src.viaBar)
  {
    var cellInp = document.getElementById('inp-' + src.ref);
    if (cellInp) cellInp.value = full;
  }
  if (!src.editing)
    document.getElementById('formula-bar').value = full;

  evaluateFormulas(src.editing ? src.ref : undefined);
  saveSheetToFile();

  // Re-parse: offsets after the replaced token have shifted.
  refreshRefHighlights();
}

document.addEventListener
(
  'mousemove',
  function(mouseEvent)
  {
    if (!refBoxDrag)
      return;

    var cell = sheetCellFromPoint(mouseEvent.clientX, mouseEvent.clientY);
    if (!cell)
      return;

    var tok = refHighlights[refBoxDrag.index];
    if (!tok)
    {
      refBoxDrag = null;
      return;
    }

    var changed = false;

    if (refBoxDrag.mode === 'move')
    {
      var dr = cell.row - refBoxDrag.lastRow,
          dc = cell.col - refBoxDrag.lastCol;

      if (tok.kind === 'col') dr = 0;
      if (tok.kind === 'row') dc = 0;

      // Clamp so the box never slides off the top/left of the sheet.
      if (tok.r1 !== undefined) dr = Math.max(dr, 1 - tok.r1);
      if (tok.c1 !== undefined) dc = Math.max(dc, -tok.c1);

      if (dr || dc)
      {
        if (tok.r1 !== undefined) { tok.r1 += dr; tok.r2 += dr; }
        if (tok.c1 !== undefined) { tok.c1 += dc; tok.c2 += dc; }
        changed = true;
      }
    }
    else // resize: the corner opposite the handle stays anchored
    {
      var nr1 = tok.r1, nr2 = tok.r2, nc1 = tok.c1, nc2 = tok.c2;

      if (tok.kind !== 'col')
      {
        nr1 = Math.min(refBoxDrag.anchorRow, cell.row);
        nr2 = Math.max(refBoxDrag.anchorRow, cell.row);
      }
      if (tok.kind !== 'row')
      {
        nc1 = Math.min(refBoxDrag.anchorCol, cell.col);
        nc2 = Math.max(refBoxDrag.anchorCol, cell.col);
      }

      if (nr1 !== tok.r1 || nr2 !== tok.r2 || nc1 !== tok.c1 || nc2 !== tok.c2)
      {
        tok.r1 = nr1; tok.r2 = nr2; tok.c1 = nc1; tok.c2 = nc2;
        changed = true;
      }
    }

    refBoxDrag.lastRow = cell.row;
    refBoxDrag.lastCol = cell.col;

    if (changed)
      applyRefTokenEdit(tok);
  }
);

document.addEventListener
(
  'mouseup',
  function()
  {
    if (!refBoxDrag)
      return;

    var src = refBoxDrag.src;
    refBoxDrag = null;

    var layer = document.getElementById('sheet-ref-layer');
    if (layer) layer.classList.remove('dragging');

    if (src.editing && src.inp)
      src.inp.focus();
  }
);

// ── DRAG AUTO-SCROLL ──
// While any grid drag is active (selection, formula ref picking, fill,
// reference-box move/resize, chart move/resize), the sheet scrolls by itself
// when the pointer nears the container's edges — the closer to the edge, the
// faster. Each scroll step retargets the drag, since the grid moved under a
// pointer that didn't.

var AUTOSCROLL_ZONE = 48; // px from an edge where scrolling kicks in
var AUTOSCROLL_MAX = 28;  // px per frame at (or past) the very edge

var autoScrollMouse = null;
var autoScrollRaf = null;

function sheetDragActive()
{
  return isDragging || isRefDragging || isFillDragging || !!refBoxDrag || !!sheetChartDrag;
}

document.addEventListener
(
  'mousemove',
  function(mouseEvent)
  {
    if (!sheetDragActive())
    {
      autoScrollMouse = null;
      return;
    }

    autoScrollMouse = { x: mouseEvent.clientX, y: mouseEvent.clientY };

    if (!autoScrollRaf)
      autoScrollRaf = requestAnimationFrame(autoScrollStep);
  }
);

function autoScrollSpeed(pos, lo, hi)
{
  var depth;

  if (pos < lo + AUTOSCROLL_ZONE)
  {
    depth = Math.min(1, (lo + AUTOSCROLL_ZONE - pos) / AUTOSCROLL_ZONE);
    return -Math.ceil(depth * AUTOSCROLL_MAX);
  }

  if (pos > hi - AUTOSCROLL_ZONE)
  {
    depth = Math.min(1, (pos - (hi - AUTOSCROLL_ZONE)) / AUTOSCROLL_ZONE);
    return Math.ceil(depth * AUTOSCROLL_MAX);
  }

  return 0;
}

function autoScrollStep()
{
  autoScrollRaf = null;

  if (!sheetDragActive() || !autoScrollMouse)
    return;

  var container = document.getElementById('sheet-container');
  if (!container)
    return;

  var rect = container.getBoundingClientRect(),
      dx = autoScrollSpeed(autoScrollMouse.x, rect.left, rect.right),
      dy = autoScrollSpeed(autoScrollMouse.y, rect.top, rect.bottom);

  if (dx || dy)
  {
    var beforeLeft = container.scrollLeft,
        beforeTop = container.scrollTop;

    container.scrollLeft += dx;
    container.scrollTop += dy;

    var movedX = container.scrollLeft - beforeLeft,
        movedY = container.scrollTop - beforeTop;

    if (movedX || movedY)
      retargetDragAtPointer(movedX, movedY);
  }

  // The retarget above can dispatch a synthetic mousemove, whose listener
  // already scheduled the next step — guard so each frame runs this once,
  // not an ever-doubling number of times.
  if (!autoScrollRaf)
    autoScrollRaf = requestAnimationFrame(autoScrollStep);
}

function retargetDragAtPointer(dx, dy)
{
  // Chart moves/resizes are anchored to viewport coordinates; the content
  // shifted under the stationary pointer, so shift the anchor with it.
  if (sheetChartDrag)
  {
    if (sheetChartDrag.kind === 'move')
    {
      sheetChartDrag.origX += dx;
      sheetChartDrag.origY += dy;
    }
    else
    {
      sheetChartDrag.origWidth += dx;
      sheetChartDrag.origHeight += dy;
    }
  }

  // Ref-box and chart drags do their work in document mousemove handlers;
  // feed them a synthetic move at the pointer's (unchanged) position.
  if (refBoxDrag || sheetChartDrag)
  {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: autoScrollMouse.x, clientY: autoScrollMouse.y, button: 0 }));
    return;
  }

  // Selection, formula-ref picking, and fill drags track the hovered cell.
  var cell = sheetCellFromPoint(autoScrollMouse.x, autoScrollMouse.y);

  if (cell && (isDragging || isRefDragging || isFillDragging))
    cellMouseEnter(colName(cell.col) + cell.row);
}

function getSelectionBoundingBox()
{
  var anchor = parseName(selectionAnchor),
      end = parseName(selectionEnd || selectionAnchor);

  if (!anchor)
    return null;

  if (!end)
    end = anchor;

  var anchorCol = colIndex(anchor.col),
      endCol = colIndex(end.col);

  return  {
            rowStart: Math.min(anchor.row, end.row),
            rowEnd: Math.max(anchor.row, end.row),
            colStart: Math.min(anchorCol, endCol),
            colEnd: Math.max(anchorCol, endCol)
          };
}

function fillHandleMouseDown(mouseEvent)
{
  mouseEvent.preventDefault();
  mouseEvent.stopPropagation();

  fillSourceBox = getSelectionBoundingBox();
  isFillDragging = true;
  fillRange = null;
}

function updateFillPreview(targetRef)
{
  var target = parseName(targetRef);

  if (!target || !fillSourceBox)
    return;

  var targetCol = colIndex(target.col),
      box = fillSourceBox,
      vDist =   target.row < box.rowStart
                ?
                  box.rowStart - target.row
                :
                  (target.row > box.rowEnd ? target.row - box.rowEnd : 0),
      hDist =   targetCol < box.colStart
                ?
                  box.colStart - targetCol
                :
                  (targetCol > box.colEnd ? targetCol - box.colEnd : 0);

  if (!vDist && !hDist)
    fillRange = null;
  else if (vDist >= hDist)
    fillRange =   (target.row > box.rowEnd)
                  ?
                    { rowStart: box.rowEnd + 1, rowEnd: target.row, colStart: box.colStart, colEnd: box.colEnd }
                  :
                    { rowStart: target.row, rowEnd: box.rowStart - 1, colStart: box.colStart, colEnd: box.colEnd };
  else
    fillRange =   (targetCol > box.colEnd)
                  ?
                    { rowStart: box.rowStart, rowEnd: box.rowEnd, colStart: box.colEnd + 1, colEnd: targetCol }
                  :
                    { rowStart: box.rowStart, rowEnd: box.rowEnd, colStart: targetCol, colEnd: box.colStart - 1 };

  renderFillPreview();
}

function renderFillPreview()
{
  clearFillPreview();

  if (!fillRange)
    return;

  for (var r = fillRange.rowStart; r <= fillRange.rowEnd; r++)
    for (var c = fillRange.colStart; c <= fillRange.colEnd; c++)
    {
      var td = document.getElementById('cell-' + colName(c) + r);

      if (td)
        td.classList.add('fill-preview');
    }
}

function clearFillPreview()
{
  document.querySelectorAll('#sheet-body td.fill-preview').forEach
  (
    function(td)
    {
      td.classList.remove('fill-preview');
    }
  );
}

// Shifts every cell reference in a formula by a row/column delta - the same
// relative-reference adjustment Excel/Sheets apply when you drag-fill. A '$'
// before the column or row (e.g. $A$1, A$1, $A1) locks that axis in place.
function shiftFormulaRefs(formulaText, rowDelta, colDelta)
{
  return formulaText.replace
  (
    /(?<![A-Za-z])(\$?)([A-Z]{1,2})(\$?)(\d+)/g,
    function(match, colAbs, col, rowAbs, row)
    {
      var newCol = colAbs ? colIndex(col) : colIndex(col) + colDelta,
          newRow = rowAbs ? parseInt(row, 10) : parseInt(row, 10) + rowDelta;

      if (newCol < 0 || newCol >= COLS || newRow < 1 || newRow > ROWS)
        return match;

      return colAbs + colName(newCol) + rowAbs + newRow;
    }
  );
}

// Optional companion to shiftFormulaRefs: when the "increment numbers on
// fill" toggle is on, plain top-level numeric literals in the formula shift
// by the same delta, so =A1+1 filled down becomes =A2+2, =A3+3, etc. Numbers
// inside a function call's parens (ROUND(A1,2)'s 2, LOG10(100)'s 100) are
// left alone, since those are arguments, not series values - and so are
// cell-reference/function-name digits (A1, LOG10), which are never "bare".
function shiftFormulaLiterals(formulaText, delta)
{
  if (!delta)
    return formulaText;

  var result = '',
      depth = 0,
      i = 0;

  while (i < formulaText.length)
  {
    var ch = formulaText[i];

    if (ch === '(')
    {
      depth++;
      result += ch;
      i++;
      continue;
    }

    if (ch === ')')
    {
      depth--;
      result += ch;
      i++;
      continue;
    }

    var prevChar = i > 0 ? formulaText[i - 1] : '';

    if (depth === 0 && /\d/.test(ch) && !/[A-Za-z0-9.$]/.test(prevChar))
    {
      var match = /^\d+(?:\.\d+)?/.exec(formulaText.slice(i))[0];

      result += (parseFloat(match) + delta).toString();
      i += match.length;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

function toggleIncrementLiterals(checked)
{
  incrementLiteralsOnFill = checked;
}

function refreshCellDisplay(ref)
{
  var inp = document.getElementById('inp-' + ref),
      v = sheetData[ref] || '';

  if (!inp)
    return;

  inp.value = v.startsWith('=') ? evalCell(ref, v) : v;
  inp.classList.toggle('formula-result', v.startsWith('='));
}

function performFill()
{
  sheetSnapshotForUndo();

  var box = fillSourceBox,
      range = fillRange,
      srcRows = box.rowEnd - box.rowStart + 1,
      srcCols = box.colEnd - box.colStart + 1;

  for (var r = range.rowStart; r <= range.rowEnd; r++)
  {
    for (var c = range.colStart; c <= range.colEnd; c++)
    {
      // Cycle back through the source range so a multi-cell source pattern
      // repeats across the filled region, same as Excel/Sheets.
      var srcRow = box.rowStart + (((r - box.rowStart) % srcRows) + srcRows) % srcRows,
          srcCol = box.colStart + (((c - box.colStart) % srcCols) + srcCols) % srcCols,
          srcRef = colName(srcCol) + srcRow,
          destRef = colName(c) + r,
          srcVal = sheetData[srcRef] || '',
          destVal = srcVal;

      if (srcVal.startsWith('='))
      {
        destVal = shiftFormulaRefs(srcVal, r - srcRow, c - srcCol);

        if (incrementLiteralsOnFill)
          destVal = shiftFormulaLiterals(destVal, (r - srcRow) + (c - srcCol));
      }

      sheetData[destRef] = destVal;

      refreshCellDisplay(destRef);
    }
  }

  selectionAnchor = colName(Math.min(box.colStart, range.colStart)) + Math.min(box.rowStart, range.rowStart);
  selectionEnd = colName(Math.max(box.colEnd, range.colEnd)) + Math.max(box.rowEnd, range.rowEnd);

  renderRangeSelection();
  evaluateFormulas();
  saveSheetToFile();
}

function enterEditMode(name, freshValue)
{
  var inp = document.getElementById('inp-' + name);

  if (!inp)
    return;

  sheetSnapshotForUndo();

  editingCell = name;
  inp.readOnly = false;
  inp.classList.remove('formula-result');

  if (freshValue === undefined)
    inp.value = sheetData[name] || '';
  else
  {
    inp.value = freshValue;
    sheetData[name] = freshValue;
  }

  selectCell(name);
  inp.focus();
}

function cellDblClick(name)
{
  enterEditMode(name);

  var inp = document.getElementById('inp-' + name),
      caretPos = inp.value.length;

  inp.setSelectionRange(caretPos, caretPos);
}

function isTypingKey(keyEvent)
{
  return  keyEvent.key.length === 1 &&
          !keyEvent.ctrlKey &&
          !keyEvent.metaKey &&
          !keyEvent.altKey;
}
