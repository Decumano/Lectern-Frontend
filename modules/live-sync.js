// Live sync for the JSON data apps
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── LIVE SYNC (concurrent editing for the JSON data apps) ──
//
// While a Glossary / Bestiary / Calendar / Economy file is open, the same file
// can be edited from several devices — or by several people through a share —
// at once, with everyone seeing everyone else's changes within moments. Remote
// and local edits are reconciled with a three-way merge at item granularity
// (see fMergeDataContent), which these JSON files support cleanly because every
// item carries a stable id.
//
// Nothing polls. The page keeps one WebSocket to the server (/api/sync/ws, see
// Lectern-Server's sync_hub.h) and the server announces "this changed"; only
// then is the file's {modified, hash} stat fetched (fLiveSyncTick). The socket
// speaks a small acknowledged protocol: every announcement is answered, so
// neither end acts on, or waits for, a peer that is gone. File contents still
// travel over the ordinary HTTP calls.
// Web only: on Tauri the desktop engine has its own socket (cloud.cpp), and
// fLiveSyncTarget() returns null, so none of this starts.

var cLiveSyncAckTimeout = 10000;   // ms the server has to answer a frame of ours
var cLiveSyncHeartbeat  = 25000;   // ms between pings that expose a silently dead connection
var cLiveSyncRetryMax   = 30000;   // ms, longest pause between reconnect attempts

var liveSyncSocket      = null;
var liveSyncReady       = false;   // the server has answered our greeting
var liveSyncGreetingId  = null;
var liveSyncReconnect   = null;    // pending reconnect timer, if any
var liveSyncRetryDelay  = 1000;
var liveSyncHeartbeatTimer = null;
var liveSyncPending     = {};      // frame id -> timeout handle, for frames awaiting an ack
var liveSyncFrameSeq    = 0;
var liveSyncWatchKey    = null;    // which shared file the server is told we follow
var liveSyncDevice      = Platform.deviceId;

var liveSyncFileId     = null;   // file being followed
var liveSyncBase       = null;   // content as of the last agreement with the server
var liveSyncServerHash = null;   // server hash seen on the previous check
var liveSyncBusy       = false;
var liveSyncAgain      = false;  // a change was announced while a check was running

// What is followed live: Documents, merged as text (fMergeText), and the four
// JSON data apps, merged item by item (fMergeDataContent).
var cLiveFileTypes = { doc: 1, glossary: 1, bestiary: 1, calendar: 1, economy: 1 };

function fLiveSyncTarget()
{
  var f = currentFileId && files[currentFileId];
  if (!f || !cLiveFileTypes[f.type] || !f.contentLoaded) return null;
  // The desktop app has no socket here: its sync engine (cloud.cpp) keeps the
  // folder in step and tells the page which files it just changed
  // (fOnCloudFilesChanged), and the page merges those into the editor.
  if (Platform.isNative) return workFolderRoot ? { path: currentFileId } : null;
  if (currentFileId === cSharedTmpId)
  {
    if (!sharedCtx) return null;
    // Any permission level may watch; only edit may write back.
    return sharedCtx.link
      ? { link: sharedCtx.link, subPath: sharedCtx.subPath }
      : { share: sharedCtx.shareId, subPath: sharedCtx.subPath };
  }
  if (!workFolderRoot) return null; // local-storage mode: nothing to sync with
  return { path: currentFileId };
}

// (Re)aims live sync at whatever is currently open. Called after every file
// open; the check also calls it when it notices the file changed.
function fUpdateLiveSync()
{
  var target = fLiveSyncTarget();
  liveSyncFileId     = target ? currentFileId : null;
  liveSyncBase       = target ? (files[currentFileId].content || '') : null;
  liveSyncServerHash = null;

  var pill = document.getElementById('live-sync-pill');
  if (pill) pill.style.display = (target && !Platform.isNative) ? '' : 'none';

  if (!target || Platform.isNative)
  {
    fLiveSyncDisconnect();
    return;
  }

  if (liveSyncSocket && liveSyncReady)
  {
    fLiveSyncSendWatch(target);
    fLiveSyncTick(); // the new file may already be ahead of what was loaded
  }
  else if (!liveSyncSocket && !liveSyncReconnect)
    fLiveSyncConnect();
}

function fLiveSyncSetPill(live)
{
  var pill = document.getElementById('live-sync-pill');
  if (!pill || pill.classList.contains('flash')) return;
  pill.textContent = live ? '● Live' : '○ Reconnecting…';
}

// Sends a frame and, if wanted, arms the deadline by which the server must
// answer it. No answer means the server is down or wedged: drop the connection
// (the reconnect then runs a full catch-up).
function fLiveSyncSend(frame, expectAck)
{
  if (!liveSyncSocket || liveSyncSocket.readyState !== 1) return null;
  frame.id = 'w' + (++liveSyncFrameSeq);
  if (expectAck)
  {
    var socket = liveSyncSocket;
    liveSyncPending[frame.id] = setTimeout(function()
    {
      if (liveSyncSocket === socket) socket.close();
    }, cLiveSyncAckTimeout);
  }
  liveSyncSocket.send(JSON.stringify(frame));
  return frame.id;
}

function fLiveSyncAck(frameId)
{
  if (frameId) liveSyncSocket.send(JSON.stringify({ type: 'ack', id: frameId }));
}

// Tells the server which shared file this page follows, so it announces that
// file's changes to us (changes to our own workspace need no watch).
function fLiveSyncSendWatch(target)
{
  var key = !target ? null
          : target.link  ? 'link:'  + target.link  + '/' + target.subPath
          : target.share ? 'share:' + target.share + '/' + target.subPath
          : null;
  if (key === liveSyncWatchKey) return;
  liveSyncWatchKey = key;

  if (!key)
    fLiveSyncSend({ type: 'unwatch' }, false);
  else
    fLiveSyncSend({ type: 'watch', link: target.link, share: target.share, path: target.subPath || '' }, true);
}

function fLiveSyncConnect()
{
  if (liveSyncSocket || !fLiveSyncTarget()) return;

  var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var socket;
  try { socket = new WebSocket(scheme + '//' + location.host + '/api/sync/ws'); }
  catch(e) { fLiveSyncScheduleReconnect(); return; }

  liveSyncSocket = socket;
  liveSyncReady  = false;
  liveSyncWatchKey = null;

  socket.onopen = function()
  {
    liveSyncRetryDelay = 1000;
    liveSyncGreetingId = fLiveSyncSend({ type: 'hello', device: liveSyncDevice, client: 'web' }, true);
    liveSyncHeartbeatTimer = setInterval(function() { fLiveSyncSend({ type: 'ping' }, true); }, cLiveSyncHeartbeat);
  };

  socket.onmessage = function(event)
  {
    var frame;
    try { frame = JSON.parse(event.data); } catch(e) { return; }
    if (!frame || typeof frame !== 'object') return;

    if (frame.type === 'ack' || frame.type === 'nack')
    {
      if (liveSyncPending[frame.id])
      {
        clearTimeout(liveSyncPending[frame.id]);
        delete liveSyncPending[frame.id];
      }

      // The answer to the greeting is what makes the connection usable: from
      // here on we may act on announcements, and we catch up on whatever
      // happened while we were away.
      if (frame.type === 'ack' && frame.id === liveSyncGreetingId && !liveSyncReady)
      {
        liveSyncReady = true;
        fLiveSyncSetPill(true);
        var followed = fLiveSyncTarget();
        if (followed) fLiveSyncSendWatch(followed);
        fLiveSyncTick();
      }
      return;
    }

    if (frame.type === 'changes' || frame.type === 'request_changes')
    {
      fLiveSyncAck(frame.id);
      // As on the desktop, nothing is acted on until the server has answered
      // our greeting; that answer runs the catch-up itself.
      if (liveSyncReady) fLiveSyncTick();
    }
  };

  socket.onclose = function()
  {
    if (liveSyncSocket !== socket) return;
    fLiveSyncDropSocket();
    fLiveSyncSetPill(false);
    if (fLiveSyncTarget()) fLiveSyncScheduleReconnect();
  };

  socket.onerror = function() { /* onclose follows */ };
}

function fLiveSyncDropSocket()
{
  clearInterval(liveSyncHeartbeatTimer);
  liveSyncHeartbeatTimer = null;
  Object.keys(liveSyncPending).forEach(function(id) { clearTimeout(liveSyncPending[id]); });
  liveSyncPending = {};
  liveSyncSocket = null;
  liveSyncReady  = false;
  liveSyncWatchKey = null;
}

// A server that is down is expected, so retries back off instead of hammering it.
function fLiveSyncScheduleReconnect()
{
  if (liveSyncReconnect) return;
  liveSyncReconnect = setTimeout(function()
  {
    liveSyncReconnect = null;
    fLiveSyncConnect();
  }, liveSyncRetryDelay);
  liveSyncRetryDelay = Math.min(liveSyncRetryDelay * 2, cLiveSyncRetryMax);
}

function fLiveSyncDisconnect()
{
  clearTimeout(liveSyncReconnect);
  liveSyncReconnect = null;
  if (liveSyncSocket)
  {
    var socket = liveSyncSocket;
    fLiveSyncDropSocket();
    socket.close();
  }
}

function fFlashLiveSyncPill()
{
  var pill = document.getElementById('live-sync-pill');
  if (!pill) return;
  pill.textContent = '↻ Updated';
  pill.classList.add('flash');
  setTimeout(function()
  {
    pill.textContent = '● Live';
    pill.classList.remove('flash');
  }, 1600);
}

async function fLiveSyncTick()
{
  if (liveSyncBusy) { liveSyncAgain = true; return; }
  if (currentFileId !== liveSyncFileId) { fUpdateLiveSync(); return; }
  var target = fLiveSyncTarget();
  if (!target) { fUpdateLiveSync(); return; }

  liveSyncBusy = true;
  try
  {
    var stat;
    try
    {
      // Native: there is nothing to stat; the file on disk is read directly and
      // compared with what the editor last agreed on.
      if (Platform.isNative) stat = { hash: null, modified: Date.now() };
      else stat = target.link  ? await Platform.fStatLinkFile(target.link, target.subPath)
           : target.share ? await Platform.fStatSharedFile(target.share, target.subPath)
           :                await Platform.fStatWorkFile(workFolderRoot, target.path);
    }
    catch(e) { fLiveSyncRetrySoon(); return; } // transient network error, or the file moved remotely

    if (!stat || (!stat.hash && !Platform.isNative)) return;
    if (!Platform.isNative && stat.hash === liveSyncServerHash) return; // nothing new on the server

    var remote;
    try
    {
      remote = target.link  ? await Platform.fReadLinkFile(target.link, target.subPath)
             : target.share ? await Platform.fReadSharedFile(target.share, target.subPath)
             :                await Platform.fReadWorkFile(workFolderRoot, target.path);
    }
    catch(e) { fLiveSyncRetrySoon(); return; }

    // Things may have changed while awaiting the fetch.
    if (currentFileId !== liveSyncFileId || !files[currentFileId]) return;
    if (Platform.isNative && remote === liveSyncBase) return;

    var f     = files[currentFileId];
    var local = f.content || '';
    var merged = (local === liveSyncBase || liveSyncBase === null) ? remote
               : f.type === 'doc' ? fMergeText(liveSyncBase, local, remote)
               : fMergeDataContent(f.type, liveSyncBase, local, remote);

    if (merged !== local)
    {
      f.content  = merged;
      f.fileTags = undefined; // recomputed lazily from the new content
      f.modified = stat.modified || Date.now();
      if (f.type === 'doc') fApplyRemoteDocContent(currentFileId);
      else fApplyRemoteDataContent(currentFileId);
      fFlashLiveSyncPill();
    }

    if (merged !== remote)
    {
      // Our local edits survived the merge — push the merged result back so
      // the other devices converge on it. (Read-only shares never diverge:
      // their UI can't edit, so local always equals base.)
      var canWrite = !sharedCtx || sharedCtx.permission === 'edit';
      if (canWrite)
      {
        try
        {
          if (target.link)       await Platform.fWriteLinkFile(target.link, target.subPath, merged);
          else if (target.share) await Platform.fWriteSharedFile(target.share, target.subPath, merged);
          else                   await Platform.fWriteWorkFile(workFolderRoot, target.path, merged);
          liveSyncBase = merged;
          liveSyncServerHash = null; // our write changed the server hash; re-read it next tick
        }
        catch(e) {}
      }
      else
        liveSyncBase = merged;
    }
    else
    {
      liveSyncBase = remote;
      liveSyncServerHash = stat.hash;
    }
  }
  finally
  {
    liveSyncBusy = false;
    if (liveSyncAgain)
    {
      liveSyncAgain = false;
      fLiveSyncTick();
    }
  }
}

// A check that failed (the network blipped) is tried once more shortly. This is
// the only timer left, and it exists only after a failure.
var liveSyncRetryTimer = null;

function fLiveSyncRetrySoon()
{
  if (liveSyncRetryTimer) return;
  liveSyncRetryTimer = setTimeout(function()
  {
    liveSyncRetryTimer = null;
    fLiveSyncTick();
  }, 3000);
}

// Puts merged text on screen without disturbing the writer: the caret and
// selection are carried along by the words around them, the scroll position is
// kept, and the state before the change is left on the undo stack.
function fApplyRemoteDocContent(id)
{
  var f = files[id];
  if (!f || currentFileId !== id) return;

  var editor = document.getElementById('editor'),
      merged = f.content || '',
      before = editor.value; // what the user sees right now

  if (before !== merged)
  {
    var start = editor.selectionStart, end = editor.selectionEnd, top = editor.scrollTop;

    docTextUndo.fForceSnapshot();
    editor.value = merged;
    editor.selectionStart = fMapOffset(before, merged, start);
    editor.selectionEnd   = fMapOffset(before, merged, end);
    editor.scrollTop      = top;
  }

  fUpdatePreview(true);
  fUpdateStatus();
  fRenderFileList();
}

// The desktop's sync engine just wrote these files into the work folder (a
// change from the server, merged or not). If the open one is among them, fold
// its new text into the editor.
// Set when the desktop sync engine reports that it wrote the open file.
var liveSyncDiskChanged = false;

function fOnCloudFilesChanged(paths)
{
  if (!liveSyncFileId || !paths || paths.indexOf(liveSyncFileId) === -1) return;
  liveSyncDiskChanged = true;
  fLiveSyncTick();
}

// Run just before the open file is saved, so a save never overwrites a change
// that arrived since the last check. On the desktop that check reads the whole
// file back from disk, so it is only made when the sync engine has said the file
// changed (it announces every write); edits made outside the app are caught by
// the folder poll. On the web the check is a small request for the file's hash.
async function fLiveSyncBeforeSave(id)
{
  if (!id || id !== liveSyncFileId || id !== currentFileId)
    return;

  if (Platform.isNative)
  {
    if (!liveSyncDiskChanged) return;
    liveSyncDiskChanged = false;
  }

  await fLiveSyncTick();
}

// How long typing waits before it is saved, and so shared: short for a file
// being followed live, so collaborators see changes within moments.
function fAutosaveDelay()
{
  return (liveSyncFileId && liveSyncFileId === currentFileId) ? 300 : 800;
}

// Which top-level keys of each data file are item arrays (merged per item);
// everything else is treated as a scalar (local wins only when it changed).
var cDataArrayKeys = {
  glossary: ['entries', 'roots'],
  bestiary: ['beasts'],
  calendar: ['seasons', 'months', 'holidays'],
  economy:  ['currencies', 'exchangeRates', 'tradeGoods', 'regions']
};

function fMergeDataContent(type, baseStr, localStr, remoteStr)
{
  var base, local, remote;
  try { base = JSON.parse(baseStr || '{}'); } catch(e) { base = {}; }
  try { local = JSON.parse(localStr || '{}'); } catch(e) { return remoteStr; }
  try { remote = JSON.parse(remoteStr || '{}'); } catch(e) { return localStr; }

  var arrayKeys = cDataArrayKeys[type] || [];
  var merged = {};
  var seenKeys = {};
  [remote, local, base].forEach(function(o){ Object.keys(o).forEach(function(k){ seenKeys[k] = 1; }); });

  Object.keys(seenKeys).forEach(function(k)
  {
    if (arrayKeys.indexOf(k) !== -1) return;
    var localChanged = JSON.stringify(local[k]) !== JSON.stringify(base[k]);
    var v = localChanged ? local[k] : remote[k];
    if (v !== undefined) merged[k] = v;
  });

  arrayKeys.forEach(function(k)
  {
    merged[k] = fMergeItemArrays(base[k] || [], local[k] || [], remote[k] || []);
  });

  return JSON.stringify(merged, null, 2);
}

// Three-way merge of two divergent copies of an item array, by item id.
// Remote order wins (they may have re-ordered); local-only survivors append.
function fMergeItemArrays(base, local, remote)
{
  function fMapById(arr)
  {
    var m = {};
    arr.forEach(function(x){ if (x && x.id) m[x.id] = x; });
    return m;
  }

  var bm = fMapById(base), lm = fMapById(local);
  var out = [], seen = {};

  remote.forEach(function(r)
  {
    if (!r || !r.id || seen[r.id]) return;
    seen[r.id] = 1;
    var l = lm[r.id], b = bm[r.id];
    if (!l)
    {
      // Missing locally: new on the remote (keep) or deleted locally (drop).
      if (!b) out.push(r);
      return;
    }
    var localChanged = JSON.stringify(l) !== JSON.stringify(b);
    out.push(localChanged ? l : r);
  });

  local.forEach(function(l)
  {
    if (!l || !l.id) { out.push(l); return; } // id-less item: never drop silently
    if (seen[l.id]) return;
    seen[l.id] = 1;
    var b = bm[l.id];
    // Missing remotely: new local item (keep), or deleted remotely — where a
    // concurrent local edit beats the delete, and an untouched item follows it.
    if (!b || JSON.stringify(l) !== JSON.stringify(b)) out.push(l);
  });

  return out;
}

// Re-points the open editor at freshly merged content and re-renders,
// preserving the user's tab, search, facet filters, and whatever input
// they're typing in (inputs holding focus are never overwritten).
function fApplyRemoteDataContent(id)
{
  var f = files[id];
  if (!f || currentFileId !== id) return;

  var data;
  try { data = JSON.parse(f.content || '{}'); } catch(e) { return; }

  var focused = document.activeElement;
  function fSetInput(elId, val)
  {
    var el = document.getElementById(elId);
    if (el && el !== focused) el.value = val;
  }

  if (f.type === 'glossary')
  {
    glsData = data;
    if (!glsData.entries) glsData.entries = [];
    if (!glsData.roots)   glsData.roots   = [];
    fSetInput('gls-file-tags', (glsData.tags || []).join(', '));
    fRenderGlossary();
  }
  else if (f.type === 'bestiary')
  {
    bstData = data;
    if (!bstData.beasts) bstData.beasts = [];
    fSetInput('bst-file-tags', (bstData.tags || []).join(', '));
    fRenderBestiary();
  }
  else if (f.type === 'calendar')
  {
    calData = data;
    if (!calData.months)   calData.months   = [];
    if (!calData.seasons)  calData.seasons  = [];
    if (!calData.holidays) calData.holidays = [];
    if (!calData.daysPerYear) calData.daysPerYear = 365;
    fSetInput('cal-file-tags', (calData.tags || []).join(', '));
    fSetInput('cal-days-per-year', calData.daysPerYear);
    if (calData.epochRealDate) fSetInput('cal-epoch-real', calData.epochRealDate);
    fRenderCalendar();
  }
  else if (f.type === 'economy')
  {
    ecoData = data;
    if (!ecoData.currencies)    ecoData.currencies    = [];
    if (!ecoData.exchangeRates) ecoData.exchangeRates = [];
    if (!ecoData.tradeGoods)    ecoData.tradeGoods    = [];
    if (!ecoData.regions)       ecoData.regions       = [];
    fSetInput('eco-file-tags', (ecoData.tags || []).join(', '));
    fRenderEconomy();
  }

  fRenderFileList();
}

