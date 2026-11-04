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

var cSharedTmpId = '@shared';
var sharedCtx = null;              // { shareId, subPath, permission, ownerEmail } while a shared file is open
var sharedEntries = [];            // GET /api/shared result
var sharedChildren = {};           // shareId -> FsEntry[] (folder shares, lazily fetched)
var sharedExpanded = {};           // shareId -> bool
var sharedRegistry = {};           // rowKey -> openable file descriptor
var sharedCollapsed = false;

function fTypeForFileName(name)
{
  var n = (name || '').toLowerCase();
  return n.endsWith('.mds') ? 'sheet'
       : n.endsWith('.mdg') ? 'graph'
       : n.endsWith('.mdd') ? 'slides'
       : n.endsWith('.mdn') ? 'notebook'
       : n.endsWith('.mdl') ? 'glossary'
       : n.endsWith('.mdc') ? 'calendar'
       : n.endsWith('.mde') ? 'economy'
       : n.endsWith('.mdb') ? 'bestiary'
       : 'doc';
}

var cSharePermColors = { view: '#9ca3af', comment: '#f1c40f', edit: '#2ecc71' };
function fSharePermBadge(perm)
{
  var c = cSharePermColors[perm] || '#9ca3af';
  return '<span class="share-perm-badge" style="background:' + c + '22;color:' + c + ';border-color:' + c + '55">' + fEscHtml(perm) + '</span>';
}

async function fRefreshSharedSection()
{
  if (Platform.isNative) return;
  var fetched;
  try { fetched = await Platform.fListSharedWithMe(); }
  catch(e) { fetched = []; }
  // Link entries (from a #link= URL) aren't in the account's share list; keep
  // them across refreshes. Captured after the await so an entry added while
  // the request was in flight isn't lost.
  var linkEntries = sharedEntries.filter(function(s){ return s.link; });
  sharedEntries = fetched.concat(linkEntries);
  fRenderSharedSection();
}

function fSharedEntryId(s) { return s.shareId || ('link:' + s.link); }

function fToggleSharedSection()
{
  sharedCollapsed = !sharedCollapsed;
  fRenderSharedSection();
}

function fSharedFileRowHtml(key, name, ownerLabel, permission, depth)
{
  var type = fTypeForFileName(name);
  return '<div class="file-item shared-row" style="padding-left:' + (10 + depth * 14) + 'px" onclick="fOpenSharedRegistry(\'' + fEscAttr(key) + '\')">' +
    '<span class="file-icon">' + fFileTypeIcon(type) + '</span>' +
    '<span class="file-name" title="' + fEscAttr(ownerLabel) + '">' + fEscHtml(name.replace(/\.[^.]+$/, '')) + '</span>' +
    fSharePermBadge(permission) +
  '</div>';
}

function fRenderSharedSection()
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
    var id = fSharedEntryId(s);
    var ownerLabel = s.link ? 'Shared via link by ' + s.ownerEmail : 'Shared by ' + s.ownerEmail;

    if (!s.exists)
    {
      html += '<div class="file-item shared-row shared-gone" title="The owner removed or moved this">' +
        '<span class="file-name">' + fEscHtml(s.name) + '</span>' +
        '<span class="shared-owner">gone</span>' +
        (s.shareId ? '<button class="gls-card-del" style="position:static" onclick="fLeaveShare(event,\'' + fEscAttr(s.shareId) + '\')" title="Remove">×</button>' : '') +
      '</div>';
      return;
    }

    if (s.isDir)
    {
      var open = !!sharedExpanded[id];
      html += '<div class="file-item shared-row" onclick="fToggleSharedFolder(\'' + fEscAttr(id) + '\')">' +
        '<span class="file-icon">' + cFolderIcon + '</span>' +
        '<span class="file-name" title="' + fEscAttr(ownerLabel) + '">' + (open ? '▾ ' : '▸ ') + fEscHtml(s.name) + '</span>' +
        fSharePermBadge(s.permission) +
      '</div>';

      if (open && sharedChildren[id])
        html += fSharedFolderChildrenHtml(s, sharedChildren[id], 1);
    }
    else
    {
      sharedRegistry[id] = { shareId: s.shareId, link: s.link, subPath: '', name: s.name, permission: s.permission, ownerEmail: s.ownerEmail };
      html += fSharedFileRowHtml(id, s.name, ownerLabel, s.permission, 0);
    }
  });

  list.innerHTML = html;
}

function fSharedFolderChildrenHtml(share, entries, depth)
{
  var html = '';
  var parentId = fSharedEntryId(share);
  var ownerLabel = share.link ? 'Shared via link by ' + share.ownerEmail : 'Shared by ' + share.ownerEmail;
  entries.forEach(function(e)
  {
    if (e.isDir)
    {
      html += '<div class="file-item shared-row" style="padding-left:' + (10 + depth * 14) + 'px">' +
        '<span class="file-icon">' + cFolderIcon + '</span>' +
        '<span class="file-name">' + fEscHtml(e.name) + '</span>' +
      '</div>' + fSharedFolderChildrenHtml(share, e.children || [], depth + 1);
    }
    else
    {
      var key = parentId + '|' + e.relPath;
      sharedRegistry[key] = { shareId: share.shareId, link: share.link, subPath: e.relPath, name: e.name, permission: share.permission, ownerEmail: share.ownerEmail };
      html += fSharedFileRowHtml(key, e.name, ownerLabel, share.permission, depth);
    }
  });
  return html;
}

async function fToggleSharedFolder(id)
{
  sharedExpanded[id] = !sharedExpanded[id];
  if (sharedExpanded[id] && !sharedChildren[id])
  {
    var s = sharedEntries.find(function(x){ return fSharedEntryId(x) === id; });
    try
    {
      sharedChildren[id] = s && s.link
        ? await Platform.fListLinkFolder(s.link, '')
        : await Platform.fListSharedFolder(s.shareId, '');
    }
    catch(e) { sharedChildren[id] = []; }
  }
  fRenderSharedSection();
}

async function fLeaveShare(e, shareId)
{
  e.stopPropagation();
  try { await Platform.fRevokeShare(shareId); } catch(err) {}
  fRefreshSharedSection();
}

/// Entered via a share-link URL (…/#link=<token>): resolves the token, adds
/// the entry to the "Shared with me" section, and opens it if it's a file.
async function fInitLinkAccess(token)
{
  var meta;
  try { meta = await Platform.fLinkMeta(token); }
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
  fRenderSharedSection();

  if (!meta.exists) return;

  if (meta.isDir)
    await fToggleSharedFolder('link:' + token);
  else
    await fOpenSharedRegistry('link:' + token);
}

async function fOpenSharedRegistry(key)
{
  var entry = sharedRegistry[key];
  if (!entry) return;

  var content;
  try
  {
    content = entry.link
      ? await Platform.fReadLinkFile(entry.link, entry.subPath)
      : await Platform.fReadSharedFile(entry.shareId, entry.subPath);
  }
  catch(err)
  {
    console.warn('Shared read error', err);
    return;
  }

  if (currentFileId && currentFileId !== cSharedTmpId)
    fRecordFileHistory(currentFileId);

  var type = fTypeForFileName(entry.name);

  files[cSharedTmpId] = {
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

  currentFileId = cSharedTmpId;
  fSwitchAppType(type, false);
  fRenderFileList();

  var file = files[cSharedTmpId];
  if (type === 'doc')           fLoadDocFile(file);
  else if (type === 'graph')    fLoadGraphFile(file);
  else if (type === 'slides')   fLoadSlidesFile(file);
  else if (type === 'notebook') fLoadNotebookFile(file);
  else if (type === 'glossary') fLoadGlossaryFile(file);
  else if (type === 'calendar') fLoadCalendarFile(file);
  else if (type === 'economy')  fLoadEconomyFile(file);
  else if (type === 'bestiary') fLoadBestiaryFile(file);
  else                          fLoadSheetFile(file);

  fApplySharedReadOnly();
  fUpdateCommentsUI();
  fUpdateLiveSync();
}

function fExitSharedMode()
{
  if (!sharedCtx && !files[cSharedTmpId]) return;
  sharedCtx = null;
  delete files[cSharedTmpId];
  fApplySharedReadOnly();
}

function fApplySharedReadOnly()
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

function fOpenShareModal()
{
  var t = contextMenuTarget;
  if (!t || t.kind === 'root') return;

  var isDir = t.kind === 'folder';
  var label = isDir ? t.id : (files[t.id] ? files[t.id].name : t.id);
  shareModalTarget = { relPath: t.id, isDir: isDir, label: label };

  fCloseContextMenu();

  document.getElementById('share-modal-title').textContent = 'Share "' + label + '"';
  document.getElementById('share-email').value = '';
  document.getElementById('share-error').style.display = 'none';
  document.getElementById('share-modal').style.display = 'flex';
  fRenderShareModalList();
  fRenderShareLinksList();
}

// ── Share links ("anyone with the link") ──

function fShareLinkUrl(token)
{
  return window.location.origin + '/#link=' + token;
}

async function fRenderShareLinksList()
{
  if (!shareModalTarget) return;
  var box = document.getElementById('share-links-list');
  var links = [];
  try { links = await Platform.fListShareLinks(shareModalTarget.relPath); }
  catch(e) {}

  box.innerHTML = links.length
    ? links.map(function(l){
        return '<div class="share-modal-row">' +
          '<span class="share-modal-email share-link-url" title="' + fEscAttr(fShareLinkUrl(l.id)) + '">' + fEscHtml(fShareLinkUrl(l.id)) + '</span>' +
          fSharePermBadge(l.permission) +
          '<button class="share-copy-btn" onclick="fCopyShareLink(\'' + fEscAttr(l.id) + '\', this)">Copy</button>' +
          '<button class="gls-card-del" style="position:static" onclick="fRevokeLinkRow(\'' + fEscAttr(l.id) + '\')" title="Revoke link">×</button>' +
        '</div>';
      }).join('')
    : '<div class="share-modal-empty">No links yet — anyone who gets one can open this without an account.</div>';
}

async function fCreateLinkRow()
{
  if (!shareModalTarget) return;
  var perm = document.getElementById('share-link-perm').value,
      errEl = document.getElementById('share-error');
  errEl.style.display = 'none';
  try
  {
    await Platform.fCreateShareLink(shareModalTarget.relPath, shareModalTarget.isDir, perm);
    fRenderShareLinksList();
  }
  catch(e)
  {
    errEl.textContent = e.message || 'Creating the link failed';
    errEl.style.display = '';
  }
}

async function fCopyShareLink(token, btn)
{
  var url = fShareLinkUrl(token);
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

async function fRevokeLinkRow(linkId)
{
  try { await Platform.fRevokeShareLink(linkId); } catch(e) {}
  fRenderShareLinksList();
}

function fCloseShareModal()
{
  document.getElementById('share-modal').style.display = 'none';
  shareModalTarget = null;
}

async function fRenderShareModalList()
{
  if (!shareModalTarget) return;
  var box = document.getElementById('share-modal-list');
  var shares = [];
  try { shares = await Platform.fListSharesFor(shareModalTarget.relPath); }
  catch(e) {}

  box.innerHTML = shares.length
    ? shares.map(function(s){
        return '<div class="share-modal-row">' +
          '<span class="share-modal-email">' + fEscHtml(s.email) + '</span>' +
          fSharePermBadge(s.permission) +
          '<button class="gls-card-del" style="position:static" onclick="fRevokeShareRow(\'' + fEscAttr(s.id) + '\')" title="Revoke">×</button>' +
        '</div>';
      }).join('')
    : '<div class="share-modal-empty">Not shared with anyone yet.</div>';
}

async function fRevokeShareRow(shareId)
{
  try { await Platform.fRevokeShare(shareId); } catch(e) {}
  fRenderShareModalList();
}

async function fSubmitShare()
{
  if (!shareModalTarget) return;
  var email = document.getElementById('share-email').value.trim(),
      perm  = document.getElementById('share-perm').value,
      errEl = document.getElementById('share-error');
  if (!email) return;

  errEl.style.display = 'none';
  try
  {
    await Platform.fShareEntry(shareModalTarget.relPath, shareModalTarget.isDir, email, perm);
    document.getElementById('share-email').value = '';
    fRenderShareModalList();
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

function fCommentTarget()
{
  if (Platform.isNative) return null;
  if (!currentFileId || !files[currentFileId]) return null;
  if (sharedCtx && sharedCtx.link) return { link: sharedCtx.link, subPath: sharedCtx.subPath };
  if (sharedCtx) return { share: sharedCtx.shareId, subPath: sharedCtx.subPath };
  if (!workFolderRoot) return null; // not logged in / no workspace
  return { path: currentFileId };
}

function fUpdateCommentsUI()
{
  var fab = document.getElementById('comments-fab');
  if (!fab) return;
  var target = fCommentTarget();
  fab.style.display = (target && !commentsVisible) ? '' : 'none';
  if (!target)
  {
    commentsVisible = false;
    document.getElementById('comments-panel').style.display = 'none';
    fStopCommentsPolling();
    return;
  }
  fStartCommentsPolling();
  lastCommentCount = -1;
  if (commentsVisible) fRefreshComments();
  else fRefreshCommentsCount();
}

function fStartCommentsPolling()
{
  if (commentsPollTimer) return;
  commentsPollTimer = setInterval(function()
  {
    if (!fCommentTarget()) { fStopCommentsPolling(); return; }
    if (commentsVisible) fRefreshComments();
    else fRefreshCommentsCount();
  }, 7000);
}

function fStopCommentsPolling()
{
  if (!commentsPollTimer) return;
  clearInterval(commentsPollTimer);
  commentsPollTimer = null;
}

function fToggleCommentsPanel()
{
  commentsVisible = !commentsVisible;
  document.getElementById('comments-panel').style.display = commentsVisible ? 'flex' : 'none';
  var fab = document.getElementById('comments-fab');
  if (fab) fab.style.display = (!commentsVisible && fCommentTarget()) ? '' : 'none';
  if (commentsVisible) { lastCommentCount = -1; fRefreshComments(); }
}

function fSetCommentsBadge(n)
{
  var badge = document.getElementById('comments-count');
  if (!badge) return;
  badge.textContent = n;
  badge.style.display = n ? '' : 'none';
}

async function fRefreshCommentsCount()
{
  var target = fCommentTarget();
  if (!target) return;
  try { fSetCommentsBadge((await Platform.fListComments(target)).length); }
  catch(e) {}
}

// ── Comment anchors ──

function fNoteItemAnchor(kind, id, label)
{
  lastItemAnchor = { fileId: currentFileId, kind: kind, id: id, label: label };
}

function fCaptureCommentAnchor()
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
  fRenderPendingAnchor();
}

function fClearPendingAnchor()
{
  pendingAnchor = null;
  fRenderPendingAnchor();
}

function fAnchorLabel(a)
{
  if (!a) return '';
  if (a.t === 'text')  return '“' + (a.x || '').slice(0, 40) + ((a.x || '').length > 40 ? '…' : '') + '”';
  if (a.t === 'cells') return a.p + ' · ' + a.r;
  if (a.t === 'item')  return a.x || 'item';
  return '';
}

function fRenderPendingAnchor()
{
  var chip = document.getElementById('comment-anchor-chip');
  if (!chip) return;
  if (!pendingAnchor) { chip.style.display = 'none'; chip.innerHTML = ''; return; }
  chip.style.display = '';
  chip.innerHTML = '<span class="comment-anchor">📍 ' + fEscHtml(fAnchorLabel(pendingAnchor)) + '</span>' +
    '<button class="gls-card-del" style="position:static" onclick="fClearPendingAnchor()" title="Comment on the whole file instead">×</button>';
}

function fGotoCommentAnchor(commentId)
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
    if (pi !== -1 && pi !== sheetPageIdx) fSwitchSheetPage(pi);
    var parts = (a.r || 'A1').split(':');
    fSelectCell(parts[0]);
    if (parts[1]) { selectionEnd = parts[1]; fRenderRangeSelection(); }
  }
  else if (a.t === 'item')
  {
    if (a.k === 'glossary-entry')      { fSwitchGlossaryTab('words'); fOpenGlossaryEntryModal(a.id); }
    else if (a.k === 'glossary-root')  { fSwitchGlossaryTab('roots'); fOpenGlossaryRootModal(a.id); }
    else if (a.k === 'beast')          fOpenBeastModal(a.id);
    else if (a.k === 'eco-currency')   fOpenEcoCurrencyModal(a.id);
    else if (a.k === 'eco-good')       fOpenEcoGoodModal(a.id);
    else if (a.k === 'eco-region')     fOpenEcoRegionModal(a.id);
  }
}

async function fRefreshComments()
{
  var target = fCommentTarget();
  if (!target) return;

  var listEl = document.getElementById('comments-list');
  var canPost = !sharedCtx || sharedCtx.permission === 'comment' || sharedCtx.permission === 'edit';
  document.getElementById('comments-compose').style.display = canPost ? '' : 'none';
  document.getElementById('comments-no-perm').style.display = canPost ? 'none' : '';

  var comments = [];
  try { comments = await Platform.fListComments(target); }
  catch(e)
  {
    listEl.innerHTML = '<div class="comments-empty">' + fEscHtml(e.message || 'Could not load comments') + '</div>';
    return;
  }

  fSetCommentsBadge(comments.length);

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
            anchorHtml = '<button class="comment-anchor comment-anchor-link" onclick="fGotoCommentAnchor(&quot;' + fEscAttr(c.id) + '&quot;)" title="Jump to this spot">📍 ' + fEscHtml(fAnchorLabel(a)) + '</button>';
          }
          catch(e) {}
        }
        return '<div class="comment-item">' +
          '<div class="comment-meta">' +
            '<span class="comment-author">' + fEscHtml(c.authorEmail || 'Anonymous') + '</span>' +
            '<span class="comment-when">' + fEscHtml(when) + '</span>' +
            (c.mine ? '<button class="gls-card-del" style="position:static" onclick="fRemoveComment(&quot;' + fEscAttr(c.id) + '&quot;)" title="Delete">×</button>' : '') +
          '</div>' +
          anchorHtml +
          '<div class="comment-body">' + fEscHtml(c.body) + '</div>' +
        '</div>';
      }).join('')
    : '<div class="comments-empty">No comments yet.</div>';

  // Only jump to the newest comment when something actually arrived, so the
  // live refresh never yanks the scroll position mid-read.
  if (comments.length !== lastCommentCount)
    listEl.scrollTop = listEl.scrollHeight;
  lastCommentCount = comments.length;
}

async function fSubmitComment()
{
  var target = fCommentTarget();
  var input = document.getElementById('comment-input');
  if (!target || !input.value.trim()) return;
  try
  {
    await Platform.fAddComment(target, input.value.trim(), pendingAnchor ? JSON.stringify(pendingAnchor) : null);
    input.value = '';
    fClearPendingAnchor();
    lastCommentCount = -1; // force the scroll-to-newest on the next render
    fRefreshComments();
  }
  catch(e)
  {
    document.getElementById('comments-list').innerHTML += '<div class="comments-empty">' + fEscHtml(e.message || 'Posting failed') + '</div>';
  }
}

async function fRemoveComment(id)
{
  try { await Platform.fDeleteComment(id); } catch(e) {}
  fRefreshComments();
}
