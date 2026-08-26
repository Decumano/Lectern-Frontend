// Native spell checking
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── SPELL CHECKING (native corrector) ──
//
// Uses the spell checker built into the browser / OS webview (red squiggles +
// right-click suggestions), so no dictionary ships with the app. The language
// select writes a `lang` attribute onto every editing surface, which is the
// standard hint engines (WebView2, Firefox, Chromium with multiple dictionaries
// enabled) use to pick the dictionary. Text fields created later (modal forms
// are built from innerHTML) are covered by the focusin delegate below.

var spellPrefs = { enabled: true, lang: '' };

var SPELL_LANGS = [
  ['',      'System default'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['es-ES', 'Español'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'],
  ['pt-PT', 'Português'],
  ['pt-BR', 'Português (Brasil)'],
  ['ca-ES', 'Català'],
  ['nl-NL', 'Nederlands'],
  ['pl-PL', 'Polski'],
  ['sv-SE', 'Svenska'],
  ['da-DK', 'Dansk'],
  ['nb-NO', 'Norsk'],
  ['fi-FI', 'Suomi'],
  ['cs-CZ', 'Čeština'],
  ['ro-RO', 'Română'],
  ['hu-HU', 'Magyar'],
  ['tr-TR', 'Türkçe'],
  ['el-GR', 'Ελληνικά'],
  ['ru-RU', 'Русский'],
  ['uk-UA', 'Українська']
];

function spellApplyTo(el)
{
  if (!el)
    return;

  el.spellcheck = !!spellPrefs.enabled;

  if (spellPrefs.lang)
    el.setAttribute('lang', spellPrefs.lang);
  else
    el.removeAttribute('lang');
}

function isSpellcheckable(el)
{
  if (!el || !el.tagName)
    return false;

  var tag = el.tagName.toLowerCase();

  return tag === 'textarea' ||
         (tag === 'input' && (!el.type || el.type === 'text' || el.type === 'search')) ||
         el.isContentEditable;
}

function applySpellcheckPrefs()
{
  // The document language doubles as the fallback hint for fields the
  // delegate hasn't touched yet.
  if (spellPrefs.lang)
    document.documentElement.setAttribute('lang', spellPrefs.lang);
  else
    document.documentElement.setAttribute('lang', navigator.language || 'en');

  document.querySelectorAll('textarea, input[type="text"], input:not([type]), input[type="search"], [contenteditable="true"]')
    .forEach(spellApplyTo);
}

document.addEventListener('focusin', function(e)
{
  if (isSpellcheckable(e.target))
    spellApplyTo(e.target);
});

function onSpellPrefsChange()
{
  var enabledEl = document.getElementById('settings-spell-enabled'),
      langEl    = document.getElementById('settings-spell-lang');

  spellPrefs.enabled = !!(enabledEl && enabledEl.checked);
  spellPrefs.lang    = langEl ? langEl.value : '';

  saveSettings();
  applySpellcheckPrefs();
}

var DOC_TEMPLATES =
{
  character: '{type: Character, status: Active, faction: Unknown, race: Unknown}\n\n#character\n\n## Background\n\n## Personality\n\n## Relationships\n\n## Notes\n',
  faction:   '{type: Faction, status: Active, alignment: Neutral, size: Unknown}\n\n#faction\n\n## Overview\n\n## Goals\n\n## Members\n\n## Rivals\n',
  location:  '{type: Location, region: Unknown, climate: Unknown, status: Active}\n\n#location\n\n## Description\n\n## Points of Interest\n\n## Inhabitants\n\n## History\n',
  event:     '{type: Event, era: Unknown, date: Unknown, outcome: Unknown}\n\n#event\n\n## Summary\n\n## Participants\n\n## Consequences\n\n## Notes\n',
  region:    '{type: Region, climate: Unknown, culture: Unknown, status: Active, ruler: Unknown}\n\n#region\n\n## Overview\n\n## Climate & Geography\n\n## Culture & Society\n\n## Political Status\n\n## Key NPCs\n\n## Linked Events\n\n## Notes\n'
};

function defaultContentForType(type, name)
{
  if (type === 'sheet')
    return '---\ntype: spreadsheet\n---\n\n';

  if (type === 'graph')
    return '<!-- type: graph -->\n\n```mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Continue]\n    B -->|No| D[Stop]\n```\n';

  if (type === 'notebook')
    return serializeNotebookData(defaultNotebookData());

  // The JSON-backed apps embed a display title; seed it with the name the
  // user gave the file so the first save doesn't rename the file to a
  // canned default.
  if (type === 'glossary')
    return JSON.stringify({ name: name || 'My Glossary', entries: [], roots: [] }, null, 2);

  if (type === 'calendar')
    return JSON.stringify({
      name: name || 'My Calendar',
      daysPerYear: 365,
      epochFictionYear: 1,
      epochRealDate: new Date().toISOString().slice(0, 10),
      seasons: [
        { id: 's1', name: 'Spring', color: '#7a9e6a', monthIds: [] },
        { id: 's2', name: 'Summer', color: '#e8a832', monthIds: [] },
        { id: 's3', name: 'Autumn', color: '#c4621a', monthIds: [] },
        { id: 's4', name: 'Winter', color: '#4a9fc8', monthIds: [] }
      ],
      months: [],
      holidays: []
    }, null, 2);

  if (type === 'economy')
    return JSON.stringify({ name: name || 'Economy Notes', currencies: [], exchangeRates: [], tradeGoods: [], regions: [] }, null, 2);

  if (type === 'bestiary')
    return JSON.stringify({ name: name || 'My Bestiary', beasts: [] }, null, 2);

  return '';
}

function createFile(name, type, content)
{
  const fileId = 'f_' + Date.now();

  if (content === undefined)
    content = defaultContentForType(type, name);

  files[fileId] =
  {
    name, type, content, modified: Date.now()
  };

  saveToStorage();

  return fileId;
}

// Strips characters that are illegal in filenames on Windows (a superset of
// what's illegal on macOS/Linux), so a display name can double as a real
// on-disk filename without surprising the user when they open the folder.
function sanitizeFileName(name)
{
  return String(name || '')
          .trim()
          .replace(/[\\/:*?"<>|]/g, '_')
          .replace(/\.+$/, '')
          .trim();
}

// Finds a rel_path that isn't already taken by another file, suffixing " (2)",
// " (3)", etc. on collision - except a candidate matching excludeRelPath itself
// is always accepted, so re-saving a file under its own current name is a no-op.
function uniqueRelPath(folder, baseName, ext, excludeRelPath)
{
  var prefix = folder ? folder + '/' : '',
      candidate = prefix + baseName + '.' + ext,
      n = 2;

  while (files[candidate] && candidate !== excludeRelPath)
  {
    candidate = prefix + baseName + ' (' + n + ').' + ext;
    n++;
  }

  return candidate;
}

function uniqueFolderRelPath(parent, baseName, excludeRelPath)
{
  var prefix = parent ? parent + '/' : '',
      candidate = prefix + baseName,
      n = 2;

  while (folders[candidate] && candidate !== excludeRelPath)
  {
    candidate = prefix + baseName + ' (' + n + ')';
    n++;
  }

  return candidate;
}

function fileTypeIcon(type)
{
  if (type === 'sheet')
    return  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
              '<rect x="3" y="3" width="18" height="18" rx="2"/>'+
              '<line x1="3" y1="9" x2="21" y2="9"/>'+
              '<line x1="3" y1="15" x2="21" y2="15"/>'+
              '<line x1="9" y1="3" x2="9" y2="21"/>'+
              '<line x1="15" y1="3" x2="15" y2="21"/>'+
            '</svg>';

  if (type === 'graph')
    return  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
              '<circle cx="6" cy="6" r="3"/>'+
              '<circle cx="6" cy="18" r="3"/>'+
              '<circle cx="18" cy="12" r="3"/>'+
              '<line x1="8.5" y1="7.5" x2="15.5" y2="10.5"/>'+
              '<line x1="8.5" y1="16.5" x2="15.5" y2="13.5"/>'+
            '</svg>';

  if (type === 'notebook')
    return  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
              '<rect x="4" y="3" width="16" height="18" rx="2"/>'+
              '<line x1="8" y1="3" x2="8" y2="21"/>'+
              '<line x1="12" y1="8" x2="17" y2="8"/>'+
              '<line x1="12" y1="12" x2="17" y2="12"/>'+
              '<line x1="12" y1="16" x2="15" y2="16"/>'+
            '</svg>';

  if (type === 'glossary')
    return  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
              '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>'+
              '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'+
              '<line x1="9" y1="8" x2="16" y2="8"/>'+
              '<line x1="9" y1="12" x2="14" y2="12"/>'+
            '</svg>';

  if (type === 'bestiary')
    return  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
              '<circle cx="5.5" cy="10" r="1.6"/>'+
              '<circle cx="9.5" cy="6.5" r="1.6"/>'+
              '<circle cx="14.5" cy="6.5" r="1.6"/>'+
              '<circle cx="18.5" cy="10" r="1.6"/>'+
              '<path d="M12 11c-2.6 0-5.5 2.6-5.5 5a3 3 0 0 0 3 3c1 0 1.7-.5 2.5-.5s1.5.5 2.5.5a3 3 0 0 0 3-3c0-2.4-2.9-5-5.5-5z"/>'+
            '</svg>';

  if (type === 'calendar')
    return  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
              '<rect x="3" y="4" width="18" height="18" rx="2"/>'+
              '<line x1="16" y1="2" x2="16" y2="6"/>'+
              '<line x1="8" y1="2" x2="8" y2="6"/>'+
              '<line x1="3" y1="10" x2="21" y2="10"/>'+
            '</svg>';

  if (type === 'economy')
    return  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
              '<circle cx="12" cy="12" r="9"/>'+
              '<path d="M14.8 9A2 2 0 0 0 13 8h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2a2 2 0 0 1-1.8-1"/>'+
              '<line x1="12" y1="6" x2="12" y2="8"/>'+
              '<line x1="12" y1="16" x2="12" y2="18"/>'+
            '</svg>';

  return  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'+
            '<polyline points="14,2 14,8 20,8"/>'+
          '</svg>';
}

function fileExtensionFor(type)
{
  if (type === 'sheet')    return 'mds';
  if (type === 'notebook') return 'mdn';
  if (type === 'graph')    return 'mdg';
  if (type === 'glossary') return 'mdl';
  if (type === 'calendar') return 'mdc';
  if (type === 'economy')  return 'mde';
  if (type === 'bestiary') return 'mdb';
  return 'mdp';
}

var FOLDER_ICON =  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
                      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>'+
                    '</svg>';

var EMPTY_FILE_LIST_HTML =  '<div style="padding: 20px 12px; text-align: center; color: var(--text3); font-size: 12px;">' +
                              'No files yet.<br>Click <strong style="color:var(--accent)">+ New</strong> to start.' +
                            '</div>';

var CHEVRON_ICON =  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'+
                       '<polyline points="9,6 15,12 9,18"/>'+
                     '</svg>';

function fileRowHtml(id, f, depth)
{
  const active = (id === currentFileId),
        icon = fileTypeIcon(f.type),
        date = new Date(f.modified).toLocaleDateString(undefined,{month:'short',day:'numeric'}),
        indent = depth ? (' style="padding-left:' + (12 + depth * 16) + 'px;"') : '',
        safeId = escAttr(id);

  const tagChips = fileTagsOf(f).map(function(t){
    return '<span class="file-tag" onclick="event.stopPropagation();sidebarTagFilter(\'' + escAttr(t) + '\')">#' + escHtml(t) + '</span>';
  }).join('');

  return  '<div class="file-item ' + (active?'active':'') + '"' + indent + ' data-id="' + escHtml(id) + '"' +
            ' draggable="true" ondragstart="handleDragStart(event,\'' + safeId + '\')" ondragend="handleDragEnd(event)"' +
            ' onclick="openFile(\'' + safeId + '\')" oncontextmenu="openContextMenu(event,\'file\',\'' + safeId + '\')">' +
            '<span class="file-icon">' +
              icon +
            '</span>' +
            '<div class="file-info">'+
              '<div class="file-name" ondblclick="startInlineRename(event,this,\'' + safeId + '\')">' +
                escHtml(f.name) +
              '</div>'+
              '<div class="file-meta">' +
                date + tagChips +
              '</div>'+
            '</div>'+
            '<span class="file-del" onclick="deleteFile(event,\'' + safeId + '\')">'+
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'+
                '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'+
              '</svg>'+
            '</span>'+
          '</div>';
}

function folderRowHtml(path, depth)
{
  const expanded = expandedFolders.has(path),
        indent = 12 + depth * 16,
        safePath = escAttr(path);

  return  '<div class="folder-item" style="padding-left:' + indent + 'px;" data-id="' + escHtml(path) + '"' +
            ' draggable="true" ondragstart="handleDragStart(event,\'' + safePath + '\')" ondragend="handleDragEnd(event)"' +
            ' ondragenter="handleDragEnter(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event,\'' + safePath + '\')"' +
            ' onclick="toggleFolderExpanded(\'' + safePath + '\')" oncontextmenu="openContextMenu(event,\'folder\',\'' + safePath + '\')">' +
            '<span class="folder-caret ' + (expanded ? 'expanded' : '') + '">' + CHEVRON_ICON + '</span>' +
            '<span class="file-icon">' + FOLDER_ICON + '</span>' +
            '<div class="file-info">'+
              '<div class="file-name" ondblclick="startInlineRename(event,this,\'' + safePath + '\')">' +
                escHtml(folders[path].name) +
              '</div>'+
            '</div>'+
            '<span class="file-del" onclick="deleteFolderEntry(event,\'' + safePath + '\')">'+
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'+
                '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'+
              '</svg>'+
            '</span>'+
          '</div>';
}

function renderFileList()
{
  const fileList = document.getElementById('file-list');

  var _searchQ = sidebarSearch.trim().toLowerCase();

  // "#tag" filters by tag: file-level tags on the JSON data apps, and inline
  // #hashtags in Documents (which carry them in the markdown itself).
  var _tagQ = null;
  if (_searchQ.charAt(0) === '#')
  {
    _tagQ = _searchQ.slice(1).trim();
    _searchQ = '';
  }

  const filesOfType = Object.entries(files).filter(function(entry)
  {
    var f = entry[1];
    if (entry[0] === SHARED_TMP_ID) return false; // shared files live in their own sidebar section
    if (f.type !== currentAppType) return false;
    if (_tagQ)
    {
      if (fileTagsOf(f).some(function(t){ return t.toLowerCase() === _tagQ; })) return true;
      return !!(f.content && f.content.toLowerCase().indexOf('#' + _tagQ) !== -1);
    }
    if (!_searchQ) return true;
    if (f.name.toLowerCase().indexOf(_searchQ) !== -1) return true;
    if (fileTagsOf(f).some(function(t){ return t.toLowerCase().indexOf(_searchQ) !== -1; })) return true;
    if (f.content && f.content.toLowerCase().indexOf(_searchQ) !== -1) return true;
    return false;
  });

  renderOpenTabs(); // names/active state shown in the tab bar change on the same events

  if (Object.keys(folders).length === 0)
  {
    filesOfType.sort((a, b) => b[1].modified - a[1].modified);

    fileList.innerHTML = filesOfType.length
                          ?
                            filesOfType.map(([id, f]) => fileRowHtml(id, f, 0)).join('')
                          :
                            EMPTY_FILE_LIST_HTML;
    return;
  }

  const byFolder = {};

  filesOfType.forEach(function(entry)
  {
    const folder = entry[1].folder || '';
    (byFolder[folder] = byFolder[folder] || []).push(entry);
  });

  const childFolders = {};

  Object.keys(folders).forEach(function(path)
  {
    const parent = folders[path].parent || '';
    (childFolders[parent] = childFolders[parent] || []).push(path);
  });

  function renderLevel(parentPath, depth)
  {
    let html = '';

    const subFolders = (childFolders[parentPath] || []).slice().sort(function(a, b)
    {
      return folders[a].name.localeCompare(folders[b].name);
    });

    subFolders.forEach(function(path)
    {
      html += folderRowHtml(path, depth);

      if (expandedFolders.has(path))
        html += renderLevel(path, depth + 1);
    });

    const filesHere = (byFolder[parentPath] || []).slice().sort(function(a, b)
    {
      return b[1].modified - a[1].modified;
    });

    filesHere.forEach(function(entry)
    {
      html += fileRowHtml(entry[0], entry[1], depth);
    });

    return html;
  }

  fileList.innerHTML = renderLevel('', 0) || EMPTY_FILE_LIST_HTML;
}

function onSidebarSearch(value)
{
  sidebarSearch = value;
  onGlobalSearch(value);
}

function filterByTag(tag)
{
  if (currentAppType !== 'doc')
    switchAppType('doc');
  sidebarSearch = '#' + tag;
  var inp = document.getElementById('sidebar-search');
  if (inp) inp.value = sidebarSearch;
  renderFileList();
}

// Tag chip on a sidebar file row: filter the current app's list by that tag.
function sidebarTagFilter(tag)
{
  sidebarSearch = '#' + tag;
  var inp = document.getElementById('sidebar-search');
  if (inp) inp.value = sidebarSearch;
  onGlobalSearch(sidebarSearch);
}
