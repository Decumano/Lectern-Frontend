// Lectern frontend — entry point.
//
// This used to be one 18,000-line file. It is now the loader below plus the
// feature modules in modules/, one per area of the app. Nothing about how the
// code is written changed: the modules are plain classic scripts sharing one
// global scope, exactly as when they were consecutive sections of a single
// file, so a function defined in one is callable from any other without
// imports, exports or a build step.
//
// Two things about that arrangement are load-bearing.
//
// Order. The modules are concatenated in the order listed here, and that
// order is the original file's order. A module only sees what earlier modules
// have already defined, so anything that runs at load time — the
// addEventListener wiring, configureMermaid(), and so on — must come after
// what it uses. Appending an entry is safe; reordering is not.
//
// async = false. A script element created with createElement is async by
// default, and async scripts run in whatever order they finish downloading.
// Setting async = false puts them back in insertion order, which is what
// makes the point above true. Without it this file would work on a warm cache
// and fail on a cold one.
//
// init() is called once, after the last module has run, rather than at the
// bottom of the last file — so it can rely on every module being present.

(function () {
  // Modules load relative to this script, so a page served from a
  // subdirectory keeps working.
  var LOADER = document.currentScript;

  // Reuse whatever cache-busting version this script was loaded with
  // (auth-gate.js appends ?v=N), so there is no second place to update.
  function version() {
    try {
      var query = (LOADER && LOADER.src || '').split('?')[1] || '';
      var match = /(?:^|&)v=([^&]+)/.exec(query);
      return match ? match[1] : '';
    } catch (e) {
      return '';
    }
  }

  // Order matters — see the note above.
  var MODULES = [
    // Core: state every other module reads, init(), and the file list.
    'core-state.js',
    'core-spellcheck.js',

    // Shell: finding things, and the window/tab furniture around the editors.
    'navigation.js',
    'workspace-tabs.js',
    'relations-graph.js',
    'file-history.js',
    'work-folder.js',

    // The structured data apps, and the modal/tag machinery they share.
    'data-apps-common.js',
    'app-glossary.js',
    'app-bestiary.js',
    'app-calendar.js',
    'app-economy.js',

    // Documents.
    'app-documents.js',
    'documents-find.js',
    'documents-links.js',

    // Diagrams.
    'app-diagrams.js',

    // Notebook and maps.
    'app-notebook.js',
    'notebook-maps.js',
    'notebook-import.js',

    // Spreadsheet.
    'app-sheet.js',
    'sheet-formulas.js',
    'sheet-tabs-format.js',
    'sheet-charts.js',
    'sheet-function-reference.js',

    // Settings, and the account-backed features.
    'settings.js',
    'cloud-sync.js',
    'sharing.js',
    'live-sync.js',

    // Slides. Appended rather than placed by the other editors: it only
    // calls into earlier modules, and appending is the safe kind of edit.
    'app-slides.js'
  ];

  var suffix = version() ? '?v=' + version() : '';
  var base = 'modules/';

  function report(message) {
    // A module that fails to load leaves a blank window and no explanation,
    // which is the worst way to find out. Say so on the page itself.
    var box = document.createElement('div');
    box.setAttribute('style',
      'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
      'justify-content:center;padding:32px;font:14px system-ui,sans-serif;' +
      'background:#1e1e1e;color:#eee;text-align:center;white-space:pre-wrap');
    box.textContent = message;
    document.body.appendChild(box);
  }

  MODULES.forEach(function (name, index) {
    var script = document.createElement('script');
    script.src = base + name + suffix;

    // Restores document order for dynamically inserted scripts. Everything
    // depends on this.
    script.async = false;

    if (index === MODULES.length - 1) {
      // async = false guarantees the earlier modules have already run by the
      // time the last one does, so this is the moment everything exists.
      script.onload = function () {
        init();
      };
    }

    script.onerror = function () {
      report('Lectern could not start: failed to load ' + base + name +
             '\n\nThe frontend files are incomplete or the server is not ' +
             'serving modules/.');
    };

    document.head.appendChild(script);
  });
})();
