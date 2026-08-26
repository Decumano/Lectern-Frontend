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
async function loadWorkFolderTree()
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
    entries = await Platform.listWorkFolder(workFolderRoot);
  }
  catch(e)
  {
    console.warn('Work folder read error', e);
    alert('Could not read the work folder. It may have been moved or deleted.');
    return;
  }

  const newFiles = {},
        newFolders = {};

  function walk(list, parent)
  {
    list.forEach(function(entry)
    {
      if (entry.isDir)
      {
        newFolders[entry.relPath] = { name: entry.name, parent: parent };
        walk(entry.children, entry.relPath);
        return;
      }

      // Sync sidecars (e.g. the _lktpl.json custom-templates store) are in
      // the server listing so the desktop app can sync them, but they aren't
      // documents — keep them out of the file tree.
      if (/\.json$/i.test(entry.name))
        return;

      const dot = entry.name.lastIndexOf('.'),
            ext = (dot === -1) ? '' : entry.name.slice(dot + 1).toLowerCase(),
            baseName = (dot === -1) ? entry.name : entry.name.slice(0, dot),
            type = ext === 'mds' ? 'sheet' : ext === 'mdg' ? 'graph' : ext === 'mdn' ? 'notebook' : ext === 'mdl' ? 'glossary' : ext === 'mdc' ? 'calendar' : ext === 'mde' ? 'economy' : ext === 'mdb' ? 'bestiary' : 'doc',
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

  walk(entries, '');

  files = newFiles;
  folders = newFolders;

  if (currentFileId && !files[currentFileId])
    currentFileId = null;

  pruneOpenTabs(); // ids are rel paths; anything renamed/moved/deleted on disk is gone
  renderFileList();
}

async function createWorkFile(name, type, content)
{
  const ext = fileExtensionFor(type),
        base = sanitizeFileName(name) || 'Untitled',
        relPath = uniqueRelPath('', base, ext);

  try
  {
    await Platform.writeWorkFile(workFolderRoot, relPath, content !== undefined ? content : defaultContentForType(type, name));
  }
  catch(e)
  {
    console.warn('Work folder create error', e);
    alert('Could not create the file.');
    return null;
  }

  await loadWorkFolderTree();

  return relPath;
}

// Single funnel for persisting a file's content and/or its on-disk name, used
// both by the autosave debounce (acting on currentFileId) and by sidebar
// inline-rename (which may target a file that isn't the open one). A rename
// is implemented as a move within the same parent folder.
async function persistFileEntry(id)
{
  if (!files[id])
    return;

  // Files opened from "Shared with me" never touch my own workspace: they're
  // written back through the share (edit permission) or not at all.
  if (id === SHARED_TMP_ID)
  {
    if (sharedCtx && sharedCtx.permission === 'edit')
    {
      try
      {
        var sharedContent = files[id].content || '';
        if (sharedCtx.link)
          await Platform.writeLinkFile(sharedCtx.link, sharedCtx.subPath, sharedContent);
        else
          await Platform.writeSharedFile(sharedCtx.shareId, sharedCtx.subPath, sharedContent);
        if (id === liveSyncFileId) { liveSyncBase = sharedContent; liveSyncServerHash = null; }
      }
      catch(e) { console.warn('Shared write error', e); }
    }
    return;
  }

  if (!workFolderRoot)
  {
    await updateBacklinksForFile(id);
    saveToStorage();
    renderFileList();
    return;
  }

  const file = files[id],
        ext = fileExtensionFor(file.type),
        desiredRelPath = uniqueRelPath(file.folder || '', sanitizeFileName(file.name) || 'Untitled', ext, id);

  let activeId = id;

  if (desiredRelPath !== id)
  {
    try
    {
      await Platform.moveWorkEntry(workFolderRoot, id, desiredRelPath);

      files[desiredRelPath] = file;
      delete files[id];

      if (currentFileId === id)
        currentFileId = desiredRelPath;

      remapOpenTab(id, desiredRelPath);

      activeId = desiredRelPath;

      // Best-effort: keep the version-history sidecar attached to the file
      // it documents. Fails quietly if there's no history yet.
      Platform.moveWorkEntry(workFolderRoot, id + '.history.json', desiredRelPath + '.history.json').catch(function(){});
    }
    catch(e)
    {
      console.warn('Work folder rename error', e);
    }
  }

  try
  {
    await Platform.writeWorkFile(workFolderRoot, activeId, files[activeId].content || '');
    if (activeId === liveSyncFileId) { liveSyncBase = files[activeId].content || ''; liveSyncServerHash = null; }
    await updateBacklinksForFile(activeId);
  }
  catch(e)
  {
    console.warn('Work folder write error', e);
  }

  renderFileList();

  if (currentFileId === activeId)
  {
    if (file.type === 'doc')
      document.getElementById('doc-title-input').value = file.name;

    else if (file.type === 'graph')
      document.getElementById('graph-title-input').value = file.name;
  }
}

async function renameFolderEntry(path, newName)
{
  const folder = folders[path],
        base = sanitizeFileName(newName) || folder.name,
        desiredRelPath = uniqueFolderRelPath(folder.parent, base, path);

  if (desiredRelPath === path)
  {
    renderFileList();
    return;
  }

  try
  {
    await Platform.moveWorkEntry(workFolderRoot, path, desiredRelPath);
  }
  catch(e)
  {
    console.warn('Work folder rename error', e);
  }

  expandedFolders.delete(path);
  expandedFolders.add(desiredRelPath);

  await loadWorkFolderTree();
}

function startInlineRename(e, nameEl, id)
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

  function commit()
  {
    if (committed)
      return;

    committed = true;
    finishInlineRename(id, input.value.trim());
  }

  input.addEventListener('blur', commit);
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
      renderFileList();
    }
  });
}

function finishInlineRename(id, newName)
{
  if (files[id])
  {
    if (newName && newName !== files[id].name)
    {
      files[id].name = newName;
      files[id].modified = Date.now();
      persistFileEntry(id);
      return;
    }

    renderFileList();
    return;
  }

  if (folders[id])
  {
    if (newName && newName !== folders[id].name)
    {
      renameFolderEntry(id, newName);
      return;
    }

    renderFileList();
  }
}

function handleDragStart(e, id)
{
  draggedEntryId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  e.currentTarget.classList.add('dragging');
}

function handleDragEnd(e)
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
function handleDragEnter(e)
{
  if (!workFolderRoot || !draggedEntryId)
    return;

  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('drag-over');
}

function handleDragOver(e)
{
  if (!workFolderRoot || !draggedEntryId)
    return;

  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e)
{
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
}

// Core move used by both drag-and-drop and the right-click "Move to" menu.
async function moveEntryToFolder(id, targetFolderPath)
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
                        uniqueFolderRelPath(targetFolderPath, folders[id].name)
                      :
                        uniqueRelPath(targetFolderPath, sanitizeFileName(files[id].name) || 'Untitled', fileExtensionFor(files[id].type));

  try
  {
    await Platform.moveWorkEntry(workFolderRoot, id, toRelPath);

    if (!isDir)
      Platform.moveWorkEntry(workFolderRoot, id + '.history.json', toRelPath + '.history.json').catch(function(){});
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
    persistOpenTabs();

    expandedFolders.delete(id);
    expandedFolders.add(toRelPath);
  }
  else
    remapOpenTab(id, toRelPath);

  await loadWorkFolderTree();
  return true;
}

async function handleDrop(e, targetFolderPath)
{
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');

  const id = draggedEntryId;
  draggedEntryId = null;

  if (!id || !workFolderRoot)
    return;

  await moveEntryToFolder(id, targetFolderPath);
}

// ── RIGHT-CLICK CONTEXT MENU (folder creation + "Move to" as a drag-and-drop alternative) ──
let contextMenuTarget = null; // { kind: 'file'|'folder'|'root', id }

function openContextMenu(e, kind, id)
{
  e.preventDefault();
  e.stopPropagation();

  if (!workFolderRoot)
    return;

  contextMenuTarget = { kind: kind, id: id };
  renderContextMenu();

  const menu = document.getElementById('context-menu');

  menu.classList.add('open');

  const maxLeft = window.innerWidth - menu.offsetWidth - 8,
        maxTop = window.innerHeight - menu.offsetHeight - 8;

  menu.style.left = Math.max(4, Math.min(e.clientX, maxLeft)) + 'px';
  menu.style.top = Math.max(4, Math.min(e.clientY, maxTop)) + 'px';
}

function closeContextMenu()
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
      closeContextMenu();
  }
);

function renderContextMenu()
{
  const menu = document.getElementById('context-menu'),
        t = contextMenuTarget;

  let html = '<button class="file-menu-item" onclick="contextMenuNewFolder()">New Folder</button>';

  if (t.kind !== 'root' && !Platform.isNative)
    html += '<div class="file-menu-divider"></div>' +
            '<button class="file-menu-item" onclick="openShareModal()">Share&hellip;</button>';

  if (t.kind !== 'root')
  {
    const currentParent = (t.kind === 'folder') ? folders[t.id].parent : files[t.id].folder;

    html += '<div class="file-menu-divider"></div>';

    if (currentParent !== '')
      html += '<button class="file-menu-item" onclick="contextMenuMoveTo(\'\')">Move to Root</button>';

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
        html += '<button class="file-menu-item" onclick="contextMenuMoveTo(\'' + escAttr(p) + '\')">Move to &ldquo;' + escHtml(folders[p].name) + '&rdquo;</button>';
      });
  }

  menu.innerHTML = html;
}

async function contextMenuNewFolder()
{
  const t = contextMenuTarget,
        parent = (t.kind === 'folder') ? t.id : (t.kind === 'file' ? (files[t.id].folder || '') : '');

  closeContextMenu();

  const relPath = uniqueFolderRelPath(parent, 'New Folder');

  try
  {
    await Platform.createWorkFolder(workFolderRoot, relPath);
  }
  catch(e)
  {
    console.warn('Work folder create-folder error', e);
    alert('Could not create the folder.');
    return;
  }

  if (parent)
    expandedFolders.add(parent);

  await loadWorkFolderTree();

  const nameEl = document.querySelector('.folder-item[data-id="' + relPath + '"] .file-name');

  if (nameEl)
    startInlineRename({ stopPropagation: function(){} }, nameEl, relPath);
}

async function contextMenuMoveTo(targetFolderPath)
{
  const id = contextMenuTarget.id;

  closeContextMenu();
  await moveEntryToFolder(id, targetFolderPath);
}

function switchAppType(type, rerender)
{
  if (rerender === undefined)
    rerender = true;

  currentAppType = type;
  
  document.getElementById('doc-app').style.display      = (type === 'doc')      ? 'flex' : 'none';
  document.getElementById('sheet-app').style.display    = (type === 'sheet')    ? 'flex' : 'none';
  document.getElementById('graph-app').style.display    = (type === 'graph')    ? 'flex' : 'none';
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
    renderFileList();
}
