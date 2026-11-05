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

async function fRefreshCloudStatus()
{
  if (!Platform.isNative)
    return;

  try { cloudStatusCache = await Platform.fCloudStatus(); }
  catch(e) { cloudStatusCache = { connected: false }; }

  fRenderCloudSyncSection();
}

function fRenderCloudSyncSection()
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

async function fConnectCloud()
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
    cloudStatusCache = await Platform.fCloudConnect(serverUrl, email, password, workFolderRoot);
    document.getElementById('cloud-password').value = '';
    fRenderSettingsModal();
    await fLoadWorkFolderTree();
  }
  catch(e)
  {
    alert('Could not connect: ' + e.message);
  }
}

async function fDisconnectCloud()
{
  try { await Platform.fCloudDisconnect(); }
  catch(e) { console.warn('Cloud disconnect error', e); }

  cloudStatusCache = { connected: false };
  fRenderCloudSyncSection();
}

async function fSyncNowCloud()
{
  try
  {
    cloudStatusCache = await Platform.fCloudSyncNow();
    fRenderCloudSyncSection();
    await fLoadWorkFolderTree();
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

async function fOpenSyncConflictsModal()
{
  try { syncConflicts = await Platform.fCloudListConflicts(); }
  catch(e) { syncConflicts = []; }

  fRenderSyncConflictsModal();
  document.getElementById('sync-conflicts-modal').classList.add('open');
}

function fCloseSyncConflictsModal()
{
  document.getElementById('sync-conflicts-modal').classList.remove('open');
}

function fRenderSyncConflictsModal()
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
               '<div class="history-item-time">' + fEscHtml(c.relPath) + '</div>' +
               '<div class="history-item-preview">Both your device and the cloud changed this file since the last sync.</div>' +
             '</div>' +
             '<div class="history-item-actions">' +
               '<button type="button" class="btn-cancel history-compare-btn" onclick="fOpenSyncConflictDiff(' + i + ')">Review</button>' +
             '</div>' +
           '</div>';
  }).join('');
}

function fOpenSyncConflictDiff(index)
{
  activeSyncConflict = syncConflicts[index];

  if (!activeSyncConflict)
    return;

  document.getElementById('sync-conflict-diff-title').textContent = activeSyncConflict.relPath;
  fRenderWordDiff(activeSyncConflict.localContent, activeSyncConflict.remoteContent, 'sync-conflict-local-pane', 'sync-conflict-remote-pane');

  fCloseSyncConflictsModal();
  document.getElementById('sync-conflict-diff-modal').classList.add('open');
}

function fCloseSyncConflictDiffModal()
{
  document.getElementById('sync-conflict-diff-modal').classList.remove('open');
  document.getElementById('sync-conflicts-modal').classList.add('open');
}

async function fResolveSyncConflict(choice)
{
  if (!activeSyncConflict)
    return;

  try
  {
    await Platform.fCloudResolveConflict(activeSyncConflict.relPath, choice);
  }
  catch(e)
  {
    alert('Could not resolve conflict: ' + e.message);
    return;
  }

  document.getElementById('sync-conflict-diff-modal').classList.remove('open');
  activeSyncConflict = null;

  await fRefreshCloudStatus();
  await fOpenSyncConflictsModal();
  await fLoadWorkFolderTree();
}

// Wraps rendered body markup (doc HTML or a sheet table) into a standalone,
// printable HTML document - intentionally light-themed regardless of the
// app's dark UI, since this is meant to be portable/readable on its own.
// extraCss is appended last so a document's own [PAGE ...] options (page size,
// margins, running headers, heading styles) override the defaults below.
function fWrapExportHtml(title, bodyHtml, extraCss)
{
  return  '<!DOCTYPE html>\n'+
          '<html lang="en">\n'+
          '<head>\n'+
          '<meta charset="UTF-8">\n'+
          '<title>' + fEscHtml(title) + '</title>\n'+
          '<style>\n'+
          '@page{size:A4;margin:2cm;}\n'+
          'body{font-family:Georgia,\'Times New Roman\',serif;font-size:11pt;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact;}\n'+
          'h1,h2,h3,h4,h5,h6{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.25;margin:1.4em 0 .5em;}\n'+
          'h1{font-size:1.9em;}h2{font-size:1.5em;}h3{font-size:1.25em;}h4{font-size:1.1em;}\n'+
          'p{margin:0 0 .8em;orphans:2;widows:2;}\n'+
          'p,li,td,th,h1,h2,h3,h4,h5,h6{overflow-wrap:anywhere;}\n'+
          'thead{display:table-header-group;}\n'+
          'a{color:#1a4d8f;text-decoration:none;}\n'+
          'ul,ol{margin:0 0 .8em;padding-left:1.6em;}\n'+
          'li{margin:.15em 0;}\n'+
          'table{border-collapse:collapse;width:100%;font-family:Consolas,monospace;font-size:13px;}\n'+
          'td{border:1px solid #ccc;padding:4px 8px;}\n'+
          'th{border:1px solid #ccc;padding:4px 8px;background:#f2f2f2;text-align:left;}\n'+
          'code{background:#f0f0f0;padding:2px 4px;border-radius:3px;font-size:.9em;}\n'+
          'pre{background:#f0f0f0;padding:12px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;}\n'+
          'pre code{background:none;padding:0;}\n'+
          'blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:16px;color:#555;}\n'+
          'hr{border:none;border-top:1px solid #ccc;margin:1.5em 0;}\n'+
          'img{max-width:100%;}\n'+
          '.mermaid-diagram{text-align:center;margin:1.5em 0;}\n'+
          '.mermaid-diagram svg{max-width:100%;height:auto;}\n'+
          '.math-block{text-align:center;margin:1em 0;}\n'+
          '.doc-fields{display:flex;flex-wrap:wrap;gap:4px 12px;margin:.8em 0;padding:8px 12px;background:#f6f6f6;border:1px solid #ddd;border-left:3px solid #7a6a4f;border-radius:4px;font-size:.85em;break-inside:avoid;}\n'+
          '.doc-field b{margin-right:4px;}\n'+
          '.doc-fields-vertical{display:inline-grid;grid-template-columns:auto 1fr;gap:3px 16px;}\n'+
          '.doc-field-key{font-weight:bold;}\n'+
          '.toc{margin:1em 0;}\n'+
          '.toc-title{font-size:1.4em;font-weight:bold;margin-bottom:.5em;}\n'+
          '.toc ul{list-style:none;margin:.15em 0;padding-left:1.4em;}\n'+
          '.toc > ul{padding-left:0;}\n'+
          '.toc a{color:inherit;}\n'+
          '.toc-num{display:inline-block;min-width:1.6em;}\n'+
          '.doc-tag{background:#eee;border-radius:10px;padding:0 7px;font-size:.85em;}\n'+
          'input.preview-checkbox{margin-right:.4em;}\n'+
          'ul:has(> li > input.preview-checkbox){list-style:none;padding-left:.4em;}\n'+
          '.chapter-label{display:block;font-size:.45em;font-weight:normal;letter-spacing:.04em;margin-bottom:.3em;}\n'+
          '.page-break{break-after:page;height:0;margin:0;padding:0;border:0;overflow:hidden;}\n'+
          '.page-break span,.page-setup-note{display:none;}\n'+
          '.force-break{break-before:page;}\n'+
          '.pdf-fill,.pdf-space{margin:0;padding:0;border:0;}\n'+
          '.pdf-sheet{display:flex;flex-direction:column;}\n'+
          '.pdf-sheet>*{flex:0 0 auto;}\n'+
          '.no-break{break-before:avoid;}\n'+
          'tr,.mermaid-diagram,.math-block,.notebook-page{break-inside:avoid;}\n'+
          'h1,h2,h3,h4,h5,h6{break-after:avoid;}\n'+
          '.notebook-page{break-after:page;}\n'+
          '.notebook-page:last-child{break-after:auto;}\n'+
          '@media print{\n'+
          'body{max-width:none;margin:0;padding:0;}\n'+
          '}\n'+
          (extraCss || '') +
          '</style>\n'+
          '</head>\n'+
          '<body>\n' + bodyHtml + '\n</body>\n'+
          '</html>';
}

// KaTeX's stylesheet points at font files by relative URL, which don't resolve
// once the HTML is printed from an iframe or posted to the PDF renderer - the
// formulas come out as unstyled soup. So the stylesheet is inlined with its
// woff2 fonts as data URIs (cached; only built for documents that use math).
var katexExportCssCache = null;

async function fGetKatexExportCss()
{
  if (katexExportCssCache !== null)
    return katexExportCssCache;

  try
  {
    var css = await (await fetch('vendor/katex/katex.min.css')).text(),
        srcRe = /src:url\(fonts\/([^)]+)\.woff2\) format\("woff2"\),url\([^)]+\) format\("woff"\),url\([^)]+\) format\("truetype"\)/g,
        names = {};

    css.replace(srcRe, function(all, name) { names[name] = null; return all; });

    await Promise.all
    (
      Object.keys(names).map
      (
        async function(name)
        {
          var bytes = new Uint8Array(await (await fetch('vendor/katex/fonts/' + name + '.woff2')).arrayBuffer()),
              binary = '';

          for (var i = 0; i < bytes.length; i += 0x8000)
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));

          names[name] = btoa(binary);
        }
      )
    );

    katexExportCssCache = css.replace(srcRe, function(all, name) { return 'src:url(data:font/woff2;base64,' + names[name] + ') format("woff2")'; });
  }
  catch(e)
  {
    console.warn('KaTeX export CSS unavailable', e);
    katexExportCssCache = '';
  }

  return katexExportCssCache;
}

// overrides: values from the PDF options dialog, on top of the [PAGE] line.
// mode: 'paper' for CSS paged media, 'paged' when fPaginateDocument lays it out.
async function fBuildDocExport(file, overrides, mode)
{
  var bodyHtml = fEscHtml(file.content || ''),
      settings = { headings: {} },
      showTitle = true;

  if (typeof marked !== 'undefined')
  {
    var rendered = fRenderMarkdownDoc(file.content || '');

    bodyHtml = rendered.html;
    settings = rendered.settings;
    showTitle = !settings.hideTitle && !rendered.startsWithTitle;
  }

  Object.keys(overrides || {}).forEach(function(k) { settings[k] = overrides[k]; });

  // Sanitise first, then inline mermaid as static SVG (the diagram library
  // isn't shipped inside an exported file).
  bodyHtml = await fInlineMermaidSvgs(fSanitizeHtml(bodyHtml));

  // The server paginates with CSS, which cannot stretch a fill across a page.
  if ((mode || 'paper') === 'paper' && bodyHtml.indexOf('pdf-fill') !== -1)
    bodyHtml = fWrapFillSections(bodyHtml, settings, file.name);

  var extraCss = bodyHtml.indexOf('class="katex') !== -1 ? await fGetKatexExportCss() : '';

  extraCss += fBuildPageCss(settings, 'body', mode || 'paper', file.name);

  return  {
            html: fWrapExportHtml(file.name, (showTitle ? '<h1>' + fEscHtml(file.name) + '</h1>\n' : '') + bodyHtml, extraCss),
            settings: settings
          };
}

// ── PDF options dialog (Documents) ──
// Prefilled from the document's [PAGE] line; what's chosen here wins for this export.
var pdfOptionsFile = null;

function fOpenPdfOptions(file)
{
  pdfOptionsFile = file;

  var settings = (typeof marked !== 'undefined') ? fRenderMarkdownDoc(file.content || '').settings : {},
      set = function(id, value) { document.getElementById(id).value = value; };

  set('pdf-opt-size', settings.size || 'A4');
  set('pdf-opt-orientation', settings.orientation || 'portrait');
  set('pdf-opt-margin', settings.margin || '2cm');
  set('pdf-opt-numbers', settings.numbers || '');
  set('pdf-opt-header', settings.header || '');
  set('pdf-opt-footer', settings.footer || '');
  document.getElementById('pdf-opt-newpage').checked = settings.newPage !== 'none';

  document.getElementById('pdf-options-modal').classList.add('open');
}

function fClosePdfOptions()
{
  document.getElementById('pdf-options-modal').classList.remove('open');
}

async function fConfirmPdfOptions()
{
  var get = function(id) { return document.getElementById(id).value.trim(); },
      margin = get('pdf-opt-margin').split(/\s+/).map(fCssLengthValue).join(' '),
      existingBreak = (typeof marked !== 'undefined') ? fRenderMarkdownDoc(pdfOptionsFile.content || '').settings.newPage : '',
      overrides =
      {
        size: get('pdf-opt-size'),
        orientation: get('pdf-opt-orientation'),
        numbers: get('pdf-opt-numbers'),
        header: get('pdf-opt-header'),
        footer: get('pdf-opt-footer'),
        newPage: document.getElementById('pdf-opt-newpage').checked
                 ? ((existingBreak && existingBreak !== 'none') ? existingBreak : 'h1')
                 : 'none'
      };

  // A bare number in this box means centimetres, the way it's labelled.
  if (/^[\d.]+(\s+[\d.]+)*$/.test(get('pdf-opt-margin')))
    margin = get('pdf-opt-margin').split(/\s+/).map(function(v) { return v + 'cm'; }).join(' ');

  if (!fParseMarginsValid(margin))
  {
    alert('Margins must be 1 to 4 lengths in mm, cm, in, pt or px, for example 2cm or "2cm 3cm".');
    return;
  }

  overrides.margin = margin;

  fClosePdfOptions();

  var file = pdfOptionsFile;

  try
  {
    if (Platform.isNative)
    {
      var built = await fBuildDocExport(file, overrides, 'paged');
      fPrintHtmlContent(built.html, { layout: fPageLayoutFromSettings(built.settings, file.name), name: file.name });
    }
    else
    {
      var served = await fBuildDocExport(file, overrides, 'paper');
      await Platform.fExportPdf(file.name.replace(/\s+/g,'_') + '.pdf', served.html);
    }
  }
  catch(e)
  {
    console.warn('PDF export error', e);
    alert('Could not export PDF.');
  }
}

function fParseMarginsValid(text)
{
  var parts = text.split(/\s+/);

  return parts.length >= 1 && parts.length <= 4 && parts.every(function(v) { return fCssLengthToMm(v) !== null; });
}

function fBuildSheetExportHtml(file)
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
        var parsed = fParseName(ref);

        if (!parsed)
          return;

        maxRow = Math.max(maxRow, parsed.row);
        maxCol = Math.max(maxCol, fColIndex(parsed.col));
      }
    );

    var rowsHtml = '';

    for (var r = 1; r <= maxRow; r++)
    {
      rowsHtml += '<tr>';

      for (var c = 0; c <= maxCol; c++)
        rowsHtml += '<td>' + fEscHtml(fGetDisplayValue(fColName(c) + r)) + '</td>';

      rowsHtml += '</tr>\n';
    }

    if (sheetPages.length > 1)
      sections += '<h2>' + fEscHtml(page.name) + '</h2>\n';

    sections += maxRow
                ?
                  '<table>\n<tbody>\n' + rowsHtml + '</tbody>\n</table>\n'
                :
                  '<p>This tab is empty.</p>\n';
  });

  sheetData = savedData;

  return fWrapExportHtml(file.name, '<h1>' + fEscHtml(file.name) + '</h1>\n' + sections);
}

// Mermaid's library isn't shipped inside exported files, so any `.mermaid`
// placeholder is rendered to a static <svg> here (via mermaid.render, which
// works off-DOM) and the markup is inlined directly - keeping the exported
// HTML/PDF fully self-contained and immune to script execution quirks in
// whatever renders it later (the server-side PDF renderer, or the Tauri
// print-preview iframe).
async function fInlineMermaidSvgs(html)
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
      node.outerHTML = '<pre>' + fEscHtml(source) + '</pre>';
    }
  }

  return container.innerHTML;
}

async function fBuildGraphExportHtml(file)
{
  var bodyHtml = fEscHtml(file.content || '');

  if (typeof marked !== 'undefined')
    bodyHtml = fRenderMarkdownFragment(file.content || '');

  bodyHtml = await fInlineMermaidSvgs(fSanitizeHtml(bodyHtml));

  return fWrapExportHtml(file.name, '<h1>' + fEscHtml(file.name) + '</h1>\n' + bodyHtml);
}

// Shows the HTML in a genuinely on-screen preview (rather than a hidden/
// off-screen iframe) before printing. An invisible or off-canvas iframe is
// the usual trick for "print this content", but some embedded webviews
// (e.g. Tauri's WebView2 on Windows) appear to rasterize whatever's at the
// iframe's on-page position for "Print to PDF" rather than the iframe's own
// internal layout - which is empty when the iframe sits off-screen, so the
// resulting PDF comes out blank. Keeping the content visibly on-screen
// sidesteps that entirely, and lets the user see what they're printing.
var printPreviewJob = null;

// paged: { layout, name } lays the document out into real pages once it has
// loaded, in this frame's engine, the one that goes on to print it.
function fPrintHtmlContent(html, paged)
{
  var overlay = document.getElementById('print-preview-overlay'),
      iframe = document.getElementById('print-preview-frame');

  if (!overlay || !iframe)
    return;

  printPreviewJob = paged || null;

  if (paged)
  {
    iframe.onload = async function()
    {
      iframe.onload = null;

      var doc = iframe.contentDocument;

      // Measuring before the fonts arrive would put every break in the wrong place.
      if (doc.fonts && doc.fonts.ready)
        await doc.fonts.ready;

      fPaginateDocument(doc, paged.layout);
    };
  }
  else
  {
    iframe.onload = null;
  }

  iframe.srcdoc = html;
  overlay.classList.add('open');
}

async function fPrintPreviewNow()
{
  var iframe = document.getElementById('print-preview-frame');

  if (!iframe || !iframe.contentWindow)
    return;

  // Linux: write the PDF natively, because WebKitGTK's print path would impose
  // the print dialog's margins on the pages. Elsewhere, or if that isn't
  // available, the ordinary print dialog (Chromium honours @page margin:0).
  if (printPreviewJob && Platform.fSavePdf)
  {
    try
    {
      var job = printPreviewJob,
          html = '<!DOCTYPE html>\n' + iframe.contentDocument.documentElement.outerHTML;

      await Platform.fSavePdf(job.name.replace(/\s+/g, '_') + '.pdf', html, job.layout.widthMm, job.layout.heightMm);
      return;
    }
    catch(e)
    {
      console.warn('Native PDF export unavailable, using the print dialog', e);
    }
  }

  iframe.contentWindow.focus();
  iframe.contentWindow.print();
}

function fClosePrintPreview()
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
      fClosePrintPreview();
  }
);

async function fExportCurrentAs(format)
{
  if (!currentFileId)
  {
    alert('No file open.');
    return;
  }

  var f = files[currentFileId],
      html;

  if (f.type === 'sheet')
    html = fBuildSheetExportHtml(f);
  else if (f.type === 'graph')
    html = await fBuildGraphExportHtml(f);
  else if (f.type === 'slides')
    html = await fBuildSlidesExportHtml(f);
  else if (f.type === 'notebook')
    html = await fBuildNotebookExportHtml(f);
  else if (format === 'pdf')
  {
    fOpenPdfOptions(f);
    return;
  }
  else
    html = (await fBuildDocExport(f, null, 'paper')).html;

  if (format === 'pdf')
  {
    if (Platform.isNative)
    {
      fPrintHtmlContent(html);
      return;
    }

    var pdfName = f.name.replace(/\s+/g,'_') + '.pdf';

    try
    {
      await Platform.fExportPdf(pdfName, html);
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
    var saved = await Platform.fSaveFile(fileName, html);

    if (!saved)
      return;
  }
  catch(e)
  {
    console.warn('Export error', e);
    alert('Could not export file.');
  }
}

function fTriggerImport()
{
  document.getElementById('import-input').click();
}

function fHandleImport(e)
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
              : file.name.endsWith('.mdd') ? 'slides'
              : file.name.endsWith('.mdn') ? 'notebook'
              : file.name.endsWith('.mdl') ? 'glossary'
              : file.name.endsWith('.mdc') ? 'calendar'
              : file.name.endsWith('.mde') ? 'economy'
              : file.name.endsWith('.mdb') ? 'bestiary'
              : 'doc';

    var name = file.name.replace(/\.[^.]+$/,'');

    if (workFolderRoot)
    {
      var relPath = fUniqueRelPath('', fSanitizeFileName(name) || 'Untitled', fFileExtensionFor(type));

      try
      {
        await Platform.fWriteWorkFile(workFolderRoot, relPath, content);
      }
      catch(err)
      {
        console.warn('Work folder import error', err);
        alert('Could not import that file.');
        return;
      }

      await fLoadWorkFolderTree();
      fSwitchAppType(type);
      await fOpenFile(relPath);
      return;
    }

    var id = fCreateFile(name, type, content);
    fSwitchAppType(type);
    fOpenFile(id);
  };

  reader.readAsText(file);
  e.target.value = '';
}

function fEscHtml(s)
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
function fEscAttr(s)
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
function fSanitizeHtml(html)
{
  if (typeof DOMPurify !== 'undefined' && DOMPurify.isSupported)
    return DOMPurify.sanitize(html);

  return fEscHtml(html);
}

