// App state, init(), and the file list
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── STATE ──
let files = {};
let currentFileId = null;
let currentAppType = 'doc';
let newFileType = 'doc';
let editorView = 'write';
let saveTimer = null;
let sheetData = {};
// Cell decorations, aliased per page just like sheetData below:
// sheetColors = {ref: '#rrggbb'} paints a cell's background, serialized as a
// `;#hex` suffix on the cell's line (B1=5;#FAFAFA); sheetTextColors paints a
// cell's text, serialized as a `;txt#hex` suffix (B1=5;txt#FF0000);
// sheetMerges = {anchorRef: [coveredRefs]} joins cells into one bigger cell,
// serialized as a `:B2,B3,B4` suffix (B1=5:B2,B3,B4). The suffixes may appear
// on one line in any order.
let sheetColors = {};
let sheetTextColors = {};
let sheetMerges = {};
// Multi-tab spreadsheets: each page owns a {ref: value} map; sheetData is
// always an alias to the active page's map, so the whole grid/formula engine
// keeps working unchanged. Serialized with a `# page name` heading per page;
// formulas reference other tabs with the link-like syntax [Tab name](A1).
let sheetPages = [{ name: 'Sheet 1', data: sheetData, colors: sheetColors, textColors: sheetTextColors, merges: sheetMerges }];
let sheetPageIdx = 0;
// Set when the user switches tabs mid-formula: the next cell clicked on the
// other tab is inserted into that pending formula as [Tab name](REF) and the
// editor jumps back to where they were typing.
let formulaPickCtx = null;
let activeCell =
{
  row: 1,
  col: 1
};

let isDragging = false;
let selectionAnchor = null;
let selectionEnd = null;

let editingCell = null;
let isRefDragging = false;
// True while the ref-drag above targets the formula bar instead of an
// in-cell input (typing "=" in the bar, then clicking/dragging cells).
let refDragViaBar = false;
let formulaInsertStart = null;
let formulaInsertLength = 0;

let isFillDragging = false;
let fillSourceBox = null;
let fillRange = null;
let incrementLiteralsOnFill = false;

let functionSuggestState = null;

var sidebarSearch = '';
var newDocTemplate = 'blank';
var sidebarCollapsed = false;

// Shared undo/redo controller factory for the two plain-textarea editors
// (Docs, Graphs) - both need the exact same thing: batch a burst of typing
// into one undo step (capturing the "before" state on the first keystroke of
// a burst, via keydown, since oninput only ever sees the "after" state), plus
// a forced single-step snapshot for toolbar actions that rewrite the value
// programmatically (bold/italic wrapping, inserting a table, etc).
function makeTextUndo(getEditor)
{
  var undoStack = [],
      redoStack = [],
      pending = null,
      debounceTimer = null;

  function snapshotOf(editor)
  {
    return { value: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
  }

  function flushPending()
  {
    if (!pending)
      return;

    undoStack.push(pending);
    redoStack = [];
    pending = null;

    if (undoStack.length > 100)
      undoStack.shift();
  }

  function noteKeydown(e)
  {
    if (e.ctrlKey || e.metaKey || e.altKey)
      return;

    var navigationKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Shift','Control','Alt','Meta','Escape'];

    if (navigationKeys.indexOf(e.key) !== -1)
      return;

    if (!pending)
      pending = snapshotOf(getEditor());

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPending, 700);
  }

  function forceSnapshot()
  {
    flushPending();
    undoStack.push(snapshotOf(getEditor()));
    redoStack = [];

    if (undoStack.length > 100)
      undoStack.shift();
  }

  function restore(from, to)
  {
    flushPending();

    if (!from.length)
      return false;

    var editor = getEditor();
    to.push(snapshotOf(editor));

    var snap = from.pop();
    editor.value = snap.value;
    editor.selectionStart = snap.start;
    editor.selectionEnd = snap.end;

    return true;
  }

  return  {
            noteKeydown: noteKeydown,
            forceSnapshot: forceSnapshot,
            undo: function(){ return restore(undoStack, redoStack); },
            redo: function(){ return restore(redoStack, undoStack); },
            reset: function(){ undoStack = []; redoStack = []; pending = null; clearTimeout(debounceTimer); }
          };
}

// Chart definitions persisted with the sheet; live Chart.js instances are
// kept separately (sheetChartInstances, keyed by chart id) since they aren't
// serializable data - they're rebuilt from sheetCharts on every render.
let sheetCharts = [];
let sheetChartInstances = {};
let sheetChartDrag = null;
let newChartType = 'bar';

// Sheet-wide undo: a snapshot is the whole {data, charts} pair rather than a
// single cell, since one undo step (a paste, a fill, a chart move) can touch
// many cells/charts at once - same "snapshot the whole relevant state" idea
// used for Notebook pages, just at the sheet level instead of the page level.
let sheetUndoStack = [];
let sheetRedoStack = [];

let historyDiffIndex = null;

let graphEditorView = 'split';

let workFolderRoot = null;
let workspaces = []; // [{ name, root }] - saved work folders the user can switch between
let folders = {};
let expandedFolders = new Set();
let draggedEntryId = null;

let ROWS = 40,
    COLS = 26;

let documentHeadings = [];
let headingRenderCursor = 0;
let slugCounts = {};

async function createDefaultFile()
{
  let fileContext = await Platform.defaultFile("Decumano");

  const file = createFile
  (
    fileContext.name,
    fileContext.docType,
    fileContext.content
  );

  openFile(file);
}

async function init()
{
  loadSettings();
  applyCloudWorkspaceScope();
  applySpellcheckPrefs();

  // Cloud workspace names roam with the account (fire-and-forget; the
  // settings modal re-renders when it opens, so late arrival is fine).
  if (!Platform.isNative && workFolderRoot)
    loadRoamingCloudWorkspaces();

  // ?win= (satellite window) and ?embed= (split-pane iframe) boot the same
  // app with trimmed chrome; see initSecondaryContext.
  if (!isMainWindow)
  {
    await initSecondaryContext();
    return;
  }

  // #link=<token> in the URL is a share link (see initLinkAccess); it works
  // with or without a logged-in account.
  var linkToken = null;
  if (!Platform.isNative)
  {
    var lm = (window.location.hash || '').match(/^#link=([0-9a-fA-F-]{36})/);
    if (lm) linkToken = lm[1];
  }

  // Web only: surface the desktop-app download page. On Tauri you're already
  // in the desktop app, so the item stays hidden.
  if (!Platform.isNative)
  {
    var dlItem = document.getElementById('file-menu-download');
    if (dlItem) dlItem.style.display = '';
    refreshSharedSection();
  }

  // Anonymous link visitor: skip the personal-workspace bootstrap entirely —
  // there is no account, just the linked file/folder.
  if (linkToken && !(await Platform.currentUser()))
  {
    initTheme();
    applyEnabledTypes();
    applySidebarCollapse();
    buildSheet();
    renderFileList();
    await initLinkAccess(linkToken);
    return;
  }

  await refreshCloudStatus();
  initTheme();
  applyEnabledTypes();
  applySidebarCollapse();
  buildSheet();
  pruneWindowRegistry();
  registerThisWindow();
  initCrossWindowSync();

  if (workFolderRoot)
  {
    await loadWorkFolderTree();
    await loadBacklinksIndex();
    loadOpenTabs();
    initSplitView();
    injectCustomFontsStyle(); // fire-and-forget: doesn't block first paint
    if (linkToken) await initLinkAccess(linkToken);
    return;
  }

  loadFromStorage();
  await loadBacklinksIndex();
  loadOpenTabs();
  initSplitView();
  renderFileList();

  // First run only (per browser/install): an empty list later on means the
  // user deleted everything, and recreating the welcome file would make it
  // look like it resurrects itself.
  if (Object.keys(files).length === 0 && !linkToken && !localStorage.getItem('lk_welcomed'))
  {
    try { localStorage.setItem('lk_welcomed', '1'); } catch(e) {}
    createDefaultFile();
  }

  if (linkToken) await initLinkAccess(linkToken);
}

function saveToStorage()
{
  try
  {
    localStorage.setItem('lore_keep_v2', JSON.stringify(files));
  }
  catch(e)
  {
    console.warn('Storage error', e);
  }
}

function loadFromStorage()
{
  try
  {
    const d = localStorage.getItem('lore_keep_v2');
    if (d)
      files = JSON.parse(d);
  }
  catch(e)
  {
    files = {};
  }
}

// Default display name for a workspace: the folder's basename. "cloud" is
// the web build's whole-space sentinel; "cloud:<folder>" scopes the web app
// to that top-level folder of the cloud space (see platform.js).
function workspaceNameFromRoot(root)
{
  if (root === 'cloud')
    return 'Cloud workspace';

  if (String(root).indexOf('cloud:') === 0)
    return String(root).slice(6);

  var parts = String(root).split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(root);
}

// Tells platform.js which cloud folder scopes the share/comment calls (they
// don't take a root argument). Must run whenever workFolderRoot changes.
function applyCloudWorkspaceScope()
{
  if (Platform.setCloudWorkspace)
    Platform.setCloudWorkspace(
      (!Platform.isNative && workFolderRoot && workFolderRoot.indexOf('cloud:') === 0)
        ? workFolderRoot.slice(6)
        : ''
    );
}

function loadSettings()
{
  try
  {
    const raw = localStorage.getItem('lore_keep_settings'),
          settings = raw ? JSON.parse(raw) : {};

    workFolderRoot = settings.workFolder || null;

    workspaces = Array.isArray(settings.workspaces)
      ? settings.workspaces.filter(function(w) { return w && w.root && w.name; })
      : [];

    // Installs that predate named workspaces have an active folder but no
    // list: adopt it so it shows up (and stays switchable) in Settings.
    if (workFolderRoot && !workspaces.some(function(w) { return w.root === workFolderRoot; }))
      workspaces.push({ name: workspaceNameFromRoot(workFolderRoot), root: workFolderRoot });

    // Web: the whole-space workspace is always available to switch back to,
    // even when the active workspace is a scoped folder.
    if (!Platform.isNative && workFolderRoot && !workspaces.some(function(w) { return w.root === 'cloud'; }))
      workspaces.unshift({ name: 'Cloud workspace', root: 'cloud' });

    if (settings.spell)
      spellPrefs = { enabled: settings.spell.enabled !== false, lang: settings.spell.lang || '' };
  }
  catch(e)
  {
    workFolderRoot = null;
    workspaces = [];
  }
}

function saveSettings()
{
  try
  {
    localStorage.setItem('lore_keep_settings', JSON.stringify({ workFolder: workFolderRoot, workspaces: workspaces, spell: spellPrefs }));
  }
  catch(e)
  {
    console.warn('Settings storage error', e);
  }
}
