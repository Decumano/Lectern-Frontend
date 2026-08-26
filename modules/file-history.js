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

function linesOf(text)
{
  return (text || '').split('\n');
}

// Same LCS-based approach as computeWordDiff, but over lines instead of
// whitespace tokens, then grouped into contiguous add/remove/modify hunks.
function computeLineHunks(oldText, newText)
{
  var a = linesOf(oldText),
      b = linesOf(newText),
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
function applyLineHunks(content, hunks)
{
  var lines = linesOf(content),
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
function reconstructHistoryContent(file, uptoIndex)
{
  var content = '';

  for (var i = 0; i <= uptoIndex; i++)
  {
    var entry = file.history[i];

    content = entry.hunks ? applyLineHunks(content, entry.hunks) : (entry.content || '');
  }

  return content;
}

// Records what changed since the last entry, skipping it if nothing did (so
// just opening and closing a file without editing it doesn't pollute the
// history with no-op entries).
function recordFileHistory(id)
{
  var file = files[id];

  if (!file)
    return;

  // Shared files aren't ours: no history sidecar in someone else's workspace.
  if (id === SHARED_TMP_ID)
    return;

  var content = file.content || '';

  if (!file.history)
    file.history = [];

  var lastContent = reconstructHistoryContent(file, file.history.length - 1);

  if (lastContent === content)
    return;

  file.history.push({ timestamp: Date.now(), hunks: computeLineHunks(lastContent, content) });

  if (file.history.length > 50)
  {
    // Drop the two oldest entries and replace them with a single re-based
    // "diff from empty" entry covering the same ground, so the replay chain
    // stays intact instead of losing its anchor at index 0.
    var mergedContent = reconstructHistoryContent(file, 1);

    file.history.splice(0, 2, { timestamp: file.history[1].timestamp, hunks: computeLineHunks('', mergedContent) });
  }

  if (workFolderRoot)
  {
    Platform.writeWorkFile(workFolderRoot, id + '.history.json', JSON.stringify(file.history))
      .catch(function(e){ console.warn('History sidecar write error', e); });
  }
  else
    saveToStorage();
}

window.addEventListener
(
  'beforeunload',
  function()
  {
    if (currentFileId)
      recordFileHistory(currentFileId);
  }
);

document.addEventListener('click', function(e)
{
  var tPop = document.getElementById('travel-popover');
  if (tPop && tPop.style.display !== 'none')
  {
    if (!tPop.contains(e.target) && e.target.id !== 'map-travel-result')
      closeTravelPopover();
  }
  var pPop = document.getElementById('pin-popover');
  if (pPop && pPop.style.display !== 'none')
  {
    if (!pPop.contains(e.target) && !e.target.closest('.map-pin'))
      closePinPopover();
  }
});

async function openHistoryModal()
{
  if (!currentFileId || !files[currentFileId])
    return;

  var file = files[currentFileId];

  if (workFolderRoot && !file.historyLoaded)
  {
    try
    {
      var raw = await Platform.readWorkFile(workFolderRoot, currentFileId + '.history.json');
      file.history = JSON.parse(raw) || [];
    }
    catch(e)
    {
      file.history = file.history || [];
    }

    file.historyLoaded = true;
  }

  renderHistoryModal();
  document.getElementById('history-modal').classList.add('open');
}

function closeHistoryModal()
{
  document.getElementById('history-modal').classList.remove('open');
}

document.getElementById('history-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('history-modal'))
      closeHistoryModal();
  }
);

// Sheets/Notebook don't read as plain text, so their preview is a short
// structural summary instead of a text snippet.
function historyPreviewFor(type, content)
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
      var pageCount = parseNotebookContent(content).pages.length;
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

function renderHistoryModal()
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

    running = entry.hunks ? applyLineHunks(running, entry.hunks) : (entry.content || '');
    reconstructed[i] = running;
  }

  for (i = history.length - 1; i >= 0; i--)
  {
    entry = history[i];

    var when = new Date(entry.timestamp).toLocaleString(),
        preview = historyPreviewFor(file.type, reconstructed[i]),
        changeSummary = historyChangeSummary(entry);

    html +=  '<div class="history-item">' +
                '<div class="history-item-info">' +
                  '<div class="history-item-time">' + escHtml(when) + (changeSummary ? ' <span class="history-item-changes">' + changeSummary + '</span>' : '') + '</div>' +
                  '<div class="history-item-preview">' + escHtml(preview) + '</div>' +
                '</div>' +
                '<div class="history-item-actions">' +
                  '<button type="button" class="btn-cancel history-compare-btn" onclick="compareHistoryEntry(' + i + ')">Compare</button>' +
                  '<button type="button" class="btn-cancel history-restore-btn" onclick="restoreHistoryEntry(' + i + ')">Restore</button>' +
                '</div>' +
              '</div>';
  }

  list.innerHTML = html;
}

// A compact "+N -M line(s)" badge built straight from the stored hunks -
// entries from before this format change (full-snapshot entries) have no
// hunks, so they just don't get a badge.
function historyChangeSummary(entry)
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
function tokenizeForDiff(text)
{
  return (text || '').split(/(\s+)/).filter(function(t){ return t.length > 0; });
}

// Classic LCS-based diff over the token arrays. Returns a flat op list
// (same/removed/added) in document order, or null if the documents are too
// large for an O(n*m) table to be worth computing.
function computeWordDiff(oldText, newText)
{
  var a = tokenizeForDiff(oldText),
      b = tokenizeForDiff(newText),
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

function renderWordDiff(oldText, newText, oldPaneId, newPaneId)
{
  var ops = computeWordDiff(oldText, newText),
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
    var escaped = escHtml(op.value);

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

function compareHistoryEntry(index)
{
  var file = files[currentFileId],
      entry = file && file.history && file.history[index];

  if (!entry)
    return;

  historyDiffIndex = index;

  var oldContent = index > 0 ? reconstructHistoryContent(file, index - 1) : '';
  var newContent = reconstructHistoryContent(file, index);

  var oldLabel = index > 0
    ? new Date(file.history[index - 1].timestamp).toLocaleString()
    : 'Before';

  document.getElementById('diff-old-header').textContent = oldLabel;
  document.getElementById('diff-new-header').textContent = new Date(entry.timestamp).toLocaleString();

  renderWordDiff(oldContent, newContent);

  closeHistoryModal();
  document.getElementById('history-diff-modal').classList.add('open');
}

function closeHistoryDiffModal()
{
  document.getElementById('history-diff-modal').classList.remove('open');
}

document.getElementById('history-diff-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('history-diff-modal'))
      closeHistoryDiffModal();
  }
);

async function restoreFromDiff()
{
  var index = historyDiffIndex;

  closeHistoryDiffModal();
  await restoreHistoryEntry(index);
}

async function restoreHistoryEntry(index)
{
  var file = files[currentFileId],
      entry = file && file.history && file.history[index];

  if (!entry)
    return;

  if (!confirm('Restore this version? Your current content will be saved to history first, so you can still get back to it.'))
    return;

  var restoredContent = reconstructHistoryContent(file, index);

  recordFileHistory(currentFileId);
  file.content = restoredContent;

  closeHistoryModal();

  if (file.type === 'doc')
    loadDocFile(file);
  else if (file.type === 'graph')
    loadGraphFile(file);
  else if (file.type === 'notebook')
    loadNotebookFile(file);
  else
    loadSheetFile(file);

  if (workFolderRoot)
  {
    try { await Platform.writeWorkFile(workFolderRoot, currentFileId, file.content || ''); }
    catch(e) { console.warn('Work folder write error', e); }
  }
  else
    saveToStorage();

  renderFileList();
}

async function openFile(id)
{
  if (!files[id])
    return;

  if (id !== SHARED_TMP_ID)
    exitSharedMode();

  if (currentFileId && currentFileId !== id && currentFileId !== SHARED_TMP_ID)
    recordFileHistory(currentFileId);

  currentFileId = id;

  if (workFolderRoot && !files[id].contentLoaded)
  {
    try
    {
      files[id].content       = await Platform.readWorkFile(workFolderRoot, id);
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

  switchAppType(file.type, false);
  renderFileList();
  noteTabOpened(id);
  closeMobileSidebar(); // picking a file dismisses the phone drawer

  // Secondary windows are named after what they're showing, and the registry
  // entry follows so other windows' menus stay accurate
  if (!isMainWindow && file.name)
    document.title = file.name;

  if (file.type === 'doc')
    loadDocFile(file);

  else if (file.type === 'graph')
    loadGraphFile(file);

  else if (file.type === 'notebook')
    loadNotebookFile(file);

  else if (file.type === 'glossary')
    loadGlossaryFile(file);

  else if (file.type === 'calendar')
    loadCalendarFile(file);

  else if (file.type === 'economy')
    loadEconomyFile(file);

  else if (file.type === 'bestiary')
    loadBestiaryFile(file);

  else
    loadSheetFile(file);

  updateCommentsUI();
  updateLiveSync();

  // Fire-and-forget: update the shared backlinks index whenever a file is opened
  updateBacklinksForFile(id);
}

function clearActiveEditors()
{
  document.getElementById('doc-title-input').value = '';
  document.getElementById('editor').value = '';
  document.getElementById('toolbar-title').innerHTML = '<span>No document open</span>';
  updatePreview();
  updateStatus();
}

async function deleteFile(e, id)
{
  e.stopPropagation();

  if (!confirm('Delete "' + files[id].name + '"?'))
    return;

  if (workFolderRoot)
  {
    try
    {
      await Platform.deleteWorkEntry(workFolderRoot, id, false);
      Platform.deleteWorkEntry(workFolderRoot, id + '.history.json', false).catch(function(){});
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
      clearActiveEditors();
    }

    await loadWorkFolderTree();
    return;
  }

  delete files[id];

  if (currentFileId === id)
  {
    currentFileId = null;
    clearActiveEditors();
  }

  saveToStorage();
  pruneOpenTabs();
  renderFileList();
}

async function deleteFolderEntry(e, path)
{
  e.stopPropagation();

  if (!confirm('Delete folder "' + folders[path].name + '" and everything inside it?'))
    return;

  try
  {
    await Platform.deleteWorkEntry(workFolderRoot, path, true);
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
    clearActiveEditors();
  }

  await loadWorkFolderTree();
}
