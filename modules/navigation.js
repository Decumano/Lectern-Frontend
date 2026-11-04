// Global search, sidebar, mobile drawer, backlinks
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── GLOBAL SEARCH ──────────────────────────────────────────

var globalSearchActive  = false;
var globalSearchLoadTmr = null;

function fExtractSearchableText(id)
{
  var f = files[id];
  if (!f || !f.content) return '';
  var c = f.content;

  if (f.type === 'bestiary')
  {
    try
    {
      var bd = JSON.parse(c), bparts = (bd.tags || []).slice();
      (bd.beasts || []).forEach(function(b) { bparts.push(b.name, b.commonName, b.category, b.habitat, b.description); if (b.abilities) bparts = bparts.concat(b.abilities); if (b.tags) bparts = bparts.concat(b.tags); });
      return bparts.filter(Boolean).join(' ');
    }
    catch(e) { return ''; }
  }

  if (f.type === 'glossary')
  {
    try
    {
      var d = JSON.parse(c), parts = (d.tags || []).slice();
      (d.entries || []).forEach(function(e) { parts.push(e.word, e.definition, e.example, e.language); if (e.tags) parts = parts.concat(e.tags); });
      (d.roots   || []).forEach(function(r) { parts.push(r.form, r.meaning); if (r.examples) parts = parts.concat(r.examples); if (r.tags) parts = parts.concat(r.tags); });
      return parts.filter(Boolean).join(' ');
    }
    catch(e) { return c; }
  }

  if (f.type === 'calendar')
  {
    try
    {
      var d = JSON.parse(c), parts = (d.tags || []).slice();
      (d.months   || []).forEach(function(m) { parts.push(m.name, m.season, m.description); if (m.tags) parts = parts.concat(m.tags); });
      (d.seasons  || []).forEach(function(s) { parts.push(s.name, s.description); });
      (d.holidays || []).forEach(function(h) { parts.push(h.name, h.description); if (h.tags) parts = parts.concat(h.tags); });
      return parts.filter(Boolean).join(' ');
    }
    catch(e) { return c; }
  }

  if (f.type === 'economy')
  {
    try
    {
      var d = JSON.parse(c), parts = (d.tags || []).slice();
      (d.currencies || []).forEach(function(x) { parts.push(x.name, x.code, x.symbol, x.region, x.description); if (x.tags) parts = parts.concat(x.tags); });
      (d.tradeGoods || []).forEach(function(x) { parts.push(x.name, x.category, x.description, x.origin); if (x.tags) parts = parts.concat(x.tags); });
      (d.regions    || []).forEach(function(x) { parts.push(x.name, x.economicStatus, x.notes); if (x.tags) parts = parts.concat(x.tags); });
      return parts.filter(Boolean).join(' ');
    }
    catch(e) { return c; }
  }

  if (f.type === 'slides')
  {
    try
    {
      var deck = fParseSlides(c), words = [];
      deck.slides.forEach(function(s) { s.blocks.forEach(function(b) { words.push(b.text); }); });
      return words.join('\n');
    }
    catch(e) { return c; }
  }

  if (f.type === 'sheet')
  {
    // "REF=value" or "REF=formula=result" lines — extract value parts
    return c.split('\n').map(function(l)
    {
      var eq = l.indexOf('=');
      return eq > 0 ? l.slice(eq + 1) : '';
    }).join(' ');
  }

  return c; // doc: raw markdown; graph/notebook: JSON that contains label/text strings
}

function fGsEscRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function fGsHighlight(text, query)
{
  if (!text || !query) return fEscHtml(text || '');
  var re = new RegExp('(' + fGsEscRe(query) + ')', 'gi');
  return fEscHtml(text).replace(re, '<mark class="gs-hl">$1</mark>');
}

function fGsSnippet(raw, query)
{
  if (!raw) return '';
  var lc  = raw.toLowerCase();
  var qlo = query.toLowerCase();
  var idx = lc.indexOf(qlo);
  if (idx < 0) return '';
  var s   = Math.max(0, idx - 50);
  var e   = Math.min(raw.length, idx + query.length + 90);
  var txt = (s > 0 ? '…' : '') + raw.slice(s, e) + (e < raw.length ? '…' : '');
  return fGsHighlight(txt, query);
}

function fRunGlobalSearch(query)
{
  var q   = query.trim();
  var qlo = q.toLowerCase();
  if (!q) { fHideGlobalSearch(); return; }

  var results = [];
  Object.keys(files).forEach(function(id)
  {
    var f = files[id];
    if (!f) return;
    var nameHit = f.name.toLowerCase().indexOf(qlo) >= 0;
    var text    = fExtractSearchableText(id);
    var snippet = fGsSnippet(text, q);
    if (nameHit || snippet)
      results.push({ id: id, file: f, nameHit: nameHit, snippet: snippet });
  });

  results.sort(function(a, b)
  {
    if (a.nameHit !== b.nameHit) return a.nameHit ? -1 : 1;
    return a.file.name.localeCompare(b.file.name);
  });

  globalSearchActive = true;
  document.getElementById('file-list').style.display           = 'none';
  document.getElementById('sidebar-search-clear').style.display = '';

  var panel = document.getElementById('global-search-results');
  panel.style.display = '';

  if (!results.length)
  {
    panel.innerHTML = '<div class="gs-empty">No results for <strong>' + fEscHtml(q) + '</strong></div>';
    return;
  }

  panel.innerHTML =
    '<div class="gs-count">' + results.length + ' result' + (results.length !== 1 ? 's' : '') + '</div>' +
    results.map(function(r)
    {
      return '<div class="gs-result" onclick="fOpenFile(\'' + fEscAttr(r.id) + '\');fClearGlobalSearch();">' +
        '<div class="gs-result-name">' +
          '<span class="gs-file-icon">' + fFileTypeIcon(r.file.type) + '</span>' +
          '<span class="gs-name">' + fGsHighlight(r.file.name, q) + '</span>' +
        '</div>' +
        (r.snippet ? '<div class="gs-snippet">' + r.snippet + '</div>' : '') +
      '</div>';
    }).join('');
}

function fHideGlobalSearch()
{
  globalSearchActive = false;
  document.getElementById('global-search-results').style.display    = 'none';
  document.getElementById('file-list').style.display                = '';
  document.getElementById('sidebar-search-clear').style.display     = 'none';
  fRenderFileList();
}

// Work-folder mode: background-load any unread files, then call `done` so
// the caller can re-run its filter over the full content set.
function fScheduleUnloadedContentLoad(done)
{
  if (!workFolderRoot) return;
  globalSearchLoadTmr = setTimeout(async function()
  {
    var unloaded = Object.keys(files).filter(function(id) { return files[id] && !files[id].contentLoaded; });
    if (!unloaded.length) return;
    await Promise.all(unloaded.map(async function(id)
    {
      try
      {
        var _r = await Platform.fReadWorkFile(workFolderRoot, id);
        if (files[id]) { files[id].content = _r; files[id].contentLoaded = true; }
      }
      catch(err) {}
    }));
    done();
  }, 150);
}

function fOnGlobalSearch(value)
{
  clearTimeout(globalSearchLoadTmr);
  var q = value.trim();
  if (!q) { fHideGlobalSearch(); return; }

  // '#tag' queries filter the sidebar file list in place (fRenderFileList
  // understands them) instead of opening the global results panel.
  if (q.charAt(0) === '#')
  {
    globalSearchActive = false;
    document.getElementById('global-search-results').style.display    = 'none';
    document.getElementById('file-list').style.display                = '';
    document.getElementById('sidebar-search-clear').style.display     = '';
    fRenderFileList();
    fScheduleUnloadedContentLoad(function(){ if (sidebarSearch.trim() === q) fRenderFileList(); });
    return;
  }

  fRunGlobalSearch(q); // immediate pass — searches already-loaded content

  fScheduleUnloadedContentLoad(function(){ if (sidebarSearch.trim() === q) fRunGlobalSearch(q); }); // re-render with full content
}

function fClearGlobalSearch()
{
  var inp = document.getElementById('sidebar-search');
  if (inp) inp.value = '';
  sidebarSearch = '';
  fHideGlobalSearch();
}

// ── SIDEBAR COLLAPSE ───────────────────────────────────────

function fToggleSidebarCollapse()
{
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('sidebar--rail', sidebarCollapsed);
  try { localStorage.setItem('lk_sidebar_rail', sidebarCollapsed ? '1' : '0'); } catch(e) {}
}

function fApplySidebarCollapse()
{
  try { sidebarCollapsed = localStorage.getItem('lk_sidebar_rail') === '1'; } catch(e) {}
  document.getElementById('sidebar').classList.toggle('sidebar--rail', sidebarCollapsed);
}

// ── MOBILE SIDEBAR DRAWER ──
// On narrow screens the sidebar is off-canvas; a floating button slides it
// in over a backdrop, and picking a file slides it back out.

function fToggleMobileSidebar()
{
  var sidebar = document.getElementById('sidebar'),
      open = !sidebar.classList.contains('mobile-open');

  // The rail (icons-only) state is a desktop concept — a drawer opens full.
  if (open && sidebarCollapsed)
    fToggleSidebarCollapse();

  sidebar.classList.toggle('mobile-open', open);
  document.getElementById('mobile-backdrop').classList.toggle('open', open);
}

function fCloseMobileSidebar()
{
  var sidebar = document.getElementById('sidebar'),
      backdrop = document.getElementById('mobile-backdrop');

  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('open');
}

// ── BACKLINKS INDEX ────────────────────────────────────────
//
// Stored in _lkbl.json at the work-folder root (or localStorage key "lk_bl").
// Shape: { targetFileId: [sourceFileId, ...] }
// Files themselves are never modified for backlink data.

var backlinksIndex = {};

async function fLoadBacklinksIndex()
{
  if (workFolderRoot)
  {
    try
    {
      var raw = await Platform.fReadWorkFile(workFolderRoot, '_lkbl.json');
      backlinksIndex = JSON.parse(raw) || {};
    }
    catch(e) { backlinksIndex = {}; }
  }
  else
  {
    try { var r = localStorage.getItem('lk_bl'); backlinksIndex = r ? JSON.parse(r) : {}; }
    catch(e) { backlinksIndex = {}; }
  }
}

async function fSaveBacklinksIndex()
{
  if (workFolderRoot)
  {
    try { await Platform.fWriteWorkFile(workFolderRoot, '_lkbl.json', JSON.stringify(backlinksIndex, null, 2)); }
    catch(e) {}
  }
  else
  {
    try { localStorage.setItem('lk_bl', JSON.stringify(backlinksIndex)); } catch(e) {}
  }
}

// Returns list of file ids that sourceId currently mentions by name.
// Outside Work Folder mode content always lives in memory, so only the
// lazily-loaded work-folder files can be "not loaded yet".
function fComputeMentionsListFor(sourceId)
{
  if (!files[sourceId] || (workFolderRoot && !files[sourceId].contentLoaded)) return [];
  var text = fExtractSearchableText(sourceId).toLowerCase();
  var out  = [];
  Object.keys(files).forEach(function(targetId)
  {
    if (targetId === sourceId || !files[targetId]) return;
    var name = files[targetId].name.toLowerCase();
    if (name && text.indexOf(name) >= 0) out.push(targetId);
  });
  return out;
}

// Called when a file is opened or saved — updates only changed entries in the index.
async function fUpdateBacklinksForFile(sourceId)
{
  if (!files[sourceId] || (workFolderRoot && !files[sourceId].contentLoaded)) return;

  var newMentions = fComputeMentionsListFor(sourceId);
  var oldMentions = files[sourceId].lkMentions || [];
  var removed     = oldMentions.filter(function(t) { return newMentions.indexOf(t) < 0; });
  var added       = newMentions.filter(function(t) { return oldMentions.indexOf(t) < 0; });
  files[sourceId].lkMentions = newMentions;

  if (!removed.length && !added.length) return;

  removed.forEach(function(tid)
  {
    if (!backlinksIndex[tid]) return;
    var i = backlinksIndex[tid].indexOf(sourceId);
    if (i >= 0) backlinksIndex[tid].splice(i, 1);
    if (!backlinksIndex[tid].length) delete backlinksIndex[tid];
  });

  added.forEach(function(tid)
  {
    if (!backlinksIndex[tid]) backlinksIndex[tid] = [];
    if (backlinksIndex[tid].indexOf(sourceId) < 0) backlinksIndex[tid].push(sourceId);
  });

  await fSaveBacklinksIndex();
}

// ── BACKLINKS (live scan) ───────────────────────────────────

function fComputeBacklinks(fileId)
{
  if (!fileId || !files[fileId]) return [];
  var targetName = files[fileId].name.toLowerCase();
  var results    = [];
  Object.keys(files).forEach(function(id)
  {
    if (id === fileId || !files[id]) return;
    var f    = files[id];
    var text = f.name + ' ' + fExtractSearchableText(id);
    if (text.toLowerCase().indexOf(targetName) >= 0)
      results.push({ id: id, file: f });
  });
  return results;
}


function fToggleFolderExpanded(path)
{
  if (expandedFolders.has(path))
    expandedFolders.delete(path);
  else
    expandedFolders.add(path);

  fRenderFileList();
}
