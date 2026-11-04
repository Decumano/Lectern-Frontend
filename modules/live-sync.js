// Live sync for the JSON data apps
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── LIVE SYNC (concurrent editing for the JSON data apps) ──
//
// While a Glossary / Bestiary / Calendar / Economy file is open, the server
// is polled for changes to that file (a cheap {modified, hash} stat) so the
// same file can be edited from several devices — or by several people
// through a share — at once, with everyone seeing everyone else's changes
// within a few seconds. Remote and local edits are reconciled with a
// three-way merge at item granularity (see fMergeDataContent), which these
// JSON files support cleanly because every item carries a stable id.
// Web only: on Tauri the stat call resolves null and the poller never
// starts — the desktop app keeps its explicit cloud-sync flow.

var cLiveSyncInterval = 3000;

var liveSyncTimer      = null;
var liveSyncFileId     = null;   // file the poller is tracking
var liveSyncBase       = null;   // content as of the last agreement with the server
var liveSyncServerHash = null;   // server hash seen on the previous tick
var liveSyncBusy       = false;

function fLiveSyncTarget()
{
  if (Platform.isNative) return null;
  var f = currentFileId && files[currentFileId];
  if (!f || !cDataFileTypes[f.type] || !f.contentLoaded) return null;
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

// (Re)aims the poller at whatever is currently open. Called after every
// file open; the tick also calls it when it notices the file changed.
function fUpdateLiveSync()
{
  var target = fLiveSyncTarget();
  liveSyncFileId     = target ? currentFileId : null;
  liveSyncBase       = target ? (files[currentFileId].content || '') : null;
  liveSyncServerHash = null;

  var pill = document.getElementById('live-sync-pill');
  if (pill) pill.style.display = target ? '' : 'none';

  if (target && !liveSyncTimer)
    liveSyncTimer = setInterval(fLiveSyncTick, cLiveSyncInterval);
  if (!target && liveSyncTimer)
  {
    clearInterval(liveSyncTimer);
    liveSyncTimer = null;
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
  if (liveSyncBusy) return;
  if (currentFileId !== liveSyncFileId) { fUpdateLiveSync(); return; }
  var target = fLiveSyncTarget();
  if (!target) { fUpdateLiveSync(); return; }

  liveSyncBusy = true;
  try
  {
    var stat;
    try
    {
      stat = target.link  ? await Platform.fStatLinkFile(target.link, target.subPath)
           : target.share ? await Platform.fStatSharedFile(target.share, target.subPath)
           :                await Platform.fStatWorkFile(workFolderRoot, target.path);
    }
    catch(e) { return; } // transient network error, or the file moved remotely — try again next tick

    if (!stat || !stat.hash) return;
    if (stat.hash === liveSyncServerHash) return; // nothing new on the server

    var remote;
    try
    {
      remote = target.link  ? await Platform.fReadLinkFile(target.link, target.subPath)
             : target.share ? await Platform.fReadSharedFile(target.share, target.subPath)
             :                await Platform.fReadWorkFile(workFolderRoot, target.path);
    }
    catch(e) { return; }

    // Things may have changed while awaiting the fetch.
    if (currentFileId !== liveSyncFileId || !files[currentFileId]) return;

    var f     = files[currentFileId];
    var local = f.content || '';
    var merged = (local === liveSyncBase || liveSyncBase === null)
      ? remote
      : fMergeDataContent(f.type, liveSyncBase, local, remote);

    if (merged !== local)
    {
      f.content  = merged;
      f.fileTags = undefined; // recomputed lazily from the new content
      f.modified = stat.modified || Date.now();
      fApplyRemoteDataContent(currentFileId);
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
  }
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

