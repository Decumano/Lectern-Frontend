// Relationship graph
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── RELATIONSHIP GRAPH (desktop) ───────────────────────────
//
// Force-directed view of how files relate: solid edges are explicit
// cross-file links ([text](lorekeep://file/<id>) in Documents), faint edges
// are name mentions (the same signal that feeds the backlinks index). Plain
// canvas + a tiny simulation - no vendored graph library needed at the scale
// of a personal archive.

var relState = null; // { nodes, edges, raf, ... } while the modal is open

// User-tunable layout: spacing = spring rest length in px (how far apart
// connected nodes sit; repulsion scales with it so density feels uniform),
// size = node radius percentage. Persisted so the graph opens how you left it.
var relPrefs = { spacing: 110, size: 100 };

function loadRelPrefs()
{
  try
  {
    var raw = localStorage.getItem('lk_rel_prefs');
    if (raw)
    {
      var p = JSON.parse(raw);
      if (p.spacing >= 40 && p.spacing <= 300) relPrefs.spacing = p.spacing;
      if (p.size >= 50 && p.size <= 250)       relPrefs.size = p.size;
    }
  }
  catch(e) {}
}

function saveRelPrefs()
{
  try { localStorage.setItem('lk_rel_prefs', JSON.stringify(relPrefs)); } catch(e) {}
}

function relApplyPrefs()
{
  if (!relState)
    return;

  relState.nodes.forEach(function(n) { n.r = n.baseR * relPrefs.size / 100; });
  relState.alpha = Math.max(relState.alpha, 0.6); // reheat so the layout re-settles
}

function onRelSpacingChange(v)
{
  relPrefs.spacing = parseInt(v, 10) || 110;
  saveRelPrefs();
  relApplyPrefs();
}

function onRelSizeChange(v)
{
  relPrefs.size = parseInt(v, 10) || 100;
  saveRelPrefs();
  relApplyPrefs();
}

var REL_TYPE_COLORS =
{
  doc:      '#3498db',
  sheet:    '#2ecc71',
  graph:    '#9b59b6',
  slides:   '#1abc9c',
  notebook: '#e67e22',
  glossary: '#f1c40f',
  calendar: '#4a9fc8',
  economy:  '#e8a832',
  bestiary: '#e74c3c'
};

var REL_TYPE_LABELS =
{
  doc: 'Document', sheet: 'Spreadsheet', graph: 'Diagram', slides: 'Slides', notebook: 'Notebook',
  glossary: 'Glossary', calendar: 'Calendar', economy: 'Economy', bestiary: 'Bestiary'
};

// Explicit doc links: any lorekeep://file/<url-encoded id> occurrence.
function relExplicitTargets(content)
{
  var out = [], re = /lorekeep:\/\/file\/([^)\s"'<>]+)/g, m;

  while ((m = re.exec(content || '')))
  {
    try { out.push(decodeURIComponent(m[1])); }
    catch(e) {}
  }

  return out;
}

async function relEnsureContentsLoaded()
{
  if (!workFolderRoot)
    return;

  var pending = Object.keys(files).filter(function(id)
  {
    return id !== SHARED_TMP_ID && !files[id].contentLoaded;
  });

  await Promise.all(pending.map(function(id)
  {
    return Platform.readWorkFile(workFolderRoot, id)
            .then(function(c) { files[id].content = c; files[id].contentLoaded = true; })
            .catch(function() {});
  }));
}

function relBuildGraph()
{
  var ids = Object.keys(files).filter(function(id) { return id !== SHARED_TMP_ID; });

  var nodes = ids.map(function(id, i)
  {
    var angle = (i / Math.max(ids.length, 1)) * Math.PI * 2;

    return {
      id: id,
      name: files[id].name,
      type: files[id].type,
      x: Math.cos(angle) * 160 + (Math.random() - 0.5) * 40,
      y: Math.sin(angle) * 160 + (Math.random() - 0.5) * 40,
      vx: 0, vy: 0,
      degree: 0
    };
  });

  var nodeById = {};
  nodes.forEach(function(n) { nodeById[n.id] = n; });

  // Edge key "src|tgt" (undirected: smaller id first) → { a, b, kind }.
  // Explicit links win over mere mentions when both exist for a pair.
  var edgeMap = {};

  function addEdge(src, tgt, kind)
  {
    if (src === tgt || !nodeById[src] || !nodeById[tgt])
      return;

    var key = src < tgt ? src + '|' + tgt : tgt + '|' + src;

    if (!edgeMap[key])
      edgeMap[key] = { a: nodeById[src], b: nodeById[tgt], kind: kind };
    else if (kind === 'link')
      edgeMap[key].kind = 'link';
  }

  ids.forEach(function(id)
  {
    relExplicitTargets(files[id].content).forEach(function(tgt) { addEdge(id, tgt, 'link'); });
    computeMentionsListFor(id).forEach(function(tgt) { addEdge(id, tgt, 'mention'); });
  });

  var edges = Object.keys(edgeMap).map(function(k) { return edgeMap[k]; });

  edges.forEach(function(e) { e.a.degree++; e.b.degree++; });
  nodes.forEach(function(n)
  {
    n.baseR = Math.min(7 + Math.sqrt(n.degree) * 3.2, 18);
    n.r = n.baseR * relPrefs.size / 100;
  });

  return { nodes: nodes, edges: edges };
}

async function openRelationsGraph()
{
  document.getElementById('relations-modal').style.display = 'flex';

  loadRelPrefs();
  document.getElementById('rel-spacing').value = relPrefs.spacing;
  document.getElementById('rel-size').value    = relPrefs.size;

  await relEnsureContentsLoaded();

  var graph  = relBuildGraph(),
      wrap   = document.querySelector('.relations-canvas-wrap'),
      canvas = document.getElementById('relations-canvas');

  document.getElementById('relations-empty').style.display = graph.edges.length ? 'none' : '';

  // Legend: file types actually present, plus the two edge kinds
  var typesPresent = {};
  graph.nodes.forEach(function(n) { typesPresent[n.type] = true; });

  document.getElementById('relations-legend').innerHTML =
    Object.keys(typesPresent).map(function(t)
    {
      return '<span class="rel-legend-item"><span class="rel-legend-dot" style="background:' + (REL_TYPE_COLORS[t] || '#9ca3af') + '"></span>' + escHtml(REL_TYPE_LABELS[t] || t) + '</span>';
    }).join('') +
    '<span class="rel-legend-item"><span class="rel-legend-line"></span>Linked</span>' +
    '<span class="rel-legend-item"><span class="rel-legend-line rel-legend-line-dim"></span>Mentions</span>';

  var css = getComputedStyle(document.documentElement);

  relState =
  {
    nodes: graph.nodes,
    edges: graph.edges,
    canvas: canvas,
    ctx: canvas.getContext('2d'),
    wrap: wrap,
    scale: 1, tx: 0, ty: 0,
    alpha: 1,
    dragNode: null,
    panning: false,
    pointerDown: null,
    hovered: null,
    raf: 0,
    textColor:  (css.getPropertyValue('--text')  || '#ddd').trim(),
    edgeColor:  (css.getPropertyValue('--text3') || '#888').trim(),
    haloColor:  (css.getPropertyValue('--bg')    || '#16181d').trim(),
    resize: function() { relResizeCanvas(); }
  };

  window.addEventListener('resize', relState.resize);
  relAttachPointerHandlers();
  relResizeCanvas();
  relState.raf = requestAnimationFrame(relTick);
}

function closeRelationsGraph()
{
  document.getElementById('relations-modal').style.display = 'none';

  if (!relState)
    return;

  cancelAnimationFrame(relState.raf);
  window.removeEventListener('resize', relState.resize);
  relState = null;
}

function relResizeCanvas()
{
  if (!relState)
    return;

  var dpr = window.devicePixelRatio || 1,
      w = relState.wrap.clientWidth,
      h = relState.wrap.clientHeight;

  relState.canvas.width  = w * dpr;
  relState.canvas.height = h * dpr;
  relState.canvas.style.width  = w + 'px';
  relState.canvas.style.height = h + 'px';
  relState.dpr = dpr;
  relState.w = w;
  relState.h = h;
}

// One simulation step: pairwise repulsion, spring along edges, weak pull to
// the center. Standard velocity-Verlet-ish integration with damping; alpha
// cools the whole system down so the layout settles instead of jittering.
function relStep()
{
  var s = relState,
      nodes = s.nodes,
      edges = s.edges,
      alpha = s.alpha,
      spacing = relPrefs.spacing,
      spacingF = spacing / 110,
      repelK = 1600 * spacingF * spacingF,
      cutoff2 = Math.pow(spacing * 3.6, 2), // beyond ~3.6× spacing repulsion is negligible
      i, j, a, b, dx, dy, d2, d, f;

  for (i = 0; i < nodes.length; i++)
    for (j = i + 1; j < nodes.length; j++)
    {
      a = nodes[i]; b = nodes[j];
      dx = b.x - a.x; dy = b.y - a.y;
      d2 = dx * dx + dy * dy || 1;

      if (d2 > cutoff2) continue;

      f = (repelK / d2) * alpha;
      d = Math.sqrt(d2);
      dx /= d; dy /= d;
      a.vx -= dx * f; a.vy -= dy * f;
      b.vx += dx * f; b.vy += dy * f;
    }

  for (i = 0; i < edges.length; i++)
  {
    a = edges[i].a; b = edges[i].b;
    dx = b.x - a.x; dy = b.y - a.y;
    d = Math.sqrt(dx * dx + dy * dy) || 1;
    f = (d - spacing) * 0.02 * alpha * (edges[i].kind === 'link' ? 1.6 : 1);
    dx /= d; dy /= d;
    a.vx += dx * f; a.vy += dy * f;
    b.vx -= dx * f; b.vy -= dy * f;
  }

  for (i = 0; i < nodes.length; i++)
  {
    a = nodes[i];
    a.vx -= a.x * 0.004 * alpha;
    a.vy -= a.y * 0.004 * alpha;

    if (a === s.dragNode) { a.vx = 0; a.vy = 0; continue; }

    a.vx *= 0.85; a.vy *= 0.85;
    a.x += a.vx; a.y += a.vy;
  }

  s.alpha = Math.max(alpha * 0.985, 0.02);
}

function relDraw()
{
  var s = relState,
      ctx = s.ctx;

  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.clearRect(0, 0, s.w, s.h);
  ctx.translate(s.w / 2 + s.tx, s.h / 2 + s.ty);
  ctx.scale(s.scale, s.scale);

  var i, e, n,
      hover = s.hovered;

  for (i = 0; i < s.edges.length; i++)
  {
    e = s.edges[i];

    var touched = hover && (e.a === hover || e.b === hover);

    ctx.globalAlpha = e.kind === 'link' ? (touched ? 0.95 : 0.55) : (touched ? 0.7 : 0.22);
    ctx.strokeStyle = touched ? (REL_TYPE_COLORS[hover.type] || s.edgeColor) : s.edgeColor;
    ctx.lineWidth = (e.kind === 'link' ? 1.8 : 1) / s.scale + (e.kind === 'link' ? 0.6 : 0.2);
    ctx.beginPath();
    ctx.moveTo(e.a.x, e.a.y);
    ctx.lineTo(e.b.x, e.b.y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;

  for (i = 0; i < s.nodes.length; i++)
  {
    n = s.nodes[i];

    var dimmed = hover && n !== hover && !s.edges.some(function(e) { return (e.a === hover && e.b === n) || (e.b === hover && e.a === n); });

    ctx.globalAlpha = dimmed ? 0.25 : 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = REL_TYPE_COLORS[n.type] || '#9ca3af';
    ctx.fill();

    if (n === hover)
    {
      ctx.lineWidth = 2 / s.scale;
      ctx.strokeStyle = s.textColor;
      ctx.stroke();
    }

    // Labels stay a constant on-screen size regardless of zoom (divide by
    // scale since the canvas is scaled), grow a little with the node-size
    // slider, and get a halo in the background color so they stay readable
    // when they cross edges or other labels.
    var fontPx = Math.min(11 * (0.75 + (relPrefs.size / 100) * 0.35), 17) / s.scale,
        label = n.name.length > 24 ? n.name.slice(0, 22) + '…' : n.name;

    ctx.font = (n === hover ? 'bold ' : '') + fontPx.toFixed(2) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5 / s.scale;
    ctx.strokeStyle = s.haloColor;
    ctx.strokeText(label, n.x, n.y + n.r + 14 / s.scale);
    ctx.fillStyle = s.textColor;
    ctx.fillText(label, n.x, n.y + n.r + 14 / s.scale);
  }

  ctx.globalAlpha = 1;
}

function relTick()
{
  if (!relState)
    return;

  if (relState.alpha > 0.021 || relState.dragNode)
    relStep();

  relDraw();
  relState.raf = requestAnimationFrame(relTick);
}

// Screen px → graph coordinates
function relToGraph(px, py)
{
  var s = relState,
      rect = s.canvas.getBoundingClientRect();

  return {
    x: (px - rect.left - s.w / 2 - s.tx) / s.scale,
    y: (py - rect.top  - s.h / 2 - s.ty) / s.scale
  };
}

function relNodeAt(px, py)
{
  var p = relToGraph(px, py),
      nodes = relState.nodes;

  for (var i = nodes.length - 1; i >= 0; i--)
  {
    var dx = p.x - nodes[i].x,
        dy = p.y - nodes[i].y,
        hit = nodes[i].r + 4 / relState.scale;

    if (dx * dx + dy * dy <= hit * hit)
      return nodes[i];
  }

  return null;
}

function relAttachPointerHandlers()
{
  var canvas = relState.canvas;

  canvas.onpointerdown = function(e)
  {
    if (!relState) return;
    canvas.setPointerCapture(e.pointerId);
    var n = relNodeAt(e.clientX, e.clientY);
    relState.pointerDown = { x: e.clientX, y: e.clientY, moved: false, node: n };

    if (n) { relState.dragNode = n; relState.alpha = Math.max(relState.alpha, 0.3); }
    else   relState.panning = true;
  };

  canvas.onpointermove = function(e)
  {
    if (!relState) return;

    var pd = relState.pointerDown;

    if (pd)
    {
      if (Math.abs(e.clientX - pd.x) + Math.abs(e.clientY - pd.y) > 4)
        pd.moved = true;

      if (relState.dragNode)
      {
        var p = relToGraph(e.clientX, e.clientY);
        relState.dragNode.x = p.x;
        relState.dragNode.y = p.y;
        relState.alpha = Math.max(relState.alpha, 0.25);
      }
      else if (relState.panning)
      {
        relState.tx += e.movementX;
        relState.ty += e.movementY;
      }
    }
    else
    {
      relState.hovered = relNodeAt(e.clientX, e.clientY);
      canvas.style.cursor = relState.hovered ? 'pointer' : 'grab';
    }
  };

  canvas.onpointerup = function(e)
  {
    if (!relState) return;

    var pd = relState.pointerDown;

    // A press-and-release on a node without dragging opens that file
    if (pd && pd.node && !pd.moved)
    {
      var id = pd.node.id;
      closeRelationsGraph();
      openFile(id);
      return;
    }

    relState.pointerDown = null;
    relState.dragNode = null;
    relState.panning = false;
  };

  canvas.onwheel = function(e)
  {
    if (!relState) return;
    e.preventDefault();

    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12,
        next = Math.min(Math.max(relState.scale * factor, 0.25), 4);

    // Zoom around the cursor: keep the graph point under it fixed
    var rect = relState.canvas.getBoundingClientRect(),
        cx = e.clientX - rect.left - relState.w / 2,
        cy = e.clientY - rect.top  - relState.h / 2;

    relState.tx = cx - (cx - relState.tx) * (next / relState.scale);
    relState.ty = cy - (cy - relState.ty) * (next / relState.scale);
    relState.scale = next;
  };
}
