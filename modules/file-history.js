// Per-file history and diffs
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── FILE HISTORY (one entry per "close" - switching away, or app exit) ──
//
// Each entry stores only what changed since the previous entry, not a full
// copy of the document - a list of "hunks", each one { line, type, removed,
// added }, where line is the 1-based starting line in the OLD content, type
// is 'added'/'removed'/'modified', and removed/added are the actual old/new
// lines (so "what changed" is readable straight off the stored entry, not
// just its line numbers). A version's full text is reconstructed by
// replaying every entry's hunks in order, starting from ''.

function fLinesOf(text)
{
  return (text || '').split('\n');
}

// Same LCS-based approach as fComputeWordDiff, but over lines instead of
// whitespace tokens, then grouped into contiguous add/remove/modify hunks.
function fComputeLineHunks(oldText, newText)
{
  var a = fLinesOf(oldText),
      b = fLinesOf(newText),
      n = a.length,
      m = b.length;

  var dp = new Array(n + 1);

  for (var i = 0; i <= n; i++)
    dp[i] = new Uint32Array(m + 1);

  for (i = n - 1; i >= 0; i--)
    for (var j = m - 1; j >= 0; j--)
      dp[i][j] = (a[i] === b[j]) ? (dp[i+1][j+1] + 1) : Math.max(dp[i+1][j], dp[i][j+1]);

  var ops = [];

  i = 0;
  var j = 0;

  while (i < n && j < m)
  {
    if (a[i] === b[j])
    {
      ops.push({ type: 'same', value: a[i] });
      i++; j++;
    }
    else if (dp[i+1][j] >= dp[i][j+1])
    {
      ops.push({ type: 'removed', value: a[i] });
      i++;
    }
    else
    {
      ops.push({ type: 'added', value: b[j] });
      j++;
    }
  }

  while (i < n) { ops.push({ type: 'removed', value: a[i] }); i++; }
  while (j < m) { ops.push({ type: 'added', value: b[j] }); j++; }

  var hunks = [],
      oldLineNo = 1,
      k = 0;

  while (k < ops.length)
  {
    if (ops[k].type === 'same')
    {
      oldLineNo++;
      k++;
      continue;
    }

    var startLine = oldLineNo,
        removed = [],
        added = [];

    while (k < ops.length && ops[k].type !== 'same')
    {
      if (ops[k].type === 'removed')
      {
        removed.push(ops[k].value);
        oldLineNo++;
      }
      else
        added.push(ops[k].value);

      k++;
    }

    hunks.push({ line: startLine, type: (removed.length && added.length) ? 'modified' : (added.length ? 'added' : 'removed'), removed: removed, added: added });
  }

  return hunks;
}

// Replays one entry's hunks against a base text to produce the next version.
function fApplyLineHunks(content, hunks)
{
  var lines = fLinesOf(content),
      shift = 0;

  hunks.forEach
  (
    function(h)
    {
      var idx = (h.line - 1) + shift;

      lines.splice.apply(lines, [idx, h.removed.length].concat(h.added));
      shift += h.added.length - h.removed.length;
    }
  );

  return lines.join('\n');
}

// Rebuilds the full text of file.history[uptoIndex] by replaying every
// entry from the start. Entries from before this format change (which
// stored a full snapshot as entry.content) are handled as a hard reset of
// the running text, so old and new-format entries can coexist in one chain.
function fReconstructHistoryContent(file, uptoIndex)
{
  var content = '';

  for (var i = 0; i <= uptoIndex; i++)
  {
    var entry = file.history[i];

    content = entry.hunks ? fApplyLineHunks(content, entry.hunks) : (entry.content || '');
  }

  return content;
}

// Records what changed since the last entry, skipping it if nothing did (so
// just opening and closing a file without editing it doesn't pollute the
// history with no-op entries).
function fRecordFileHistory(id)
{
  var file = files[id];

  if (!file)
    return;

  // Shared files aren't ours: no history sidecar in someone else's workspace.
  if (id === cSharedTmpId)
    return;

  var content = file.content || '';

  if (!file.history)
    file.history = [];

  var lastContent = fReconstructHistoryContent(file, file.history.length - 1);

  if (lastContent === content)
    return;

  file.history.push({ timestamp: Date.now(), hunks: fComputeLineHunks(lastContent, content) });

  if (file.history.length > 50)
  {
    // Drop the two oldest entries and replace them with a single re-based
    // "diff from empty" entry covering the same ground, so the replay chain
    // stays intact instead of losing its anchor at index 0.
    var mergedContent = fReconstructHistoryContent(file, 1);

    file.history.splice(0, 2, { timestamp: file.history[1].timestamp, hunks: fComputeLineHunks('', mergedContent) });
  }

  if (workFolderRoot)
  {
    Platform.fWriteWorkFile(workFolderRoot, id + '.history.json', JSON.stringify(file.history))
      .catch(function(e){ console.warn('History sidecar write error', e); });
  }
  else
    fSaveToStorage();
}

window.addEventListener
(
  'beforeunload',
  function()
  {
    if (currentFileId)
      fRecordFileHistory(currentFileId);
  }
);

document.addEventListener('click', function(e)
{
  var tPop = document.getElementById('travel-popover');
  if (tPop && tPop.style.display !== 'none')
  {
    if (!tPop.contains(e.target) && e.target.id !== 'map-travel-result')
      fCloseTravelPopover();
  }
  var pPop = document.getElementById('pin-popover');
  if (pPop && pPop.style.display !== 'none')
  {
    if (!pPop.contains(e.target) && !e.target.closest('.map-pin'))
      fClosePinPopover();
  }
});

async function fOpenHistoryModal()
{
  if (!currentFileId || !files[currentFileId])
    return;

  var file = files[currentFileId];

  if (workFolderRoot && !file.historyLoaded)
  {
    try
    {
      var raw = await Platform.fReadWorkFile(workFolderRoot, currentFileId + '.history.json');
      file.history = JSON.parse(raw) || [];
    }
    catch(e)
    {
      file.history = file.history || [];
    }

    file.historyLoaded = true;
  }

  fRenderHistoryModal();
  document.getElementById('history-modal').classList.add('open');
}

function fCloseHistoryModal()
{
  document.getElementById('history-modal').classList.remove('open');
}

document.getElementById('history-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('history-modal'))
      fCloseHistoryModal();
  }
);

// Sheets/Notebook don't read as plain text, so their preview is a short
// structural summary instead of a text snippet.
function fHistoryPreviewFor(type, content)
{
  content = content || '';

  if (type === 'sheet')
  {
    var cellCount = content.split('\n').filter(function(line){ return /^[A-Za-z]+\d+=/.test(line); }).length;
    return cellCount + ' cell' + (cellCount === 1 ? '' : 's') + ' with data';
  }

  if (type === 'notebook')
  {
    try
    {
      var pageCount = fParseNotebookContent(content).pages.length;
      return pageCount + ' page' + (pageCount === 1 ? '' : 's');
    }
    catch(e)
    {
      return 'Notebook snapshot';
    }
  }

  var flat = content.replace(/\s+/g, ' ').trim();
  return flat ? (flat.length > 120 ? flat.slice(0, 120) + '…' : flat) : '(empty)';
}

function fRenderHistoryModal()
{
  var file = files[currentFileId],
      list = document.getElementById('history-list'),
      history = file.history || [];

  if (!history.length)
  {
    list.innerHTML = '<div class="history-empty">No history yet — a version is saved each time you switch away from this document or close the app.</div>';
    return;
  }

  var html = '',
      reconstructed = new Array(history.length),
      running = '';

  for (var i = 0; i < history.length; i++)
  {
    var entry = history[i];

    running = entry.hunks ? fApplyLineHunks(running, entry.hunks) : (entry.content || '');
    reconstructed[i] = running;
  }

  for (i = history.length - 1; i >= 0; i--)
  {
    entry = history[i];

    var when = new Date(entry.timestamp).toLocaleString(),
        preview = fHistoryPreviewFor(file.type, reconstructed[i]),
        changeSummary = fHistoryChangeSummary(entry);

    html +=  '<div class="history-item">' +
                '<div class="history-item-info">' +
                  '<div class="history-item-time">' + fEscHtml(when) + (changeSummary ? ' <span class="history-item-changes">' + changeSummary + '</span>' : '') + '</div>' +
                  '<div class="history-item-preview">' + fEscHtml(preview) + '</div>' +
                '</div>' +
                '<div class="history-item-actions">' +
                  '<button type="button" class="btn-cancel history-compare-btn" onclick="fCompareHistoryEntry(' + i + ')">Compare</button>' +
                  '<button type="button" class="btn-cancel history-restore-btn" onclick="fRestoreHistoryEntry(' + i + ')">Restore</button>' +
                '</div>' +
              '</div>';
  }

  list.innerHTML = html;
}

// A compact "+N -M line(s)" badge built straight from the stored hunks -
// entries from before this format change (full-snapshot entries) have no
// hunks, so they just don't get a badge.
function fHistoryChangeSummary(entry)
{
  if (!entry.hunks)
    return '';

  var added = 0,
      removed = 0;

  entry.hunks.forEach(function(h){ added += h.added.length; removed += h.removed.length; });

  if (!added && !removed)
    return '';

  var parts = [];

  if (added)
    parts.push('<span class="diff-added">+' + added + '</span>');

  if (removed)
    parts.push('<span class="diff-removed">−' + removed + '</span>');

  return parts.join(' ');
}

// Splits on whitespace runs while keeping them as their own tokens, so
// joining the tokens back together reconstructs the text exactly - the
// standard tokenization for a word-level (rather than line-level) diff,
// which reads much better than line diffing on wrapped markdown paragraphs.
function fTokenizeForDiff(text)
{
  return (text || '').split(/(\s+)/).filter(function(t){ return t.length > 0; });
}

// Classic LCS-based diff over the token arrays. Returns a flat op list
// (same/removed/added) in document order, or null if the documents are too
// large for an O(n*m) table to be worth computing.
function fComputeWordDiff(oldText, newText)
{
  var a = fTokenizeForDiff(oldText),
      b = fTokenizeForDiff(newText),
      n = a.length,
      m = b.length;

  if (n * m > 4000000)
    return null;

  var dp = new Array(n + 1);

  for (var i = 0; i <= n; i++)
    dp[i] = new Uint32Array(m + 1);

  for (i = n - 1; i >= 0; i--)
    for (var j = m - 1; j >= 0; j--)
      dp[i][j] = (a[i] === b[j]) ? (dp[i+1][j+1] + 1) : Math.max(dp[i+1][j], dp[i][j+1]);

  var ops = [];

  i = 0;
  var j = 0;

  while (i < n && j < m)
  {
    if (a[i] === b[j])
    {
      ops.push({ type: 'same', value: a[i] });
      i++; j++;
    }
    else if (dp[i+1][j] >= dp[i][j+1])
    {
      ops.push({ type: 'removed', value: a[i] });
      i++;
    }
    else
    {
      ops.push({ type: 'added', value: b[j] });
      j++;
    }
  }

  while (i < n) { ops.push({ type: 'removed', value: a[i] }); i++; }
  while (j < m) { ops.push({ type: 'added', value: b[j] }); j++; }

  return ops;
}

function fRenderWordDiff(oldText, newText, oldPaneId, newPaneId)
{
  var ops = fComputeWordDiff(oldText, newText),
      oldPane = document.getElementById(oldPaneId || 'diff-old-pane'),
      newPane = document.getElementById(newPaneId || 'diff-new-pane');

  if (!ops)
  {
    oldPane.textContent = oldText;
    newPane.textContent = newText;
    return;
  }

  var oldHtml = '',
      newHtml = '';

  ops.forEach(function(op)
  {
    var escaped = fEscHtml(op.value);

    if (op.type === 'same')
    {
      oldHtml += escaped;
      newHtml += escaped;
    }
    else if (op.type === 'removed')
      oldHtml += '<span class="diff-removed">' + escaped + '</span>';
    else
      newHtml += '<span class="diff-added">' + escaped + '</span>';
  });

  oldPane.innerHTML = oldHtml || '<em>(empty)</em>';
  newPane.innerHTML = newHtml || '<em>(empty)</em>';
}

function fCompareHistoryEntry(index)
{
  var file = files[currentFileId],
      entry = file && file.history && file.history[index];

  if (!entry)
    return;

  historyDiffIndex = index;

  var oldContent = index > 0 ? fReconstructHistoryContent(file, index - 1) : '';
  var newContent = fReconstructHistoryContent(file, index);

  var oldLabel = index > 0
    ? new Date(file.history[index - 1].timestamp).toLocaleString()
    : 'Before';

  document.getElementById('diff-old-header').textContent = oldLabel;
  document.getElementById('diff-new-header').textContent = new Date(entry.timestamp).toLocaleString();

  fRenderWordDiff(oldContent, newContent);

  fCloseHistoryModal();
  document.getElementById('history-diff-modal').classList.add('open');
}

function fCloseHistoryDiffModal()
{
  document.getElementById('history-diff-modal').classList.remove('open');
}

document.getElementById('history-diff-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('history-diff-modal'))
      fCloseHistoryDiffModal();
  }
);

async function fRestoreFromDiff()
{
  var index = historyDiffIndex;

  fCloseHistoryDiffModal();
  await fRestoreHistoryEntry(index);
}

async function fRestoreHistoryEntry(index)
{
  var file = files[currentFileId],
      entry = file && file.history && file.history[index];

  if (!entry)
    return;

  if (!confirm('Restore this version? Your current content will be saved to history first, so you can still get back to it.'))
    return;

  var restoredContent = fReconstructHistoryContent(file, index);

  fRecordFileHistory(currentFileId);
  file.content = restoredContent;

  fCloseHistoryModal();

  if (file.type === 'doc')
    fLoadDocFile(file);
  else if (file.type === 'graph')
    fLoadGraphFile(file);
  else if (file.type === 'slides')
    fLoadSlidesFile(file);
  else if (file.type === 'notebook')
    fLoadNotebookFile(file);
  else if (file.type === 'glossary')
    fLoadGlossaryFile(file);
  else if (file.type === 'calendar')
    fLoadCalendarFile(file);
  else if (file.type === 'economy')
    fLoadEconomyFile(file);
  else if (file.type === 'bestiary')
    fLoadBestiaryFile(file);
  else
    fLoadSheetFile(file);

  if (workFolderRoot)
  {
    try { await Platform.fWriteWorkFile(workFolderRoot, currentFileId, file.content || ''); }
    catch(e) { console.warn('Work folder write error', e); }
  }
  else
    fSaveToStorage();

  fRenderFileList();
}

async function fOpenFile(id)
{
  if (!files[id])
    return;

  if (id !== cSharedTmpId)
    fExitSharedMode();

  if (currentFileId && currentFileId !== id && currentFileId !== cSharedTmpId)
    fRecordFileHistory(currentFileId);

  currentFileId = id;

  if (workFolderRoot && !files[id].contentLoaded)
  {
    try
    {
      files[id].content       = await Platform.fReadWorkFile(workFolderRoot, id);
      files[id].contentLoaded = true;
    }
    catch(e)
    {
      console.warn('Work folder read error', e);
      alert('Could not open this file.');
      return;
    }
  }

  const file = files[id];

  fSwitchAppType(file.type, false);
  fRenderFileList();
  fNoteTabOpened(id);
  fCloseMobileSidebar(); // picking a file dismisses the phone drawer

  // Secondary windows are named after what they're showing, and the registry
  // entry follows so other windows' menus stay accurate
  if (!isMainWindow && file.name)
    document.title = file.name;

  if (file.type === 'doc')
    fLoadDocFile(file);

  else if (file.type === 'graph')
    fLoadGraphFile(file);

  else if (file.type === 'slides')
    fLoadSlidesFile(file);

  else if (file.type === 'notebook')
    fLoadNotebookFile(file);

  else if (file.type === 'glossary')
    fLoadGlossaryFile(file);

  else if (file.type === 'calendar')
    fLoadCalendarFile(file);

  else if (file.type === 'economy')
    fLoadEconomyFile(file);

  else if (file.type === 'bestiary')
    fLoadBestiaryFile(file);

  else
    fLoadSheetFile(file);

  fUpdateCommentsUI();
  fUpdateLiveSync();

  // Fire-and-forget: update the shared backlinks index whenever a file is opened
  fUpdateBacklinksForFile(id);
}

function fClearActiveEditors()
{
  document.getElementById('doc-title-input').value = '';
  document.getElementById('editor').value = '';
  document.getElementById('toolbar-title').innerHTML = '<span>No document open</span>';
  fUpdatePreview();
  fUpdateStatus();
}

async function fDeleteFile(e, id)
{
  e.stopPropagation();

  if (!confirm('Delete "' + files[id].name + '"?'))
    return;

  if (workFolderRoot)
  {
    try
    {
      await Platform.fDeleteWorkEntry(workFolderRoot, id, false);
      Platform.fDeleteWorkEntry(workFolderRoot, id + '.history.json', false).catch(function(){});
    }
    catch(err)
    {
      console.warn('Work folder delete error', err);
      alert('Could not delete the file.');
      return;
    }

    if (currentFileId === id)
    {
      currentFileId = null;
      fClearActiveEditors();
    }

    await fLoadWorkFolderTree();
    return;
  }

  delete files[id];

  if (currentFileId === id)
  {
    currentFileId = null;
    fClearActiveEditors();
  }

  fSaveToStorage();
  fPruneOpenTabs();
  fRenderFileList();
}

async function fDeleteFolderEntry(e, path)
{
  e.stopPropagation();

  if (!confirm('Delete folder "' + folders[path].name + '" and everything inside it?'))
    return;

  try
  {
    await Platform.fDeleteWorkEntry(workFolderRoot, path, true);
  }
  catch(err)
  {
    console.warn('Work folder delete error', err);
    alert('Could not delete the folder.');
    return;
  }

  if (currentFileId && (currentFileId === path || currentFileId.indexOf(path + '/') === 0))
  {
    currentFileId = null;
    fClearActiveEditors();
  }

  await fLoadWorkFolderTree();
}
