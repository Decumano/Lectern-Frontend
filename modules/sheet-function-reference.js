// Spreadsheet: the built-in function reference
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── FUNCTION REFERENCE ──
var SHEET_FUNCTION_GROUPS =
[
  {
    category: 'Aggregate',
    functions:
    [
      { name: 'SUM(range)', desc: 'Adds all numbers in a range.', example: '=SUM(A1:A4)' },
      { name: 'AVG(range)', desc: 'Averages the numbers in a range.', example: '=AVG(A1:A4)' },
      { name: 'AVERAGE(range)', desc: 'Same as AVG.', example: '=AVERAGE(A1:A4)' },
      { name: 'MEAN(range)', desc: 'Same as AVG.', example: '=MEAN(A1:A4)' },
      { name: 'COUNTIF(range, criterion)', desc: 'Counts cells matching a criterion like ">5" or "text".', example: '=COUNTIF(A1:A9, ">5")' },
      { name: 'SUMIF(range, criterion, [sum_range])', desc: 'Sums the cells (or sum_range) where the criterion matches.', example: '=SUMIF(A1:A9, ">5", B1:B9)' },
      { name: 'AVERAGEIF(range, criterion, [avg_range])', desc: 'Averages the cells where the criterion matches.', example: '=AVERAGEIF(A1:A9, "<>0")' },
      { name: 'LARGE(range, k)', desc: 'The k-th largest value in a range.', example: '=LARGE(A1:A9, 2)' },
      { name: 'SMALL(range, k)', desc: 'The k-th smallest value in a range.', example: '=SMALL(A1:A9, 2)' },
      { name: 'MEDIAN(range)', desc: 'Middle value of a range.', example: '=MEDIAN(A1:A4)' },
      { name: 'PRODUCT(range)', desc: 'Multiplies all numbers in a range.', example: '=PRODUCT(A1:A4)' },
      { name: 'MAX(range)', desc: 'Largest value in a range.', example: '=MAX(A1:A4)' },
      { name: 'MIN(range)', desc: 'Smallest value in a range.', example: '=MIN(A1:A4)' },
      { name: 'COUNT(range)', desc: 'Counts the cells in a range.', example: '=COUNT(A1:A4)' },
      { name: 'COUNTA(range)', desc: 'Counts the non-empty cells in a range.', example: '=COUNTA(A1:A4)' },
      { name: 'COUNTBLANK(range)', desc: 'Counts the empty cells in a range.', example: '=COUNTBLANK(A1:A4)' },
      { name: 'STDEV(range)', desc: 'Sample standard deviation of a range.', example: '=STDEV(A1:A4)' },
      { name: 'VAR(range)', desc: 'Sample variance of a range.', example: '=VAR(A1:A4)' }
    ]
  },
  {
    category: 'Math',
    functions:
    [
      { name: 'ABS(value)', desc: 'Absolute value of a number, cell, or expression.', example: '=ABS(A1-A2)' },
      { name: 'ROUND(value, decimals)', desc: 'Rounds to a number of decimal places.', example: '=ROUND(A1, 2)' },
      { name: 'ROUNDUP(value, [digits])', desc: 'Rounds away from zero.', example: '=ROUNDUP(A1, 1)' },
      { name: 'ROUNDDOWN(value, [digits])', desc: 'Rounds toward zero.', example: '=ROUNDDOWN(A1, 1)' },
      { name: 'TRUNC(value, [decimals])', desc: 'Truncates toward zero without rounding.', example: '=TRUNC(A1, 1)' },
      { name: 'INT(value)', desc: 'Rounds down to the nearest integer.', example: '=INT(A1)' },
      { name: 'CEILING(value, [significance])', desc: 'Rounds up to the nearest multiple.', example: '=CEILING(A1, 5)' },
      { name: 'FLOOR(value, [significance])', desc: 'Rounds down to the nearest multiple.', example: '=FLOOR(A1, 5)' },
      { name: 'SIGN(value)', desc: 'Returns -1, 0, or 1 depending on the sign.', example: '=SIGN(A1)' },
      { name: 'SQRT(value)', desc: 'Square root of a number, cell, or expression.', example: '=SQRT(A1)' },
      { name: 'POWER(base, exponent)', desc: 'Raises a number to a power (the ^ operator works too).', example: '=POWER(A1, 2)' },
      { name: 'MOD(number, divisor)', desc: 'Remainder after division.', example: '=MOD(A1, 3)' },
      { name: 'EXP(value)', desc: 'e raised to the given power.', example: '=EXP(A1)' },
      { name: 'LN(value)', desc: 'Natural logarithm.', example: '=LN(A1)' },
      { name: 'LOG(value, [base])', desc: 'Logarithm with an optional base (default 10).', example: '=LOG(A1, 2)' },
      { name: 'LOG10(value)', desc: 'Base-10 logarithm.', example: '=LOG10(A1)' },
      { name: 'PI()', desc: 'The value of pi.', example: '=PI()' },
      { name: 'RAND()', desc: 'Random number between 0 and 1.', example: '=RAND()' },
      { name: 'RANDBETWEEN(min, max)', desc: 'Random integer between two values.', example: '=RANDBETWEEN(1, 6)' },
      { name: 'FACT(n)', desc: 'Factorial of a number.', example: '=FACT(5)' },
      { name: 'EVEN(value)', desc: 'Rounds up (away from zero) to the nearest even integer.', example: '=EVEN(A1)' },
      { name: 'ODD(value)', desc: 'Rounds up (away from zero) to the nearest odd integer.', example: '=ODD(A1)' }
    ]
  },
  {
    category: 'Trigonometry',
    functions:
    [
      { name: 'SIN(angle)', desc: 'Sine of an angle in radians.', example: '=SIN(PI()/2)' },
      { name: 'COS(angle)', desc: 'Cosine of an angle in radians.', example: '=COS(A1)' },
      { name: 'TAN(angle)', desc: 'Tangent of an angle in radians.', example: '=TAN(A1)' },
      { name: 'ASIN(value)', desc: 'Inverse sine, in radians.', example: '=ASIN(A1)' },
      { name: 'ACOS(value)', desc: 'Inverse cosine, in radians.', example: '=ACOS(A1)' },
      { name: 'ATAN(value)', desc: 'Inverse tangent, in radians.', example: '=ATAN(A1)' },
      { name: 'ATAN2(x, y)', desc: 'Angle of the point (x, y), in radians.', example: '=ATAN2(1, 1)' },
      { name: 'SINH(value)', desc: 'Hyperbolic sine.', example: '=SINH(A1)' },
      { name: 'COSH(value)', desc: 'Hyperbolic cosine.', example: '=COSH(A1)' },
      { name: 'TANH(value)', desc: 'Hyperbolic tangent.', example: '=TANH(A1)' },
      { name: 'DEGREES(radians)', desc: 'Converts radians to degrees.', example: '=DEGREES(PI())' },
      { name: 'RADIANS(degrees)', desc: 'Converts degrees to radians.', example: '=RADIANS(180)' }
    ]
  },
  {
    category: 'Lookup',
    functions:
    [
      { name: 'INDEX(range, row, [col])', desc: 'Value at a position inside a range (1-based).', example: '=INDEX(A1:B10, 3, 2)' },
      { name: 'VLOOKUP(value, range, col)', desc: 'Finds value in the range\'s first column, returns the col-th column of that row.', example: '=VLOOKUP("Bob", A1:C9, 3)' },
      { name: 'HLOOKUP(value, range, row)', desc: 'Finds value in the range\'s first row, returns the row-th row of that column.', example: '=HLOOKUP("Q2", A1:F3, 2)' },
      { name: 'MATCH(value, range)', desc: 'Position of the first exact match in a row or column range (1-based).', example: '=MATCH(42, A1:A9)' },
      { name: 'ROW([ref])', desc: 'Row number of a reference, or of the formula\'s own cell.', example: '=ROW(B7)' },
      { name: 'COLUMN([ref])', desc: 'Column number of a reference, or of the formula\'s own cell.', example: '=COLUMN(B7)' }
    ]
  },
  {
    category: 'Text',
    functions:
    [
      { name: 'CONCAT(value1, value2, ...)', desc: 'Joins values into one piece of text.', example: '=CONCAT(A1, " ", A2)' },
      { name: 'CONCATENATE(value1, value2, ...)', desc: 'Same as CONCAT.', example: '=CONCATENATE(A1, A2)' },
      { name: 'LEN(text)', desc: 'Number of characters in the text.', example: '=LEN(A1)' },
      { name: 'UPPER(text)', desc: 'Converts text to uppercase.', example: '=UPPER(A1)' },
      { name: 'LOWER(text)', desc: 'Converts text to lowercase.', example: '=LOWER(A1)' },
      { name: 'TRIM(text)', desc: 'Removes leading/trailing whitespace.', example: '=TRIM(A1)' },
      { name: 'LEFT(text, [count])', desc: 'First N characters of the text.', example: '=LEFT(A1, 3)' },
      { name: 'RIGHT(text, [count])', desc: 'Last N characters of the text.', example: '=RIGHT(A1, 3)' },
      { name: 'MID(text, start, count)', desc: 'A substring starting at a given position.', example: '=MID(A1, 2, 3)' },
      { name: 'SUBSTITUTE(text, old, new, [n])', desc: 'Replaces occurrences of old with new (all, or only the n-th).', example: '=SUBSTITUTE(A1, "cat", "dog")' },
      { name: 'REPT(text, times)', desc: 'Repeats text a number of times.', example: '=REPT("-", 10)' },
      { name: 'FIND(needle, text, [start])', desc: 'Position of needle in text (case-sensitive, 1-based).', example: '=FIND("a", A1)' },
      { name: 'SEARCH(needle, text, [start])', desc: 'Like FIND, but case-insensitive.', example: '=SEARCH("a", A1)' },
      { name: 'PROPER(text)', desc: 'Capitalizes the first letter of each word.', example: '=PROPER(A1)' },
      { name: 'EXACT(text1, text2)', desc: 'TRUE if two texts are identical (case-sensitive).', example: '=EXACT(A1, B1)' }
    ]
  },
  {
    category: 'Logical',
    functions:
    [
      { name: 'IF(condition, true_value, false_value)', desc: 'Branches on a condition.', example: '=IF(A1>5,"big","small")' },
      { name: 'AND(cond1, cond2, ...)', desc: 'True if every condition is true.', example: '=AND(A1>0, A2>0)' },
      { name: 'OR(cond1, cond2, ...)', desc: 'True if any condition is true.', example: '=OR(A1>0, A2>0)' },
      { name: 'NOT(condition)', desc: 'Reverses a true/false value.', example: '=NOT(A1>5)' },
      { name: 'XOR(cond1, cond2, ...)', desc: 'True if an odd number of conditions are true.', example: '=XOR(A1>0, A2>0)' },
      { name: 'IFERROR(value, fallback)', desc: 'Returns a fallback if value errors out.', example: '=IFERROR(A1/A2, 0)' }
    ]
  }
];

// Flattened, autocomplete-friendly view of SHEET_FUNCTION_GROUPS - one entry
// per function with its bare name (the part before "(") split out, used by
// the in-cell function suggestion dropdown.
var ALL_SHEET_FUNCTIONS = SHEET_FUNCTION_GROUPS.reduce
(
  function(acc, group)
  {
    return acc.concat(group.functions);
  },
  []
).map
(
  function(fn)
  {
    return { bareName: fn.name.split('(')[0], signature: fn.name, desc: fn.desc };
  }
);

function renderFunctionHelp()
{
  var panel = document.getElementById('function-help-panel');

  if (!panel)
    return;

  var intro = '<div class="fx-help-intro">'+
                'Start a cell with <code>=</code> to write a formula. Reference cells like '+
                '<code>A1</code> or ranges like <code>A1:B3</code>. Whole columns and rows '+
                'work too: <code>A:A</code> is everything in column A, <code>4:4</code> '+
                'everything in row 4. Prefix ranges with <code>@</code> for line-by-line math: '+
                'inside an aggregate it combines the ranges element by element and returns one '+
                'result — <code>=SUM(@A1:A9*@B1:B9)</code> sums each row\'s product, like '+
                'SUMPRODUCT. Outside a function, <code>@</code> takes the value on the '+
                'formula\'s own line, so <code>=@A1:A9*@B1:B9</code> filled down computes '+
                'row by row. While editing a formula, '+
                'click or drag cells on the grid to insert their reference at the cursor. '+
                'Functions can be nested, e.g. <code>=ROUND(SUM(A1:A4),1)</code>. Prefix a '+
                'column or row with <code>$</code> (e.g. <code>$A$1</code>, <code>A$1</code>, '+
                '<code>$A1</code>) to lock it in place when filling.'+
              '</div>';

  var groups = SHEET_FUNCTION_GROUPS.map
  (
    function(group)
    {
      var rows = group.functions.map
      (
        function(fn)
        {
          return  '<div class="fx-help-row">'+
                    '<div class="fx-help-name">' + escHtml(fn.name) + '</div>'+
                    '<div class="fx-help-desc">' + escHtml(fn.desc) + ' <span class="fx-help-example">' + escHtml(fn.example) + '</span></div>'+
                  '</div>';
        }
      ).join('');

      return '<div class="fx-help-category">' + escHtml(group.category) + '</div>' + rows;
    }
  ).join('');

  panel.innerHTML = intro + groups;
}

function toggleFunctionHelp(clickEvent)
{
  if (clickEvent)
    clickEvent.stopPropagation();

  var panel = document.getElementById('function-help-panel');

  if (!panel)
    return;

  if (!panel.classList.contains('open'))
    renderFunctionHelp();

  panel.classList.toggle('open');
}

document.addEventListener
(
  'click',
  function(clickEvent)
  {
    var panel = document.getElementById('function-help-panel');

    if (!panel || !panel.classList.contains('open'))
      return;

    if (panel.contains(clickEvent.target) || clickEvent.target.id === 'fx-help-btn')
      return;

    panel.classList.remove('open');
  }
);
