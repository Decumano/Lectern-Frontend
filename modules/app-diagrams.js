// Diagrams (Mermaid)
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── GRAPH (Mermaid diagrams, stored as Markdown) ──
var graphTextUndo = fMakeTextUndo(function(){ return document.getElementById('graph-editor'); });

function fLoadGraphFile(file)
{
  graphTextUndo.reset();
  document.getElementById('graph-title-input').value = file.name;
  document.getElementById('graph-editor').value = file.content || '';

  fUpdateGraphPreview();
}

function fHandleGraphEditorKey(keyEvent)
{
  graphTextUndo.fNoteKeydown(keyEvent);

  if (!(keyEvent.ctrlKey || keyEvent.metaKey))
    return;

  if (!keyEvent.shiftKey && keyEvent.key.toLowerCase() === 'z')
  {
    keyEvent.preventDefault();

    if (graphTextUndo.undo())
      fOnGraphEditorChange();
  }
  else if (keyEvent.key.toLowerCase() === 'y' || (keyEvent.shiftKey && keyEvent.key.toLowerCase() === 'z'))
  {
    keyEvent.preventDefault();

    if (graphTextUndo.redo())
      fOnGraphEditorChange();
  }
}

function fOnGraphTitleChange()
{
  if ((!currentFileId) || (files[currentFileId].type !== 'graph'))
    return;

  files[currentFileId].name = (document.getElementById('graph-title-input').value || files[currentFileId].name);
  fScheduleSave();
  fRenderFileList();
}

function fOnGraphEditorChange()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'graph')
    return;

  files[currentFileId].content = document.getElementById('graph-editor').value;

  fUpdateGraphPreview();
  fScheduleSave();
}

function fUpdateGraphPreview()
{
  var source = document.getElementById('graph-editor').value,
      html = fEscHtml(source);

  if (typeof marked !== 'undefined')
    html = fRenderMarkdownFragment(source);

  var container = document.getElementById('graph-preview-content');

  container.innerHTML = fSanitizeHtml(html);

  fRenderMermaidDiagrams(container);
}

// Renders any `.mermaid` placeholder divs produced by the marked code-block
// override into actual diagrams. Re-running on freshly-built markup is safe
// since each call works on brand-new, unprocessed nodes.
// ── Diagram rendering ──
// Turning a Mermaid source into an SVG costs on the order of 200 ms with Mermaid itself (about 1 ms with Pele), so it is
// done as little as possible: a diagram is rendered once per distinct source (the
// result is cached, so an unchanged diagram reappears instantly after every
// edit), and only when it is near the screen, so a document with dozens of
// diagrams doesn't render them all up front.
// Pele (vendor/pele.global.js) draws the diagram in about a millisecond and is
// synchronous. It covers Mermaid's diagram types but has its own layout, so
// should it reject a source, Mermaid itself is loaded (once, only then) and
// given the same source: nothing that rendered before stops rendering.
var mermaidLoading = null;

function fLoadMermaid()
{
  if (typeof mermaid !== 'undefined')
    return Promise.resolve();

  if (!mermaidLoading)
    mermaidLoading = new Promise
    (
      function(resolve, reject)
      {
        var script = document.createElement('script');
        script.src = 'vendor/mermaid.min.js';
        script.onload = function() { mermaid.initialize({ startOnLoad: false }); resolve(); };
        script.onerror = function() { mermaidLoading = null; reject(new Error('Mermaid could not be loaded')); };
        document.head.appendChild(script);
      }
    );

  return mermaidLoading;
}

// Source text -> SVG markup (a promise). `id` only matters to Mermaid.
function fDiagramSvg(source, id)
{
  if (typeof pele !== 'undefined')
  {
    try
    {
      return Promise.resolve(pele.render(source).svg);
    }
    catch(e) { /* fall through to Mermaid */ }
  }

  return fLoadMermaid().then(function() { return mermaid.render(id, source); }).then(function(result) { return result.svg; });
}

var mermaidSvgCache = {};
var mermaidCacheOrder = [];
var cMermaidCacheMax = 80;
var mermaidRenderSeq = 0;
var mermaidQueue = Promise.resolve();
var mermaidObservers = [];

function fMermaidShow(node, svg)
{
  node.innerHTML = svg;
  node.setAttribute('data-processed', 'true');
  node.classList.remove('mermaid-pending');
}

function fMermaidRender(node)
{
  var source = node.getAttribute('data-mermaid-src');

  if (!source || node.getAttribute('data-processed'))
    return;

  if (mermaidSvgCache[source])
  {
    fMermaidShow(node, mermaidSvgCache[source]);
    return;
  }

  // One at a time: Mermaid's render shares scratch elements between calls.
  mermaidQueue = mermaidQueue.then(function()
  {
    if (!node.isConnected || node.getAttribute('data-processed'))
      return;

    return fDiagramSvg(source, 'mmd-' + (++mermaidRenderSeq)).then
    (
      function(svg)
      {
        mermaidSvgCache[source] = svg;
        mermaidCacheOrder.push(source);

        if (mermaidCacheOrder.length > cMermaidCacheMax)
          delete mermaidSvgCache[mermaidCacheOrder.shift()];

        if (node.isConnected)
          fMermaidShow(node, svg);
      }
    ).catch
    (
      function(e)
      {
        // A diagram with a syntax error stays as its source, as before.
        node.classList.remove('mermaid-pending');
        console.warn('Mermaid render error', e);
      }
    );
  });
}

// The nearest ancestor that scrolls, so "near the screen" means near the
// visible part of the preview rather than of the whole window.
function fScrollParentOf(element)
{
  for (var el = element.parentElement; el; el = el.parentElement)
  {
    var overflow = getComputedStyle(el).overflowY;

    if (overflow === 'auto' || overflow === 'scroll')
      return el;
  }

  return null;
}

function fRenderMermaidDiagrams(container)
{
  if (!container)
    return;

  var nodes = container.querySelectorAll('.mermaid:not([data-processed])');

  if (!nodes.length)
    return;

  var observer = null;

  if (typeof IntersectionObserver !== 'undefined')
  {
    observer = new IntersectionObserver
    (
      function(entries)
      {
        entries.forEach
        (
          function(entry)
          {
            if (!entry.isIntersecting)
              return;

            observer.unobserve(entry.target);
            fMermaidRender(entry.target);
          }
        );
      },
      { root: fScrollParentOf(container), rootMargin: '1200px 0px' }
    );
  }

  // Observers of an earlier pass over this container are obsolete.
  mermaidObservers = mermaidObservers.filter(function(o) { if (o.container === container) { o.observer.disconnect(); return false; } return true; });
  if (observer) mermaidObservers.push({ container: container, observer: observer });

  Array.prototype.forEach.call
  (
    nodes,
    function(node)
    {
      // The source is kept on the node: its text is about to become the SVG.
      var source = node.getAttribute('data-mermaid-src');

      if (source === null)
      {
        source = node.textContent;
        node.setAttribute('data-mermaid-src', source);
      }

      if (mermaidSvgCache[source])
        fMermaidShow(node, mermaidSvgCache[source]);
      else
      {
        node.classList.add('mermaid-pending');
        if (observer) observer.observe(node);
        else fMermaidRender(node);
      }
    }
  );
}

function fSetGraphView(newView)
{
  graphEditorView = newView;

  document.getElementById('graph-editor-area').className = (newView === 'write')
                                                            ?
                                                              ''
                                                            :
                                                              newView;

  ['write', 'split', 'preview'].forEach(
    function(view)
    {
      document.getElementById('gvbtn-'+ view).classList.toggle('active', view === newView);
    }
  );

  if (newView !== 'write')
    fUpdateGraphPreview();
}

var cMermaidSnippets =
[
  {
    name: 'Flowchart',
    desc: 'Boxes and arrows for a process or decision.',
    snippet: '```mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Continue]\n    B -->|No| D[Stop]\n```'
  },
  {
    name: 'Sequence diagram',
    desc: 'Messages exchanged between participants over time.',
    snippet: '```mermaid\nsequenceDiagram\n    Alice->>Bob: Hello Bob, how are you?\n    Bob-->>Alice: I am good, thanks!\n```'
  },
  {
    name: 'Class diagram',
    desc: 'Classes, members and relationships.',
    snippet: '```mermaid\nclassDiagram\n    Animal <|-- Dog\n    Animal : +String name\n    Animal : +makeSound()\n```'
  },
  {
    name: 'State diagram',
    desc: 'States and the transitions between them.',
    snippet: '```mermaid\nstateDiagram-v2\n    [*] --> Idle\n    Idle --> Running : start\n    Running --> Idle : stop\n    Running --> [*]\n```'
  },
  {
    name: 'Entity relationship',
    desc: 'Entities and how they relate to each other.',
    snippet: '```mermaid\nerDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains\n```'
  },
  {
    name: 'Gantt chart',
    desc: 'Tasks laid out against a timeline.',
    snippet: '```mermaid\ngantt\n    title Project Plan\n    section Phase 1\n    Design : 2024-01-01, 5d\n    Build  : 5d\n```'
  },
  {
    name: 'Pie chart',
    desc: 'Proportions of a whole.',
    snippet: '```mermaid\npie title Distribution\n    "A" : 40\n    "B" : 35\n    "C" : 25\n```'
  },
  {
    name: 'Relationship map',
    desc: 'Characters, factions and places connected by relationships.',
    snippet: '```mermaid\ngraph LR\n    %% Characters\n    Aria((Aria))\n    Kael((Kael))\n\n    %% Factions\n    Order[Order of Dawn]\n    Shadow[Shadow Guild]\n\n    %% Places\n    City([Ironhaven])\n\n    Aria -->|member of| Order\n    Kael -->|member of| Shadow\n    Aria ---|rivals| Kael\n    Order ---|based in| City\n\n    classDef character fill:#4a7fa8,stroke:#3a6f98,color:#fff\n    classDef faction fill:#8b6f3e,stroke:#7b5f2e,color:#fff\n    classDef place fill:#4a8b60,stroke:#3a7b50,color:#fff\n    class Aria,Kael character\n    class Order,Shadow faction\n    class City place\n```'
  },
  {
    name: 'Timeline',
    desc: 'Horizontal timeline for events, eras and character arcs.',
    snippet: '```mermaid\ntimeline\n    title Chronicle of Aethermoor\n    section Age of Founding\n        Year 1   : Kingdom established\n                 : First Conclave formed\n        Year 50  : Great Schism\n    section Age of Conflict\n        Year 100 : War of Three Crowns begins\n        Year 130 : Peace of Whitehall signed\n    section Current Era\n        Year 200 : Present day\n```'
  },
  {
    name: 'Hierarchy tree',
    desc: 'Org-chart style tree for lineages, power structures or systems.',
    snippet: '```mermaid\ngraph TD\n    A[The High Crown] --> B[Northern Realm]\n    A --> C[Southern Realm]\n    A --> D[Eastern Realm]\n    B --> E[House Ironwood]\n    B --> F[House Frostholm]\n    C --> G[House Sundagger]\n    C --> H[House Ashveil]\n    D --> I[House Embercroft]\n\n    classDef royal fill:#8b6f3e,stroke:#7b5f2e,color:#fff\n    classDef noble fill:#4a7fa8,stroke:#3a6f98,color:#fff\n    class A royal\n    class B,C,D,E,F,G,H,I noble\n```'
  }
];

function fRenderMermaidHelp()
{
  var panel = document.getElementById('mermaid-help-panel');

  if (!panel)
    return;

  var intro = '<div class="fx-help-intro">'+
                'Diagrams are stored as Markdown with a <code>```mermaid</code> code block. '+
                'Click a diagram type below to insert a starter template at the cursor.'+
              '</div>';

  var rows = cMermaidSnippets.map
  (
    function(s, i)
    {
      return  '<div class="fx-help-row mermaid-help-row" onclick="fInsertMermaidSnippet(' + i + ')">'+
                '<div class="fx-help-name">' + fEscHtml(s.name) + '</div>'+
                '<div class="fx-help-desc">' + fEscHtml(s.desc) + '</div>'+
              '</div>';
    }
  ).join('');

  panel.innerHTML = intro + rows;
}

function fToggleMermaidHelp(clickEvent)
{
  if (clickEvent)
    clickEvent.stopPropagation();

  var panel = document.getElementById('mermaid-help-panel');

  if (!panel)
    return;

  if (!panel.classList.contains('open'))
    fRenderMermaidHelp();

  panel.classList.toggle('open');
}

document.addEventListener
(
  'click',
  function(clickEvent)
  {
    var panel = document.getElementById('mermaid-help-panel');

    if (!panel || !panel.classList.contains('open'))
      return;

    if (panel.contains(clickEvent.target) || clickEvent.target.id === 'mermaid-help-btn')
      return;

    panel.classList.remove('open');
  }
);

function fInsertMermaidSnippet(index)
{
  var snippet = cMermaidSnippets[index];

  if (!snippet)
    return;

  graphTextUndo.fForceSnapshot();

  var editor = document.getElementById('graph-editor'),
      start = editor.selectionStart,
      end = editor.selectionEnd,
      before = editor.value.slice(0, start),
      after = editor.value.slice(end),
      lead = (!before || /\n\n$/.test(before)) ? '' : (/\n$/.test(before) ? '\n' : '\n\n'),
      trail = (!after || /^\n/.test(after)) ? '' : '\n\n';

  editor.value = before + lead + snippet.snippet + trail + after;

  var caretPos = (before + lead + snippet.snippet).length;
  editor.setSelectionRange(caretPos, caretPos);
  editor.focus();

  fOnGraphEditorChange();

  document.getElementById('mermaid-help-panel').classList.remove('open');
}
