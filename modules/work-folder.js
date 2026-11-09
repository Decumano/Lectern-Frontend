// On-disk work folder and its context menu
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── WORK FOLDER (on-disk storage mirrored into the sidebar) ──

// Rebuilds `files`/`folders` from disk. Used as the single source of truth
// refresh after any structural change (create/delete/move) rather than
// hand-patching the in-memory tree - simpler and safe at the scale of a
// person clicking buttons rather than a hot path.
var cWorkAssetExtRe = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?|pdf|zip|7z|rar|gz|mp3|wav|ogg|flac|mp4|webm|mov|woff2?|ttf|otf|eot|exe|dll|bin)$/i;

async function fLoadWorkFolderTree()
{
  if (!workFolderRoot)
    return;

  const preserved = {};

  Object.keys(files).forEach(function(id)
  {
    if (files[id].contentLoaded)
      preserved[id] = files[id];
  });

  let entries;

  try
  {
    entries = await Platform.fListWorkFolder(workFolderRoot);
  }
  catch(e)
  {
    console.warn('Work folder read error', e);
    alert('Could not read the work folder. It may have been moved or deleted.');
    return;
  }

  const newFiles = {},
        newFolders = {};

  function fWalk(list, parent)
  {
    list.forEach(function(entry)
    {
      if (entry.isDir)
      {
        newFolders[entry.relPath] = { name: entry.name, parent: parent };
        fWalk(entry.children, entry.relPath);
        return;
      }

      // Sync sidecars (e.g. the _lktpl.json custom-templates store) are in
      // the server listing so the desktop app can sync them, but they aren't
      // documents — keep them out of the file tree.
      if (/\.json$/i.test(entry.name))
        return;

      // Neither are images and other binary assets (a presentation's
      // backgrounds live in the work folder too); opened as a document they
      // would show as garbage, and saving one would destroy it.
      if (cWorkAssetExtRe.test(entry.name))
        return;

      const dot = entry.name.lastIndexOf('.'),
            ext = (dot === -1) ? '' : entry.name.slice(dot + 1).toLowerCase(),
            baseName = (dot === -1) ? entry.name : entry.name.slice(0, dot),
            type = ext === 'mds' ? 'sheet' : ext === 'mdg' ? 'graph' : ext === 'mdd' ? 'slides' : ext === 'mdn' ? 'notebook' : ext === 'mdl' ? 'glossary' : ext === 'mdc' ? 'calendar' : ext === 'mde' ? 'economy' : ext === 'mdb' ? 'bestiary' : 'doc',
            kept = preserved[entry.relPath];

      newFiles[entry.relPath] =
      {
        name: baseName,
        type: type,
        folder: parent,
        modified: entry.modified,
        content: kept ? kept.content : undefined,
        contentLoaded: !!kept,
        lkMentions:    kept ? (kept.lkMentions || []) : []
      };
    });
  }

  fWalk(entries, '');

  files = newFiles;
  folders = newFolders;

  if (currentFileId && !files[currentFileId])
    currentFileId = null;

  fPruneOpenTabs(); // ids are rel paths; anything renamed/moved/deleted on disk is gone
  fRenderFileList();

  // Fonts in a `fonts` folder (see project-fonts.js). Not awaited: the tree
  // is usable at once and the text re-flows when a font arrives.
  fLoadProjectFonts(entries).catch(function(e) { console.warn('Project fonts', e); });
}

async function fCreateWorkFile(name, type, content)
{
  const ext = fFileExtensionFor(type),
        base = fSanitizeFileName(name) || 'Untitled',
        relPath = fUniqueRelPath('', base, ext);

  try
  {
    await Platform.fWriteWorkFile(workFolderRoot, relPath, content !== undefined ? content : fDefaultContentForType(type, name));
  }
  catch(e)
  {
    console.warn('Work folder create error', e);
    alert('Could not create the file.');
    return null;
  }

  await fLoadWorkFolderTree();

  return relPath;
}

// Single funnel for persisting a file's content and/or its on-disk name, used
// both by the autosave debounce (acting on currentFileId) and by sidebar
// inline-rename (which may target a file that isn't the open one). A rename
// is implemented as a move within the same parent folder.
// What an autosave leaves for later. Writing the file is the save; refreshing
// the backlink index, re-sorting the sidebar and redrawing the side pane are
// bookkeeping that nothing is waiting on, and on a long document or a big
// workspace they cost more than the write. They run once, when typing has
// stopped for a moment, however many saves came before.
var saveFollowUpTimer = null,
    saveFollowUpIds = {},
    saveFollowUpList = false,
    saveFollowUpSplit = false;

function fScheduleSaveFollowUp(id, relist)
{
  saveFollowUpIds[id] = true;
  saveFollowUpList = saveFollowUpList || !!relist;
  saveFollowUpSplit = saveFollowUpSplit || splitState.fileId === id;

  clearTimeout(saveFollowUpTimer);
  saveFollowUpTimer = setTimeout(fRunSaveFollowUp, 900);
}

async function fRunSaveFollowUp()
{
  saveFollowUpTimer = null;

  // Still typing: this isn't the moment. Try again once it has paused.
  if (Date.now() - lastLocalEditAt < 900)
  {
    saveFollowUpTimer = setTimeout(fRunSaveFollowUp, 900);
    return;
  }

  var ids = Object.keys(saveFollowUpIds),
      relist = saveFollowUpList,
      split = saveFollowUpSplit;

  saveFollowUpIds = {};
  saveFollowUpList = false;
  saveFollowUpSplit = false;

  for (var i = 0; i < ids.length; i++)
  {
    try { if (files[ids[i]]) await fUpdateBacklinksForFile(ids[i]); }
    catch(e) { console.warn('Backlink update error', e); }
  }

  if (relist)
    fRenderFileList();

  if (split && typeof fRenderSplitPane === 'function')
    fRenderSplitPane();
}

// Writes to one file go out one at a time, in the order they were asked for.
// Two in flight can land in either order, and the older one landing last puts
// stale text on disk (and on the server) over newer text.
var writeChains = {};

function fSerialWrite(key, task)
{
  var run = (writeChains[key] || Promise.resolve()).catch(function() {}).then(task);

  writeChains[key] = run;
  run.catch(function() {}).then(function() { if (writeChains[key] === run) delete writeChains[key]; });

  return run;
}

// options.background: an autosave. The same write, with the bookkeeping above
// postponed instead of done before returning. Resolves true once what was asked
// for is on disk, false if the write failed (so the caller can try again).
async function fPersistFileEntry(id, options)
{
  var background = !!(options && options.background),
      saved = true;

  if (!files[id])
    return true;

  // Files opened from "Shared with me" never touch my own workspace: they're
  // written back through the share (edit permission) or not at all.
  if (id === cSharedTmpId)
  {
    if (sharedCtx && sharedCtx.permission === 'edit')
    {
      try
      {
        var sharedContent = files[id].content || '';
        if (sharedCtx.link)
          await Platform.fWriteLinkFile(sharedCtx.link, sharedCtx.subPath, sharedContent);
        else
          await Platform.fWriteSharedFile(sharedCtx.shareId, sharedCtx.subPath, sharedContent);
        if (id === liveSyncFileId) { liveSyncBase = sharedContent; liveSyncServerHash = null; }
      }
      catch(e) { console.warn('Shared write error', e); saved = false; }
    }
    return saved;
  }

  if (!workFolderRoot)
  {
    if (background)
    {
      fSaveToStorage();
      fScheduleSaveFollowUp(id, true);
      return true;
    }

    await fUpdateBacklinksForFile(id);
    fSaveToStorage();
    fRenderFileList();
    return true;
  }

  const file = files[id],
        ext = fFileExtensionFor(file.type),
        desiredRelPath = fUniqueRelPath(file.folder || '', fSanitizeFileName(file.name) || 'Untitled', ext, id);

  let activeId = id;

  if (desiredRelPath !== id)
  {
    try
    {
      await Platform.fMoveWorkEntry(workFolderRoot, id, desiredRelPath);

      files[desiredRelPath] = file;
      delete files[id];

      if (currentFileId === id)
        currentFileId = desiredRelPath;

      fRemapOpenTab(id, desiredRelPath);

      activeId = desiredRelPath;

      // Best-effort: keep the version-history sidecar attached to the file
      // it documents. Fails quietly if there's no history yet.
      Platform.fMoveWorkEntry(workFolderRoot, id + '.history.json', desiredRelPath + '.history.json').catch(function(){});
    }
    catch(e)
    {
      console.warn('Work folder rename error', e);
    }
  }

  try
  {
    // What is written is what is recorded as the last agreed text. Reading
    // files[activeId].content again after the write would pick up whatever was
    // typed while it ran, and record text that never reached the disk.
    var writtenText = files[activeId].content || '';

    await fSerialWrite(workFolderRoot + '\0' + activeId, function() { return Platform.fWriteWorkFile(workFolderRoot, activeId, writtenText); });
    if (activeId === liveSyncFileId) { liveSyncBase = writtenText; liveSyncServerHash = null; }

    if (!background)
      await fUpdateBacklinksForFile(activeId);
  }
  catch(e)
  {
    console.warn('Work folder write error', e);
    saved = false;
  }

  // A rename changes the sidebar now; otherwise only the order (by time saved)
  // does, which can wait.
  if (background && activeId === id)
    fScheduleSaveFollowUp(activeId, true);
  else
  {
    if (background)
      fScheduleSaveFollowUp(activeId, false);

    fRenderFileList();
  }

  if (currentFileId === activeId)
  {
    if (file.type === 'doc')
      document.getElementById('doc-title-input').value = file.name;

    else if (file.type === 'graph')
      document.getElementById('graph-title-input').value = file.name;

    else if (file.type === 'slides')
      document.getElementById('slides-title-input').value = file.name;
  }

  return saved;
}

async function fRenameFolderEntry(path, newName)
{
  const folder = folders[path],
        base = fSanitizeFileName(newName) || folder.name,
        desiredRelPath = fUniqueFolderRelPath(folder.parent, base, path);

  if (desiredRelPath === path)
  {
    fRenderFileList();
    return;
  }

  try
  {
    await Platform.fMoveWorkEntry(workFolderRoot, path, desiredRelPath);
  }
  catch(e)
  {
    console.warn('Work folder rename error', e);
  }

  expandedFolders.delete(path);
  expandedFolders.add(desiredRelPath);

  await fLoadWorkFolderTree();
}

function fStartInlineRename(e, nameEl, id)
{
  e.stopPropagation();

  const current = files[id] ? files[id].name : (folders[id] ? folders[id].name : '');

  nameEl.innerHTML = '';

  const input = document.createElement('input');
  input.className = 'inline-rename-input';
  input.value = current;

  nameEl.appendChild(input);
  input.focus();
  input.select();

  let committed = false;

  function fCommit()
  {
    if (committed)
      return;

    committed = true;
    fFinishInlineRename(id, input.value.trim());
  }

  input.addEventListener('blur', fCommit);
  input.addEventListener('keydown', function(ke)
  {
    if (ke.key === 'Enter')
    {
      ke.preventDefault();
      input.blur();
    }
    else if (ke.key === 'Escape')
    {
      committed = true;
      fRenderFileList();
    }
  });
}

function fFinishInlineRename(id, newName)
{
  if (files[id])
  {
    if (newName && newName !== files[id].name)
    {
      files[id].name = newName;
      files[id].modified = Date.now();
      fPersistFileEntry(id);
      return;
    }

    fRenderFileList();
    return;
  }

  if (folders[id])
  {
    if (newName && newName !== folders[id].name)
    {
      fRenameFolderEntry(id, newName);
      return;
    }

    fRenderFileList();
  }
}

function fHandleDragStart(e, id)
{
  draggedEntryId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  e.currentTarget.classList.add('dragging');
}

function fHandleDragEnd(e)
{
  e.currentTarget.classList.remove('dragging');
  draggedEntryId = null;

  document.querySelectorAll('.drag-over').forEach(function(el)
  {
    el.classList.remove('drag-over');
  });
}

// Both dragenter and dragover need preventDefault() for a drop to be allowed -
// some engines only honor the dragenter on the very first frame a drag enters
// an element, so it's handled defensively alongside dragover rather than relying
// on dragover alone.
function fHandleDragEnter(e)
{
  if (!workFolderRoot || !draggedEntryId)
    return;

  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('drag-over');
}

function fHandleDragOver(e)
{
  if (!workFolderRoot || !draggedEntryId)
    return;

  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function fHandleDragLeave(e)
{
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
}

// Core move used by both drag-and-drop and the right-click "Move to" menu.
async function fMoveEntryToFolder(id, targetFolderPath)
{
  const isDir = !!folders[id];

  if (!isDir && !files[id])
    return false;

  if (isDir && (targetFolderPath === id || targetFolderPath.indexOf(id + '/') === 0))
    return false; // can't move a folder into itself or its own descendant

  const currentParent = isDir ? folders[id].parent : files[id].folder;

  if (currentParent === targetFolderPath)
    return false;

  const toRelPath = isDir
                      ?
                        fUniqueFolderRelPath(targetFolderPath, folders[id].name)
                      :
                        fUniqueRelPath(targetFolderPath, fSanitizeFileName(files[id].name) || 'Untitled', fFileExtensionFor(files[id].type));

  try
  {
    await Platform.fMoveWorkEntry(workFolderRoot, id, toRelPath);

    if (!isDir)
      Platform.fMoveWorkEntry(workFolderRoot, id + '.history.json', toRelPath + '.history.json').catch(function(){});
  }
  catch(err)
  {
    console.warn('Work folder move error', err);
    alert('Could not move that item.');
    return false;
  }

  if (currentFileId === id)
    currentFileId = toRelPath;

  else if (currentFileId && isDir && currentFileId.indexOf(id + '/') === 0)
    currentFileId = toRelPath + currentFileId.slice(id.length);

  if (isDir)
  {
    // Keep tabs for files inside the moved folder alive under their new paths
    openTabs = openTabs.map(function(t)
    {
      return t.indexOf(id + '/') === 0 ? toRelPath + t.slice(id.length) : t;
    });
    fPersistOpenTabs();

    expandedFolders.delete(id);
    expandedFolders.add(toRelPath);
  }
  else
    fRemapOpenTab(id, toRelPath);

  await fLoadWorkFolderTree();
  return true;
}

async function fHandleDrop(e, targetFolderPath)
{
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');

  const id = draggedEntryId;
  draggedEntryId = null;

  if (!id || !workFolderRoot)
    return;

  await fMoveEntryToFolder(id, targetFolderPath);
}

// ── RIGHT-CLICK CONTEXT MENU (folder creation + "Move to" as a drag-and-drop alternative) ──
let contextMenuTarget = null; // { kind: 'file'|'folder'|'root', id }

function fOpenContextMenu(e, kind, id)
{
  e.preventDefault();
  e.stopPropagation();

  if (!workFolderRoot)
    return;

  contextMenuTarget = { kind: kind, id: id };
  fRenderContextMenu();

  const menu = document.getElementById('context-menu');

  menu.classList.add('open');

  const maxLeft = window.innerWidth - menu.offsetWidth - 8,
        maxTop = window.innerHeight - menu.offsetHeight - 8;

  menu.style.left = Math.max(4, Math.min(e.clientX, maxLeft)) + 'px';
  menu.style.top = Math.max(4, Math.min(e.clientY, maxTop)) + 'px';
}

function fCloseContextMenu()
{
  document.getElementById('context-menu').classList.remove('open');
  contextMenuTarget = null;
}

document.addEventListener
(
  'click',
  function(e)
  {
    const menu = document.getElementById('context-menu');

    if (menu.classList.contains('open') && !menu.contains(e.target))
      fCloseContextMenu();
  }
);

function fRenderContextMenu()
{
  const menu = document.getElementById('context-menu'),
        t = contextMenuTarget;

  let html = '<button class="file-menu-item" onclick="fContextMenuNewFolder()">New Folder</button>';

  if (t.kind !== 'root' && fCanShare())
    html += '<div class="file-menu-divider"></div>' +
            '<button class="file-menu-item" onclick="fOpenShareModal()">Share&hellip;</button>';

  if (t.kind !== 'root')
  {
    const currentParent = (t.kind === 'folder') ? folders[t.id].parent : files[t.id].folder;

    html += '<div class="file-menu-divider"></div>';

    if (currentParent !== '')
      html += '<button class="file-menu-item" onclick="fContextMenuMoveTo(\'\')">Move to Root</button>';

    Object.keys(folders)
      .filter(function(p)
      {
        if (p === currentParent)
          return false;

        if (t.kind === 'folder' && (p === t.id || p.indexOf(t.id + '/') === 0))
          return false; // can't move a folder into itself or its own descendant

        return true;
      })
      .sort()
      .forEach(function(p)
      {
        html += '<button class="file-menu-item" onclick="fContextMenuMoveTo(\'' + fEscAttr(p) + '\')">Move to &ldquo;' + fEscHtml(folders[p].name) + '&rdquo;</button>';
      });
  }

  menu.innerHTML = html;
}

async function fContextMenuNewFolder()
{
  const t = contextMenuTarget,
        parent = (t.kind === 'folder') ? t.id : (t.kind === 'file' ? (files[t.id].folder || '') : '');

  fCloseContextMenu();

  const relPath = fUniqueFolderRelPath(parent, 'New Folder');

  try
  {
    await Platform.fCreateWorkFolder(workFolderRoot, relPath);
  }
  catch(e)
  {
    console.warn('Work folder create-folder error', e);
    alert('Could not create the folder.');
    return;
  }

  if (parent)
    expandedFolders.add(parent);

  await fLoadWorkFolderTree();

  const nameEl = document.querySelector('.folder-item[data-id="' + relPath + '"] .file-name');

  if (nameEl)
    fStartInlineRename({ stopPropagation: function(){} }, nameEl, relPath);
}

async function fContextMenuMoveTo(targetFolderPath)
{
  const id = contextMenuTarget.id;

  fCloseContextMenu();
  await fMoveEntryToFolder(id, targetFolderPath);
}

function fSwitchAppType(type, rerender)
{
  if (rerender === undefined)
    rerender = true;

  currentAppType = type;
  
  document.getElementById('doc-app').style.display      = (type === 'doc')      ? 'flex' : 'none';
  document.getElementById('sheet-app').style.display    = (type === 'sheet')    ? 'flex' : 'none';
  document.getElementById('graph-app').style.display    = (type === 'graph')    ? 'flex' : 'none';
  document.getElementById('slides-app').style.display   = (type === 'slides')   ? 'flex' : 'none';
  document.getElementById('notebook-app').style.display = (type === 'notebook') ? 'flex' : 'none';
  document.getElementById('glossary-app').style.display = (type === 'glossary') ? 'flex' : 'none';
  document.getElementById('calendar-app').style.display = (type === 'calendar') ? 'flex' : 'none';
  document.getElementById('economy-app').style.display  = (type === 'economy')  ? 'flex' : 'none';
  document.getElementById('bestiary-app').style.display = (type === 'bestiary') ? 'flex' : 'none';

  document.querySelectorAll('.app-tab').forEach
  (
    function(appTabs)
    {
        appTabs.classList.remove('active');
    }
  );

  document.getElementById('tab-' + type).classList.add('active');

  if (rerender)
    fRenderFileList();
}
