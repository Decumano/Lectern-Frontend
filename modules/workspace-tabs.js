// Open-file tabs, split view, detached windows, tab drag and drop
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── OPEN-FILE TABS (desktop) ───────────────────────────────
//
// Every file opened gets a browser-style tab above the editor, so switching
// between a handful of working files doesn't mean hunting the sidebar. The
// bar is hidden on phones via CSS (the sidebar drawer plays that role there).
// Tab entries are file ids, so Work Folder renames/moves must remap them
// (remapOpenTab) and structural refreshes must drop dead ids (pruneOpenTabs).

var openTabs = [];

// Satellite windows keep their own tab list; the main window keeps the
// original key. (Embeds have no tab bar and never persist tabs at all.)
function tabsStorageKey()
{
  return isSatelliteWindow ? ('lk_tabs_' + satelliteWinId) : 'lk_tabs';
}

function loadOpenTabs()
{
  try
  {
    var raw = localStorage.getItem(tabsStorageKey());
    openTabs = raw ? JSON.parse(raw).filter(function(id) { return !!files[id]; }) : [];
  }
  catch(e) { openTabs = []; }
  renderOpenTabs();
}

function persistOpenTabs()
{
  if (isEmbedContext) return;
  try { localStorage.setItem(tabsStorageKey(), JSON.stringify(openTabs)); } catch(e) {}
}

function noteTabOpened(id)
{
  if (isEmbedContext || id === SHARED_TMP_ID || !files[id])
    return;

  if (openTabs.indexOf(id) < 0)
  {
    openTabs.push(id);
    persistOpenTabs();
  }

  renderOpenTabs();
}

function remapOpenTab(oldId, newId)
{
  var i = openTabs.indexOf(oldId);

  if (i < 0)
    return;

  if (openTabs.indexOf(newId) >= 0)
    openTabs.splice(i, 1); // already open under the new id - drop the stale one
  else
    openTabs[i] = newId;

  persistOpenTabs();
  renderOpenTabs();

  // A rename/move must not orphan the side pane
  if (splitState.fileId === oldId)
  {
    splitState.fileId = newId;
    persistSplitState();
    renderSplitPane();
  }
}

function pruneOpenTabs()
{
  var before = openTabs.length;
  openTabs = openTabs.filter(function(id) { return !!files[id]; });

  if (openTabs.length !== before)
    persistOpenTabs();

  renderOpenTabs();

  if (splitState.fileId && !files[splitState.fileId])
  {
    splitState.fileId = null;
    persistSplitState();
    renderSplitPane();
  }
}

function closeOpenTab(e, id)
{
  e.stopPropagation();

  var i = openTabs.indexOf(id);

  if (i >= 0)
  {
    openTabs.splice(i, 1);
    persistOpenTabs();
  }

  // Closing the active tab moves to a neighbor; closing the last one leaves
  // the editors empty, same as after deleting the open file.
  if (currentFileId === id)
  {
    var next = openTabs[Math.min(i, openTabs.length - 1)];

    if (next)
    {
      openFile(next);
      return;
    }

    currentFileId = null;
    clearActiveEditors();
    renderFileList();
  }

  renderOpenTabs();
}

function renderOpenTabs()
{
  var bar = document.getElementById('open-tabs-bar');

  if (!bar)
    return;

  var tabs = openTabs.filter(function(id) { return !!files[id]; });

  if (!tabs.length)
  {
    bar.innerHTML = '';
    bar.style.display = 'none';
    return;
  }

  bar.style.display = '';
  bar.innerHTML = tabs.map(function(id)
  {
    var f = files[id];

    return '<div class="open-tab' + (id === currentFileId ? ' active' : '') + '" draggable="true" ondragstart="onTabDragStart(event,\'' + escAttr(id) + '\')" ondragend="onTabDragEnd(event)" onclick="openFile(\'' + escAttr(id) + '\')" oncontextmenu="showTabContextMenu(event,\'' + escAttr(id) + '\')" title="' + escAttr(f.name) + '">' +
             '<span class="open-tab-icon">' + fileTypeIcon(f.type) + '</span>' +
             '<span class="open-tab-name">' + escHtml(f.name) + '</span>' +
             '<button class="open-tab-close" onclick="closeOpenTab(event,\'' + escAttr(id) + '\')" title="Close tab">×</button>' +
           '</div>';
  }).join('');

  var active = bar.querySelector('.open-tab.active');

  if (active && active.scrollIntoView)
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── SPLIT VIEW, DETACHED WINDOWS & TAB DRAG-AND-DROP (VS Code-style) ──────────
//
// Every open-file tab can be dragged (or right-clicked) to three destinations:
//   * the side pane   - raw text, or the real app view via an ?embed= iframe
//   * a new window    - a full app instance (?win=) with its own tab bar
//   * an existing window - routed over localStorage (see the window registry)
//
// Three boot contexts share this one codebase:
//   main window   - the normal app
//   satellite     - ?win=<winId>: full app, sidebar hidden, per-window tab
//                   list, registers itself so other windows can target it
//   embed         - ?embed=<fileId>: full app chrome-less inside the split
//                   pane's iframe, permanently showing one file
//
// Windows stay consistent through storage events: browser-storage workspaces
// merge the whole file map on every save (mergeFilesFromStorage), work-folder
// files are separate on disk already, and the web cloud workspace additionally
// live-polls the open file (updateLiveSync).

var bootParams        = new URLSearchParams(window.location.search);
var embedFileId       = bootParams.get('embed');
var satelliteWinId    = bootParams.get('win');
var isEmbedContext    = !!embedFileId;
var isSatelliteWindow = !isEmbedContext && !!satelliteWinId;
var isMainWindow      = !isEmbedContext && !isSatelliteWindow;

var splitState     = { fileId: null, mode: 'rendered', width: 400, side: 'right' };
var tabMenuFileId  = null;
var lastLocalEditAt = 0;

function loadSplitState()
{
  try
  {
    var raw = localStorage.getItem('lk_split');
    if (!raw) return;
    var s = JSON.parse(raw);
    splitState.fileId = s.fileId || null;
    splitState.mode   = s.mode === 'raw' ? 'raw' : 'rendered';
    splitState.side   = s.side === 'left' ? 'left' : 'right';
    if (s.width >= 240) splitState.width = s.width;
  }
  catch(e) {}
}

function persistSplitState()
{
  if (!isMainWindow) return; // satellites/embeds must not steal the main window's pane state
  try { localStorage.setItem('lk_split', JSON.stringify(splitState)); } catch(e) {}
}

// Called once from init after files are available: restores the pane the user
// had open last session.
function initSplitView()
{
  loadSplitState();
  renderSplitPane();
}

function openInSplit(id, mode)
{
  if (!files[id]) return;
  splitState.fileId = id;
  if (mode) splitState.mode = mode === 'raw' ? 'raw' : 'rendered';
  persistSplitState();
  renderSplitPane();
}

function closeSplitPane()
{
  splitState.fileId = null;
  persistSplitState();
  renderSplitPane();
}

function setSplitMode(mode)
{
  splitState.mode = mode === 'raw' ? 'raw' : 'rendered';
  persistSplitState();
  renderSplitPane();
}

// Work-folder files are read lazily; the split pane needs the same guarantee
// openFile gives the main editor.
async function ensureFileContentLoaded(id)
{
  var f = files[id];
  if (!f || !workFolderRoot || f.contentLoaded) return;
  try
  {
    f.content       = await Platform.readWorkFile(workFolderRoot, id);
    f.contentLoaded = true;
  }
  catch(e) { console.warn('Split view read error', e); }
}

async function renderSplitPane()
{
  var pane    = document.getElementById('split-pane'),
      divider = document.getElementById('split-divider');

  if (!pane) return;

  var id = splitState.fileId,
      f  = id && files[id];

  if (!f)
    splitState.fileId = null;

  pane.style.display    = f ? 'flex' : 'none';
  divider.style.display = f ? '' : 'none';

  var embedEl = document.getElementById('split-embed');

  if (!f)
  {
    // Unload the embedded app when the pane closes; it's a whole app instance
    if (embedEl && embedEl.getAttribute('data-file'))
    {
      embedEl.src = 'about:blank';
      embedEl.removeAttribute('data-file');
    }
    return;
  }

  pane.style.width = splitState.width + 'px';
  document.getElementById('editor-split').classList.toggle('split-side-left', splitState.side === 'left');

  await ensureFileContentLoaded(id);

  document.getElementById('split-pane-icon').innerHTML   = fileTypeIcon(f.type);
  document.getElementById('split-pane-name').textContent = f.name || '';
  document.getElementById('split-pane-name').title       = f.name || '';

  var raw = splitState.mode === 'raw';
  document.getElementById('split-btn-raw').classList.toggle('active', raw);
  document.getElementById('split-btn-rendered').classList.toggle('active', !raw);

  var rawEl = document.getElementById('split-raw'),
      renEl = document.getElementById('split-rendered');

  // Rendered mode: every type - documents included - gets the real app view
  // through an embedded chrome-less instance (?embed=), so the side pane is a
  // fully editable editor rather than a read-only preview.
  var useEmbed = !raw;

  rawEl.style.display   = raw ? '' : 'none';
  renEl.style.display   = 'none';
  embedEl.style.display = useEmbed ? '' : 'none';

  if (raw)
  {
    // Refreshing while the user is typing here would clobber the caret
    if (document.activeElement !== rawEl)
      rawEl.value = f.content || '';
    return;
  }

  if (embedEl.getAttribute('data-file') !== id)
  {
    embedEl.src = 'index.html?embed=' + encodeURIComponent(id);
    embedEl.setAttribute('data-file', id);
  }
}

// Raw side-pane edits persist through the same funnel as the main editor.
// The pane can hold a file other than currentFileId, so it debounces on its
// own timer instead of scheduleSave's.
var splitSaveTimer = null;

function onSplitRawInput()
{
  var id = splitState.fileId,
      f = id && files[id];

  if (!f)
    return;

  f.content = document.getElementById('split-raw').value;
  f.modified = Date.now();
  lastLocalEditAt = Date.now();

  // Same document open in the main editor: keep both views in step
  if (currentFileId === id && f.type === 'doc')
  {
    document.getElementById('editor').value = f.content;
    updatePreview();
    updateStatus();
  }

  clearTimeout(splitSaveTimer);
  splitSaveTimer = setTimeout(function() { persistFileEntry(id); }, 800);
}

// ── Split divider drag ──

function startSplitDrag(e)
{
  e.preventDefault();

  var pane   = document.getElementById('split-pane'),
      startX = e.clientX,
      startW = pane.getBoundingClientRect().width;

  function move(ev)
  {
    var delta = (splitState.side === 'left') ? (ev.clientX - startX) : (startX - ev.clientX),
        w = Math.min(Math.max(240, startW + delta), window.innerWidth * 0.75);
    splitState.width = Math.round(w);
    pane.style.width = splitState.width + 'px';
  }

  function up()
  {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    persistSplitState();
  }

  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ── Tab context menu ──

function showTabContextMenu(e, id)
{
  e.preventDefault();
  e.stopPropagation();

  if (!files[id]) return;

  tabMenuFileId = id;

  var winItems = listOtherWindows().map(function(w)
  {
    return '<button class="file-menu-item" onclick="tabMenuSendToWindow(\'' + escAttr(w.id) + '\')">Move to &ldquo;' + escHtml(w.title) + '&rdquo;</button>';
  }).join('');

  var menu = document.getElementById('tab-context-menu');
  menu.innerHTML =
    '<button class="file-menu-item" onclick="tabMenuAction(\'split\')">Open to the side</button>' +
    '<button class="file-menu-item" onclick="tabMenuAction(\'splitRaw\')">Open raw text to the side</button>' +
    '<button class="file-menu-item" onclick="tabMenuAction(\'detach\')">Move to a new window</button>' +
    winItems +
    '<div class="file-menu-divider"></div>' +
    '<button class="file-menu-item" onclick="tabMenuAction(\'close\')">Close tab</button>';

  menu.classList.add('open');
  menu.style.left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px';
}

function closeTabContextMenu()
{
  document.getElementById('tab-context-menu').classList.remove('open');
}

function tabMenuAction(action)
{
  var id = tabMenuFileId;

  closeTabContextMenu();

  if (!id || !files[id]) return;

  if (action === 'split')         openInSplit(id, 'rendered');
  else if (action === 'splitRaw') openInSplit(id, 'raw');
  else if (action === 'detach')   { openSecondaryWindow(id); removeTab(id); }
  else if (action === 'close')    removeTab(id);
}

function tabMenuSendToWindow(winId)
{
  var id = tabMenuFileId;

  closeTabContextMenu();

  if (!id || !files[id]) return;

  sendFileToWindow(winId, id);
  removeTab(id);
}

// closeOpenTab without a real event: shared by menu actions and drag-drops
function removeTab(id)
{
  closeOpenTab({ stopPropagation: function(){} }, id);
}

document.addEventListener('click', function(e)
{
  var menu = document.getElementById('tab-context-menu');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target))
    closeTabContextMenu();
});

// ── Secondary (satellite) windows ──
//
// A satellite is the full app booted with ?win=<winId>: sidebar hidden, its
// own tab list under lk_tabs_<winId>, and an entry in the lk_windows registry
// so every other window can offer "Move to <this window>". Windows talk over
// localStorage (lk_wincmd) because storage events reach every same-origin
// window - browser popups and Tauri webview windows alike.

function openSecondaryWindow(fileId, screenX, screenY)
{
  var winId = 'w' + Date.now().toString(36),
      url   = 'index.html?win=' + winId + (fileId ? '&file=' + encodeURIComponent(fileId) : ''),
      t     = window.__TAURI__,
      hasPos = typeof screenX === 'number' && typeof screenY === 'number';

  if (Platform.isNative && t && t.webviewWindow && t.webviewWindow.WebviewWindow)
  {
    try
    {
      var opts = { url: url, title: (fileId && files[fileId] ? files[fileId].name : 'Lectern'), width: 1100, height: 750, dragDropEnabled: false };
      if (hasPos) { opts.x = Math.max(0, screenX - 100); opts.y = Math.max(0, screenY - 20); }
      new t.webviewWindow.WebviewWindow('viewer-' + winId, opts);
      return;
    }
    catch(e) { console.warn('Tauri window error, falling back to popup', e); }
  }

  var feats = 'popup=yes,width=1100,height=750';
  if (hasPos) feats += ',left=' + Math.max(0, screenX - 100) + ',top=' + Math.max(0, screenY - 20);
  window.open(url, '_blank', feats);
}

function detachSplitPane()
{
  var id = splitState.fileId;
  if (!id) return;
  openSecondaryWindow(id);
  closeSplitPane();
}

// ── Window registry & command channel ──

function selfWindowId()
{
  return isSatelliteWindow ? satelliteWinId : (isMainWindow ? 'main' : null);
}

function winRegRead()
{
  try { return JSON.parse(localStorage.getItem('lk_windows') || '{}'); } catch(e) { return {}; }
}

function winRegWrite(reg)
{
  try { localStorage.setItem('lk_windows', JSON.stringify(reg)); } catch(e) {}
}

var WIN_REG_STALE_MS = 15000;

function registerThisWindow()
{
  var id = selfWindowId();
  if (!id) return; // embeds aren't drop targets

  function heartbeat()
  {
    var reg = winRegRead();
    reg[id] = {
      title: isMainWindow ? 'Main window' : (document.title || 'Window'),
      ts: Date.now()
    };
    winRegWrite(reg);
  }

  heartbeat();
  setInterval(heartbeat, 5000);

  // pagehide is the reliable close signal; beforeunload kept as a belt.
  // Windows that die without either (crash, killed process) age out via
  // WIN_REG_STALE_MS and the boot-time prune.
  function unregister()
  {
    var reg = winRegRead();
    delete reg[id];
    winRegWrite(reg);
    if (isSatelliteWindow)
      try { localStorage.removeItem('lk_tabs_' + id); } catch(e) {}
  }

  window.addEventListener('pagehide', unregister);
  window.addEventListener('beforeunload', unregister);
}

// Registry entries other than this window, freshest first, stale ones skipped.
function listOtherWindows()
{
  var reg = winRegRead(),
      now = Date.now(),
      self = selfWindowId(),
      out = [];

  Object.keys(reg).forEach(function(id)
  {
    if (id === self) return;
    if (now - (reg[id].ts || 0) > WIN_REG_STALE_MS) return;
    out.push({ id: id, title: reg[id].title || 'Window', ts: reg[id].ts });
  });

  return out.sort(function(a, b){ return b.ts - a.ts; });
}

// Crash-leftover registry rows and orphaned per-window tab lists, swept once
// at main-window boot.
function pruneWindowRegistry()
{
  var reg = winRegRead(),
      now = Date.now(),
      changed = false;

  Object.keys(reg).forEach(function(id)
  {
    if (id !== 'main' && now - (reg[id].ts || 0) > WIN_REG_STALE_MS)
    {
      delete reg[id];
      changed = true;
    }
  });

  if (changed) winRegWrite(reg);

  try
  {
    Object.keys(localStorage).forEach(function(k)
    {
      if (k.indexOf('lk_tabs_w') === 0 && !reg[k.slice('lk_tabs_'.length)])
        localStorage.removeItem(k);
    });
  }
  catch(e) {}
}

function sendFileToWindow(winId, fileId)
{
  try { localStorage.setItem('lk_wincmd', JSON.stringify({ target: winId, fileId: fileId, ts: Date.now() })); } catch(e) {}
}

function handleWindowCommand(raw)
{
  var cmd;
  try { cmd = JSON.parse(raw); } catch(e) { return; }

  if (!cmd || cmd.target !== selfWindowId() || !cmd.fileId || !files[cmd.fileId])
    return;

  openFile(cmd.fileId);

  if (window.focus)
    try { window.focus(); } catch(e) {}
}

// ── Cross-window file sync (browser-storage workspaces) ──
//
// saveToStorage writes the whole file map, so a window holding a stale copy
// of a file someone else just edited would clobber it on its next save.
// Merging on every storage event closes that gap: adopt everything incoming
// except the file being edited right here (kept unless the incoming copy is
// strictly newer, which means it was edited elsewhere).

function mergeFilesFromStorage(raw)
{
  var incoming;
  try { incoming = JSON.parse(raw); } catch(e) { return; }
  if (!incoming || typeof incoming !== 'object') return;

  var localCur = currentFileId && files[currentFileId];

  files = incoming;

  if (localCur)
  {
    var incCur = files[currentFileId];

    if (!incCur)
    {
      // Deleted in another window: let it go here too
      currentFileId = null;
      clearActiveEditors();
    }
    else if ((incCur.modified || 0) > (localCur.modified || 0))
      openFile(currentFileId); // edited elsewhere more recently - reload the editors
    else
      files[currentFileId] = localCur; // local (possibly unsaved) copy wins
  }

  renderFileList();
  pruneOpenTabs();

  if (splitState.fileId)
    renderSplitPane();
}

function initCrossWindowSync()
{
  window.addEventListener('storage', function(e)
  {
    if (e.key === 'lore_keep_v2' && e.newValue && !workFolderRoot)
      mergeFilesFromStorage(e.newValue);
    else if (e.key === 'lk_wincmd' && e.newValue)
      handleWindowCommand(e.newValue);
  });
}

// ── Tab drag & drop (VS Code-style) ──
//
// Dragging a tab (from the bar, or the split pane's own pseudo-tab) turns
// every app window into a drop surface with three kinds of targets:
//   * left / right fifth of the editor area - dock the split pane to that
//     side and open the file there (a half-screen highlight previews it)
//   * the tab bar - insert at the drop position (same window = reorder;
//     from the split pane or another window = the tab moves here)
//   * anywhere outside every app window - tear the tab off into a new
//     window at the drop position (Chrome-style)
// Native HTML5 dnd carries the payload across same-profile windows, so the
// same handlers cover local and cross-window drags. Cancelled drags
// (dropEffect 'none' released inside the window) change nothing.

var TAB_DND_MIME = 'application/x-lorekeep-file';
var dragTabId = null;        // set while a drag that started here is in flight
var dragSource = null;       // 'tab' | 'split' (null for drags from other windows)
var dragDropHandled = false; // a target in this window consumed the drop
var lastDragOverAt = 0;
var dragModeTimer = null;

function tabDragHasFile(e)
{
  var types = e.dataTransfer && e.dataTransfer.types;
  return !!types && Array.prototype.indexOf.call(types, TAB_DND_MIME) >= 0;
}

function onTabDragStart(e, id)
{
  if (!files[id]) return;

  dragTabId = id;
  dragSource = 'tab';
  dragDropHandled = false;
  e.dataTransfer.setData(TAB_DND_MIME, id);
  e.dataTransfer.setData('text/plain', files[id].name || id);
  e.dataTransfer.effectAllowed = 'move';

  // Deferred so the browser snapshots the drag image before layout shifts
  setTimeout(activateTabDragMode, 0);
}

// The split pane's pseudo-tab: drag it back into the bar, to the other edge,
// into another window, or out of the app entirely.
function onSplitTabDragStart(e)
{
  var id = splitState.fileId;

  if (!id || !files[id]) { e.preventDefault(); return; }

  dragTabId = id;
  dragSource = 'split';
  dragDropHandled = false;
  e.dataTransfer.setData(TAB_DND_MIME, id);
  e.dataTransfer.setData('text/plain', files[id].name || id);
  e.dataTransfer.effectAllowed = 'move';

  setTimeout(activateTabDragMode, 0);
}

function onTabDragEnd(e)
{
  var id = dragTabId,
      src = dragSource,
      handled = dragDropHandled;

  dragTabId = null;
  dragSource = null;
  dragDropHandled = false;
  deactivateTabDragMode();

  if (handled || !id)
    return;

  var accepted = e.dataTransfer && e.dataTransfer.dropEffect !== 'none';

  if (accepted)
  {
    // Another window took the tab; this one lets its copy go
    if (src === 'split') closeSplitPane(); else removeTab(id);
  }
  else if (dragEndedOutsideWindow(e))
  {
    // Released where no app window is: tear off into a fresh window there
    openSecondaryWindow(id, e.screenX, e.screenY);
    if (src === 'split') closeSplitPane(); else removeTab(id);
  }
  // else: cancelled inside the window - keep everything as it was
}

function dragEndedOutsideWindow(e)
{
  if (typeof e.screenX !== 'number' || (e.screenX === 0 && e.screenY === 0))
    return false;

  var m = 10;
  return e.screenX < window.screenX - m || e.screenX > window.screenX + window.outerWidth + m ||
         e.screenY < window.screenY - m || e.screenY > window.screenY + window.outerHeight + m;
}

// While any tab drag is over this window the body carries .tab-drag-active:
// the tab bar stays visible as a target even when empty, and the split
// pane's embed iframe goes pointer-transparent so drags pass through it.
// A staleness timer clears the state for drags that simply leave the window
// (their dragend fires elsewhere).
function activateTabDragMode()
{
  lastDragOverAt = Date.now();
  document.body.classList.add('tab-drag-active');

  if (!dragModeTimer)
    dragModeTimer = setInterval(function()
    {
      if (Date.now() - lastDragOverAt > 1500)
        deactivateTabDragMode();
    }, 500);
}

function deactivateTabDragMode()
{
  document.body.classList.remove('tab-drag-active');
  hideSplitHints();

  if (dragModeTimer)
  {
    clearInterval(dragModeTimer);
    dragModeTimer = null;
  }
}

function hideSplitHints()
{
  document.getElementById('split-hint-left').classList.remove('open');
  document.getElementById('split-hint-right').classList.remove('open');
}

// Which target the pointer is over: 'tabbar', 'left', 'right' or null.
// The top strip counts as the bar even while the bar is empty/hidden.
function tabDropZoneAt(e)
{
  var bar = document.getElementById('open-tabs-bar'),
      barRect = bar.getBoundingClientRect();

  if (e.clientY <= Math.max(barRect.bottom, 44))
    return 'tabbar';

  var es = document.getElementById('editor-split').getBoundingClientRect();

  if (e.clientY >= es.top && e.clientY <= es.bottom)
  {
    var x = e.clientX - es.left;
    if (x < es.width * 0.2)  return 'left';
    if (x > es.width * 0.8)  return 'right';
  }

  return null;
}

// Insert position in the tab bar for a drop at this x
function tabInsertIndexAt(e)
{
  var tabs = document.querySelectorAll('#open-tabs-bar .open-tab');

  for (var i = 0; i < tabs.length; i++)
  {
    var r = tabs[i].getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2)
      return i;
  }

  return tabs.length;
}

function placeTabAt(id, index)
{
  var cur = openTabs.indexOf(id);

  if (cur >= 0)
  {
    openTabs.splice(cur, 1);
    if (cur < index) index--;
  }

  openTabs.splice(Math.max(0, Math.min(index, openTabs.length)), 0, id);
  persistOpenTabs();
  renderOpenTabs();
}

document.addEventListener('dragover', function(e)
{
  if (isEmbedContext || !tabDragHasFile(e)) return;

  activateTabDragMode();
  e.preventDefault();

  var zone = tabDropZoneAt(e);

  // A drag from another window may be dropped anywhere in this one: the
  // center simply appends a tab. Local drags need a real target.
  if (!zone && !dragTabId) zone = 'append';

  e.dataTransfer.dropEffect = zone ? 'move' : 'none';
  document.getElementById('split-hint-left').classList.toggle('open', zone === 'left');
  document.getElementById('split-hint-right').classList.toggle('open', zone === 'right');
}, true);

document.addEventListener('drop', function(e)
{
  if (isEmbedContext || !tabDragHasFile(e)) return;

  e.preventDefault();

  var zone = tabDropZoneAt(e),
      id   = e.dataTransfer.getData(TAB_DND_MIME) || dragTabId,
      src  = dragSource; // null for cross-window drags

  if (!zone && !dragTabId) zone = 'append';

  deactivateTabDragMode();

  if (!zone || !id || !files[id]) return;

  dragDropHandled = true;

  if (zone === 'left' || zone === 'right')
  {
    splitState.side = zone;
    openInSplit(id, 'rendered');

    if (src === 'tab')
      removeTab(id);
    // src 'split': only the docking side changed; foreign: source cleans up
  }
  else // 'tabbar' / 'append'
  {
    var index = (zone === 'tabbar') ? tabInsertIndexAt(e) : openTabs.length;

    if (src === 'tab')
      placeTabAt(id, index); // reorder within this bar
    else
    {
      placeTabAt(id, index);
      if (src === 'split') closeSplitPane();
      openFile(id);
    }
  }
}, true);

// Embedded instances can't host drops, but drags do wander over their
// iframes; they nudge the parent so it keeps its drop surface active (the
// parent then makes the iframe pointer-transparent).
if (isEmbedContext)
{
  var lastDragPostAt = 0;

  document.addEventListener('dragover', function(e)
  {
    if (!tabDragHasFile(e)) return;

    var now = Date.now();

    if (now - lastDragPostAt > 400)
    {
      lastDragPostAt = now;
      try { window.parent.postMessage({ lkTabDrag: 1 }, '*'); } catch(err) {}
    }
  }, true);
}

window.addEventListener('message', function(e)
{
  if (!isEmbedContext && e.data && e.data.lkTabDrag)
    activateTabDragMode();
});

// Cross-file links inside the split pane's document view open the target in
// this window's main editor.
document.getElementById('split-rendered').addEventListener('click', function(e)
{
  var link = e.target.closest('a');
  if (!link) return;

  var href = link.getAttribute('href') || '';
  if (href.indexOf(FILE_LINK_SCHEME) !== 0) return;

  e.preventDefault();

  var id = decodeURIComponent(href.slice(FILE_LINK_SCHEME.length));
  if (files[id])
    openFile(id);
});

// Boot path for satellites (?win=) and embeds (?embed=): the full app with
// the chrome trimmed by a body class, sharing storage with the main window.
async function initSecondaryContext()
{
  document.body.classList.add(isEmbedContext ? 'embed-mode' : 'satellite-mode');
  initTheme();
  buildSheet();

  if (workFolderRoot)
    await loadWorkFolderTree();
  else
    loadFromStorage();

  await loadBacklinksIndex();

  if (isEmbedContext)
  {
    if (files[embedFileId])
      await openFile(embedFileId);
  }
  else
  {
    loadOpenTabs();

    var seed = bootParams.get('file');

    if (seed && files[seed])
      await openFile(seed);
    else if (openTabs.length && files[openTabs[0]])
      await openFile(openTabs[0]);

    if (currentFileId && files[currentFileId])
      document.title = files[currentFileId].name || 'Lectern';

    renderSplitPane(); // satellites can hold their own (non-persisted) split
    registerThisWindow();
  }

  initCrossWindowSync();

  // Work-folder workspaces have no storage event to lean on; keep this
  // window's copy of its visible file fresh with a light poll. (The web
  // cloud workspace additionally live-merges through updateLiveSync.)
  if (workFolderRoot)
  {
    setInterval(async function()
    {
      var id = isEmbedContext ? embedFileId : currentFileId,
          f = id && files[id];

      // Never clobber text the user typed here in the last few seconds - a
      // pending debounced save makes disk content momentarily stale.
      if (!f || Date.now() - lastLocalEditAt < 5000) return;

      try
      {
        var content = await Platform.readWorkFile(workFolderRoot, id);

        if (content !== f.content)
        {
          f.content = content;
          f.contentLoaded = true;
          await openFile(id);
        }
      }
      catch(e) {}
    }, 4000);
  }
}
