// Documents: cross-file links and the font picker
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── CROSS-FILE LINKS (Docs only) ──
// Written as ordinary markdown links whose target uses a custom scheme -
// [text](lorekeep://file/<id>) - so a click handler in the preview can tell
// them apart from real URLs and route to openFile() instead of navigating.
// The id is URL-encoded since Work Folder ids are relative paths (can
// contain "/") and could in principle contain other URL-unsafe characters.
var FILE_LINK_SCHEME = 'lorekeep://file/';

function openFileLinkModal()
{
  document.getElementById('file-link-search').value = '';
  renderFileLinkList();
  document.getElementById('file-link-modal').classList.add('open');
  document.getElementById('file-link-search').focus();

  // In Work Folder mode, eagerly pre-load content for embeddable files so the
  // Embed button works immediately when clicked (content is otherwise only
  // loaded on explicit openFile).
  if (workFolderRoot)
  {
    Object.keys(files).forEach(function(id)
    {
      var f = files[id];
      if ((f.type === 'sheet' || f.type === 'graph') && !f.contentLoaded)
      {
        Platform.readWorkFile(workFolderRoot, id)
          .then(function(c){ f.content = c; f.contentLoaded = true; })
          .catch(function(){});
      }
    });
  }
}

function closeFileLinkModal()
{
  document.getElementById('file-link-modal').classList.remove('open');
}

document.getElementById('file-link-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('file-link-modal'))
      closeFileLinkModal();
  }
);

// Folders the user collapsed inside the Link-file modal (session-scoped).
// Everything starts expanded: the point of the tree is browsing by location.
var fileLinkCollapsed = new Set();

function toggleFileLinkFolder(path)
{
  if (fileLinkCollapsed.has(path))
    fileLinkCollapsed.delete(path);
  else
    fileLinkCollapsed.add(path);

  renderFileLinkList();
}

function fileLinkRowHtml(id, f, depth, subtitle)
{
  var canEmbed = (f.type === 'graph' || f.type === 'sheet');

  return  '<div class="file-link-item" style="margin-left:' + (depth * 16) + 'px" onclick="chooseFileLink(\'' + escAttr(id) + '\')">' +
            '<span class="file-icon">' + fileTypeIcon(f.type) + '</span>' +
            '<span class="file-link-item-name">' + escHtml(f.name) +
              (subtitle ? '<span class="file-link-item-path">' + escHtml(subtitle) + '</span>' : '') +
            '</span>' +
            (canEmbed ? '<button class="file-link-embed-btn" onclick="event.stopPropagation();chooseFileEmbed(\'' + escAttr(id) + '\')">Embed</button>' : '') +
          '</div>';
}

// Mirrors the sidebar's folder tree so files can be found by where they
// live, not just by name. Searching flattens the tree (matches from any
// folder) but keeps each hit's folder path visible as a subtitle.
function renderFileLinkList()
{
  var query = document.getElementById('file-link-search').value.trim().toLowerCase(),
      list = document.getElementById('file-link-list'),
      ids = Object.keys(files).filter(function(id)
      {
        return id !== SHARED_TMP_ID && id !== currentFileId; // no self-links
      });

  function byName(a, b) { return files[a].name.localeCompare(files[b].name); }

  if (query)
  {
    var matches = ids.filter(function(id) { return files[id].name.toLowerCase().indexOf(query) !== -1; })
                     .sort(byName);

    list.innerHTML = matches.length
                      ?
                        matches.map(function(id)
                        {
                          return fileLinkRowHtml(id, files[id], 0, files[id].folder ? files[id].folder + '/' : '');
                        }).join('')
                      :
                        '<div class="history-empty">No matching files.</div>';
    return;
  }

  // No folders (e.g. browser-storage mode): flat list, most recent first
  if (Object.keys(folders).length === 0)
  {
    var flat = ids.sort(function(a, b) { return (files[b].modified || 0) - (files[a].modified || 0); });

    list.innerHTML = flat.length
                      ? flat.map(function(id) { return fileLinkRowHtml(id, files[id], 0, ''); }).join('')
                      : '<div class="history-empty">No other files yet.</div>';
    return;
  }

  var byFolder = {},
      childFolders = {};

  ids.forEach(function(id)
  {
    var parent = files[id].folder || '';
    (byFolder[parent] = byFolder[parent] || []).push(id);
  });

  Object.keys(folders).forEach(function(path)
  {
    var parent = folders[path].parent || '';
    (childFolders[parent] = childFolders[parent] || []).push(path);
  });

  function renderLevel(parentPath, depth)
  {
    var html = '';

    (childFolders[parentPath] || []).slice().sort(function(a, b)
    {
      return folders[a].name.localeCompare(folders[b].name);
    })
    .forEach(function(path)
    {
      var collapsed = fileLinkCollapsed.has(path);

      html += '<div class="file-link-folder" style="margin-left:' + (depth * 16) + 'px" onclick="toggleFileLinkFolder(\'' + escAttr(path) + '\')">' +
                '<span class="folder-caret' + (collapsed ? '' : ' expanded') + '">' + CHEVRON_ICON + '</span>' +
                '<span class="file-icon">' + FOLDER_ICON + '</span>' +
                '<span class="file-link-item-name">' + escHtml(folders[path].name) + '</span>' +
              '</div>';

      if (!collapsed)
        html += renderLevel(path, depth + 1);
    });

    (byFolder[parentPath] || []).slice().sort(byName).forEach(function(id)
    {
      html += fileLinkRowHtml(id, files[id], depth, '');
    });

    return html;
  }

  list.innerHTML = renderLevel('', 0) || '<div class="history-empty">No other files yet.</div>';
}

function chooseFileLink(fileId)
{
  closeFileLinkModal();
  insertFileLink(fileId);
}

function insertFileLink(fileId)
{
  var target = files[fileId];

  if (!target)
    return;

  docTextUndo.forceSnapshot();

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart,
      selectionEnd = editor.selectionEnd,
      selection = editor.value.slice(selectionStart, selectionEnd),
      linkText = selection || target.name,
      markdown = '[' + linkText + '](' + FILE_LINK_SCHEME + encodeURIComponent(fileId) + ')';

  editor.value = editor.value.slice(0, selectionStart) + markdown + editor.value.slice(selectionEnd);
  editor.selectionStart = editor.selectionEnd = selectionStart + markdown.length;

  editor.focus();
  onEditorChange();
}

async function chooseFileEmbed(fileId)
{
  closeFileLinkModal();

  // In Work Folder mode, ensure content is loaded before embedding — file
  // content is lazy-loaded only on openFile, so an unvisited sheet would
  // otherwise embed with undefined content and show "No charts in: …".
  var f = files[fileId];
  if (f && workFolderRoot && !f.contentLoaded)
  {
    try
    {
      f.content = await Platform.readWorkFile(workFolderRoot, fileId);
      f.contentLoaded = true;
    }
    catch(e) { console.warn('Could not load file content for embed', e); }
  }

  insertFileEmbed(fileId);
}

function insertFileEmbed(fileId)
{
  var target = files[fileId];

  if (!target)
    return;

  docTextUndo.forceSnapshot();

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart,
      markdown = '![' + (target.name || '') + '](' + FILE_LINK_SCHEME + encodeURIComponent(fileId) + ')';

  editor.value = editor.value.slice(0, selectionStart) + markdown + editor.value.slice(selectionStart);
  editor.selectionStart = editor.selectionEnd = selectionStart + markdown.length;

  editor.focus();
  onEditorChange();
}

function parseSheetChartsFromContent(content)
{
  var lines = (content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'),
      dataStart = 0;

  if (lines[0] === '---')
  {
    var end = lines.indexOf('---', 1);
    dataStart = end + 2;
  }

  var cellLines = lines.slice(dataStart),
      chartsMarker = cellLines.indexOf('```charts');

  if (chartsMarker === -1) return [];

  var chartsEnd = cellLines.indexOf('```', chartsMarker + 1);

  if (chartsEnd === -1) return [];

  try { return JSON.parse(cellLines.slice(chartsMarker + 1, chartsEnd).join('\n')) || []; }
  catch(e) { return []; }
}

function parseSheetCellsForEmbed(content)
{
  var cells = {},
      lines = (content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'),
      dataStart = 0;

  if (lines[0] === '---')
  {
    var end = lines.indexOf('---', 1);
    dataStart = end + 2;
  }

  var cellLines = lines.slice(dataStart),
      chartsMarker = cellLines.indexOf('```charts');

  if (chartsMarker !== -1) cellLines = cellLines.slice(0, chartsMarker);

  // Multi-tab sheets: embeds show the FIRST page; a second `# name` heading
  // ends it (the first heading, if any, is just that page's name).
  var headingsSeen = 0, firstPageEnd = cellLines.length;
  for (var li = 0; li < cellLines.length; li++)
  {
    if (cellLines[li].charAt(0) === '#' && ++headingsSeen === 2) { firstPageEnd = li; break; }
  }
  cellLines = cellLines.slice(0, firstPageEnd);

  cellLines.forEach(function(line)
  {
    if (!line.trim()) return;
    var refEnd = line.indexOf('=');
    if (refEnd === -1) return;
    var ref = line.slice(0, refEnd),
        rest = line.slice(refEnd + 1),
        formulaEnd = rest.indexOf('=');
    cells[ref] = (formulaEnd === -1) ? rest : rest.slice(formulaEnd + 1);
  });

  return cells;
}

function getChartRangeGridFromCells(range, cells)
{
  var dims = parseChartRange(range);
  if (!dims) return null;
  var grid = [];
  for (var r = dims.rowStart; r <= dims.rowEnd; r++)
  {
    var row = [];
    for (var c = dims.colStart; c <= dims.colEnd; c++)
      row.push(cells[colName(c) + r] || '');
    grid.push(row);
  }
  return grid;
}

function buildChartDataFromCells(chartDef, cells)
{
  var grid = getChartRangeGridFromCells(chartDef.range, cells);
  if (!grid || !grid.length) return { labels: [], datasets: [] };
  if (chartDef.type === 'scatter') return buildScatterChartData(chartDef, grid);
  var data = buildCategoricalChartData(chartDef, grid);
  if (chartDef.type === 'pie' || chartDef.type === 'doughnut') data.datasets = data.datasets.slice(0, 1);
  if (chartDef.type === 'percent')
    data = percentStackDatasets(data, chartDef);
  return data;
}

function buildChartJsConfigFromCells(chartDef, cells)
{
  var data = buildChartDataFromCells(chartDef, cells),
      isPie = (chartDef.type === 'pie' || chartDef.type === 'doughnut'),
      baseType = (chartDef.type === 'combo' || chartDef.type === 'percent') ? 'bar' : chartDef.type;

  var datasets = data.datasets.map(function(ds, i)
  {
    var color = CHART_COLORS[i % CHART_COLORS.length],
        styled =
        {
          label: ds.label,
          data: ds.data,
          backgroundColor: isPie ? ds.data.map(function(_, j){ return CHART_COLORS[j % CHART_COLORS.length]; }) : color,
          borderColor: color,
          borderWidth: (chartDef.type === 'line' || chartDef.type === 'radar') ? 2 : 1
        };

    if (chartDef.type === 'combo') styled.type = (i === 0) ? 'bar' : 'line';

    if (chartDef.type === 'line' || chartDef.type === 'radar' || (chartDef.type === 'combo' && i > 0))
    {
      styled.fill = false;
      styled.tension = 0.25;
    }

    return styled;
  });

  return  {
            type: baseType,
            data: { labels: data.labels, datasets: datasets },
            options:
            {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              plugins:
              {
                title: { display: !!chartDef.title, text: chartDef.title, color: '#f0ede6' },
                legend: { display: datasets.length > 1 || isPie, labels: { color: '#9e9b94' } }
              },
              scales: isPie ? {} : buildChartScales(chartDef)
            }
          };
}

function renderEmbeddedSheetCharts(container)
{
  if (typeof Chart === 'undefined') return;

  var embeds = container.querySelectorAll('.embed-sheet-chart[data-chart-config]');

  embeds.forEach(function(div)
  {
    try
    {
      var config = JSON.parse(div.getAttribute('data-chart-config')),
          canvas = div.querySelector('canvas');

      if (canvas) new Chart(canvas.getContext('2d'), config);
    }
    catch(e) { console.warn('Embedded chart render error', e); }
  });
}

document.getElementById('preview-content').addEventListener
(
  'click',
  function(e)
  {
    var link = e.target.closest('a');

    if (!link)
      return;

    var href = link.getAttribute('href') || '';

    if (href.indexOf(FILE_LINK_SCHEME) !== 0)
      return;

    e.preventDefault();

    var id = decodeURIComponent(href.slice(FILE_LINK_SCHEME.length));

    if (!files[id])
    {
      alert('That file no longer exists, or was renamed/moved.');
      return;
    }

    openFile(id);
  }
);

function toggleDocCheckbox(idx)
{
  var editor = document.getElementById('editor'),
      count = 0,
      newText = editor.value.replace(/^(\s*[-*+]\s+)\[([ xX])\]/gm, function(m, prefix, state)
      {
        if (count === idx)
        {
          count++;
          return prefix + '[' + (state.trim() === '' ? 'x' : ' ') + ']';
        }
        count++;
        return m;
      });

  if (newText !== editor.value)
  {
    docTextUndo.forceSnapshot();
    editor.value = newText;
    onEditorChange();
  }
}

document.getElementById('preview-content').addEventListener
(
  'change',
  function(e)
  {
    if (!e.target.classList.contains('preview-checkbox'))
      return;
    toggleDocCheckbox(parseInt(e.target.getAttribute('data-idx'), 10));
  }
);

// Alignment blocks are written with a bare symbol (no keyword) repeated on
// the opening and closing line - :: for left, ::: for right, ;; for center,
// ;;; for justify. Anything else (currently just font="...") still uses the
// older ":::keyword ... :::" form, unchanged.
var ALIGN_BLOCK_SYMBOLS = { left: '::', right: ':::', center: ';;', justify: ';;;' };

function wrapBlock(align)
{
  docTextUndo.forceSnapshot();

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart,
      selectionEnd = editor.selectionEnd,
      selection = editor.value.slice(selectionStart, selectionEnd) || 'Text',
      symbol = ALIGN_BLOCK_SYMBOLS[align];

  var block = '\n' + symbol + '\n' + selection + '\n' + symbol + '\n';

  editor.value = editor.value.slice(0, selectionStart) + block + editor.value.slice(selectionEnd);
  editor.selectionStart = editor.selectionEnd = selectionStart + block.length;

  editor.focus();
  onEditorChange();
}

// Font blocks use their own bare-symbol scheme (see fontSymbolBlock above) -
// || followed directly by the font name, no "font=" keyword, no quotes,
// closed by a bare ||.
function wrapFontBlock(fontName)
{
  docTextUndo.forceSnapshot();

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart,
      selectionEnd = editor.selectionEnd,
      selection = editor.value.slice(selectionStart, selectionEnd) || 'Text';

  var block = '\n||' + fontName + '\n' + selection + '\n||\n';

  editor.value = editor.value.slice(0, selectionStart) + block + editor.value.slice(selectionEnd);
  editor.selectionStart = editor.selectionEnd = selectionStart + block.length;

  editor.focus();
  onEditorChange();
}

function insertTOC()
{
  docTextUndo.forceSnapshot();

  var editor = document.getElementById('editor'),
      selectionStart = editor.selectionStart,
      lineStart = editor.value.lastIndexOf('\n', selectionStart - 1) + 1,
      marker = '[TOC]\n\n';

  editor.value = editor.value.slice(0, lineStart) + marker + editor.value.slice(lineStart);
  editor.selectionStart = editor.selectionEnd = lineStart + marker.length;

  editor.focus();
  onEditorChange();
}

// ── FONT PICKER ──
// Prefers the real fonts installed on the user's machine via the Local Font
// Access API (window.queryLocalFonts - Chromium/WebView2, requires a user
// gesture and a one-time permission grant), falling back to a static list
// of the fonts that ship with Windows when that API is unavailable, denied,
// or fails for any other reason.
var FALLBACK_FONT_LIST =
[
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
  'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium',
  'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Ink Free', 'Javanese Text', 'Leelawadee UI',
  'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Microsoft Himalaya',
  'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa', 'Microsoft Sans Serif',
  'Microsoft Tai Le', 'Microsoft Yahei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti',
  'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe Print',
  'Segoe Script', 'Segoe UI', 'Segoe UI Historic', 'SimSun', 'Sitka', 'Sylfaen', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana', 'Yu Gothic',
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'
];

var cachedFontList = null,
    fontPickerSelection = null;

async function getAvailableFonts()
{
  if (cachedFontList)
    return cachedFontList;

  var names = null;

  // queryLocalFonts() only exists in a secure context (HTTPS, or literally
  // "localhost") in Chromium browsers, so on a plain-http deployment - or
  // any non-Chromium browser - this silently has nothing to offer; the
  // account's uploaded fonts (merged in below) are the reliable path that
  // works the same way everywhere.
  if (typeof window.queryLocalFonts === 'function')
  {
    try
    {
      var fonts = await window.queryLocalFonts(),
          seen = {};

      names = [];

      fonts.forEach(function(f)
      {
        if (!seen[f.family])
        {
          seen[f.family] = true;
          names.push(f.family);
        }
      });

      names.sort(function(a, b){ return a.localeCompare(b); });
    }
    catch(e)
    {
      console.warn('Local Font Access unavailable, falling back to the standard font list', e);
      names = null;
    }
  }

  var baseNames = (names && names.length) ? names : FALLBACK_FONT_LIST.slice();

  if (customFontsCache === null) await refreshCustomFonts();
  var customNames = (customFontsCache || []).map(function(f){ return f.familyName; });

  // Custom (uploaded, always-renders-correctly) fonts first, then whatever
  // the OS/fallback list contributed, deduped.
  var seenNames = {}, merged = [];
  customNames.concat(baseNames).forEach(function(n)
  {
    var key = n.toLowerCase();
    if (!seenNames[key]) { seenNames[key] = true; merged.push(n); }
  });

  cachedFontList = merged;
  return cachedFontList;
}

// Changes the font of the current selection, akin to LaTeX's \fontspec/\setfont commands.
// A selection spanning multiple paragraphs becomes a ":::" block (own font for the whole passage);
// a single-line/inline selection becomes a "[text]{font="..."}" span (own font for that phrase only).
async function applyFont()
{
  var editor = document.getElementById('editor');

  fontPickerSelection = { selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd };

  document.getElementById('font-picker-search').value = '';
  document.getElementById('font-picker-list').innerHTML = '<div class="history-empty">Loading fonts…</div>';
  document.getElementById('font-picker-modal').classList.add('open');
  document.getElementById('font-picker-search').focus();

  fontPickerSelection.fonts = await getAvailableFonts();
  renderFontPickerList();
}

function closeFontPickerModal()
{
  document.getElementById('font-picker-modal').classList.remove('open');
}

document.getElementById('font-picker-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('font-picker-modal'))
      closeFontPickerModal();
  }
);

function renderFontPickerList()
{
  var query = document.getElementById('font-picker-search').value.trim().toLowerCase(),
      list = document.getElementById('font-picker-list'),
      fonts = (fontPickerSelection && fontPickerSelection.fonts) || [],
      matches = fonts.filter(function(f){ return !query || f.toLowerCase().indexOf(query) !== -1; });

  if (!matches.length)
  {
    list.innerHTML = '<div class="history-empty">No matching fonts.</div>';
    return;
  }

  list.innerHTML = matches.map(function(f)
  {
    return  '<div class="font-picker-item" style="font-family:' + escHtml(cssFontFamilyValue(f)) + ';" onclick="chooseFontFromPicker(\'' + escAttr(f) + '\')">' +
              escHtml(f) +
            '</div>';
  }).join('');
}

function chooseFontFromPicker(fontName)
{
  closeFontPickerModal();

  var editor = document.getElementById('editor'),
      selectionStart = fontPickerSelection.selectionStart,
      selectionEnd = fontPickerSelection.selectionEnd,
      selection = editor.value.slice(selectionStart, selectionEnd);

  editor.selectionStart = selectionStart;
  editor.selectionEnd = selectionEnd;

  if (selection && !/\n[ \t]*\n/.test(selection))
    wrapSelectedText('[', ']{font="' + fontName + '"}');

  else
    wrapFontBlock(fontName);
}

function setView(newView)
{
  editorView = newView;

  document.getElementById('editor-area').className = (newView === 'write')
                                                      ?
                                                        ''
                                                      :
                                                        newView;

  ['write', 'split', 'preview'].forEach(
    function(view)
    {
      document.getElementById('vbtn-'+ view).classList.toggle('active', view === newView);
    }
  );

  if (newView !== 'write')
    updatePreview();
}

document.getElementById('editor').addEventListener('dblclick', function()
{
  if (editorView !== 'split') return;
  var text = this.value,
      cursorLine = text.slice(0, this.selectionStart).split('\n').length,
      totalLines = text.split('\n').length || 1,
      pp = document.getElementById('preview-pane');
  pp.scrollTop = (cursorLine / totalLines) * (pp.scrollHeight - pp.clientHeight);
});

document.getElementById('preview-pane').addEventListener('dblclick', function(e)
{
  if (editorView !== 'split') return;
  var pp = this,
      ratio = (pp.scrollTop + e.clientY - pp.getBoundingClientRect().top) / pp.scrollHeight,
      editor = document.getElementById('editor');
  editor.scrollTop = ratio * (editor.scrollHeight - editor.clientHeight);
});
