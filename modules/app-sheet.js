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
        fPerformFill();

      fClearFillPreview();
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
    copyEvent.clipboardData.setData('text/plain', fBuildRangeTSV(selectionAnchor, selectionEnd));
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
    fPasteTSVAt(selectionAnchor, text);
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
      fSheetUndo();
    }
    else if (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
    {
      e.preventDefault();
      fSheetRedo();
    }
  }
);

// Writes tab/newline-delimited clipboard text (the format every major
// spreadsheet - Excel, Google Sheets, OnlyOffice - puts on the clipboard for
// a copied range) into the grid starting at anchorRef, growing right/down.
function fPasteTSVAt(anchorRef, text)
{
  var anchor = fParseName(anchorRef);

  if (!anchor)
    return;

  fSheetSnapshotForUndo();

  var rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Spreadsheets terminate clipboard TSV with a trailing newline - without
  // dropping it, the paste would write one extra (empty) row past the data.
  if (rows.length > 1 && rows[rows.length - 1] === '')
    rows.pop();

  var startCol = fColIndex(anchor.col),
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
          fEnsureGridFits(row, col);

          if (col >= COLS || row > ROWS)
            return;

          var ref = fColName(col) + row;

          sheetData[ref] = cellText;
          lastRef = ref;

          var inp = document.getElementById('inp-' + ref);

          if (inp)
          {
            inp.value = cellText.startsWith('=') ? fEvalCell(ref, cellText) : cellText;
            inp.classList.toggle('formula-result', cellText.startsWith('='));
          }
        }
      );
    }
  );

  // fEvaluateFormulas recalculates every formula cell on the sheet (not just
  // the pasted ones) - needed since other formulas may reference cells that
  // just changed - and also refreshes any charts built from this range.
  fEvaluateFormulas();
  fSaveSheetToFile();

  fSelectCell(anchorRef);
  selectionEnd = lastRef;
  fRenderRangeSelection();
}

function fGetDisplayValue(ref)
{
  var val = sheetData[ref] || '';
  return val.startsWith('=') ? fEvalCell(ref, val) : val;
}

function fBuildRangeTSV(anchorRef, endRef)
{
  var anchor = fParseName(anchorRef),
      end = fParseName(endRef);

  if (!anchor || !end)
    return '';

  var anchorCol = fColIndex(anchor.col),
      endCol = fColIndex(end.col),
      rowStart = Math.min(anchor.row, end.row),
      rowEnd = Math.max(anchor.row, end.row),
      colStart = Math.min(anchorCol, endCol),
      colEnd = Math.max(anchorCol, endCol),
      rows = [];

  for (var r = rowStart; r <= rowEnd; r++)
  {
    var cells = [];

    for (var c = colStart; c <= colEnd; c++)
      cells.push(fGetDisplayValue(fColName(c) + r));

    rows.push(cells.join('\t'));
  }

  return rows.join('\n');
}

function fBuildSheet()
{
  var head = document.getElementById('sheet-head');

  var tableHeadNames ='<tr>'+
                        '<th class="row-header" style="top: 0; left: 0; z-index: 4;">'+
                        '</th>';

  for (var i = 0; i < COLS; i++)
    tableHeadNames +=   '<th class="col-header" id="colh-' + i + '" onmousedown="fColHeaderMouseDown(event,' + i + ')">' +
                          fColName(i) +
                        '</th>';

  head.innerHTML = tableHeadNames +
                      '</tr>';

  var body = document.getElementById('sheet-body'),
      html = '';

  for (var i = 1; i <= ROWS; i++)
  {
    html += '<tr>' +
              '<th class="row-header" id="rowh-' + i + '" onmousedown="fRowHeaderMouseDown(event,' + i + ')">' +
                i +
              '</th>';

    for (var j = 0; j < COLS; j++)
      html += fSheetCellHtml(fColName(j) + i);

    html += '</tr>';
  }

  document.getElementById('sheet-body').innerHTML = html;

  fPaintBucketSwatch();
  fPaintTextSwatch();
}

function fSheetCellHtml(ref)
{
  return '<td id="cell-' + ref + '" onmousedown="fCellMouseDown(event,\'' + ref + '\')" onmouseenter="fCellMouseEnter(\'' + ref + '\')" ondblclick="fCellDblClick(\'' + ref + '\')">'+
           '<input class="cell-input" id="inp-' + ref + '" value="" readonly onkeydown="fCellKey(event, \'' + ref + '\')" onfocus="fOnCellFocus(\'' + ref + '\')" oninput="fOnCellInput(\'' + ref + '\')" onblur="fOnCellBlur(\'' + ref + '\')">'+
         '</td>';
}

// ── GRID GROWTH ──
// The grid isn't fixed-size: whenever content or the selection gets close to
// an edge, more rows/columns are appended (chunked, to keep DOM churn low).
// Columns run past Z into two-letter names, up to ZZ.

var cMaxSheetCols = 702; // "ZZ"
var cGrowRowChunk = 12;
var cGrowColChunk = 4;

function fGrowSheetGrid(targetRows, targetCols)
{
  targetCols = Math.min(targetCols, cMaxSheetCols);
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
      th.setAttribute('onmousedown', 'fColHeaderMouseDown(event,' + j + ')');
      th.textContent = fColName(j);
      headRow.appendChild(th);
    }
    for (var r = 0; r < body.rows.length; r++)
    {
      var rowNum = r + 1, cells = '';
      for (var jj = COLS; jj < targetCols; jj++)
        cells += fSheetCellHtml(fColName(jj) + rowNum);
      body.rows[r].insertAdjacentHTML('beforeend', cells);
    }
    COLS = targetCols;
  }

  if (targetRows > ROWS)
  {
    var html = '';
    for (var i = ROWS + 1; i <= targetRows; i++)
    {
      html += '<tr><th class="row-header" id="rowh-' + i + '" onmousedown="fRowHeaderMouseDown(event,' + i + ')">' + i + '</th>';
      for (var j2 = 0; j2 < COLS; j2++)
        html += fSheetCellHtml(fColName(j2) + i);
      html += '</tr>';
    }
    body.insertAdjacentHTML('beforeend', html);
    ROWS = targetRows;
  }
}

/// Grows the grid so (row, col) sits comfortably inside it — being within a
/// couple of cells of an edge already triggers the next chunk.
function fEnsureGridFits(row, col)
{
  var targetRows = ROWS, targetCols = COLS;
  while (row > targetRows - 3) targetRows += cGrowRowChunk;
  while (col > targetCols - 3 && targetCols < cMaxSheetCols) targetCols += cGrowColChunk;
  fGrowSheetGrid(targetRows, targetCols);
}

function fEnsureGridFitsData(data)
{
  var maxRow = 0, maxCol = 0;
  Object.keys(data || {}).forEach(function(ref)
  {
    var p = fParseName(ref);
    if (!p) return;
    if (p.row > maxRow) maxRow = p.row;
    var ci = fColIndex(p.col);
    if (ci > maxCol) maxCol = ci;
  });
  if (maxRow || maxCol) fEnsureGridFits(maxRow, maxCol);
}

// Bijective base-26 column names: 0..25 = A..Z, 26 = AA, 27 = AB, … 701 = ZZ.
function fColName(i)
{
    if (i < 26)
      return String.fromCharCode(65 + i);
    return String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

function fColIndex(name)
{
    if (name.length === 1)
      return name.charCodeAt(0) - 65;
    return (name.charCodeAt(0) - 65 + 1) * 26 + (name.charCodeAt(1) - 65);
}

function fParseName(cellReference)
{
    // '$' (absolute-reference markers, e.g. $A$1) carry no meaning for lookups,
    // only for how fShiftFormulaRefs treats them during a fill-drag.
    var matched = cellReference.match(/^\$?([A-Z]+)\$?(\d+)$/);

    if(!matched)
      return null;

    return {
      col: matched[1],
      row: parseInt(matched[2])
    };
}

function fSelectCell(name)
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

  var parsedName = fParseName(name);

  if(!parsedName)
    return;

  activeCell = {
    row: parsedName.row,
    col: fColIndex(parsedName.col)
  };

  // Selection moving near an edge pulls more rows/columns into existence.
  fEnsureGridFits(activeCell.row, activeCell.col);

  selectionAnchor = name;
  selectionEnd = name;

  var selectedCell = document.getElementById('cell-' + name);

  if(selectedCell)
    selectedCell.classList.add('active');

  document.getElementById('cell-ref').value = name;
  document.getElementById('formula-bar').value = sheetData[name] || '';

  fRefreshFillHandle();
  fUpdateHeaderHighlights();
  fRefreshRefHighlights();
}

// Marks the row/column header cells spanning the current selection, so the
// margins always show where you are.
function fUpdateHeaderHighlights()
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

  var box = fGetSelectionBoundingBox();
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

function fCellMouseDown(mouseEvent, name)
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

    fSwitchSheetPage(ctx.pageIdx);

    if (ctx.viaBar)
    {
      // Resume in the formula bar: fSelectCell repopulates it from
      // sheetData (which now holds the formula with the inserted ref).
      fSelectCell(backRef);
      var backBar = document.getElementById('formula-bar');
      backBar.focus();
      backBar.setSelectionRange(caretPos, caretPos);
    }
    else
    {
      fEnterEditMode(backRef);
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

    fInsertFormulaRef(name, name);
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

    fInsertFormulaRef(name, name);
    return;
  }

  isDragging = true;
  fSelectCell(name);
}

// Clicking a column letter or row number in the margins: while a formula is
// being typed it inserts the whole-column/row range (A:A / 4:4) at the caret,
// mirroring fCellMouseDown's cell picker; otherwise it selects the whole
// column or row.
function fColHeaderMouseDown(mouseEvent, col)
{
  var letter = fColName(col);
  fHeaderMouseDown(mouseEvent, letter + ':' + letter, letter + '1', letter + ROWS);
}

function fRowHeaderMouseDown(mouseEvent, row)
{
  fHeaderMouseDown(mouseEvent, row + ':' + row, 'A' + row, fColName(COLS - 1) + row);
}

function fHeaderMouseDown(mouseEvent, rangeText, selAnchor, selEnd)
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
    fInsertFormulaText(rangeText);
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
    fInsertFormulaText(rangeText);
    refDragViaBar = false;
    formulaInsertStart = null;
    formulaInsertLength = 0;
    formulaBar.focus();
    return;
  }

  // Otherwise: select the whole row/column.
  fSelectCell(selAnchor);
  selectionEnd = selEnd;
  fRenderRangeSelection();
}

function fCellMouseEnter(name)
{
  if (isFillDragging)
  {
    fUpdateFillPreview(name);
    return;
  }

  if (isRefDragging)
  {
    selectionEnd = name;
    fInsertFormulaRef(selectionAnchor, name);
    return;
  }

  if (!isDragging)
    return;

  selectionEnd = name;
  fRenderRangeSelection();
}

function fInsertFormulaRef(anchorRef, endRef)
{
  var refText = (anchorRef === endRef) ? anchorRef : (anchorRef + ':' + endRef);
  fInsertFormulaText(refText);
}

function fInsertFormulaText(refText)
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

  fEvaluateFormulas(targetRef);
  fSaveSheetToFile();

  fRenderRangeSelection();
  fRefreshRefHighlights();
}

function fRenderRangeSelection()
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
    fUpdateHeaderHighlights();
    return;
  }

  var anchor = fParseName(selectionAnchor),
      end = fParseName(selectionEnd);

  if (!anchor || !end)
    return;

  var anchorCol = fColIndex(anchor.col),
      endCol = fColIndex(end.col),
      rowStart = Math.min(anchor.row, end.row),
      rowEnd = Math.max(anchor.row, end.row),
      colStart = Math.min(anchorCol, endCol),
      colEnd = Math.max(anchorCol, endCol);

  for (var r = rowStart; r <= rowEnd; r++)
    for (var c = colStart; c <= colEnd; c++)
    {
      var cellRef = fColName(c) + r,
          td = document.getElementById('cell-' + cellRef);

      if (td && cellRef !== selectionAnchor)
        td.classList.add('selected');
    }

  document.getElementById('cell-ref').value = selectionAnchor + ':' + selectionEnd;

  fRefreshFillHandle();
  fUpdateHeaderHighlights();
}

// ── FILL HANDLE (drag-fill, like Excel/Sheets) ──
function fRefreshFillHandle()
{
  if (editingCell)
    fRemoveFillHandle();
  else
    fUpdateFillHandlePosition();
}

function fUpdateFillHandlePosition()
{
  var endRef = selectionEnd || selectionAnchor;

  if (!endRef)
  {
    fRemoveFillHandle();
    return;
  }

  var td = document.getElementById('cell-' + endRef);

  if (!td)
  {
    fRemoveFillHandle();
    return;
  }

  var handle = document.getElementById('fill-handle');

  if (!handle)
  {
    handle = document.createElement('div');
    handle.id = 'fill-handle';
    handle.className = 'fill-handle';
    handle.addEventListener('mousedown', fFillHandleMouseDown);
  }

  td.appendChild(handle);
}

function fRemoveFillHandle()
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

var cRefBoxColors = ['#4a7fa8', '#c0574a', '#5a9a6e', '#9d6fd1', '#d18b3f', '#3fa7b0', '#d4a843'];

var refHighlights = [];  // tokens of the highlighted formula, in text order
var refBoxDrag = null;   // active box drag: {index, mode, src, lastRow, lastCol, anchorRow, anchorCol}

// Where the highlighted formula lives right now: the in-cell edit, the
// formula bar, or (fallback) the selected cell's stored value.
function fRefHighlightSource()
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

function fRefSourceText(src)
{
  return src.inp ? src.inp.value : (sheetData[src.ref] || '');
}

// Classifies one matched reference and normalizes it into a grid box
// (r1<=r2, c1<=c2). d holds the '$' markers so moving/resizing keeps them.
function fRefTokenInfo(text)
{
  var m;

  if ((m = text.match(/^(\$?)([A-Z]{1,2})(\$?)(\d+):(\$?)([A-Z]{1,2})(\$?)(\d+)$/)))
  {
    var ca = fColIndex(m[2]), cb = fColIndex(m[6]), ra = +m[4], rb = +m[8];
    return { kind: 'range', c1: Math.min(ca, cb), c2: Math.max(ca, cb),
             r1: Math.min(ra, rb), r2: Math.max(ra, rb), d: [m[1], m[3], m[5], m[7]] };
  }

  if ((m = text.match(/^(\$?)([A-Z]{1,2}):(\$?)([A-Z]{1,2})$/)))
  {
    var cc = fColIndex(m[2]), cd = fColIndex(m[4]);
    return { kind: 'col', c1: Math.min(cc, cd), c2: Math.max(cc, cd), d: [m[1], m[3]] };
  }

  if ((m = text.match(/^(\$?)(\d+):(\$?)(\d+)$/)))
  {
    var re = +m[2], rf = +m[4];
    if (re < 1 || rf < 1) return null;
    return { kind: 'row', r1: Math.min(re, rf), r2: Math.max(re, rf), d: [m[1], m[3]] };
  }

  if ((m = text.match(/^(\$?)([A-Z]{1,2})(\$?)(\d+)$/)))
    return { kind: 'cell', c1: fColIndex(m[2]), c2: fColIndex(m[2]), r1: +m[4], r2: +m[4], d: [m[1], m[3]] };

  return null;
}

function fRefTokenText(tok)
{
  var d = tok.d;

  if (tok.kind === 'cell') return d[0] + fColName(tok.c1) + d[1] + tok.r1;
  if (tok.kind === 'col')  return d[0] + fColName(tok.c1) + ':' + d[1] + fColName(tok.c2);
  if (tok.kind === 'row')  return d[0] + tok.r1 + ':' + d[1] + tok.r2;

  return d[0] + fColName(tok.c1) + d[1] + tok.r1 + ':' + d[2] + fColName(tok.c2) + d[3] + tok.r2;
}

// Parses cell refs (A3), ranges (A1:B3) and whole-column/row ranges (A:A,
// 4:4) out of a formula's text, with their offsets, so each can later be
// replaced in place. Quoted strings and cross-tab [Tab](A1) links are masked
// (same length, so offsets hold) to keep their contents from reading as refs.
function fParseFormulaRefTokens(text)
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
    var info = fRefTokenInfo(m[0]);
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
function fRefBoxGeometry(tok)
{
  var r1 = tok.kind === 'col' ? 1 : tok.r1,
      r2 = tok.kind === 'col' ? ROWS : Math.min(tok.r2, ROWS),
      c1 = tok.kind === 'row' ? 0 : tok.c1,
      c2 = tok.kind === 'row' ? COLS - 1 : Math.min(tok.c2, COLS - 1);

  if (r1 > ROWS || c1 > COLS - 1)
    return null;

  var layer = document.getElementById('sheet-ref-layer'),
      tdA = document.getElementById('cell-' + fColName(c1) + r1),
      tdB = document.getElementById('cell-' + fColName(c2) + r2);

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

function fBuildRefBoxElement(tok, index)
{
  var geo = fRefBoxGeometry(tok);
  if (!geo)
    return null;

  var color = cRefBoxColors[index % cRefBoxColors.length],
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
    edge.addEventListener('mousedown', function(e){ fStartRefBoxDrag(e, index, 'move'); });
    box.appendChild(edge);
  });

  if (tok.kind !== 'cell')
  {
    var handle = document.createElement('div');
    handle.className = 'ref-box-size';
    handle.style.background = color;
    handle.addEventListener('mousedown', function(e){ fStartRefBoxDrag(e, index, 'resize'); });
    box.appendChild(handle);
  }

  return box;
}

function fRefreshRefHighlights()
{
  var layer = document.getElementById('sheet-ref-layer');
  if (!layer)
    return;

  layer.innerHTML = '';
  refHighlights = [];

  var src = fRefHighlightSource();
  if (!src)
    return;

  refHighlights = fParseFormulaRefTokens(fRefSourceText(src));

  refHighlights.forEach(function(tok, i)
  {
    var el = fBuildRefBoxElement(tok, i);
    if (el) layer.appendChild(el);
  });
}

// The grid cell under a viewport point, looked up through whatever element
// is there (usually the cell's own input).
function fSheetCellFromPoint(x, y)
{
  var el = document.elementFromPoint(x, y);

  while (el && el !== document.body)
  {
    if (el.id && el.id.indexOf('cell-') === 0)
    {
      var p = fParseName(el.id.slice(5));
      if (p) return { row: p.row, col: fColIndex(p.col) };
    }
    el = el.parentElement;
  }

  return null;
}

function fStartRefBoxDrag(mouseEvent, index, mode)
{
  if (mouseEvent.button !== 0)
    return;

  var src = fRefHighlightSource(),
      tok = refHighlights[index];

  if (!src || !tok)
    return;

  // Keeps focus (and the mid-edit state) in whichever input holds the formula.
  mouseEvent.preventDefault();
  mouseEvent.stopPropagation();

  // Dragging on a committed (not-being-edited) formula rewrites it in place,
  // so it gets its own undo step; an active edit already snapshotted.
  if (!src.editing)
    fSheetSnapshotForUndo();

  var cell = fSheetCellFromPoint(mouseEvent.clientX, mouseEvent.clientY);

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
function fApplyRefTokenEdit(tok)
{
  var src = refBoxDrag.src,
      text = fRefSourceText(src),
      newText = fRefTokenText(tok),
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

  fEvaluateFormulas(src.editing ? src.ref : undefined);
  fSaveSheetToFile();

  // Re-parse: offsets after the replaced token have shifted.
  fRefreshRefHighlights();
}

document.addEventListener
(
  'mousemove',
  function(mouseEvent)
  {
    if (!refBoxDrag)
      return;

    var cell = fSheetCellFromPoint(mouseEvent.clientX, mouseEvent.clientY);
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
      fApplyRefTokenEdit(tok);
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

var cAutoscrollZone = 24; // px inside the visible cells where scrolling kicks in
var cAutoscrollMax = 28;  // px per frame at (or past) the very edge
// A drag only scrolls once the pointer has travelled this far from where the
// button went down. Without it, the hand jitter of a double-click on a cell
// near an edge scrolled the grid between the two clicks, so the second click
// — and the edit it starts — landed on a different cell.
var cAutoscrollArmDistance = 6;

var autoScrollMouse = null;
var autoScrollRaf = null;
var autoScrollOrigin = null;
var autoScrollArmed = false;

function fSheetDragActive()
{
  return isDragging || isRefDragging || isFillDragging || !!refBoxDrag || !!sheetChartDrag;
}

// Capture phase, so the origin is recorded before any cell, header, chart or
// ref-box handler starts its drag.
document.addEventListener
(
  'mousedown',
  function(mouseEvent)
  {
    autoScrollOrigin = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    autoScrollArmed = false;
  },
  true
);

document.addEventListener
(
  'mousemove',
  function(mouseEvent)
  {
    if (!fSheetDragActive())
    {
      autoScrollMouse = null;
      autoScrollArmed = false;
      return;
    }

    if (!autoScrollArmed)
    {
      var ox = autoScrollOrigin ? autoScrollOrigin.x : mouseEvent.clientX,
          oy = autoScrollOrigin ? autoScrollOrigin.y : mouseEvent.clientY;

      if (Math.abs(mouseEvent.clientX - ox) < cAutoscrollArmDistance &&
          Math.abs(mouseEvent.clientY - oy) < cAutoscrollArmDistance)
        return;

      autoScrollArmed = true;
    }

    autoScrollMouse = { x: mouseEvent.clientX, y: mouseEvent.clientY };

    if (!autoScrollRaf)
      autoScrollRaf = requestAnimationFrame(fAutoScrollStep);
  }
);

function fAutoScrollSpeed(pos, lo, hi)
{
  var depth;

  if (pos < lo + cAutoscrollZone)
  {
    depth = Math.min(1, (lo + cAutoscrollZone - pos) / cAutoscrollZone);
    return -Math.ceil(depth * cAutoscrollMax);
  }

  if (pos > hi - cAutoscrollZone)
  {
    depth = Math.min(1, (pos - (hi - cAutoscrollZone)) / cAutoscrollZone);
    return Math.ceil(depth * cAutoscrollMax);
  }

  return 0;
}

function fAutoScrollStep()
{
  autoScrollRaf = null;

  if (!fSheetDragActive() || !autoScrollMouse)
    return;

  var container = document.getElementById('sheet-container');
  if (!container)
    return;

  // The zones are measured from the edges of the visible cells: the sticky
  // column letters and row numbers cover the container's top and left, and
  // the scrollbars its bottom and right. Measuring from the container itself
  // made the first visible row and column scroll as soon as a drag began.
  var rect = container.getBoundingClientRect(),
      head = document.getElementById('sheet-head'),
      corner = head && head.rows[0] && head.rows[0].cells[0],
      top = rect.top + container.clientTop + (head ? head.offsetHeight : 0),
      left = rect.left + container.clientLeft + (corner ? corner.offsetWidth : 0),
      bottom = rect.top + container.clientTop + container.clientHeight,
      right = rect.left + container.clientLeft + container.clientWidth,
      dx = fAutoScrollSpeed(autoScrollMouse.x, left, right),
      dy = fAutoScrollSpeed(autoScrollMouse.y, top, bottom);

  if (dx || dy)
  {
    var beforeLeft = container.scrollLeft,
        beforeTop = container.scrollTop;

    container.scrollLeft += dx;
    container.scrollTop += dy;

    var movedX = container.scrollLeft - beforeLeft,
        movedY = container.scrollTop - beforeTop;

    if (movedX || movedY)
      fRetargetDragAtPointer(movedX, movedY);
  }

  // The retarget above can dispatch a synthetic mousemove, whose listener
  // already scheduled the next step — guard so each frame runs this once,
  // not an ever-doubling number of times.
  if (!autoScrollRaf)
    autoScrollRaf = requestAnimationFrame(fAutoScrollStep);
}

function fRetargetDragAtPointer(dx, dy)
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
  var cell = fSheetCellFromPoint(autoScrollMouse.x, autoScrollMouse.y);

  if (cell && (isDragging || isRefDragging || isFillDragging))
    fCellMouseEnter(fColName(cell.col) + cell.row);
}

function fGetSelectionBoundingBox()
{
  var anchor = fParseName(selectionAnchor),
      end = fParseName(selectionEnd || selectionAnchor);

  if (!anchor)
    return null;

  if (!end)
    end = anchor;

  var anchorCol = fColIndex(anchor.col),
      endCol = fColIndex(end.col);

  return  {
            rowStart: Math.min(anchor.row, end.row),
            rowEnd: Math.max(anchor.row, end.row),
            colStart: Math.min(anchorCol, endCol),
            colEnd: Math.max(anchorCol, endCol)
          };
}

function fFillHandleMouseDown(mouseEvent)
{
  mouseEvent.preventDefault();
  mouseEvent.stopPropagation();

  fillSourceBox = fGetSelectionBoundingBox();
  isFillDragging = true;
  fillRange = null;
}

function fUpdateFillPreview(targetRef)
{
  var target = fParseName(targetRef);

  if (!target || !fillSourceBox)
    return;

  var targetCol = fColIndex(target.col),
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

  fRenderFillPreview();
}

function fRenderFillPreview()
{
  fClearFillPreview();

  if (!fillRange)
    return;

  for (var r = fillRange.rowStart; r <= fillRange.rowEnd; r++)
    for (var c = fillRange.colStart; c <= fillRange.colEnd; c++)
    {
      var td = document.getElementById('cell-' + fColName(c) + r);

      if (td)
        td.classList.add('fill-preview');
    }
}

function fClearFillPreview()
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
function fShiftFormulaRefs(formulaText, rowDelta, colDelta)
{
  return formulaText.replace
  (
    /(?<![A-Za-z])(\$?)([A-Z]{1,2})(\$?)(\d+)/g,
    function(match, colAbs, col, rowAbs, row)
    {
      var newCol = colAbs ? fColIndex(col) : fColIndex(col) + colDelta,
          newRow = rowAbs ? parseInt(row, 10) : parseInt(row, 10) + rowDelta;

      if (newCol < 0 || newCol >= COLS || newRow < 1 || newRow > ROWS)
        return match;

      return colAbs + fColName(newCol) + rowAbs + newRow;
    }
  );
}

// Optional companion to fShiftFormulaRefs: when the "increment numbers on
// fill" toggle is on, plain top-level numeric literals in the formula shift
// by the same delta, so =A1+1 filled down becomes =A2+2, =A3+3, etc. Numbers
// inside a function call's parens (ROUND(A1,2)'s 2, LOG10(100)'s 100) are
// left alone, since those are arguments, not series values - and so are
// cell-reference/function-name digits (A1, LOG10), which are never "bare".
function fShiftFormulaLiterals(formulaText, delta)
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

function fToggleIncrementLiterals(checked)
{
  incrementLiteralsOnFill = checked;
}

function fRefreshCellDisplay(ref)
{
  var inp = document.getElementById('inp-' + ref),
      v = sheetData[ref] || '';

  if (!inp)
    return;

  inp.value = v.startsWith('=') ? fEvalCell(ref, v) : v;
  inp.classList.toggle('formula-result', v.startsWith('='));
}

function fPerformFill()
{
  fSheetSnapshotForUndo();

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
          srcRef = fColName(srcCol) + srcRow,
          destRef = fColName(c) + r,
          srcVal = sheetData[srcRef] || '',
          destVal = srcVal;

      if (srcVal.startsWith('='))
      {
        destVal = fShiftFormulaRefs(srcVal, r - srcRow, c - srcCol);

        if (incrementLiteralsOnFill)
          destVal = fShiftFormulaLiterals(destVal, (r - srcRow) + (c - srcCol));
      }

      sheetData[destRef] = destVal;

      fRefreshCellDisplay(destRef);
    }
  }

  selectionAnchor = fColName(Math.min(box.colStart, range.colStart)) + Math.min(box.rowStart, range.rowStart);
  selectionEnd = fColName(Math.max(box.colEnd, range.colEnd)) + Math.max(box.rowEnd, range.rowEnd);

  fRenderRangeSelection();
  fEvaluateFormulas();
  fSaveSheetToFile();
}

function fEnterEditMode(name, freshValue)
{
  var inp = document.getElementById('inp-' + name);

  if (!inp)
    return;

  fSheetSnapshotForUndo();

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

  fSelectCell(name);
  inp.focus();
}

function fCellDblClick(name)
{
  fEnterEditMode(name);

  var inp = document.getElementById('inp-' + name),
      caretPos = inp.value.length;

  inp.setSelectionRange(caretPos, caretPos);
}

function fIsTypingKey(keyEvent)
{
  return  keyEvent.key.length === 1 &&
          !keyEvent.ctrlKey &&
          !keyEvent.metaKey &&
          !keyEvent.altKey;
}
