// Diagrams (Mermaid)
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── GRAPH (Mermaid diagrams, stored as Markdown) ──
var graphTextUndo = makeTextUndo(function(){ return document.getElementById('graph-editor'); });

function loadGraphFile(file)
{
  graphTextUndo.reset();
  document.getElementById('graph-title-input').value = file.name;
  document.getElementById('graph-editor').value = file.content || '';

  updateGraphPreview();
}

function handleGraphEditorKey(keyEvent)
{
  graphTextUndo.noteKeydown(keyEvent);

  if (!(keyEvent.ctrlKey || keyEvent.metaKey))
    return;

  if (!keyEvent.shiftKey && keyEvent.key.toLowerCase() === 'z')
  {
    keyEvent.preventDefault();

    if (graphTextUndo.undo())
      onGraphEditorChange();
  }
  else if (keyEvent.key.toLowerCase() === 'y' || (keyEvent.shiftKey && keyEvent.key.toLowerCase() === 'z'))
  {
    keyEvent.preventDefault();

    if (graphTextUndo.redo())
      onGraphEditorChange();
  }
}

function onGraphTitleChange()
{
  if ((!currentFileId) || (files[currentFileId].type !== 'graph'))
    return;

  files[currentFileId].name = (document.getElementById('graph-title-input').value || files[currentFileId].name);
  scheduleSave();
  renderFileList();
}

function onGraphEditorChange()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'graph')
    return;

  files[currentFileId].content = document.getElementById('graph-editor').value;

  updateGraphPreview();
  scheduleSave();
}

function updateGraphPreview()
{
  var source = document.getElementById('graph-editor').value,
      html = escHtml(source);

  if (typeof marked !== 'undefined')
    html = marked.parser(marked.lexer(source));

  var container = document.getElementById('graph-preview-content');

  container.innerHTML = sanitizeHtml(html);

  renderMermaidDiagrams(container);
}

// Renders any `.mermaid` placeholder divs produced by the marked code-block
// override into actual diagrams. Re-running on freshly-built markup is safe
// since each call works on brand-new, unprocessed nodes.
function renderMermaidDiagrams(container)
{
  if ((typeof mermaid === 'undefined') || !container)
    return;

  var nodes = container.querySelectorAll('.mermaid');

  if (!nodes.length)
    return;

  try
  {
    mermaid.run({ nodes: nodes, suppressErrors: true });
  }
  catch(e)
  {
    console.warn('Mermaid render error', e);
  }
}

function setGraphView(newView)
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
    updateGraphPreview();
}

var MERMAID_SNIPPETS =
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

function renderMermaidHelp()
{
  var panel = document.getElementById('mermaid-help-panel');

  if (!panel)
    return;

  var intro = '<div class="fx-help-intro">'+
                'Diagrams are stored as Markdown with a <code>```mermaid</code> code block. '+
                'Click a diagram type below to insert a starter template at the cursor.'+
              '</div>';

  var rows = MERMAID_SNIPPETS.map
  (
    function(s, i)
    {
      return  '<div class="fx-help-row mermaid-help-row" onclick="insertMermaidSnippet(' + i + ')">'+
                '<div class="fx-help-name">' + escHtml(s.name) + '</div>'+
                '<div class="fx-help-desc">' + escHtml(s.desc) + '</div>'+
              '</div>';
    }
  ).join('');

  panel.innerHTML = intro + rows;
}

function toggleMermaidHelp(clickEvent)
{
  if (clickEvent)
    clickEvent.stopPropagation();

  var panel = document.getElementById('mermaid-help-panel');

  if (!panel)
    return;

  if (!panel.classList.contains('open'))
    renderMermaidHelp();

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

function insertMermaidSnippet(index)
{
  var snippet = MERMAID_SNIPPETS[index];

  if (!snippet)
    return;

  graphTextUndo.forceSnapshot();

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

  onGraphEditorChange();

  document.getElementById('mermaid-help-panel').classList.remove('open');
}
