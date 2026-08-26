// Sharing, share links and comments
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── SHARING & COMMENTS (web only) ──────────────────────────
// Files/folders can be shared with other accounts at view/comment/edit level
// (server: lectern-web src/share.rs). Shared entries appear in their own
// sidebar section; opening one loads it into the normal editors under the
// reserved id SHARED_TMP_ID, so it never mixes with the user's own workspace
// files. Saves are routed through the share (edit permission) or dropped.

var SHARED_TMP_ID = '@shared';
var sharedCtx = null;              // { shareId, subPath, permission, ownerEmail } while a shared file is open
var sharedEntries = [];            // GET /api/shared result
var sharedChildren = {};           // shareId -> FsEntry[] (folder shares, lazily fetched)
var sharedExpanded = {};           // shareId -> bool
var sharedRegistry = {};           // rowKey -> openable file descriptor
var sharedCollapsed = false;

function typeForFileName(name)
{
  var n = (name || '').toLowerCase();
  return n.endsWith('.mds') ? 'sheet'
       : n.endsWith('.mdg') ? 'graph'
       : n.endsWith('.mdn') ? 'notebook'
       : n.endsWith('.mdl') ? 'glossary'
       : n.endsWith('.mdc') ? 'calendar'
       : n.endsWith('.mde') ? 'economy'
       : n.endsWith('.mdb') ? 'bestiary'
       : 'doc';
}

var SHARE_PERM_COLORS = { view: '#9ca3af', comment: '#f1c40f', edit: '#2ecc71' };
function sharePermBadge(perm)
{
  var c = SHARE_PERM_COLORS[perm] || '#9ca3af';
  return '<span class="share-perm-badge" style="background:' + c + '22;color:' + c + ';border-color:' + c + '55">' + escHtml(perm) + '</span>';
}

async function refreshSharedSection()
{
  if (Platform.isNative) return;
  var fetched;
  try { fetched = await Platform.listSharedWithMe(); }
  catch(e) { fetched = []; }
  // Link entries (from a #link= URL) aren't in the account's share list; keep
  // them across refreshes. Captured after the await so an entry added while
  // the request was in flight isn't lost.
  var linkEntries = sharedEntries.filter(function(s){ return s.link; });
  sharedEntries = fetched.concat(linkEntries);
  renderSharedSection();
}

function sharedEntryId(s) { return s.shareId || ('link:' + s.link); }

function toggleSharedSection()
{
  sharedCollapsed = !sharedCollapsed;
  renderSharedSection();
}

function sharedFileRowHtml(key, name, ownerLabel, permission, depth)
{
  var type = typeForFileName(name);
  return '<div class="file-item shared-row" style="padding-left:' + (10 + depth * 14) + 'px" onclick="openSharedRegistry(\'' + escAttr(key) + '\')">' +
    '<span class="file-icon">' + fileTypeIcon(type) + '</span>' +
    '<span class="file-name" title="' + escAttr(ownerLabel) + '">' + escHtml(name.replace(/\.[^.]+$/, '')) + '</span>' +
    sharePermBadge(permission) +
  '</div>';
}

function renderSharedSection()
{
  var header = document.getElementById('shared-section-header'),
      list   = document.getElementById('shared-list');
  if (!header || !list) return;

  if (!sharedEntries.length)
  {
    header.style.display = 'none';
    list.style.display = 'none';
    return;
  }

  header.style.display = '';
  document.getElementById('shared-section-chevron').textContent = sharedCollapsed ? '▸' : '▾';
  list.style.display = sharedCollapsed ? 'none' : '';
  if (sharedCollapsed) return;

  sharedRegistry = {};
  var html = '';

  sharedEntries.forEach(function(s)
  {
    var id = sharedEntryId(s);
    var ownerLabel = s.link ? 'Shared via link by ' + s.ownerEmail : 'Shared by ' + s.ownerEmail;

    if (!s.exists)
    {
      html += '<div class="file-item shared-row shared-gone" title="The owner removed or moved this">' +
        '<span class="file-name">' + escHtml(s.name) + '</span>' +
        '<span class="shared-owner">gone</span>' +
        (s.shareId ? '<button class="gls-card-del" style="position:static" onclick="leaveShare(event,\'' + escAttr(s.shareId) + '\')" title="Remove">×</button>' : '') +
      '</div>';
      return;
    }

    if (s.isDir)
    {
      var open = !!sharedExpanded[id];
      html += '<div class="file-item shared-row" onclick="toggleSharedFolder(\'' + escAttr(id) + '\')">' +
        '<span class="file-icon">' + FOLDER_ICON + '</span>' +
        '<span class="file-name" title="' + escAttr(ownerLabel) + '">' + (open ? '▾ ' : '▸ ') + escHtml(s.name) + '</span>' +
        sharePermBadge(s.permission) +
      '</div>';

      if (open && sharedChildren[id])
        html += sharedFolderChildrenHtml(s, sharedChildren[id], 1);
    }
    else
    {
      sharedRegistry[id] = { shareId: s.shareId, link: s.link, subPath: '', name: s.name, permission: s.permission, ownerEmail: s.ownerEmail };
      html += sharedFileRowHtml(id, s.name, ownerLabel, s.permission, 0);
    }
  });

  list.innerHTML = html;
}

function sharedFolderChildrenHtml(share, entries, depth)
{
  var html = '';
  var parentId = sharedEntryId(share);
  var ownerLabel = share.link ? 'Shared via link by ' + share.ownerEmail : 'Shared by ' + share.ownerEmail;
  entries.forEach(function(e)
  {
    if (e.isDir)
    {
      html += '<div class="file-item shared-row" style="padding-left:' + (10 + depth * 14) + 'px">' +
        '<span class="file-icon">' + FOLDER_ICON + '</span>' +
        '<span class="file-name">' + escHtml(e.name) + '</span>' +
      '</div>' + sharedFolderChildrenHtml(share, e.children || [], depth + 1);
    }
    else
    {
      var key = parentId + '|' + e.relPath;
      sharedRegistry[key] = { shareId: share.shareId, link: share.link, subPath: e.relPath, name: e.name, permission: share.permission, ownerEmail: share.ownerEmail };
      html += sharedFileRowHtml(key, e.name, ownerLabel, share.permission, depth);
    }
  });
  return html;
}

async function toggleSharedFolder(id)
{
  sharedExpanded[id] = !sharedExpanded[id];
  if (sharedExpanded[id] && !sharedChildren[id])
  {
    var s = sharedEntries.find(function(x){ return sharedEntryId(x) === id; });
    try
    {
      sharedChildren[id] = s && s.link
        ? await Platform.listLinkFolder(s.link, '')
        : await Platform.listSharedFolder(s.shareId, '');
    }
    catch(e) { sharedChildren[id] = []; }
  }
  renderSharedSection();
}

async function leaveShare(e, shareId)
{
  e.stopPropagation();
  try { await Platform.revokeShare(shareId); } catch(err) {}
  refreshSharedSection();
}

/// Entered via a share-link URL (…/#link=<token>): resolves the token, adds
/// the entry to the "Shared with me" section, and opens it if it's a file.
async function initLinkAccess(token)
{
  var meta;
  try { meta = await Platform.linkMeta(token); }
  catch(e) { console.warn('Share link error', e); return; }

  sharedEntries = sharedEntries.filter(function(s){ return s.link !== token; });
  sharedEntries.push({
    link: token,
    ownerEmail: meta.ownerEmail,
    name: meta.name,
    isDir: meta.isDir,
    permission: meta.permission,
    exists: meta.exists
  });
  renderSharedSection();

  if (!meta.exists) return;

  if (meta.isDir)
    await toggleSharedFolder('link:' + token);
  else
    await openSharedRegistry('link:' + token);
}

async function openSharedRegistry(key)
{
  var entry = sharedRegistry[key];
  if (!entry) return;

  var content;
  try
  {
    content = entry.link
      ? await Platform.readLinkFile(entry.link, entry.subPath)
      : await Platform.readSharedFile(entry.shareId, entry.subPath);
  }
  catch(err)
  {
    console.warn('Shared read error', err);
    return;
  }

  if (currentFileId && currentFileId !== SHARED_TMP_ID)
    recordFileHistory(currentFileId);

  var type = typeForFileName(entry.name);

  files[SHARED_TMP_ID] = {
    name: entry.name.replace(/\.[^.]+$/, ''),
    type: type,
    folder: '',
    modified: Date.now(),
    content: content,
    contentLoaded: true
  };

  sharedCtx = {
    shareId: entry.shareId,
    link: entry.link,
    subPath: entry.subPath,
    permission: entry.permission,
    ownerEmail: entry.ownerEmail
  };

  currentFileId = SHARED_TMP_ID;
  switchAppType(type, false);
  renderFileList();

  var file = files[SHARED_TMP_ID];
  if (type === 'doc')           loadDocFile(file);
  else if (type === 'graph')    loadGraphFile(file);
  else if (type === 'notebook') loadNotebookFile(file);
  else if (type === 'glossary') loadGlossaryFile(file);
  else if (type === 'calendar') loadCalendarFile(file);
  else if (type === 'economy')  loadEconomyFile(file);
  else if (type === 'bestiary') loadBestiaryFile(file);
  else                          loadSheetFile(file);

  applySharedReadOnly();
  updateCommentsUI();
  updateLiveSync();
}

function exitSharedMode()
{
  if (!sharedCtx && !files[SHARED_TMP_ID]) return;
  sharedCtx = null;
  delete files[SHARED_TMP_ID];
  applySharedReadOnly();
}

function applySharedReadOnly()
{
  var ro = !!(sharedCtx && sharedCtx.permission !== 'edit');
  var ed = document.getElementById('editor');
  if (ed) ed.readOnly = ro;
  var ti = document.getElementById('doc-title-input');
  if (ti) ti.readOnly = !!sharedCtx; // renaming someone else's file isn't a thing
  document.body.classList.toggle('shared-readonly', ro);

  var banner = document.getElementById('view-only-banner');
  if (!banner) return;
  if (sharedCtx)
  {
    var via = sharedCtx.link ? 'Shared via link by ' : 'Shared by ';
    banner.style.display = '';
    banner.textContent = sharedCtx.permission === 'edit'
      ? via + sharedCtx.ownerEmail + ' — you can edit'
      : sharedCtx.permission === 'comment'
        ? via + sharedCtx.ownerEmail + ' — view & comment only'
        : via + sharedCtx.ownerEmail + ' — view only';
  }
  else
    banner.style.display = 'none';
}

// ── Share modal (owner side) ──

var shareModalTarget = null; // { relPath, isDir, label }

function openShareModal()
{
  var t = contextMenuTarget;
  if (!t || t.kind === 'root') return;

  var isDir = t.kind === 'folder';
  var label = isDir ? t.id : (files[t.id] ? files[t.id].name : t.id);
  shareModalTarget = { relPath: t.id, isDir: isDir, label: label };

  closeContextMenu();

  document.getElementById('share-modal-title').textContent = 'Share "' + label + '"';
  document.getElementById('share-email').value = '';
  document.getElementById('share-error').style.display = 'none';
  document.getElementById('share-modal').style.display = 'flex';
  renderShareModalList();
  renderShareLinksList();
}

// ── Share links ("anyone with the link") ──

function shareLinkUrl(token)
{
  return window.location.origin + '/#link=' + token;
}

async function renderShareLinksList()
{
  if (!shareModalTarget) return;
  var box = document.getElementById('share-links-list');
  var links = [];
  try { links = await Platform.listShareLinks(shareModalTarget.relPath); }
  catch(e) {}

  box.innerHTML = links.length
    ? links.map(function(l){
        return '<div class="share-modal-row">' +
          '<span class="share-modal-email share-link-url" title="' + escAttr(shareLinkUrl(l.id)) + '">' + escHtml(shareLinkUrl(l.id)) + '</span>' +
          sharePermBadge(l.permission) +
          '<button class="share-copy-btn" onclick="copyShareLink(\'' + escAttr(l.id) + '\', this)">Copy</button>' +
          '<button class="gls-card-del" style="position:static" onclick="revokeLinkRow(\'' + escAttr(l.id) + '\')" title="Revoke link">×</button>' +
        '</div>';
      }).join('')
    : '<div class="share-modal-empty">No links yet — anyone who gets one can open this without an account.</div>';
}

async function createLinkRow()
{
  if (!shareModalTarget) return;
  var perm = document.getElementById('share-link-perm').value,
      errEl = document.getElementById('share-error');
  errEl.style.display = 'none';
  try
  {
    await Platform.createShareLink(shareModalTarget.relPath, shareModalTarget.isDir, perm);
    renderShareLinksList();
  }
  catch(e)
  {
    errEl.textContent = e.message || 'Creating the link failed';
    errEl.style.display = '';
  }
}

async function copyShareLink(token, btn)
{
  var url = shareLinkUrl(token);
  try
  {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Copied!';
    setTimeout(function(){ btn.textContent = 'Copy'; }, 1400);
  }
  catch(e)
  {
    // Clipboard API needs a secure context; fall back to a copyable prompt.
    window.prompt('Copy this link:', url);
  }
}

async function revokeLinkRow(linkId)
{
  try { await Platform.revokeShareLink(linkId); } catch(e) {}
  renderShareLinksList();
}

function closeShareModal()
{
  document.getElementById('share-modal').style.display = 'none';
  shareModalTarget = null;
}

async function renderShareModalList()
{
  if (!shareModalTarget) return;
  var box = document.getElementById('share-modal-list');
  var shares = [];
  try { shares = await Platform.listSharesFor(shareModalTarget.relPath); }
  catch(e) {}

  box.innerHTML = shares.length
    ? shares.map(function(s){
        return '<div class="share-modal-row">' +
          '<span class="share-modal-email">' + escHtml(s.email) + '</span>' +
          sharePermBadge(s.permission) +
          '<button class="gls-card-del" style="position:static" onclick="revokeShareRow(\'' + escAttr(s.id) + '\')" title="Revoke">×</button>' +
        '</div>';
      }).join('')
    : '<div class="share-modal-empty">Not shared with anyone yet.</div>';
}

async function revokeShareRow(shareId)
{
  try { await Platform.revokeShare(shareId); } catch(e) {}
  renderShareModalList();
}

async function submitShare()
{
  if (!shareModalTarget) return;
  var email = document.getElementById('share-email').value.trim(),
      perm  = document.getElementById('share-perm').value,
      errEl = document.getElementById('share-error');
  if (!email) return;

  errEl.style.display = 'none';
  try
  {
    await Platform.shareEntry(shareModalTarget.relPath, shareModalTarget.isDir, email, perm);
    document.getElementById('share-email').value = '';
    renderShareModalList();
  }
  catch(e)
  {
    errEl.textContent = e.message || 'Sharing failed';
    errEl.style.display = '';
  }
}

// ── Comments (any work file; anchors point at a spot inside it) ──

var commentsVisible = false;
var commentsPollTimer = null;
var lastCommentCount = -1;
var pendingAnchor = null;          // captured when the composer gains focus
var lastItemAnchor = null;         // { fileId, kind, id, label } — last opened item modal
var commentAnchorRegistry = {};    // commentId -> parsed anchor (for click-to-navigate)

function commentTarget()
{
  if (Platform.isNative) return null;
  if (!currentFileId || !files[currentFileId]) return null;
  if (sharedCtx && sharedCtx.link) return { link: sharedCtx.link, subPath: sharedCtx.subPath };
  if (sharedCtx) return { share: sharedCtx.shareId, subPath: sharedCtx.subPath };
  if (!workFolderRoot) return null; // not logged in / no workspace
  return { path: currentFileId };
}

function updateCommentsUI()
{
  var fab = document.getElementById('comments-fab');
  if (!fab) return;
  var target = commentTarget();
  fab.style.display = (target && !commentsVisible) ? '' : 'none';
  if (!target)
  {
    commentsVisible = false;
    document.getElementById('comments-panel').style.display = 'none';
    stopCommentsPolling();
    return;
  }
  startCommentsPolling();
  lastCommentCount = -1;
  if (commentsVisible) refreshComments();
  else refreshCommentsCount();
}

function startCommentsPolling()
{
  if (commentsPollTimer) return;
  commentsPollTimer = setInterval(function()
  {
    if (!commentTarget()) { stopCommentsPolling(); return; }
    if (commentsVisible) refreshComments();
    else refreshCommentsCount();
  }, 7000);
}

function stopCommentsPolling()
{
  if (!commentsPollTimer) return;
  clearInterval(commentsPollTimer);
  commentsPollTimer = null;
}

function toggleCommentsPanel()
{
  commentsVisible = !commentsVisible;
  document.getElementById('comments-panel').style.display = commentsVisible ? 'flex' : 'none';
  var fab = document.getElementById('comments-fab');
  if (fab) fab.style.display = (!commentsVisible && commentTarget()) ? '' : 'none';
  if (commentsVisible) { lastCommentCount = -1; refreshComments(); }
}

function setCommentsBadge(n)
{
  var badge = document.getElementById('comments-count');
  if (!badge) return;
  badge.textContent = n;
  badge.style.display = n ? '' : 'none';
}

async function refreshCommentsCount()
{
  var target = commentTarget();
  if (!target) return;
  try { setCommentsBadge((await Platform.listComments(target)).length); }
  catch(e) {}
}

// ── Comment anchors ──

function noteItemAnchor(kind, id, label)
{
  lastItemAnchor = { fileId: currentFileId, kind: kind, id: id, label: label };
}

function captureCommentAnchor()
{
  var f = currentFileId && files[currentFileId];
  if (!f) return;

  var a = null;

  if (f.type === 'doc')
  {
    var ed = document.getElementById('editor');
    if (ed && ed.selectionStart !== ed.selectionEnd)
    {
      var s = ed.selectionStart, e = ed.selectionEnd;
      a = { t: 'text', s: s, e: e, x: ed.value.slice(s, e).slice(0, 120) };
    }
  }
  else if (f.type === 'sheet')
  {
    if (selectionAnchor)
      a = {
        t: 'cells',
        p: sheetPages[sheetPageIdx].name,
        r: (selectionAnchor === selectionEnd || !selectionEnd) ? selectionAnchor : (selectionAnchor + ':' + selectionEnd)
      };
  }
  else if (f.type !== 'graph' && f.type !== 'notebook' && lastItemAnchor && lastItemAnchor.fileId === currentFileId)
    a = { t: 'item', k: lastItemAnchor.kind, id: lastItemAnchor.id, x: lastItemAnchor.label };

  pendingAnchor = a;
  renderPendingAnchor();
}

function clearPendingAnchor()
{
  pendingAnchor = null;
  renderPendingAnchor();
}

function anchorLabel(a)
{
  if (!a) return '';
  if (a.t === 'text')  return '“' + (a.x || '').slice(0, 40) + ((a.x || '').length > 40 ? '…' : '') + '”';
  if (a.t === 'cells') return a.p + ' · ' + a.r;
  if (a.t === 'item')  return a.x || 'item';
  return '';
}

function renderPendingAnchor()
{
  var chip = document.getElementById('comment-anchor-chip');
  if (!chip) return;
  if (!pendingAnchor) { chip.style.display = 'none'; chip.innerHTML = ''; return; }
  chip.style.display = '';
  chip.innerHTML = '<span class="comment-anchor">📍 ' + escHtml(anchorLabel(pendingAnchor)) + '</span>' +
    '<button class="gls-card-del" style="position:static" onclick="clearPendingAnchor()" title="Comment on the whole file instead">×</button>';
}

function gotoCommentAnchor(commentId)
{
  var a = commentAnchorRegistry[commentId];
  var f = currentFileId && files[currentFileId];
  if (!a || !f) return;

  if (a.t === 'text' && f.type === 'doc')
  {
    var ed = document.getElementById('editor');
    if (!ed) return;
    // The stored offsets drift as the doc is edited; re-find the excerpt and
    // fall back to the offsets when it's gone.
    var idx = a.x ? ed.value.indexOf(a.x) : -1;
    var s = idx !== -1 ? idx : Math.min(a.s || 0, ed.value.length),
        e = idx !== -1 ? idx + a.x.length : Math.min(a.e || 0, ed.value.length);
    ed.focus();
    ed.setSelectionRange(s, e);
    var totalLines = ed.value.split('\n').length - 1;
    var frac = totalLines ? (ed.value.slice(0, s).split('\n').length - 1) / totalLines : 0;
    ed.scrollTop = frac * Math.max(0, ed.scrollHeight - ed.clientHeight);
  }
  else if (a.t === 'cells' && f.type === 'sheet')
  {
    var pi = sheetPages.findIndex(function(p){ return p.name === a.p; });
    if (pi !== -1 && pi !== sheetPageIdx) switchSheetPage(pi);
    var parts = (a.r || 'A1').split(':');
    selectCell(parts[0]);
    if (parts[1]) { selectionEnd = parts[1]; renderRangeSelection(); }
  }
  else if (a.t === 'item')
  {
    if (a.k === 'glossary-entry')      { switchGlossaryTab('words'); openGlossaryEntryModal(a.id); }
    else if (a.k === 'glossary-root')  { switchGlossaryTab('roots'); openGlossaryRootModal(a.id); }
    else if (a.k === 'beast')          openBeastModal(a.id);
    else if (a.k === 'eco-currency')   openEcoCurrencyModal(a.id);
    else if (a.k === 'eco-good')       openEcoGoodModal(a.id);
    else if (a.k === 'eco-region')     openEcoRegionModal(a.id);
  }
}

async function refreshComments()
{
  var target = commentTarget();
  if (!target) return;

  var listEl = document.getElementById('comments-list');
  var canPost = !sharedCtx || sharedCtx.permission === 'comment' || sharedCtx.permission === 'edit';
  document.getElementById('comments-compose').style.display = canPost ? '' : 'none';
  document.getElementById('comments-no-perm').style.display = canPost ? 'none' : '';

  var comments = [];
  try { comments = await Platform.listComments(target); }
  catch(e)
  {
    listEl.innerHTML = '<div class="comments-empty">' + escHtml(e.message || 'Could not load comments') + '</div>';
    return;
  }

  setCommentsBadge(comments.length);

  commentAnchorRegistry = {};
  listEl.innerHTML = comments.length
    ? comments.map(function(c){
        var when = new Date(c.createdAt).toLocaleString();
        var anchorHtml = '';
        if (c.anchor)
        {
          try
          {
            var a = JSON.parse(c.anchor);
            commentAnchorRegistry[c.id] = a;
            anchorHtml = '<button class="comment-anchor comment-anchor-link" onclick="gotoCommentAnchor(&quot;' + escAttr(c.id) + '&quot;)" title="Jump to this spot">📍 ' + escHtml(anchorLabel(a)) + '</button>';
          }
          catch(e) {}
        }
        return '<div class="comment-item">' +
          '<div class="comment-meta">' +
            '<span class="comment-author">' + escHtml(c.authorEmail || 'Anonymous') + '</span>' +
            '<span class="comment-when">' + escHtml(when) + '</span>' +
            (c.mine ? '<button class="gls-card-del" style="position:static" onclick="removeComment(&quot;' + escAttr(c.id) + '&quot;)" title="Delete">×</button>' : '') +
          '</div>' +
          anchorHtml +
          '<div class="comment-body">' + escHtml(c.body) + '</div>' +
        '</div>';
      }).join('')
    : '<div class="comments-empty">No comments yet.</div>';

  // Only jump to the newest comment when something actually arrived, so the
  // live refresh never yanks the scroll position mid-read.
  if (comments.length !== lastCommentCount)
    listEl.scrollTop = listEl.scrollHeight;
  lastCommentCount = comments.length;
}

async function submitComment()
{
  var target = commentTarget();
  var input = document.getElementById('comment-input');
  if (!target || !input.value.trim()) return;
  try
  {
    await Platform.addComment(target, input.value.trim(), pendingAnchor ? JSON.stringify(pendingAnchor) : null);
    input.value = '';
    clearPendingAnchor();
    lastCommentCount = -1; // force the scroll-to-newest on the next render
    refreshComments();
  }
  catch(e)
  {
    document.getElementById('comments-list').innerHTML += '<div class="comments-empty">' + escHtml(e.message || 'Posting failed') + '</div>';
  }
}

async function removeComment(id)
{
  try { await Platform.deleteComment(id); } catch(e) {}
  refreshComments();
}
