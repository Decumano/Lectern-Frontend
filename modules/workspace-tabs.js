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
// (fRemapOpenTab) and structural refreshes must drop dead ids (fPruneOpenTabs).

var openTabs = [];

// Satellite windows keep their own tab list; the main window keeps the
// original key. (Embeds have no tab bar and never persist tabs at all.)
function fTabsStorageKey()
{
  return isSatelliteWindow ? ('lk_tabs_' + satelliteWinId) : 'lk_tabs';
}

function fLoadOpenTabs()
{
  try
  {
    var raw = localStorage.getItem(fTabsStorageKey());
    openTabs = raw ? JSON.parse(raw).filter(function(id) { return !!files[id]; }) : [];
  }
  catch(e) { openTabs = []; }
  fRenderOpenTabs();
}

function fPersistOpenTabs()
{
  if (isEmbedContext) return;
  try { localStorage.setItem(fTabsStorageKey(), JSON.stringify(openTabs)); } catch(e) {}
}

function fNoteTabOpened(id)
{
  if (isEmbedContext || id === cSharedTmpId || !files[id])
    return;

  if (openTabs.indexOf(id) < 0)
  {
    openTabs.push(id);
    fPersistOpenTabs();
  }

  fRenderOpenTabs();
}

function fRemapOpenTab(oldId, newId)
{
  var i = openTabs.indexOf(oldId);

  if (i < 0)
    return;

  if (openTabs.indexOf(newId) >= 0)
    openTabs.splice(i, 1); // already open under the new id - drop the stale one
  else
    openTabs[i] = newId;

  fPersistOpenTabs();
  fRenderOpenTabs();

  // A rename/move must not orphan the side pane
  if (splitState.fileId === oldId)
  {
    splitState.fileId = newId;
    fPersistSplitState();
    fRenderSplitPane();
  }
}

function fPruneOpenTabs()
{
  var before = openTabs.length;
  openTabs = openTabs.filter(function(id) { return !!files[id]; });

  if (openTabs.length !== before)
    fPersistOpenTabs();

  fRenderOpenTabs();

  if (splitState.fileId && !files[splitState.fileId])
  {
    splitState.fileId = null;
    fPersistSplitState();
    fRenderSplitPane();
  }
}

function fCloseOpenTab(e, id)
{
  e.stopPropagation();

  var i = openTabs.indexOf(id);

  if (i >= 0)
  {
    openTabs.splice(i, 1);
    fPersistOpenTabs();
  }

  // Closing the active tab moves to a neighbor; closing the last one leaves
  // the editors empty, same as after deleting the open file.
  if (currentFileId === id)
  {
    var next = openTabs[Math.min(i, openTabs.length - 1)];

    if (next)
    {
      fOpenFile(next);
      return;
    }

    currentFileId = null;
    fClearActiveEditors();
    fRenderFileList();
  }

  fRenderOpenTabs();
}

function fRenderOpenTabs()
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

    return '<div class="open-tab' + (id === currentFileId ? ' active' : '') + '" draggable="true" ondragstart="fOnTabDragStart(event,\'' + fEscAttr(id) + '\')" ondragend="fOnTabDragEnd(event)" onmousedown="if(event.button===1)event.preventDefault()" onauxclick="if(event.button===1)fCloseOpenTab(event,\'' + fEscAttr(id) + '\')" onclick="fOpenFile(\'' + fEscAttr(id) + '\')" oncontextmenu="fShowTabContextMenu(event,\'' + fEscAttr(id) + '\')" title="' + fEscAttr(f.name) + '">' +
             '<span class="open-tab-icon">' + fFileTypeIcon(f.type) + '</span>' +
             '<span class="open-tab-name">' + fEscHtml(f.name) + '</span>' +
             '<button class="open-tab-close" onclick="fCloseOpenTab(event,\'' + fEscAttr(id) + '\')" title="Close tab">×</button>' +
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
// merge the whole file map on every save (fMergeFilesFromStorage), work-folder
// files are separate on disk already, and the web cloud workspace additionally
// live-polls the open file (fUpdateLiveSync).

var bootParams        = new URLSearchParams(window.location.search);
var embedFileId       = bootParams.get('embed');
var satelliteWinId    = bootParams.get('win');
var isEmbedContext    = !!embedFileId;
var isSatelliteWindow = !isEmbedContext && !!satelliteWinId;
var isMainWindow      = !isEmbedContext && !isSatelliteWindow;

var splitState     = { fileId: null, mode: 'rendered', width: 400, side: 'right' };
var tabMenuFileId  = null;
var lastLocalEditAt = 0;

function fLoadSplitState()
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

function fPersistSplitState()
{
  if (!isMainWindow) return; // satellites/embeds must not steal the main window's pane state
  try { localStorage.setItem('lk_split', JSON.stringify(splitState)); } catch(e) {}
}

// Called once from init after files are available: restores the pane the user
// had open last session.
function fInitSplitView()
{
  fLoadSplitState();
  fRenderSplitPane();
}

function fOpenInSplit(id, mode)
{
  if (!files[id]) return;
  splitState.fileId = id;
  if (mode) splitState.mode = mode === 'raw' ? 'raw' : 'rendered';
  fPersistSplitState();
  fRenderSplitPane();
}

function fCloseSplitPane()
{
  splitState.fileId = null;
  fPersistSplitState();
  fRenderSplitPane();
}

function fSetSplitMode(mode)
{
  splitState.mode = mode === 'raw' ? 'raw' : 'rendered';
  fPersistSplitState();
  fRenderSplitPane();
}

// Work-folder files are read lazily; the split pane needs the same guarantee
// fOpenFile gives the main editor.
async function fEnsureFileContentLoaded(id)
{
  var f = files[id];
  if (!f || !workFolderRoot || f.contentLoaded) return;
  try
  {
    f.content       = await Platform.fReadWorkFile(workFolderRoot, id);
    f.contentLoaded = true;
  }
  catch(e) { console.warn('Split view read error', e); }
}

async function fRenderSplitPane()
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

  await fEnsureFileContentLoaded(id);

  document.getElementById('split-pane-icon').innerHTML   = fFileTypeIcon(f.type);
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
// own timer instead of fScheduleSave's.
var splitSaveTimer = null;

function fOnSplitRawInput()
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
    fUpdatePreview();
    fUpdateStatus();
  }

  clearTimeout(splitSaveTimer);
  splitSaveTimer = setTimeout(function() { fPersistFileEntry(id); }, 800);
}

// ── Split divider drag ──

function fStartSplitDrag(e)
{
  e.preventDefault();

  var pane   = document.getElementById('split-pane'),
      startX = e.clientX,
      startW = pane.getBoundingClientRect().width;

  function fMove(ev)
  {
    var delta = (splitState.side === 'left') ? (ev.clientX - startX) : (startX - ev.clientX),
        w = Math.min(Math.max(240, startW + delta), window.innerWidth * 0.75);
    splitState.width = Math.round(w);
    pane.style.width = splitState.width + 'px';
  }

  function fUp()
  {
    document.removeEventListener('mousemove', fMove);
    document.removeEventListener('mouseup', fUp);
    fPersistSplitState();
  }

  document.addEventListener('mousemove', fMove);
  document.addEventListener('mouseup', fUp);
}

// ── Tab context menu ──

function fShowTabContextMenu(e, id)
{
  e.preventDefault();
  e.stopPropagation();

  if (!files[id]) return;

  tabMenuFileId = id;

  var winItems = fListOtherWindows().map(function(w)
  {
    return '<button class="file-menu-item" onclick="fTabMenuSendToWindow(\'' + fEscAttr(w.id) + '\')">Move to &ldquo;' + fEscHtml(w.title) + '&rdquo;</button>';
  }).join('');

  var menu = document.getElementById('tab-context-menu');
  menu.innerHTML =
    '<button class="file-menu-item" onclick="fTabMenuAction(\'split\')">Open to the side</button>' +
    '<button class="file-menu-item" onclick="fTabMenuAction(\'splitRaw\')">Open raw text to the side</button>' +
    '<button class="file-menu-item" onclick="fTabMenuAction(\'detach\')">Move to a new window</button>' +
    winItems +
    '<div class="file-menu-divider"></div>' +
    '<button class="file-menu-item" onclick="fTabMenuAction(\'close\')">Close tab</button>';

  menu.classList.add('open');
  menu.style.left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px';
}

function fCloseTabContextMenu()
{
  document.getElementById('tab-context-menu').classList.remove('open');
}

function fTabMenuAction(action)
{
  var id = tabMenuFileId;

  fCloseTabContextMenu();

  if (!id || !files[id]) return;

  if (action === 'split')         fOpenInSplit(id, 'rendered');
  else if (action === 'splitRaw') fOpenInSplit(id, 'raw');
  else if (action === 'detach')   { fOpenSecondaryWindow(id); fRemoveTab(id); }
  else if (action === 'close')    fRemoveTab(id);
}

function fTabMenuSendToWindow(winId)
{
  var id = tabMenuFileId;

  fCloseTabContextMenu();

  if (!id || !files[id]) return;

  fSendFileToWindow(winId, id);
  fRemoveTab(id);
}

// fCloseOpenTab without a real event: shared by menu actions and drag-drops
function fRemoveTab(id)
{
  fCloseOpenTab({ stopPropagation: function(){} }, id);
}

document.addEventListener('click', function(e)
{
  var menu = document.getElementById('tab-context-menu');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target))
    fCloseTabContextMenu();
});

// ── Secondary (satellite) windows ──
//
// A satellite is the full app booted with ?win=<winId>: sidebar hidden, its
// own tab list under lk_tabs_<winId>, and an entry in the lk_windows registry
// so every other window can offer "Move to <this window>". Windows talk over
// localStorage (lk_wincmd) because storage events reach every same-origin
// window - browser popups and Tauri webview windows alike.

function fOpenSecondaryWindow(fileId, screenX, screenY)
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

function fDetachSplitPane()
{
  var id = splitState.fileId;
  if (!id) return;
  fOpenSecondaryWindow(id);
  fCloseSplitPane();
}

// ── Window registry & command channel ──

function fSelfWindowId()
{
  return isSatelliteWindow ? satelliteWinId : (isMainWindow ? 'main' : null);
}

function fWinRegRead()
{
  try { return JSON.parse(localStorage.getItem('lk_windows') || '{}'); } catch(e) { return {}; }
}

function fWinRegWrite(reg)
{
  try { localStorage.setItem('lk_windows', JSON.stringify(reg)); } catch(e) {}
}

var cWinRegStaleMs = 15000;

function fRegisterThisWindow()
{
  var id = fSelfWindowId();
  if (!id) return; // embeds aren't drop targets

  function fHeartbeat()
  {
    var reg = fWinRegRead();
    reg[id] = {
      title: isMainWindow ? 'Main window' : (document.title || 'Window'),
      ts: Date.now()
    };
    fWinRegWrite(reg);
  }

  fHeartbeat();
  setInterval(fHeartbeat, 5000);

  // pagehide is the reliable close signal; beforeunload kept as a belt.
  // Windows that die without either (crash, killed process) age out via
  // WIN_REG_STALE_MS and the boot-time prune.
  function fUnregister()
  {
    var reg = fWinRegRead();
    delete reg[id];
    fWinRegWrite(reg);
    if (isSatelliteWindow)
      try { localStorage.removeItem('lk_tabs_' + id); } catch(e) {}
  }

  window.addEventListener('pagehide', fUnregister);
  window.addEventListener('beforeunload', fUnregister);
}

// Registry entries other than this window, freshest first, stale ones skipped.
function fListOtherWindows()
{
  var reg = fWinRegRead(),
      now = Date.now(),
      self = fSelfWindowId(),
      out = [];

  Object.keys(reg).forEach(function(id)
  {
    if (id === self) return;
    if (now - (reg[id].ts || 0) > cWinRegStaleMs) return;
    out.push({ id: id, title: reg[id].title || 'Window', ts: reg[id].ts });
  });

  return out.sort(function(a, b){ return b.ts - a.ts; });
}

// Crash-leftover registry rows and orphaned per-window tab lists, swept once
// at main-window boot.
function fPruneWindowRegistry()
{
  var reg = fWinRegRead(),
      now = Date.now(),
      changed = false;

  Object.keys(reg).forEach(function(id)
  {
    if (id !== 'main' && now - (reg[id].ts || 0) > cWinRegStaleMs)
    {
      delete reg[id];
      changed = true;
    }
  });

  if (changed) fWinRegWrite(reg);

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

function fSendFileToWindow(winId, fileId)
{
  try { localStorage.setItem('lk_wincmd', JSON.stringify({ target: winId, fileId: fileId, ts: Date.now() })); } catch(e) {}
}

function fHandleWindowCommand(raw)
{
  var cmd;
  try { cmd = JSON.parse(raw); } catch(e) { return; }

  if (!cmd || cmd.target !== fSelfWindowId() || !cmd.fileId || !files[cmd.fileId])
    return;

  fOpenFile(cmd.fileId);

  if (window.focus)
    try { window.focus(); } catch(e) {}
}

// ── Cross-window file sync (browser-storage workspaces) ──
//
// fSaveToStorage writes the whole file map, so a window holding a stale copy
// of a file someone else just edited would clobber it on its next save.
// Merging on every storage event closes that gap: adopt everything incoming
// except the file being edited right here (kept unless the incoming copy is
// strictly newer, which means it was edited elsewhere).

function fMergeFilesFromStorage(raw)
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
      fClearActiveEditors();
    }
    else if ((incCur.modified || 0) > (localCur.modified || 0))
      fOpenFile(currentFileId); // edited elsewhere more recently - reload the editors
    else
      files[currentFileId] = localCur; // local (possibly unsaved) copy wins
  }

  fRenderFileList();
  fPruneOpenTabs();

  if (splitState.fileId)
    fRenderSplitPane();
}

function fInitCrossWindowSync()
{
  window.addEventListener('storage', function(e)
  {
    if (e.key === 'lore_keep_v2' && e.newValue && !workFolderRoot)
      fMergeFilesFromStorage(e.newValue);
    else if (e.key === 'lk_wincmd' && e.newValue)
      fHandleWindowCommand(e.newValue);
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
// (released inside the window with no target) change nothing.
//
// A tab only leaves this window when another Lectern window says it took it.
// The drag carries a one-off token; the window that handles the drop writes
// it back under TAB_DROP_ACK_KEY in localStorage, which every same-origin
// window shares. dropEffect alone can't tell "another Lectern window" from
// "some other app": a drag that offered text/plain was accepted by chat
// boxes and editors (Discord, for one), so the tab was closed as moved while
// no window received it — no tear-off, and the tab was gone.

var cTabDndMime = 'application/x-lorekeep-file';
var cTabDndTokenMime = 'application/x-lorekeep-drag';
var cTabDropAckKey = 'lk_tabdrop_ack';
var cTabDropAckWaitMs = 600; // how long dragend waits to hear from the target
var dragTabId = null;        // set while a drag that started here is in flight
var dragSource = null;       // 'tab' | 'split' (null for drags from other windows)
var dragToken = null;        // this drag's token, for the target's acknowledgement
var dragDropHandled = false; // a target in this window consumed the drop
var lastDragOverAt = 0;
var dragModeTimer = null;

function fTabDragHasFile(e)
{
  var types = e.dataTransfer && e.dataTransfer.types;
  return !!types && Array.prototype.indexOf.call(types, cTabDndMime) >= 0;
}

// Starts a tab drag. Only private types go on the drag: anything an
// ordinary app understands (text/plain) lets that app accept the drop.
function fBeginTabDrag(e, id, source)
{
  dragTabId = id;
  dragSource = source;
  dragDropHandled = false;
  dragToken = id + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2);
  e.dataTransfer.setData(cTabDndMime, id);
  e.dataTransfer.setData(cTabDndTokenMime, dragToken);
  e.dataTransfer.effectAllowed = 'move';
}

function fOnTabDragStart(e, id)
{
  if (!files[id]) return;

  fBeginTabDrag(e, id, 'tab');

  // Deferred so the browser snapshots the drag image before layout shifts
  setTimeout(fActivateTabDragMode, 0);
}

// The split pane's pseudo-tab: drag it back into the bar, to the other edge,
// into another window, or out of the app entirely.
function fOnSplitTabDragStart(e)
{
  var id = splitState.fileId;

  if (!id || !files[id]) { e.preventDefault(); return; }

  fBeginTabDrag(e, id, 'split');

  setTimeout(fActivateTabDragMode, 0);
}

function fOnTabDragEnd(e)
{
  var id = dragTabId,
      src = dragSource,
      token = dragToken,
      handled = dragDropHandled,
      // Read now: the pointer, and how recently it was over this page, are
      // only meaningful at the moment of release.
      outside = fDragEndedOutsideWindow(e),
      screenX = e.screenX,
      screenY = e.screenY;

  dragTabId = null;
  dragSource = null;
  dragToken = null;
  dragDropHandled = false;
  fDeactivateTabDragMode();

  if (handled || !id)
    return;

  fWaitForTabDropAck(token).then(function(fTaken)
  {
    if (fTaken)
    {
      // Another Lectern window took the tab; this one lets its copy go.
      if (src === 'split') fCloseSplitPane(); else fRemoveTab(id);
    }
    else if (outside && files[id])
    {
      // Released where no Lectern window took it — over the desktop or over
      // another app: tear off into a fresh window there.
      fOpenSecondaryWindow(id, screenX, screenY);
      if (src === 'split') fCloseSplitPane(); else fRemoveTab(id);
    }
    // else: cancelled inside the window - keep everything as it was
  });
}

// Resolves true once the window that handled the drop has acknowledged this
// drag's token, false if none does in time. The acknowledgement normally
// lands just before dragend, but storage events cross windows
// asynchronously, so it may also arrive a moment after.
function fWaitForTabDropAck(token)
{
  return new Promise(function(resolve)
  {
    if (!token) { resolve(false); return; }

    var done = false, timer = null;

    function fAcked(value)
    {
      return !!value && value.split('|')[0] === token;
    }

    function fFinish(result)
    {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('storage', fOnStorage);
      if (result)
        try { localStorage.removeItem(cTabDropAckKey); } catch(err) {}
      resolve(result);
    }

    function fOnStorage(ev)
    {
      if (ev.key === cTabDropAckKey && fAcked(ev.newValue)) fFinish(true);
    }

    var current = null;
    try { current = localStorage.getItem(cTabDropAckKey); } catch(err) {}
    if (fAcked(current)) { fFinish(true); return; }

    window.addEventListener('storage', fOnStorage);
    timer = setTimeout(function()
    {
      var late = null;
      try { late = localStorage.getItem(cTabDropAckKey); } catch(err) {}
      fFinish(fAcked(late));
    }, cTabDropAckWaitMs);
  });
}

// Called by the window that handled a drop from another window.
function fAcknowledgeTabDrop(token)
{
  if (!token) return;
  try { localStorage.setItem(cTabDropAckKey, token + '|' + Date.now()); } catch(err) {}
}

// Whether the drag was released somewhere other than this page: outside the
// window's rectangle, or over another app's window that sits on top of it
// (this page then stops receiving dragover — it fires continuously, every
// ~50ms, while the pointer is over the page, even when it doesn't move).
function fDragEndedOutsideWindow(e)
{
  if (Date.now() - lastDragOverAt > 350)
    return true;

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
function fActivateTabDragMode()
{
  lastDragOverAt = Date.now();
  document.body.classList.add('tab-drag-active');

  if (!dragModeTimer)
    dragModeTimer = setInterval(function()
    {
      if (Date.now() - lastDragOverAt > 1500)
        fDeactivateTabDragMode();
    }, 500);
}

function fDeactivateTabDragMode()
{
  document.body.classList.remove('tab-drag-active');
  fHideSplitHints();

  if (dragModeTimer)
  {
    clearInterval(dragModeTimer);
    dragModeTimer = null;
  }
}

function fHideSplitHints()
{
  document.getElementById('split-hint-left').classList.remove('open');
  document.getElementById('split-hint-right').classList.remove('open');
}

// Which target the pointer is over: 'tabbar', 'left', 'right' or null.
// The top strip counts as the bar even while the bar is empty/hidden.
function fTabDropZoneAt(e)
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
function fTabInsertIndexAt(e)
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

function fPlaceTabAt(id, index)
{
  var cur = openTabs.indexOf(id);

  if (cur >= 0)
  {
    openTabs.splice(cur, 1);
    if (cur < index) index--;
  }

  openTabs.splice(Math.max(0, Math.min(index, openTabs.length)), 0, id);
  fPersistOpenTabs();
  fRenderOpenTabs();
}

document.addEventListener('dragover', function(e)
{
  if (isEmbedContext || !fTabDragHasFile(e)) return;

  fActivateTabDragMode();
  e.preventDefault();

  var zone = fTabDropZoneAt(e);

  // A drag from another window may be dropped anywhere in this one: the
  // center simply appends a tab. Local drags need a real target.
  if (!zone && !dragTabId) zone = 'append';

  e.dataTransfer.dropEffect = zone ? 'move' : 'none';
  document.getElementById('split-hint-left').classList.toggle('open', zone === 'left');
  document.getElementById('split-hint-right').classList.toggle('open', zone === 'right');
}, true);

document.addEventListener('drop', function(e)
{
  if (isEmbedContext || !fTabDragHasFile(e)) return;

  e.preventDefault();

  var zone = fTabDropZoneAt(e),
      id   = e.dataTransfer.getData(cTabDndMime) || dragTabId,
      src  = dragSource; // null for cross-window drags

  if (!zone && !dragTabId) zone = 'append';

  fDeactivateTabDragMode();

  if (!zone || !id || !files[id]) return;

  dragDropHandled = true;

  // A tab from another window: tell it the tab arrived, so it closes its copy.
  if (!src)
    fAcknowledgeTabDrop(e.dataTransfer.getData(cTabDndTokenMime));

  if (zone === 'left' || zone === 'right')
  {
    splitState.side = zone;
    fOpenInSplit(id, 'rendered');

    if (src === 'tab')
      fRemoveTab(id);
    // src 'split': only the docking side changed; foreign: source cleans up
  }
  else // 'tabbar' / 'append'
  {
    var index = (zone === 'tabbar') ? fTabInsertIndexAt(e) : openTabs.length;

    if (src === 'tab')
      fPlaceTabAt(id, index); // reorder within this bar
    else
    {
      fPlaceTabAt(id, index);
      if (src === 'split') fCloseSplitPane();
      fOpenFile(id);
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
    if (!fTabDragHasFile(e)) return;

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
    fActivateTabDragMode();
});

// Cross-file links inside the split pane's document view open the target in
// this window's main editor.
document.getElementById('split-rendered').addEventListener('click', function(e)
{
  var link = e.target.closest('a');
  if (!link) return;

  var href = link.getAttribute('href') || '';
  if (href.indexOf(cFileLinkScheme) !== 0) return;

  e.preventDefault();

  var id = decodeURIComponent(href.slice(cFileLinkScheme.length));
  if (files[id])
    fOpenFile(id);
});

// Boot path for satellites (?win=) and embeds (?embed=): the full app with
// the chrome trimmed by a body class, sharing storage with the main window.
async function fInitSecondaryContext()
{
  document.body.classList.add(isEmbedContext ? 'embed-mode' : 'satellite-mode');
  fInitTheme();
  fBuildSheet();

  if (workFolderRoot)
    await fLoadWorkFolderTree();
  else
    fLoadFromStorage();

  await fLoadBacklinksIndex();

  if (isEmbedContext)
  {
    if (files[embedFileId])
      await fOpenFile(embedFileId);
  }
  else
  {
    fLoadOpenTabs();

    var seed = bootParams.get('file');

    if (seed && files[seed])
      await fOpenFile(seed);
    else if (openTabs.length && files[openTabs[0]])
      await fOpenFile(openTabs[0]);

    if (currentFileId && files[currentFileId])
      document.title = files[currentFileId].name || 'Lectern';

    fRenderSplitPane(); // satellites can hold their own (non-persisted) split
    fRegisterThisWindow();
  }

  fInitCrossWindowSync();

  // Work-folder workspaces have no storage event to lean on; keep this
  // window's copy of its visible file fresh with a light poll. (The web
  // cloud workspace additionally live-merges through fUpdateLiveSync.)
  if (workFolderRoot)
  {
    setInterval(async function()
    {
      var id = isEmbedContext ? embedFileId : currentFileId,
          f = id && files[id];

      // Never clobber text the user typed here in the last few seconds - a
      // pending debounced save makes disk content momentarily stale.
      if (!f || Date.now() - lastLocalEditAt < 5000) return;

      // A file that live sync follows is merged into the editor in place, as
      // changes arrive (and its writes are in flight, or about to be). Reloading
      // it from disk here would race that, throw away unsaved text, and send the
      // view back to the top.
      if (id === liveSyncFileId || saveTimer !== null || autosaveBusy) return;

      try
      {
        var content = await Platform.fReadWorkFile(workFolderRoot, id);

        if (content !== f.content && id === currentFileId && saveTimer === null && !autosaveBusy)
        {
          // Keep the reader's place: the text changed under them, they didn't move.
          var ed = document.getElementById('editor'),
              pv = document.getElementById('preview-content'),
              pane = pv ? fScrollParentOf(pv) : null,
              at = { edit: ed.scrollTop, pane: pane ? pane.scrollTop : 0, start: ed.selectionStart, end: ed.selectionEnd };

          f.content = content;
          f.contentLoaded = true;
          await fOpenFile(id);

          if (currentFileId === id)
          {
            ed.scrollTop = at.edit;
            ed.selectionStart = Math.min(at.start, ed.value.length);
            ed.selectionEnd = Math.min(at.end, ed.value.length);
            if (pane) pane.scrollTop = at.pane;
          }
        }
      }
      catch(e) {}
    }, 4000);
  }
}
