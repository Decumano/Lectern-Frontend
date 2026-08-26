// Documents: find and replace
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── DOCS: FIND & REPLACE ──
// A small panel over the editor: find (with live match count and optional
// case sensitivity), step through matches, replace one or all. Replacements
// are single undo steps via the shared textarea undo controller.

function frPanel() { return document.getElementById('find-replace-panel'); }

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
  frUpdateCount();
}

function closeFindReplace()
{
  var panel = frPanel();
  if (panel) panel.classList.remove('open');
  document.getElementById('editor').focus();
}

function toggleFindReplace()
{
  if (frPanel().classList.contains('open'))
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

function frCountMatches()
{
  var q = frQuery();
  if (!q.find) return 0;

  var editor = document.getElementById('editor'),
      hay = q.cs ? editor.value : editor.value.toLowerCase(),
      needle = q.cs ? q.find : q.find.toLowerCase(),
      count = 0,
      at = 0;

  while ((at = hay.indexOf(needle, at)) !== -1)
  {
    count++;
    at += needle.length;
  }

  return count;
}

function frUpdateCount()
{
  var q = frQuery();
  document.getElementById('fr-count').textContent = q.find ? (frCountMatches() + ' found') : '';
}

// Selects a range and scrolls the textarea so it's visible (textareas don't
// scroll to a programmatic selection on their own).
function frSelectRange(editor, start, end)
{
  editor.focus();
  editor.setSelectionRange(start, end);

  var lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20,
      lineIdx = editor.value.slice(0, start).split('\n').length - 1;

  editor.scrollTop = Math.max(0, lineIdx * lineHeight - editor.clientHeight / 2);
}

function frFindNext()
{
  var q = frQuery();
  if (!q.find) return;

  var editor = document.getElementById('editor'),
      hay = q.cs ? editor.value : editor.value.toLowerCase(),
      needle = q.cs ? q.find : q.find.toLowerCase(),
      at = hay.indexOf(needle, editor.selectionEnd || 0);

  if (at === -1)
    at = hay.indexOf(needle); // wrap back to the top

  if (at === -1)
    return;

  frSelectRange(editor, at, at + q.find.length);
}

function frReplaceOne()
{
  var q = frQuery();
  if (!q.find) return;

  var editor = document.getElementById('editor'),
      selText = editor.value.slice(editor.selectionStart, editor.selectionEnd),
      onMatch = q.cs ? (selText === q.find) : (selText.toLowerCase() === q.find.toLowerCase());

  // First invocation just lands on the next match; the next one replaces it.
  if (!onMatch)
  {
    frFindNext();
    return;
  }

  var replaceWith = document.getElementById('fr-replace').value,
      start = editor.selectionStart;

  docTextUndo.forceSnapshot();
  editor.value = editor.value.slice(0, start) + replaceWith + editor.value.slice(editor.selectionEnd);
  editor.setSelectionRange(start + replaceWith.length, start + replaceWith.length);
  onEditorChange();
  frUpdateCount();
  frFindNext();
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
  frUpdateCount();
}

function frKey(keyEvent)
{
  if (keyEvent.key === 'Enter')
  {
    keyEvent.preventDefault();
    if (keyEvent.target.id === 'fr-replace') frReplaceOne();
    else frFindNext();
  }

  if (keyEvent.key === 'Escape')
    closeFindReplace();
}

// Ctrl/Cmd+F and Ctrl/Cmd+H inside the doc editor open the panel.
(function()
{
  var editor = document.getElementById('editor');
  if (!editor) return;

  editor.addEventListener('keydown', function(e)
  {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'h' || e.key === 'H'))
    {
      e.preventDefault();
      openFindReplace();
    }
  });
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
