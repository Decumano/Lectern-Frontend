// Modals, templates, import/export, enabled apps, theme, fonts
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── MODAL ──
function fOpenNewModal()
{
  newFileType = currentAppType;
  newDocTemplate = 'blank';

  document.getElementById('new-modal').classList.add('open');
  document.getElementById('new-name').value = '';

  var tplRow = document.getElementById('doc-template-row');
  if (tplRow) tplRow.style.display = (newFileType === 'doc') ? '' : 'none';

  document.querySelectorAll('.doc-tpl-card').forEach(function(c)
  {
    c.classList.toggle('selected', c.dataset.tpl === 'blank');
  });

  // Re-read the template store every time: another device may have synced
  // new templates since the last look.
  customTemplates = null;
  fLoadCustomTemplates().then(fRenderDocTemplateRow);

  setTimeout
  (
    function()
    {
      document.getElementById('new-name').focus();
    },
    50
  );

  document.querySelectorAll('.type-card').forEach
  (
    function(card)
    {
      card.classList.toggle('selected', card.dataset.type === newFileType);
    }
  );
}

function fCloseNewModal()
{
  document.getElementById('new-modal').classList.remove('open');
}

function fSelectNewType(type, el)
{
  newFileType = type;

  document.querySelectorAll('.type-card').forEach
  (
    function(c)
    {
      c.classList.remove('selected');
    }
  );

  el.classList.add('selected');

  var tplRow = document.getElementById('doc-template-row');
  if (tplRow) tplRow.style.display = (type === 'doc') ? '' : 'none';
}

function fSelectDocTemplate(tpl, el)
{
  newDocTemplate = tpl;
  document.querySelectorAll('.doc-tpl-card').forEach(function(c) { c.classList.remove('selected'); });
  el.classList.add('selected');
}

// ── CUSTOM TEMPLATES ──
// User-made document templates, alongside the built-in DOC_TEMPLATES. Stored
// as a `_lktpl.json` sidecar in the work folder (same pattern as the
// `_lkbl.json` backlinks index, so it works on web and desktop alike and
// never shows up in the file tree), or localStorage when no folder is open.

var customTemplates = null; // { name: content }, lazily loaded
var customTplKeys = [];     // sorted names; template ids are 'custom:<index>'

async function fLoadCustomTemplates()
{
  if (customTemplates !== null)
    return customTemplates;

  if (workFolderRoot)
  {
    try { customTemplates = JSON.parse(await Platform.fReadWorkFile(workFolderRoot, '_lktpl.json')) || {}; }
    catch(e) { customTemplates = {}; }
  }
  else
  {
    try { customTemplates = JSON.parse(localStorage.getItem('lk_custom_templates')) || {}; }
    catch(e) { customTemplates = {}; }
  }
  return customTemplates;
}

async function fPersistCustomTemplates()
{
  if (workFolderRoot)
  {
    try { await Platform.fWriteWorkFile(workFolderRoot, '_lktpl.json', JSON.stringify(customTemplates, null, 2)); }
    catch(e) { console.warn('Template store write error', e); }
  }
  else
  {
    try { localStorage.setItem('lk_custom_templates', JSON.stringify(customTemplates)); }
    catch(e) { console.warn('Template store write error', e); }
  }
}

function fRenderDocTemplateRow()
{
  var grid = document.querySelector('#doc-template-row .doc-tpl-grid');
  if (!grid) return;

  grid.querySelectorAll('.doc-tpl-custom').forEach(function(c){ c.remove(); });

  customTplKeys = Object.keys(customTemplates || {}).sort(function(a, b){ return a.localeCompare(b); });
  customTplKeys.forEach(function(name, i)
  {
    var card = document.createElement('div');
    card.className = 'doc-tpl-card doc-tpl-custom';
    card.dataset.tpl = 'custom:' + i;
    card.title = name;
    card.appendChild(document.createTextNode(name));
    card.onclick = function(){ fSelectDocTemplate('custom:' + i, card); };

    var del = document.createElement('button');
    del.className = 'doc-tpl-del';
    del.title = 'Delete this template';
    del.textContent = '×';
    del.onclick = function(ev){ fDeleteCustomTemplate(ev, name); };
    card.appendChild(del);

    grid.appendChild(card);
  });
}

async function fDeleteCustomTemplate(ev, name)
{
  ev.stopPropagation();
  delete customTemplates[name];
  await fPersistCustomTemplates();

  // If the deleted template was selected, fall back to Blank.
  if (newDocTemplate.indexOf('custom:') === 0 && customTplKeys[parseInt(newDocTemplate.slice(7), 10)] === name)
  {
    newDocTemplate = 'blank';
    document.querySelectorAll('.doc-tpl-card').forEach(function(c)
    {
      c.classList.toggle('selected', c.dataset.tpl === 'blank');
    });
  }
  fRenderDocTemplateRow();
}

function fCustomTemplateContent(tplId)
{
  var name = customTplKeys[parseInt(tplId.slice(7), 10)];
  return name !== undefined ? (customTemplates || {})[name] : undefined;
}

function fHandleFileMenuSaveTemplate()
{
  fCloseFileMenu();

  var f = currentFileId && files[currentFileId];
  if (!f || f.type !== 'doc')
  {
    alert('Open a Document first — templates are created from the currently open Document.');
    return;
  }

  fOpenDataModal
  (
    'Save as template',
    '<label class="field-label">Template name<input class="modal-input" id="tpl-name" value="' + fEscAttr(f.name || 'My template') + '"></label>' +
    '<div style="color:var(--text3);font-size:12px;margin-top:8px">The current contents of &ldquo;' + fEscHtml(f.name) + '&rdquo; will appear as a template choice in the New File dialog. Saving under an existing name replaces that template.</div>',
    async function()
    {
      var name = document.getElementById('tpl-name').value.trim();
      if (!name) return;
      await fLoadCustomTemplates();
      customTemplates[name] = f.content || '';
      await fPersistCustomTemplates();
      fCloseDataModal();
    }
  );
}

async function fCreateNewFile()
{
  var name = document.getElementById('new-name').value.trim() || 'Untitled';
  var tplContent;
  if (newFileType === 'doc' && newDocTemplate !== 'blank')
  {
    tplContent = newDocTemplate.indexOf('custom:') === 0
                 ? fCustomTemplateContent(newDocTemplate)
                 : (cDocTemplates[newDocTemplate] || undefined);
  }

  fCloseNewModal();

  if (workFolderRoot)
  {
    var workId = await fCreateWorkFile(name, newFileType, tplContent);

    if (!workId)
      return;

    fSwitchAppType(newFileType);
    await fOpenFile(workId);
    return;
  }

  var id = fCreateFile(name, newFileType, tplContent);

  fSwitchAppType(newFileType);
  fOpenFile(id);
}

document.getElementById('new-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('new-modal'))
      fCloseNewModal();
  }
);

// ── EXPORT / IMPORT ──
async function fExportCurrent()
{
  if (!currentFileId)
  {
    alert('No file open.');
    return;
  }

  var f = files[currentFileId],
      ext = fFileExtensionFor(f.type);

  var fileName = f.name.replace(/\s+/g,'_') + '.' + ext;

  try
  {
    var saved = await Platform.fSaveFile(fileName, f.content);

    if (!saved)
      return;
  }
  catch(e)
  {
    console.warn('Save error', e);
    alert('Could not save file.');
  }
}

function fToggleFileMenu(clickEvent)
{
  clickEvent.stopPropagation();

  var menu = document.getElementById('file-menu');
  if (!menu) return;

  var opening = !menu.classList.contains('open');
  if (!opening)
    document.getElementById('export-as-submenu').classList.remove('open');

  menu.classList.toggle('open');

  if (opening)
  {
    var btn  = document.getElementById('file-menu-btn');
    var rect = btn.getBoundingClientRect();
    menu.style.left   = Math.max(4, rect.left) + 'px';
    menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    menu.style.top    = 'auto';
  }
}

function fToggleExportAsSubmenu(clickEvent)
{
  clickEvent.stopPropagation();

  var submenu = document.getElementById('export-as-submenu');

  if (submenu)
    submenu.classList.toggle('open');
}

function fCloseFileMenu()
{
  var menu = document.getElementById('file-menu'),
      submenu = document.getElementById('export-as-submenu');

  if (menu)
    menu.classList.remove('open');

  if (submenu)
    submenu.classList.remove('open');
}

document.addEventListener
(
  'click',
  function(clickEvent)
  {
    var menu = document.getElementById('file-menu');

    if (!menu || !menu.classList.contains('open'))
      return;

    if (menu.contains(clickEvent.target) || clickEvent.target.closest('#file-menu-btn'))
      return;

    fCloseFileMenu();
  }
);

function fHandleFileMenuExport()
{
  fCloseFileMenu();
  fExportCurrent();
}

function fHandleFileMenuExportAs(format)
{
  fCloseFileMenu();
  fExportCurrentAs(format);
}

function fHandleFileMenuImport()
{
  fCloseFileMenu();
  fTriggerImport();
}

function fHandleFileMenuSettings()
{
  fCloseFileMenu();
  fOpenSettingsModal();
}

// ── ENABLED TYPES ──

var enabledTypes = null;
var cAllAppTypes = ['doc','sheet','graph','slides','notebook','glossary','calendar','economy','bestiary'];

// The types that existed when lk_known_types started being recorded. A saved
// list of enabled types only says which of the *known* types were switched
// off, so a type added later starts enabled instead of silently hidden.
var cOriginalAppTypes = ['doc','sheet','graph','notebook','glossary','calendar','economy','bestiary'];

function fGetEnabledTypes()
{
  if (!enabledTypes)
  {
    try
    {
      var saved = localStorage.getItem('lk_enabled_types');
      enabledTypes = saved ? JSON.parse(saved) : null;

      if (enabledTypes)
      {
        var knownRaw = localStorage.getItem('lk_known_types'),
            known = knownRaw ? JSON.parse(knownRaw) : cOriginalAppTypes;

        cAllAppTypes.forEach(function(t)
        {
          if (known.indexOf(t) === -1 && enabledTypes.indexOf(t) === -1)
            enabledTypes.push(t);
        });

        localStorage.setItem('lk_known_types', JSON.stringify(cAllAppTypes));
      }
    }
    catch(e) {}
    if (!enabledTypes) enabledTypes = cAllAppTypes.slice();
  }
  return enabledTypes;
}

function fSaveEnabledTypes(types)
{
  enabledTypes = types.length ? types : [currentAppType || 'doc'];
  try
  {
    localStorage.setItem('lk_enabled_types', JSON.stringify(enabledTypes));
    localStorage.setItem('lk_known_types', JSON.stringify(cAllAppTypes));
  }
  catch(e) {}
  fApplyEnabledTypes();
}

function fApplyEnabledTypes()
{
  var enabled = fGetEnabledTypes();
  cAllAppTypes.forEach(function(t)
  {
    var tab = document.getElementById('tab-' + t);
    if (tab) tab.style.display = enabled.includes(t) ? '' : 'none';
    var card = document.querySelector('.type-card[data-type="' + t + '"]');
    if (card) card.style.display = enabled.includes(t) ? '' : 'none';
  });
  if (enabled.length && !enabled.includes(currentAppType))
    fSwitchAppType(enabled[0]);
}

function fOnTypeToggle()
{
  var enabled = [];
  document.querySelectorAll('#settings-type-toggles input[type=checkbox]:checked').forEach(function(cb){ enabled.push(cb.value); });
  if (!enabled.length)
  {
    var cur = document.querySelector('#settings-type-toggles input[value="' + (currentAppType||'doc') + '"]');
    if (cur) { cur.checked = true; enabled.push(cur.value); }
    else enabled = [currentAppType || 'doc'];
  }
  fSaveEnabledTypes(enabled);
}

// ── THEME ──

var cThemeVarNames = ['--bg','--bg2','--bg3','--bg4','--border','--border2','--text','--text2','--text3','--accent','--accent2','--accent-dim','--accent-dim2'];

var cThemePresets =
[
  { name: 'Amber Dusk', vars: { '--bg':'#0f0e0c', '--bg2':'#1a1916', '--bg3':'#232220', '--bg4':'#2d2c29', '--border':'rgba(255,255,255,0.07)', '--border2':'rgba(255,255,255,0.13)', '--text':'#f0ede6', '--text2':'#9e9b94', '--text3':'#5c5a55', '--accent':'#d4a843', '--accent2':'#b8912e', '--accent-dim':'rgba(212,168,67,0.12)', '--accent-dim2':'rgba(212,168,67,0.06)' } },
  { name: 'Ocean Blue', vars: { '--bg':'#0b1218', '--bg2':'#151f27', '--bg3':'#1e2a33', '--bg4':'#28353f', '--border':'rgba(255,255,255,0.07)', '--border2':'rgba(255,255,255,0.13)', '--text':'#e8edf0', '--text2':'#94a3ac', '--text3':'#54626b', '--accent':'#4a9fd8', '--accent2':'#3a84b8', '--accent-dim':'rgba(74,159,216,0.12)', '--accent-dim2':'rgba(74,159,216,0.06)' } },
  { name: 'Forest Moss', vars: { '--bg':'#0d1410', '--bg2':'#161f19', '--bg3':'#1f2b23', '--bg4':'#29362d', '--border':'rgba(255,255,255,0.07)', '--border2':'rgba(255,255,255,0.13)', '--text':'#e8ede9', '--text2':'#93a398', '--text3':'#546155', '--accent':'#6fae5c', '--accent2':'#5a9048', '--accent-dim':'rgba(111,174,92,0.12)', '--accent-dim2':'rgba(111,174,92,0.06)' } },
  { name: 'Crimson Ember', vars: { '--bg':'#150e0d', '--bg2':'#201715', '--bg3':'#2b201d', '--bg4':'#362a26', '--border':'rgba(255,255,255,0.07)', '--border2':'rgba(255,255,255,0.13)', '--text':'#f0e8e6', '--text2':'#a89490', '--text3':'#63524e', '--accent':'#d9614a', '--accent2':'#bf4c37', '--accent-dim':'rgba(217,97,74,0.12)', '--accent-dim2':'rgba(217,97,74,0.06)' } },
  { name: 'Slate Violet', vars: { '--bg':'#100e17', '--bg2':'#1a1722', '--bg3':'#23202d', '--bg4':'#2d2a38', '--border':'rgba(255,255,255,0.07)', '--border2':'rgba(255,255,255,0.13)', '--text':'#eae7f0', '--text2':'#a19cac', '--text3':'#5f5a6b', '--accent':'#9a7fd4', '--accent2':'#8267bf', '--accent-dim':'rgba(154,127,212,0.12)', '--accent-dim2':'rgba(154,127,212,0.06)' } }
];

function fHexToRgb(hex)
{
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(function(c){ return c + c; }).join('');
  var n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function fRgbToHex(r, g, b)
{
  return '#' + [r, g, b].map(function(v)
  {
    return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  }).join('');
}

function fMixHex(hex, towardHex, amount)
{
  var a = fHexToRgb(hex), b = fHexToRgb(towardHex);
  return fRgbToHex(a.r + (b.r - a.r) * amount, a.g + (b.g - a.g) * amount, a.b + (b.b - a.b) * amount);
}

function fRelativeLuminance(hex)
{
  var c = fHexToRgb(hex);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

// Derives a full palette from just a background and an accent color, so a
// custom pick stays legible regardless of how light or dark it is.
function fGenerateThemeVars(bgHex, accentHex)
{
  var isDark = fRelativeLuminance(bgHex) < 0.5,
      lightenTarget = isDark ? '#ffffff' : '#000000',
      text = isDark ? '#f0ede6' : '#1c1a17',
      accentRgb = fHexToRgb(accentHex);

  return {
    '--bg': bgHex,
    '--bg2': fMixHex(bgHex, lightenTarget, 0.045),
    '--bg3': fMixHex(bgHex, lightenTarget, 0.085),
    '--bg4': fMixHex(bgHex, lightenTarget, 0.125),
    '--border': isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    '--border2': isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.15)',
    '--text': text,
    '--text2': fMixHex(bgHex, text, 0.55),
    '--text3': fMixHex(bgHex, text, 0.32),
    '--accent': accentHex,
    '--accent2': fMixHex(accentHex, '#000000', 0.15),
    '--accent-dim': 'rgba(' + accentRgb.r + ',' + accentRgb.g + ',' + accentRgb.b + ',0.12)',
    '--accent-dim2': 'rgba(' + accentRgb.r + ',' + accentRgb.g + ',' + accentRgb.b + ',0.06)'
  };
}

function fApplyThemeVars(vars)
{
  var root = document.documentElement.style;
  cThemeVarNames.forEach(function(name)
  {
    if (vars[name]) root.setProperty(name, vars[name]);
  });
}

function fResolveThemeChoice(choice)
{
  if (choice.type === 'custom') return fGenerateThemeVars(choice.bg, choice.accent);
  var preset = cThemePresets.find(function(p){ return p.name === choice.name; });
  return preset ? preset.vars : null;
}

function fLoadThemeChoice()
{
  try
  {
    var raw = localStorage.getItem('lk_theme');
    return raw ? JSON.parse(raw) : null;
  }
  catch(e) { return null; }
}

function fSaveThemeChoice(choice)
{
  try { localStorage.setItem('lk_theme', JSON.stringify(choice)); } catch(e) {}
  fPersistRoamingTheme(choice);
}

function fInitTheme()
{
  var choice = fLoadThemeChoice();
  if (choice)
  {
    var vars = fResolveThemeChoice(choice);
    if (vars) fApplyThemeVars(vars);
  }
  // localStorage is only per-browser/per-install, so on a fresh device (or
  // after an app reinstall wiped webview storage) pull the roamed choice from
  // the workspace; repaints shortly after first paint when they differ.
  fLoadRoamingTheme();
}

// ── ROAMING APPEARANCE ──
// The theme choice also lives in a `_lkprefs.json` workspace sidecar (synced
// across devices like the `_lktpl.json` template store), with localStorage
// kept as the instant-paint cache.

async function fLoadRoamingTheme()
{
  if (!workFolderRoot) return;
  var prefs;
  try { prefs = JSON.parse(await Platform.fReadWorkFile(workFolderRoot, '_lkprefs.json')); }
  catch(e) { return; } // no prefs stored yet
  if (!prefs || !('theme' in prefs)) return;

  var localRaw  = localStorage.getItem('lk_theme'),
      roamedRaw = prefs.theme ? JSON.stringify(prefs.theme) : null;
  if (roamedRaw === localRaw) return;

  try
  {
    if (roamedRaw) localStorage.setItem('lk_theme', roamedRaw);
    else localStorage.removeItem('lk_theme');
  }
  catch(e) {}

  if (prefs.theme)
  {
    var vars = fResolveThemeChoice(prefs.theme);
    if (vars) fApplyThemeVars(vars);
  }
  else
    cThemeVarNames.forEach(function(name){ document.documentElement.style.removeProperty(name); });
}

/// choice = null records an explicit reset, so it roams too.
async function fPersistRoamingTheme(choice)
{
  if (!workFolderRoot) return;
  var prefs = {};
  try { prefs = JSON.parse(await Platform.fReadWorkFile(workFolderRoot, '_lkprefs.json')) || {}; }
  catch(e) {}
  prefs.theme = choice;
  try { await Platform.fWriteWorkFile(workFolderRoot, '_lkprefs.json', JSON.stringify(prefs, null, 2)); }
  catch(e) { console.warn('Prefs write error', e); }
}

function fSelectThemePreset(name)
{
  var choice = { type: 'preset', name: name };
  fSaveThemeChoice(choice);
  fApplyThemeVars(fResolveThemeChoice(choice));
  fRenderThemeSection();
}

function fOnCustomColorChange()
{
  var bg = document.getElementById('settings-bg-color').value,
      accent = document.getElementById('settings-accent-color').value,
      choice = { type: 'custom', bg: bg, accent: accent };
  fSaveThemeChoice(choice);
  fApplyThemeVars(fGenerateThemeVars(bg, accent));
  fRenderThemeSection();
}

function fResetTheme()
{
  localStorage.removeItem('lk_theme');
  cThemeVarNames.forEach(function(name){ document.documentElement.style.removeProperty(name); });
  fPersistRoamingTheme(null); // roam the reset too
  fRenderThemeSection();
}

function fRenderThemeSection()
{
  var choice = fLoadThemeChoice() || { type: 'preset', name: 'Amber Dusk' };

  document.getElementById('settings-theme-presets').innerHTML = cThemePresets.map(function(p)
  {
    var active = (choice.type === 'preset' && choice.name === p.name) ? ' active' : '';
    return '<button type="button" class="settings-theme-swatch' + active + '" title="' + p.name + '" onclick="fSelectThemePreset(\'' + p.name + '\')">' +
      '<span class="settings-theme-swatch-dot" style="background:' + p.vars['--bg4'] + '"></span>' +
      '<span class="settings-theme-swatch-dot" style="background:' + p.vars['--accent'] + '"></span>' +
      '<span class="settings-theme-swatch-label">' + p.name + '</span>' +
    '</button>';
  }).join('');

  var defaultPreset = cThemePresets[0];
  document.getElementById('settings-bg-color').value = choice.type === 'custom' ? choice.bg : defaultPreset.vars['--bg'];
  document.getElementById('settings-accent-color').value = choice.type === 'custom' ? choice.accent : defaultPreset.vars['--accent'];
}

// ── SETTINGS MODAL ──

function fOpenSettingsModal()
{
  fRenderSettingsModal();
  document.getElementById('settings-modal').classList.add('open');
  fRefreshCloudStatus();

  if (!Platform.isNative)
    fRefreshCustomFonts().then(fRenderCustomFontsSection);
}

function fCloseSettingsModal()
{
  document.getElementById('settings-modal').classList.remove('open');
}

var cTypeLabels = { doc:'Documents', sheet:'Sheets', graph:'Diagrams', slides:'Slides', notebook:'Notebook / Maps', glossary:'Glossary', calendar:'Calendar', economy:'Economy', bestiary:'Bestiary' };

function fRenderSettingsModal()
{
  var activeWs = workspaces.filter(function(w) { return w.root === workFolderRoot; })[0],
      location = workFolderRoot ? fWorkspaceLocationLabel(workFolderRoot) : null;

  document.getElementById('settings-folder-path').textContent =
    workFolderRoot
      ? (activeWs && activeWs.name !== location ? activeWs.name + ' — ' + location : location)
      : 'This browser (no folder set)';

  var folderBtn = document.getElementById('settings-folder-btn');
  if (folderBtn)
    folderBtn.innerHTML = (!Platform.isNative && workFolderRoot) ? 'Add Workspace&hellip;' : 'Choose Folder&hellip;';

  fRenderWorkspacesSection();

  var spellEnabled = document.getElementById('settings-spell-enabled'),
      spellLang    = document.getElementById('settings-spell-lang');

  if (spellEnabled)
    spellEnabled.checked = !!spellPrefs.enabled;

  if (spellLang)
  {
    spellLang.innerHTML = cSpellLangs.map(function(l){
      return '<option value="' + l[0] + '"' + (spellPrefs.lang === l[0] ? ' selected' : '') + '>' + fEscHtml(l[1]) + '</option>';
    }).join('');
  }

  document.getElementById('settings-stop-btn').style.display = workFolderRoot ? '' : 'none';

  var enabled = fGetEnabledTypes();
  document.getElementById('settings-type-toggles').innerHTML = cAllAppTypes.map(function(t){
    var checked = enabled.includes(t) ? ' checked' : '';
    return '<label class="settings-type-toggle">' +
      '<input type="checkbox" value="' + t + '"' + checked + ' onchange="fOnTypeToggle()"> ' +
      '<span>' + (cTypeLabels[t] || t) + '</span>' +
    '</label>';
  }).join('');

  fRenderThemeSection();
  fRenderCloudSyncSection();
  fRenderCustomFontsSection();
}

// ── CUSTOM FONTS ──
// Account-level fonts (server: src/fonts.rs). Unlike the picker's
// queryLocalFonts() path (Chromium + secure-context only, and dependent on
// whatever happens to be installed on THIS device), an uploaded font is
// served as a real asset and always renders the same way for every viewer,
// in the live editor and in exported PDFs (see embed_account_fonts_style
// server-side and fBuildDocExportHtml's use of injectedFontStyleTag below).

var customFontsCache = null; // [{id, familyName, contentType, byteSize}]

async function fRefreshCustomFonts()
{
  customFontsCache = await Platform.fListCustomFonts();
  return customFontsCache;
}

async function fInjectCustomFontsStyle()
{
  if (!customFontsCache) await fRefreshCustomFonts();

  var tag = document.getElementById('custom-fonts-style');
  if (!tag)
  {
    tag = document.createElement('style');
    tag.id = 'custom-fonts-style';
    document.head.appendChild(tag);
  }

  var rules = await Promise.all((customFontsCache || []).map(async function(f)
  {
    var url = await Platform.fCustomFontDataUrl(f.id);
    var format = f.contentType.indexOf('woff2') !== -1 ? 'woff2'
               : f.contentType.indexOf('woff') !== -1  ? 'woff'
               : f.contentType.indexOf('otf') !== -1   ? 'opentype'
               : 'truetype';
    return "@font-face{font-family:'" + f.familyName.replace(/'/g, '') + "';src:url('" + url + "') format('" + format + "');}";
  }));

  tag.textContent = rules.join('\n');
}

function fRenderCustomFontsSection()
{
  fRenderProjectFontsSection();

  var section = document.getElementById('custom-fonts-section');
  if (!section) return;

  if (Platform.isNative)
  {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  document.getElementById('custom-font-error').style.display = 'none';

  var list = document.getElementById('custom-fonts-list');
  var fonts = customFontsCache || [];

  list.innerHTML = fonts.length
    ? fonts.map(function(f)
      {
        return '<div class="custom-font-row">' +
          '<span class="custom-font-name" style="font-family:' + fEscAttr(fCssFontFamilyValue(f.familyName)) + '">' + fEscHtml(f.familyName) + '</span>' +
          '<span class="custom-font-size">' + Math.max(1, Math.round(f.byteSize / 1024)) + ' KB</span>' +
          '<button class="gls-card-del" style="position:static" onclick="fRemoveCustomFont(\'' + fEscAttr(f.id) + '\')" title="Delete">×</button>' +
        '</div>';
      }).join('')
    : '<div class="settings-help-text" style="margin:0">No custom fonts yet.</div>';
}

async function fOnCustomFontFileChosen()
{
  var fileInput = document.getElementById('custom-font-file'),
      nameInput = document.getElementById('custom-font-name'),
      errEl = document.getElementById('custom-font-error'),
      file = fileInput.files && fileInput.files[0];

  if (!file) return;

  var familyName = nameInput.value.trim() || file.name.replace(/\.[^.]+$/, '');
  errEl.style.display = 'none';

  try
  {
    var bytes = await file.arrayBuffer();
    await Platform.fUploadCustomFont(familyName, file.name, bytes);
    nameInput.value = '';
    fileInput.value = '';
    await fRefreshCustomFonts();
    fRenderCustomFontsSection();
    await fInjectCustomFontsStyle();
    cachedFontList = null; // let the "Font…" picker pick up the new family
  }
  catch(e)
  {
    errEl.textContent = e.message || 'Upload failed';
    errEl.style.display = '';
  }
}

async function fRemoveCustomFont(id)
{
  try { await Platform.fDeleteCustomFont(id); } catch(e) {}
  await fRefreshCustomFonts();
  fRenderCustomFontsSection();
  await fInjectCustomFontsStyle();
  cachedFontList = null;
}

document.getElementById('settings-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('settings-modal'))
      fCloseSettingsModal();
  }
);

// Writes every file currently in localStorage out as a real file at the root
// of `root`, de-duplicating names locally (the in-memory `files` are still
// keyed by the old synthetic ids at this point, so collisions can't be
// detected by checking `files[candidate]` the way fUniqueRelPath does).
async function fMigrateLocalStorageFilesToFolder(root)
{
  const usedPaths = {},
        entries = Object.values(files);

  for (let i = 0; i < entries.length; i++)
  {
    const f = entries[i],
          ext = fFileExtensionFor(f.type),
          base = fSanitizeFileName(f.name) || 'Untitled';

    let candidate = base + '.' + ext,
        n = 2;

    while (usedPaths[candidate])
    {
      candidate = base + ' (' + n + ').' + ext;
      n++;
    }

    usedPaths[candidate] = true;

    try
    {
      await Platform.fWriteWorkFile(root, candidate, f.content || '');
    }
    catch(e)
    {
      console.warn('Migration write error for "' + f.name + '"', e);
    }
  }
}

async function fChooseWorkFolder()
{
  let picked;

  try
  {
    picked = await Platform.fPickWorkFolder();
  }
  catch(e)
  {
    console.warn('Folder picker error', e);
    return;
  }

  if (!picked)
    return;

  // Only browser-stored files migrate into the picked folder. When switching
  // between folders/workspaces the in-memory files already live on disk
  // elsewhere; migrating them again used to copy them (often as empty stubs,
  // since work-folder content loads lazily) into every folder ever picked.
  if (!workFolderRoot && Object.keys(files).length > 0)
  {
    await fMigrateLocalStorageFilesToFolder(picked);

    // The files now live in the folder; leaving them in localStorage would
    // re-migrate them - as duplicates - on every future folder pick.
    try { localStorage.removeItem('lore_keep_v2'); } catch(e) {}
    files = {};
  }

  await fActivateWorkspace(picked, true);
}

// Makes `root` the active work folder, optionally registering it as a new
// named workspace first. Everything keyed by rel-path (open file, tabs, split
// pane, backlinks) belongs to the previous workspace and is reset.
async function fActivateWorkspace(root, isNew)
{
  if (isNew && !workspaces.some(function(w) { return w.root === root; }))
  {
    var name = fWorkspaceNameFromRoot(root);

    if (Platform.isNative)
      name = (prompt('Name this workspace:', name) || '').trim() || name;

    workspaces.push({ name: name, root: root });
  }

  await fFlushPendingSave();

  workFolderRoot = root;
  fSaveSettings();
  fApplyCloudWorkspaceScope();

  currentFileId = null;
  folders = {};
  expandedFolders = new Set();
  fClearActiveEditors();
  fCloseSplitPane();

  await fLoadWorkFolderTree();
  fLoadOpenTabs();
  await fLoadBacklinksIndex();
  fRenderSettingsModal();
}

// Web: a new workspace is a named top-level folder in the cloud space.
// Naming an existing folder attaches to it instead of failing, so a second
// browser (or a fresh login) can re-add the same workspaces.
async function fAddCloudWorkspace()
{
  var name = fSanitizeFileName(prompt('Name the new workspace (it becomes a folder in your cloud space):', '') || '');

  if (!name)
    return;

  try
  {
    await Platform.fCreateWorkFolder('cloud', name);
  }
  catch(e)
  {
    console.warn('Workspace folder create error', e);
    alert('Could not create the workspace folder.');
    return;
  }

  var root = 'cloud:' + name;

  if (!workspaces.some(function(w) { return w.root === root; }))
    workspaces.push({ name: name, root: root });

  fSaveSettings();
  fPersistRoamingCloudWorkspaces();
  await fActivateWorkspace(root, false);
}

// The settings button doubles as "pick a folder" (desktop, or the web's
// first-time cloud attach) and "add a cloud workspace" (web, once attached).
function fOnSettingsFolderButton()
{
  if (!Platform.isNative && workFolderRoot)
    fAddCloudWorkspace();
  else
    fChooseWorkFolder();
}

// ── Roaming cloud workspace list (web only) ──
// Saved in the root _lkprefs.json sidecar (always unscoped: root 'cloud'),
// so the list follows the account across browsers and devices.

async function fLoadRoamingCloudWorkspaces()
{
  var prefs;

  try { prefs = JSON.parse(await Platform.fReadWorkFile('cloud', '_lkprefs.json')); }
  catch(e) { return; } // no prefs stored yet (or logged out)

  if (!prefs || !Array.isArray(prefs.cloudWorkspaces))
    return;

  var changed = false;

  prefs.cloudWorkspaces.forEach(function(w)
  {
    if (!w || !w.name || !w.folder)
      return;

    var root = 'cloud:' + w.folder;

    if (!workspaces.some(function(x) { return x.root === root; }))
    {
      workspaces.push({ name: w.name, root: root });
      changed = true;
    }
  });

  if (changed)
    fSaveSettings();
}

function fPersistRoamingCloudWorkspaces()
{
  if (Platform.isNative)
    return;

  (async function()
  {
    var prefs = {};

    try { prefs = JSON.parse(await Platform.fReadWorkFile('cloud', '_lkprefs.json')) || {}; }
    catch(e) {}

    prefs.cloudWorkspaces = workspaces
      .filter(function(w) { return w.root.indexOf('cloud:') === 0; })
      .map(function(w) { return { name: w.name, folder: w.root.slice(6) }; });

    try { await Platform.fWriteWorkFile('cloud', '_lkprefs.json', JSON.stringify(prefs, null, 2)); }
    catch(e) { console.warn('Workspace prefs write error', e); }
  })();
}

// A pending autosave debounce still targets the previous workspace's file;
// write it out before the switch so the last keystrokes aren't lost.
async function fFlushPendingSave()
{
  if (saveTimer && currentFileId && files[currentFileId])
  {
    clearTimeout(saveTimer);
    saveTimer = null;
    files[currentFileId].modified = Date.now();
    await fPersistFileEntry(currentFileId);
  }
}

function fSwitchWorkspaceAt(i)
{
  var ws = workspaces[i];

  if (!ws || ws.root === workFolderRoot)
    return;

  fActivateWorkspace(ws.root, false);
}

function fRenameWorkspaceAt(i)
{
  var ws = workspaces[i];

  if (!ws)
    return;

  var name = (prompt('Workspace name:', ws.name) || '').trim();

  if (!name)
    return;

  ws.name = name;
  fSaveSettings();
  fPersistRoamingCloudWorkspaces();
  fRenderSettingsModal();
}

function fForgetWorkspaceAt(i)
{
  var ws = workspaces[i];

  if (!ws)
    return;

  if (ws.root === 'cloud' && !Platform.isNative)
    return; // the whole-space workspace is the web's home base; keep it

  if (!confirm('Remove "' + ws.name + '" from the workspace list? The folder and its files are kept.'))
    return;

  var wasActive = ws.root === workFolderRoot;

  workspaces.splice(i, 1);
  fSaveSettings();
  fPersistRoamingCloudWorkspaces();

  if (wasActive)
  {
    if (!Platform.isNative)
      fActivateWorkspace('cloud', false); // fall back to the whole cloud space
    else
      fStopUsingWorkFolder();
  }
  else
    fRenderSettingsModal();
}

// Human-readable location line for a workspace row: a real path on desktop,
// a friendly description of the scoped cloud folder on the web.
function fWorkspaceLocationLabel(root)
{
  if (root === 'cloud')
    return 'Entire cloud space';

  if (String(root).indexOf('cloud:') === 0)
    return 'Cloud folder: ' + String(root).slice(6);

  return root;
}

function fRenderWorkspacesSection()
{
  var listEl = document.getElementById('settings-workspaces-list');

  if (!listEl)
    return;

  // The web hides the list until the account's cloud space is attached (the
  // first "Choose Folder" / login flow); the desktop always shows it.
  if (!Platform.isNative && !workFolderRoot)
  {
    listEl.style.display = 'none';
    return;
  }

  listEl.style.display = '';

  listEl.innerHTML = workspaces.length
    ? workspaces.map(function(ws, i)
      {
        var active = ws.root === workFolderRoot,
            protectedRow = ws.root === 'cloud' && !Platform.isNative;

        return '<div class="settings-workspace-row' + (active ? ' active' : '') + '">' +
          '<button type="button" class="settings-workspace-main" title="' + fEscAttr(fWorkspaceLocationLabel(ws.root)) + '" onclick="fSwitchWorkspaceAt(' + i + ')">' +
            '<span class="settings-workspace-name">' + fEscHtml(ws.name) + (active ? '<span class="settings-workspace-badge">active</span>' : '') + '</span>' +
            '<span class="settings-workspace-path">' + fEscHtml(fWorkspaceLocationLabel(ws.root)) + '</span>' +
          '</button>' +
          '<button type="button" class="settings-workspace-action" title="Rename workspace" onclick="fRenameWorkspaceAt(' + i + ')">&#9998;</button>' +
          (protectedRow ? '' :
            '<button type="button" class="settings-workspace-action" title="Remove from list" onclick="fForgetWorkspaceAt(' + i + ')">&times;</button>') +
        '</div>';
      }).join('')
    : '<div class="settings-help-text" style="margin:0">No saved workspaces yet. Choose a folder to create one.</div>';
}

async function fStopUsingWorkFolder()
{
  await fFlushPendingSave();

  workFolderRoot = null;
  fSaveSettings();
  fApplyCloudWorkspaceScope();

  files = {};
  folders = {};
  currentFileId = null;
  expandedFolders = new Set();
  fClearActiveEditors();
  fCloseSplitPane();

  fLoadFromStorage();
  fLoadOpenTabs();
  fRenderFileList();
  fRenderSettingsModal();
}
