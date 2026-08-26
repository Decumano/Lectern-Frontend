// Cloud sync and the conflicts modal
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── CLOUD SYNC (desktop only) ──
// Connects the active work folder to a Lectern server via the
// Tauri-only cloud* commands (platform.js -> src-tauri/src/cloud.rs). The web
// build already talks to the cloud natively through Platform's work-folder
// calls and has no separate "connect" concept, so this whole section stays
// hidden there (Platform.isNative is false).

var cloudStatusCache = { connected: false };
var syncConflicts = [];
var activeSyncConflict = null;

async function refreshCloudStatus()
{
  if (!Platform.isNative)
    return;

  try { cloudStatusCache = await Platform.cloudStatus(); }
  catch(e) { cloudStatusCache = { connected: false }; }

  renderCloudSyncSection();
}

function renderCloudSyncSection()
{
  var section = document.getElementById('cloud-sync-section');

  if (!section)
    return;

  if (!Platform.isNative)
  {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';

  var needsFolderEl = document.getElementById('cloud-sync-needs-folder'),
      disconnectedEl = document.getElementById('cloud-sync-disconnected'),
      connectedEl = document.getElementById('cloud-sync-connected');

  if (!workFolderRoot)
  {
    needsFolderEl.style.display = '';
    disconnectedEl.style.display = 'none';
    connectedEl.style.display = 'none';
    return;
  }

  needsFolderEl.style.display = 'none';

  if (!cloudStatusCache.connected)
  {
    disconnectedEl.style.display = '';
    connectedEl.style.display = 'none';
    return;
  }

  disconnectedEl.style.display = 'none';
  connectedEl.style.display = '';

  var statusEl = document.getElementById('cloud-sync-status'),
      conflictsBtn = document.getElementById('cloud-conflicts-btn');

  var when = cloudStatusCache.lastSyncedAt ? new Date(cloudStatusCache.lastSyncedAt).toLocaleString() : 'not yet';
  statusEl.textContent = 'Syncing with ' + cloudStatusCache.serverUrl + ' as ' + cloudStatusCache.email + '. Last synced: ' + when + '.';

  if (cloudStatusCache.conflictCount > 0)
  {
    conflictsBtn.style.display = '';
    conflictsBtn.textContent = 'View conflicts (' + cloudStatusCache.conflictCount + ')';
  }
  else
  {
    conflictsBtn.style.display = 'none';
  }

  // Files the pass could not send come back in syncErrors while the pass
  // itself reports success -- an oversized file, a refused upload. These used
  // to be dropped on the floor, so a file could silently never reach the
  // server while this panel still read "Last synced: <time>".
  var errorsEl = document.getElementById('cloud-sync-errors'),
      errors = cloudStatusCache.syncErrors || [];

  if (errorsEl)
  {
    if (errors.length)
    {
      errorsEl.style.display = '';
      errorsEl.textContent = (errors.length === 1 ? "1 file didn't sync: "
                                                  : errors.length + " files didn't sync: ")
                             + errors.join('; ');
    }
    else
    {
      errorsEl.style.display = 'none';
      errorsEl.textContent = '';
    }
  }
}

async function connectCloud()
{
  var serverUrl = document.getElementById('cloud-server-url').value.trim(),
      email = document.getElementById('cloud-email').value.trim(),
      password = document.getElementById('cloud-password').value;

  if (!serverUrl || !email || !password)
  {
    alert('Enter a server URL, email, and password.');
    return;
  }

  if (!workFolderRoot)
  {
    alert('Choose a work folder first — that folder becomes the sync target.');
    return;
  }

  try
  {
    cloudStatusCache = await Platform.cloudConnect(serverUrl, email, password, workFolderRoot);
    document.getElementById('cloud-password').value = '';
    renderSettingsModal();
    await loadWorkFolderTree();
  }
  catch(e)
  {
    alert('Could not connect: ' + e.message);
  }
}

async function disconnectCloud()
{
  try { await Platform.cloudDisconnect(); }
  catch(e) { console.warn('Cloud disconnect error', e); }

  cloudStatusCache = { connected: false };
  renderCloudSyncSection();
}

async function syncNowCloud()
{
  try
  {
    cloudStatusCache = await Platform.cloudSyncNow();
    renderCloudSyncSection();
    await loadWorkFolderTree();
  }
  catch(e)
  {
    alert('Sync failed: ' + e.message);
  }
}

// ── Sync Conflicts modal ──
// Each conflict is a file both sides edited since the last sync in ways that
// couldn't be auto-merged (see three_way_merge in cloud.rs). The user picks
// which version wins, or keeps both as separate files.

async function openSyncConflictsModal()
{
  try { syncConflicts = await Platform.cloudListConflicts(); }
  catch(e) { syncConflicts = []; }

  renderSyncConflictsModal();
  document.getElementById('sync-conflicts-modal').classList.add('open');
}

function closeSyncConflictsModal()
{
  document.getElementById('sync-conflicts-modal').classList.remove('open');
}

function renderSyncConflictsModal()
{
  var list = document.getElementById('sync-conflicts-list');

  if (!syncConflicts.length)
  {
    list.innerHTML = '<div class="history-empty">No conflicts — everything is synced.</div>';
    return;
  }

  list.innerHTML = syncConflicts.map(function(c, i)
  {
    return '<div class="history-item">' +
             '<div class="history-item-info">' +
               '<div class="history-item-time">' + escHtml(c.relPath) + '</div>' +
               '<div class="history-item-preview">Both your device and the cloud changed this file since the last sync.</div>' +
             '</div>' +
             '<div class="history-item-actions">' +
               '<button type="button" class="btn-cancel history-compare-btn" onclick="openSyncConflictDiff(' + i + ')">Review</button>' +
             '</div>' +
           '</div>';
  }).join('');
}

function openSyncConflictDiff(index)
{
  activeSyncConflict = syncConflicts[index];

  if (!activeSyncConflict)
    return;

  document.getElementById('sync-conflict-diff-title').textContent = activeSyncConflict.relPath;
  renderWordDiff(activeSyncConflict.localContent, activeSyncConflict.remoteContent, 'sync-conflict-local-pane', 'sync-conflict-remote-pane');

  closeSyncConflictsModal();
  document.getElementById('sync-conflict-diff-modal').classList.add('open');
}

function closeSyncConflictDiffModal()
{
  document.getElementById('sync-conflict-diff-modal').classList.remove('open');
  document.getElementById('sync-conflicts-modal').classList.add('open');
}

async function resolveSyncConflict(choice)
{
  if (!activeSyncConflict)
    return;

  try
  {
    await Platform.cloudResolveConflict(activeSyncConflict.relPath, choice);
  }
  catch(e)
  {
    alert('Could not resolve conflict: ' + e.message);
    return;
  }

  document.getElementById('sync-conflict-diff-modal').classList.remove('open');
  activeSyncConflict = null;

  await refreshCloudStatus();
  await openSyncConflictsModal();
  await loadWorkFolderTree();
}

// Wraps rendered body markup (doc HTML or a sheet table) into a standalone,
// printable HTML document - intentionally light-themed regardless of the
// app's dark UI, since this is meant to be portable/readable on its own.
function wrapExportHtml(title, bodyHtml)
{
  return  '<!DOCTYPE html>\n'+
          '<html lang="en">\n'+
          '<head>\n'+
          '<meta charset="UTF-8">\n'+
          '<title>' + escHtml(title) + '</title>\n'+
          '<style>\n'+
          '@page{size:A4;margin:2cm;}\n'+
          'body{font-family:Georgia,\'Times New Roman\',serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6;}\n'+
          'h1,h2,h3,h4,h5,h6{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}\n'+
          'table{border-collapse:collapse;width:100%;font-family:Consolas,monospace;font-size:13px;}\n'+
          'td{border:1px solid #ccc;padding:4px 8px;}\n'+
          'code{background:#f0f0f0;padding:2px 4px;border-radius:3px;}\n'+
          'pre{background:#f0f0f0;padding:12px;border-radius:6px;overflow-x:auto;}\n'+
          'blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:16px;color:#555;}\n'+
          '.mermaid-diagram{text-align:center;margin:1.5em 0;}\n'+
          '.mermaid-diagram svg{max-width:100%;height:auto;}\n'+
          'table,tr,blockquote,pre,.mermaid-diagram,.notebook-page{break-inside:avoid;}\n'+
          'h1,h2,h3,h4,h5,h6{break-after:avoid;}\n'+
          '.notebook-page{break-after:page;}\n'+
          '.notebook-page:last-child{break-after:auto;}\n'+
          '@media print{\n'+
          'body{max-width:none;margin:0;padding:0;}\n'+
          '}\n'+
          '</style>\n'+
          '</head>\n'+
          '<body>\n' + bodyHtml + '\n</body>\n'+
          '</html>';
}

function buildDocExportHtml(file)
{
  var bodyHtml = escHtml(file.content || '');

  if (typeof marked !== 'undefined')
  {
    documentHeadings = [];
    slugCounts = {};
    headingRenderCursor = 0;

    var tokens = marked.lexer(file.content || '');
    collectHeadings(tokens);

    bodyHtml = marked.parser(tokens);
  }

  return wrapExportHtml(file.name, '<h1>' + escHtml(file.name) + '</h1>\n' + sanitizeHtml(bodyHtml));
}

function buildSheetExportHtml(file)
{
  var sections = '',
      savedData = sheetData;

  sheetPages.forEach(function(page)
  {
    // The display/eval helpers read the global sheetData; point it at each
    // page in turn while its table is built.
    sheetData = page.data;

    var maxRow = 0,
        maxCol = 0;

    Object.keys(page.data).forEach
    (
      function(ref)
      {
        var parsed = parseName(ref);

        if (!parsed)
          return;

        maxRow = Math.max(maxRow, parsed.row);
        maxCol = Math.max(maxCol, colIndex(parsed.col));
      }
    );

    var rowsHtml = '';

    for (var r = 1; r <= maxRow; r++)
    {
      rowsHtml += '<tr>';

      for (var c = 0; c <= maxCol; c++)
        rowsHtml += '<td>' + escHtml(getDisplayValue(colName(c) + r)) + '</td>';

      rowsHtml += '</tr>\n';
    }

    if (sheetPages.length > 1)
      sections += '<h2>' + escHtml(page.name) + '</h2>\n';

    sections += maxRow
                ?
                  '<table>\n<tbody>\n' + rowsHtml + '</tbody>\n</table>\n'
                :
                  '<p>This tab is empty.</p>\n';
  });

  sheetData = savedData;

  return wrapExportHtml(file.name, '<h1>' + escHtml(file.name) + '</h1>\n' + sections);
}

// Mermaid's library isn't shipped inside exported files, so any `.mermaid`
// placeholder is rendered to a static <svg> here (via mermaid.render, which
// works off-DOM) and the markup is inlined directly - keeping the exported
// HTML/PDF fully self-contained and immune to script execution quirks in
// whatever renders it later (the server-side PDF renderer, or the Tauri
// print-preview iframe).
async function inlineMermaidSvgs(html)
{
  if (typeof mermaid === 'undefined')
    return html;

  var container = document.createElement('div');
  container.innerHTML = html;

  var nodes = Array.prototype.slice.call(container.querySelectorAll('.mermaid'));

  if (!nodes.length)
    return html;

  for (var i = 0; i < nodes.length; i++)
  {
    var node = nodes[i],
        source = node.textContent;

    try
    {
      var result = await mermaid.render('mermaid-export-' + Date.now() + '-' + i, source);
      node.outerHTML = '<div class="mermaid-diagram">' + result.svg + '</div>';
    }
    catch(e)
    {
      console.warn('Mermaid export render error', e);
      node.outerHTML = '<pre>' + escHtml(source) + '</pre>';
    }
  }

  return container.innerHTML;
}

async function buildGraphExportHtml(file)
{
  var bodyHtml = escHtml(file.content || '');

  if (typeof marked !== 'undefined')
    bodyHtml = marked.parser(marked.lexer(file.content || ''));

  bodyHtml = await inlineMermaidSvgs(sanitizeHtml(bodyHtml));

  return wrapExportHtml(file.name, '<h1>' + escHtml(file.name) + '</h1>\n' + bodyHtml);
}

// Shows the HTML in a genuinely on-screen preview (rather than a hidden/
// off-screen iframe) before printing. An invisible or off-canvas iframe is
// the usual trick for "print this content", but some embedded webviews
// (e.g. Tauri's WebView2 on Windows) appear to rasterize whatever's at the
// iframe's on-page position for "Print to PDF" rather than the iframe's own
// internal layout - which is empty when the iframe sits off-screen, so the
// resulting PDF comes out blank. Keeping the content visibly on-screen
// sidesteps that entirely, and lets the user see what they're printing.
function printHtmlContent(html)
{
  var overlay = document.getElementById('print-preview-overlay'),
      iframe = document.getElementById('print-preview-frame');

  if (!overlay || !iframe)
    return;

  iframe.srcdoc = html;
  overlay.classList.add('open');
}

function printPreviewNow()
{
  var iframe = document.getElementById('print-preview-frame');

  if (!iframe || !iframe.contentWindow)
    return;

  iframe.contentWindow.focus();
  iframe.contentWindow.print();
}

function closePrintPreview()
{
  var overlay = document.getElementById('print-preview-overlay'),
      iframe = document.getElementById('print-preview-frame');

  if (overlay)
    overlay.classList.remove('open');

  if (iframe)
    iframe.srcdoc = '';
}

document.getElementById('print-preview-overlay').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('print-preview-overlay'))
      closePrintPreview();
  }
);

async function exportCurrentAs(format)
{
  if (!currentFileId)
  {
    alert('No file open.');
    return;
  }

  var f = files[currentFileId],
      html;

  if (f.type === 'sheet')
    html = buildSheetExportHtml(f);
  else if (f.type === 'graph')
    html = await buildGraphExportHtml(f);
  else if (f.type === 'notebook')
    html = await buildNotebookExportHtml(f);
  else
    html = buildDocExportHtml(f);

  if (format === 'pdf')
  {
    if (Platform.isNative)
    {
      printHtmlContent(html);
      return;
    }

    var pdfName = f.name.replace(/\s+/g,'_') + '.pdf';

    try
    {
      await Platform.exportPdf(pdfName, html);
    }
    catch(e)
    {
      console.warn('PDF export error', e);
      alert('Could not export PDF.');
    }

    return;
  }

  var fileName = f.name.replace(/\s+/g,'_') + '.html';

  try
  {
    var saved = await Platform.saveFile(fileName, html);

    if (!saved)
      return;
  }
  catch(e)
  {
    console.warn('Export error', e);
    alert('Could not export file.');
  }
}

function triggerImport()
{
  document.getElementById('import-input').click();
}

function handleImport(e)
{
  var file = e.target.files[0];
  if (!file)
    return;

  var reader = new FileReader();

  reader.onload = async function(ev)
  {
    var content = ev.target.result,
        type =  (file.name.endsWith('.mds') || file.name.endsWith('.csv')) ? 'sheet'
              : file.name.endsWith('.mdg') ? 'graph'
              : file.name.endsWith('.mdn') ? 'notebook'
              : file.name.endsWith('.mdl') ? 'glossary'
              : file.name.endsWith('.mdc') ? 'calendar'
              : file.name.endsWith('.mde') ? 'economy'
              : file.name.endsWith('.mdb') ? 'bestiary'
              : 'doc';

    var name = file.name.replace(/\.[^.]+$/,'');

    if (workFolderRoot)
    {
      var relPath = uniqueRelPath('', sanitizeFileName(name) || 'Untitled', fileExtensionFor(type));

      try
      {
        await Platform.writeWorkFile(workFolderRoot, relPath, content);
      }
      catch(err)
      {
        console.warn('Work folder import error', err);
        alert('Could not import that file.');
        return;
      }

      await loadWorkFolderTree();
      switchAppType(type);
      await openFile(relPath);
      return;
    }

    var id = createFile(name, type, content);
    switchAppType(type);
    openFile(id);
  };

  reader.readAsText(file);
  e.target.value = '';
}

function escHtml(s)
{
  return String(s)
          .replace(/&/g,'&amp;')
          .replace(/</g,'&lt;')
          .replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;');
}

// Escapes a value for safe use inside a single-quoted JS string literal that
// itself sits inside a double-quoted HTML attribute (the onclick="fn('ID')"
// pattern used throughout the sidebar) - relevant since rel_paths/names can
// contain arbitrary text once a user renames something.
function escAttr(s)
{
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
}

// Central sanitizer for HTML produced from document content (markdown
// preview, graph preview, export bodies). marked's html renderer passes raw
// HTML through untouched, so a shared file can carry <img onerror=...> or a
// <script> - every innerHTML sink for rendered markdown must go through
// here. Own-renderer output (KaTeX spans/MathML, .mermaid divs, checkbox
// inputs with data-idx, data-chart-config attributes) survives DOMPurify's
// default profile. If the vendored sanitizer somehow didn't load, fall back
// to escaping everything: a plain-text preview beats running untrusted markup.
function sanitizeHtml(html)
{
  if (typeof DOMPurify !== 'undefined' && DOMPurify.isSupported)
    return DOMPurify.sanitize(html);

  return escHtml(html);
}

