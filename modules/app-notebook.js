// Notebook: tools, page rendering, undo, text boxes
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── NOTEBOOK (Xournal++-style pen/highlighter/eraser/shapes/text/PDF annotation) ──

// Transient editing state - not persisted; reset whenever a notebook file is opened.
let nbData = null;
let nbTool = 'pen';
let nbColor = '#1a1a1a';
let nbWidth = 3;
let nbCurrentPage = 0;
let nbUndoStack = [];
let nbRedoStack = [];
let nbSelection = [];
let nbActive = null;
let nbPdfDocCache = null;
let nbPdfDocCacheKey = null;
let nbPageObserver = null;
let nbZoom = 1;

// Pending SVG vector import awaiting interactive placement: strokes are held
// normalized (bounds shifted to origin, unscaled) and only baked into the
// page's stroke list when the user accepts the position/size.
let nbImport = null;

// Per-page offscreen bitmap of every *committed* stroke/shape (i.e. everything
// except whatever's currently being drawn), keyed by page index. Letting an
// active pen/highlighter/shape draw on top of a cached blit instead of
// replaying the page's entire history on every pointermove is what keeps fast
// stylus input feeling responsive once a page has built up real content -
// redrawing everything every move event scales with total ink on the page,
// which is the opposite of what you want from a 100+Hz pointer stream.
let nbCommittedCache = {};

const NB_COLORS = ['#1a1a1a', '#c0574a', '#2f6fd1', '#2f9e44', '#e8830f', '#7048b8'];

// The ink layer is rendered at least 2x even on a plain 1x display - canvas
// path strokes are always antialiased by the browser, but only against
// whatever resolution the buffer actually has, so deliberately oversampling
// (supersampling) gives visibly smoother edges than native resolution alone,
// the same idea as MSAA. devicePixelRatio is still respected on top of that
// floor, so a HiDPI display gets whichever of the two is sharper.
function notebookCanvasScale()
{
  return Math.max(window.devicePixelRatio || 1, 2);
}

function rebuildNotebookCommittedCache(pageIndex)
{
  const page = nbData && nbData.pages[pageIndex];

  if (!page)
    return;

  const scale = notebookCanvasScale(),
        rawWidth = Math.round(page.width * scale),
        rawHeight = Math.round(page.height * scale);

  let cached = nbCommittedCache[pageIndex];

  if (!cached || cached.width !== rawWidth || cached.height !== rawHeight)
  {
    cached = document.createElement('canvas');
    cached.width = rawWidth;
    cached.height = rawHeight;
    nbCommittedCache[pageIndex] = cached;
  }

  const ctx = cached.getContext('2d');

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, rawWidth, rawHeight);
  ctx.scale(scale, scale);

  page.strokes.forEach(function(s){ drawNotebookStroke(ctx, s); });
  page.shapes.forEach(function(s){ drawNotebookShape(ctx, s); });
}

function defaultNotebookPage()
{
  return {
    width: 816,
    height: 1056,
    background: { type: 'ruled' },
    strokes: [],
    shapes: [],
    texts: []
  };
}

function defaultNotebookData()
{
  return { version: 1, pdfData: null, pages: [defaultNotebookPage()] };
}

function serializeNotebookData(data)
{
  return '<!-- type: notebook -->\n\n```notebook\n' + JSON.stringify(data) + '\n```\n';
}

function parseNotebookContent(content)
{
  const match = /```notebook\n([\s\S]*?)\n```/.exec(content || '');

  if (!match)
    return defaultNotebookData();

  try
  {
    const data = JSON.parse(match[1]);

    if (!data.pages || !data.pages.length)
      data.pages = [defaultNotebookPage()];

    return data;
  }
  catch(e)
  {
    console.warn('Notebook parse error', e);
    return defaultNotebookData();
  }
}

function loadNotebookFile(file)
{
  document.getElementById('notebook-title-input').value = file.name;

  nbData = parseNotebookContent(file.content || '');
  nbCurrentPage = 0;
  nbUndoStack = [];
  nbRedoStack = [];
  nbSelection = [];
  nbActive = null;
  nbImport = null;
  document.getElementById('nb-import-bar').style.display = 'none';
  nbPdfDocCache = null;
  nbPdfDocCacheKey = null;
  nbZoom = 1;

  renderNotebookColorSwatches();
  renderNotebookPages();
  updateNotebookZoomIndicator();
  updateMapToolbarVisibility();
}

function onNotebookTitleChange()
{
  if ((!currentFileId) || (files[currentFileId].type !== 'notebook'))
    return;

  files[currentFileId].name = (document.getElementById('notebook-title-input').value || files[currentFileId].name);
  scheduleSave();
  renderFileList();
}

function commitNotebookChange()
{
  if (!currentFileId || !nbData || !files[currentFileId] || files[currentFileId].type !== 'notebook')
    return;

  files[currentFileId].content = serializeNotebookData(nbData);
  scheduleSave();
}

// ── Tool / color / width selection ──

function setNotebookTool(tool)
{
  nbTool = tool;
  nbSelection = [];

  document.querySelectorAll('.nb-tool-btn').forEach(function(btn)
  {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  const pages = document.getElementById('notebook-pages');

  if (pages)
  {
    pages.className = pages.className.replace(/\btool-\S+/g, '').trim();
    pages.classList.add('tool-' + tool);
  }

  if (nbData)
    redrawNotebookPage(nbCurrentPage);
}

function setNotebookColor(color)
{
  nbColor = color;

  document.querySelectorAll('.nb-swatch').forEach(function(sw)
  {
    sw.classList.toggle('active', sw.dataset.color === color);
  });
}

function setNotebookWidth(width)
{
  nbWidth = parseFloat(width);
}

function renderNotebookColorSwatches()
{
  const group = document.getElementById('notebook-color-group');

  if (!group)
    return;

  group.innerHTML = NB_COLORS.map(function(c)
  {
    return  '<button type="button" class="nb-swatch' + (c === nbColor ? ' active' : '') + '"' +
              ' data-color="' + c + '" style="background:' + c + '" onclick="setNotebookColor(\'' + c + '\')" title="' + c + '"></button>';
  }).join('');
}

// ── Page rendering ──

function renderNotebookPages()
{
  const container = document.getElementById('notebook-pages');

  container.innerHTML = '';

  // Page indices can shift (a page added/removed/reordered), so the whole
  // cache is rebuilt fresh below rather than trying to patch it in place.
  nbCommittedCache = {};

  nbData.pages.forEach(function(page, i)
  {
    const pageEl = document.createElement('div');
    pageEl.className = 'notebook-page' + (page.type === 'map' ? ' map-notebook-page' : '');
    pageEl.style.width = (page.width * nbZoom) + 'px';
    pageEl.style.height = (page.height * nbZoom) + 'px';
    pageEl.dataset.pageIndex = i;

    // Canvases are sized well above CSS resolution so strokes render crisp
    // rather than blurry, on both HiDPI displays and plain 1x ones (see
    // notebookCanvasScale). The ink canvas's context is scaled once here and
    // never touched again, so every other ink-canvas function keeps drawing
    // in plain page-space coordinates (0..page.width/height) regardless of
    // the actual buffer size.
    const scale = notebookCanvasScale();

    const bgCanvas = document.createElement('canvas');
    bgCanvas.className = 'notebook-bg-canvas';
    bgCanvas.width = Math.round(page.width * scale);
    bgCanvas.height = Math.round(page.height * scale);

    const inkCanvas = document.createElement('canvas');
    inkCanvas.className = 'notebook-ink-canvas';
    inkCanvas.width = Math.round(page.width * scale);
    inkCanvas.height = Math.round(page.height * scale);
    inkCanvas.getContext('2d').scale(scale, scale);

    const textLayer = document.createElement('div');
    textLayer.className = 'notebook-text-layer';

    pageEl.appendChild(bgCanvas);
    pageEl.appendChild(inkCanvas);
    pageEl.appendChild(textLayer);

    if (page.type === 'map')
    {
      // Scale/travel overlay canvases (not scaled by context, raw pixel match)
      const scaleCanvas = document.createElement('canvas');
      scaleCanvas.className = 'nb-scale-canvas';
      scaleCanvas.width = Math.round(page.width * scale);
      scaleCanvas.height = Math.round(page.height * scale);
      pageEl.appendChild(scaleCanvas);

      const travelCanvas = document.createElement('canvas');
      travelCanvas.className = 'nb-travel-canvas';
      travelCanvas.width = Math.round(page.width * scale);
      travelCanvas.height = Math.round(page.height * scale);
      pageEl.appendChild(travelCanvas);

      const pinLayer = document.createElement('div');
      pinLayer.className = 'nb-pin-layer';
      pageEl.appendChild(pinLayer);
    }

    container.appendChild(pageEl);

    renderNotebookPageBackground(page, bgCanvas);
    wireNotebookPointerEvents(inkCanvas, i);
    rebuildNotebookCommittedCache(i);
    redrawNotebookPage(i);
    renderNotebookTextLayerForPage(i);

    if (page.type === 'map')
      renderMapPinLayer(i);
  });

  updateNotebookPageIndicator();
  setupNotebookPageObserver();
  updateMapToolbarVisibility();
}

function notebookSetZoom(zoom)
{
  nbZoom = Math.max(0.25, Math.min(3, zoom));

  document.querySelectorAll('.notebook-page').forEach(function(pageEl)
  {
    const i = parseInt(pageEl.dataset.pageIndex, 10),
          page = nbData.pages[i];

    pageEl.style.width = (page.width * nbZoom) + 'px';
    pageEl.style.height = (page.height * nbZoom) + 'px';

    if (page.type === 'map') renderMapPinLayer(i);
  });

  updateNotebookZoomIndicator();
}

function notebookZoomIn()
{
  notebookSetZoom(nbZoom + 0.1);
}

function notebookZoomOut()
{
  notebookSetZoom(nbZoom - 0.1);
}

function notebookZoomReset()
{
  notebookSetZoom(1);
}

function updateNotebookZoomIndicator()
{
  const el = document.getElementById('notebook-zoom-indicator');

  if (el)
    el.textContent = Math.round(nbZoom * 100) + '%';
}

function renderNotebookPageBackground(page, canvas)
{
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (page.type === 'map' && page.imageData)
  {
    var mapImg = new Image();
    mapImg.onload = function()
    {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(mapImg, 0, 0, canvas.width, canvas.height);
    };
    mapImg.src = page.imageData;
    return;
  }

  if (page.background.type === 'pdf')
  {
    if (nbData.pdfData)
      renderNotebookPdfBackground(page, canvas);

    return;
  }

  if (page.background.type === 'ruled' || page.background.type === 'grid')
  {
    // Scoped to just this section (save/restore) rather than scaling the whole
    // context, since the PDF branch above computes its own scale to fill the
    // raw buffer directly - a persistent transform here would double-scale it.
    const scale = notebookCanvasScale();

    ctx.save();
    ctx.scale(scale, scale);

    if (page.background.type === 'ruled')
    {
      ctx.strokeStyle = '#cdd6e0';
      ctx.lineWidth = 1;

      for (let y = 40; y < page.height; y += 32)
      {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(page.width, y + 0.5);
        ctx.stroke();
      }
    }
    else
    {
      ctx.strokeStyle = '#dde3ea';
      ctx.lineWidth = 1;

      for (let gx = 0; gx < page.width; gx += 24)
      {
        ctx.beginPath();
        ctx.moveTo(gx + 0.5, 0);
        ctx.lineTo(gx + 0.5, page.height);
        ctx.stroke();
      }

      for (let gy = 0; gy < page.height; gy += 24)
      {
        ctx.beginPath();
        ctx.moveTo(0, gy + 0.5);
        ctx.lineTo(page.width, gy + 0.5);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

async function getNotebookPdfDocument()
{
  if (nbPdfDocCache && nbPdfDocCacheKey === nbData.pdfData)
    return nbPdfDocCache;

  const base64 = nbData.pdfData.split(',').pop(),
        binary = atob(base64),
        bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);

  nbPdfDocCache = await pdfjsLib.getDocument({ data: bytes }).promise;
  nbPdfDocCacheKey = nbData.pdfData;

  return nbPdfDocCache;
}

async function renderNotebookPdfBackground(page, canvas)
{
  if (typeof pdfjsLib === 'undefined')
    return;

  try
  {
    const pdfDoc = await getNotebookPdfDocument(),
          pdfPage = await pdfDoc.getPage(page.background.pdfPageIndex + 1),
          scale = canvas.width / pdfPage.getViewport({ scale: 1 }).width,
          viewport = pdfPage.getViewport({ scale: scale });

    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
  }
  catch(e)
  {
    console.warn('Notebook PDF background render error', e);
  }
}

function drawNotebookStroke(ctx, stroke, alphaScale)
{
  const pts = stroke.points;

  ctx.globalAlpha = ((stroke.tool === 'highlighter') ? 0.35 : 1) * (alphaScale || 1);
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.fill)
  {
    // Filled stroke (SVG import): the points trace the shape's outline(s),
    // with `breaks` marking indices where a new subpath starts. Nonzero
    // winding (the SVG default) keeps self-intersecting shapes solid -
    // Excalidraw freedraw ribbons overlap themselves constantly - while
    // still leaving holes (letter counters, rings) empty via subpath
    // winding direction; evenodd is honored when the source asked for it.
    const breaks = stroke.breaks || [];
    let bi = 0;

    ctx.beginPath();

    for (let i = 0; i < pts.length; i++)
    {
      if (i === 0)
      {
        ctx.moveTo(pts[i].x, pts[i].y);
      }
      else if (bi < breaks.length && breaks[bi] === i)
      {
        ctx.closePath();
        ctx.moveTo(pts[i].x, pts[i].y);
        bi++;
      }
      else
      {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }

    ctx.closePath();
    ctx.fill(stroke.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    ctx.globalAlpha = 1;
    return;
  }

  if (pts.length === 1)
  {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, (pts[0].w || stroke.baseWidth) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  else if (pts.length === 2)
  {
    ctx.beginPath();
    ctx.lineWidth = ((pts[0].w || stroke.baseWidth) + (pts[1].w || stroke.baseWidth)) / 2;
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
  }
  else
  {
    // Quadratic curve through the midpoint of each consecutive pair, using the
    // shared point as the control point - the standard cheap smoothing trick
    // for freehand input, since raw polylines look visibly faceted/jagged at
    // normal sampling rates rather than smooth handwriting strokes. Chained
    // from the actual first point through each midpoint to the actual last
    // point, so the smoothing doesn't clip the stroke's start/end tips.
    let prevMid = pts[0];

    for (let i = 1; i < pts.length - 1; i++)
    {
      const p1 = pts[i], p2 = pts[i + 1],
            mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      ctx.beginPath();
      ctx.lineWidth = p1.w || stroke.baseWidth;
      ctx.moveTo(prevMid.x, prevMid.y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid.x, mid.y);
      ctx.stroke();

      prevMid = mid;
    }

    const last = pts[pts.length - 1];

    ctx.beginPath();
    ctx.lineWidth = last.w || stroke.baseWidth;
    ctx.moveTo(prevMid.x, prevMid.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawNotebookShape(ctx, shape)
{
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = 'round';
  ctx.beginPath();

  if (shape.tool === 'line')
  {
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
  }
  else if (shape.tool === 'rectangle')
  {
    ctx.rect(Math.min(shape.x1, shape.x2), Math.min(shape.y1, shape.y2), Math.abs(shape.x2 - shape.x1), Math.abs(shape.y2 - shape.y1));
  }
  else if (shape.tool === 'ellipse')
  {
    const cx = (shape.x1 + shape.x2) / 2,
          cy = (shape.y1 + shape.y2) / 2,
          rx = Math.abs(shape.x2 - shape.x1) / 2,
          ry = Math.abs(shape.y2 - shape.y1) / 2;

    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  }

  ctx.stroke();
}

function notebookStrokeBounds(stroke)
{
  const xs = stroke.points.map(function(p){ return p.x; }),
        ys = stroke.points.map(function(p){ return p.y; });

  return { x1: Math.min.apply(null, xs), y1: Math.min.apply(null, ys), x2: Math.max.apply(null, xs), y2: Math.max.apply(null, ys) };
}

function notebookShapeBounds(shape)
{
  return { x1: Math.min(shape.x1, shape.x2), y1: Math.min(shape.y1, shape.y2), x2: Math.max(shape.x1, shape.x2), y2: Math.max(shape.y1, shape.y2) };
}

function notebookTextBounds(text)
{
  return { x1: text.x, y1: text.y, x2: text.x + text.width, y2: text.y + text.height };
}

function notebookItemBounds(page, sel)
{
  if (sel.kind === 'stroke')
    return notebookStrokeBounds(page.strokes[sel.index]);

  if (sel.kind === 'shape')
    return notebookShapeBounds(page.shapes[sel.index]);

  if (sel.kind === 'text')
    return notebookTextBounds(page.texts[sel.index]);

  return null;
}

function redrawNotebookPage(pageIndex)
{
  if (!nbData || !nbData.pages[pageIndex])
    return;

  const pageEl = document.querySelector('.notebook-page[data-page-index="' + pageIndex + '"]');

  if (!pageEl)
    return;

  const canvas = pageEl.querySelector('.notebook-ink-canvas'),
        ctx = canvas.getContext('2d'),
        page = nbData.pages[pageIndex];

  // The context carries a persistent devicePixelRatio scale (applied once when
  // the canvas was created), so clears/draws use logical page coordinates -
  // canvas.width/height here would be the larger raw buffer size and over-clear.
  ctx.clearRect(0, 0, page.width, page.height);

  const activeHere = nbActive && nbActive.pageIndex === pageIndex;

  if (activeHere && (nbActive.kind === 'erase' || nbActive.kind === 'move'))
  {
    // These mutate already-committed strokes/shapes in place rather than adding
    // a new one, so the cached bitmap (which reflects the *previous* commit)
    // can't be reused for them - has to be a real redraw from current data.
    page.strokes.forEach(function(s){ drawNotebookStroke(ctx, s); });
    page.shapes.forEach(function(s){ drawNotebookShape(ctx, s); });
  }
  else
  {
    const cached = nbCommittedCache[pageIndex];

    if (cached)
      ctx.drawImage(cached, 0, 0, page.width, page.height);
    else
    {
      page.strokes.forEach(function(s){ drawNotebookStroke(ctx, s); });
      page.shapes.forEach(function(s){ drawNotebookShape(ctx, s); });
    }

    if (activeHere && nbActive.kind === 'stroke')
      drawNotebookStroke(ctx, nbActive.stroke);
    else if (activeHere && nbActive.kind === 'shape')
      drawNotebookShape(ctx, nbActive.shape);
  }

  if (nbImport && nbImport.pageIndex === pageIndex)
  {
    const iw = nbImport.w * nbImport.scale,
          ih = nbImport.h * nbImport.scale;

    // Ghost preview of the pending vector, rendered through the exact same
    // stroke pipeline that committed ink uses, just translated/scaled and
    // slightly transparent until the user accepts the placement.
    ctx.save();
    ctx.translate(nbImport.x, nbImport.y);
    ctx.scale(nbImport.scale, nbImport.scale);
    nbImport.strokes.forEach(function(s){ drawNotebookStroke(ctx, s, 0.75); });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#d4a843';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(nbImport.x - 6, nbImport.y - 6, iw + 12, ih + 12);
    ctx.setLineDash([]);
    ctx.fillStyle = '#d4a843';
    ctx.fillRect(nbImport.x + iw + 1, nbImport.y + ih + 1, 10, 10);
    ctx.restore();
  }

  if (nbActive && nbActive.kind === 'marquee' && nbActive.pageIndex === pageIndex)
  {
    const mx = Math.min(nbActive.x1, nbActive.x2),
          my = Math.min(nbActive.y1, nbActive.y2),
          mw = Math.abs(nbActive.x2 - nbActive.x1),
          mh = Math.abs(nbActive.y2 - nbActive.y1);

    ctx.save();
    ctx.fillStyle = 'rgba(212,168,67,0.12)';
    ctx.strokeStyle = 'rgba(212,168,67,0.8)';
    ctx.lineWidth = 1;
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeRect(mx, my, mw, mh);
    ctx.restore();
  }

  if (pageIndex === nbCurrentPage)
  {
    nbSelection.forEach(function(sel)
    {
      const b = notebookItemBounds(page, sel);

      if (!b)
        return;

      ctx.save();
      ctx.strokeStyle = '#d4a843';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(b.x1 - 4, b.y1 - 4, (b.x2 - b.x1) + 8, (b.y2 - b.y1) + 8);
      ctx.restore();
    });
  }
}

function updateNotebookPageIndicator()
{
  const el = document.getElementById('notebook-page-indicator');

  if (el && nbData)
    el.textContent = (nbCurrentPage + 1) + ' / ' + nbData.pages.length;
}

// While the user free-scrolls, the observer keeps nbCurrentPage in sync with
// whatever's actually on screen. But programmatic navigation (add/delete/prev/
// next page) sets nbCurrentPage deliberately and then scrolls to match - and an
// observer callback queued from the *previous* scroll position can fire just
// after, stomping the deliberate value before the new scroll position is even
// reflected. Suppressing the observer for a short window after any
// programmatic jump avoids that race.
let nbSuppressObserverUntil = 0;

function setupNotebookPageObserver()
{
  if (nbPageObserver)
    nbPageObserver.disconnect();

  const container = document.getElementById('notebook-pages');

  nbPageObserver = new IntersectionObserver(function(entries)
  {
    if (Date.now() < nbSuppressObserverUntil)
      return;

    let best = null;

    entries.forEach(function(entry)
    {
      if (entry.isIntersecting && (!best || entry.intersectionRatio > best.intersectionRatio))
        best = entry;
    });

    if (best)
    {
      nbCurrentPage = parseInt(best.target.dataset.pageIndex, 10);
      updateNotebookPageIndicator();
    }
  }, { root: container, threshold: [0.5] });

  document.querySelectorAll('.notebook-page').forEach(function(el)
  {
    nbPageObserver.observe(el);
  });
}

function notebookScrollToPage(index)
{
  const pageEl = document.querySelector('.notebook-page[data-page-index="' + index + '"]');

  if (pageEl)
    pageEl.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function notebookGoToPage(index)
{
  nbCurrentPage = index;
  nbSuppressObserverUntil = Date.now() + 400;
  updateNotebookPageIndicator();
  notebookScrollToPage(index);
  updateMapToolbarVisibility();
}

function notebookPrevPage()
{
  if (!nbData || nbCurrentPage <= 0)
    return;

  notebookGoToPage(nbCurrentPage - 1);
}

function notebookNextPage()
{
  if (!nbData || nbCurrentPage >= nbData.pages.length - 1)
    return;

  notebookGoToPage(nbCurrentPage + 1);
}

function notebookAddPage()
{
  if (!nbData)
    return;

  const lastPage = nbData.pages[nbData.pages.length - 1],
        newPage =
        {
          width: lastPage.width,
          height: lastPage.height,
          background: { type: (lastPage.background.type === 'pdf') ? 'blank' : lastPage.background.type },
          strokes: [],
          shapes: [],
          texts: []
        };

  nbData.pages.push(newPage);

  renderNotebookPages();
  commitNotebookChange();
  notebookGoToPage(nbData.pages.length - 1);
}

function notebookDeletePage()
{
  if (!nbData)
    return;

  if (nbData.pages.length <= 1)
  {
    alert('A notebook needs at least one page.');
    return;
  }

  if (!confirm('Delete this page?'))
    return;

  const targetPage = nbCurrentPage;

  nbData.pages.splice(targetPage, 1);
  nbSelection = [];

  // Page indices shift under a pending vector import - drop it rather than
  // letting it land on the wrong page.
  if (nbImport)
    cancelNotebookVectorImport();

  renderNotebookPages();
  commitNotebookChange();
  notebookGoToPage(Math.min(targetPage, nbData.pages.length - 1));
}

// ── Undo / redo ──

function notebookSnapshotForUndo(pageIndex)
{
  const page = nbData.pages[pageIndex];

  var snapFields = { strokes: page.strokes, shapes: page.shapes, texts: page.texts };
  if (page.type === 'map') snapFields.pins = page.pins || [];

  nbUndoStack.push({ pageIndex: pageIndex, snapshot: JSON.parse(JSON.stringify(snapFields)) });
  nbRedoStack = [];

  if (nbUndoStack.length > 50)
    nbUndoStack.shift();
}

function notebookRestoreSnapshot(entry, stack)
{
  const page = nbData.pages[entry.pageIndex],
        inverse = JSON.parse(JSON.stringify({ strokes: page.strokes, shapes: page.shapes, texts: page.texts }));

  stack.push({ pageIndex: entry.pageIndex, snapshot: inverse });

  page.strokes = entry.snapshot.strokes;
  page.shapes = entry.snapshot.shapes;
  page.texts = entry.snapshot.texts;

  nbSelection = [];
  nbCurrentPage = entry.pageIndex;

  rebuildNotebookCommittedCache(entry.pageIndex);
  renderNotebookTextLayerForPage(entry.pageIndex);
  redrawNotebookPage(entry.pageIndex);
  commitNotebookChange();
}

function notebookUndo()
{
  if (!nbUndoStack.length)
    return;

  notebookRestoreSnapshot(nbUndoStack.pop(), nbRedoStack);
}

function notebookRedo()
{
  if (!nbRedoStack.length)
    return;

  notebookRestoreSnapshot(nbRedoStack.pop(), nbUndoStack);
}

document.addEventListener
(
  'keydown',
  function(e)
  {
    if (currentAppType !== 'notebook' || !nbData)
      return;

    const tag = (document.activeElement && document.activeElement.tagName) || '';

    if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable))
      return;

    if (nbImport)
    {
      if (e.key === 'Enter')
      {
        e.preventDefault();
        acceptNotebookVectorImport();
      }
      else if (e.key === 'Escape')
      {
        e.preventDefault();
        cancelNotebookVectorImport();
      }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')
      {
        e.preventDefault();

        const nudge = e.shiftKey ? 10 : 1;

        if (e.key === 'ArrowLeft')  nbImport.x -= nudge;
        if (e.key === 'ArrowRight') nbImport.x += nudge;
        if (e.key === 'ArrowUp')    nbImport.y -= nudge;
        if (e.key === 'ArrowDown')  nbImport.y += nudge;

        redrawNotebookPage(nbImport.pageIndex);
      }

      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && nbSelection.length)
    {
      notebookSnapshotForUndo(nbCurrentPage);
      notebookDeleteSelection();
      rebuildNotebookCommittedCache(nbCurrentPage);
      commitNotebookChange();
      renderNotebookTextLayerForPage(nbCurrentPage);
      redrawNotebookPage(nbCurrentPage);
    }
    else if ((e.ctrlKey || e.metaKey) && (e.code === 'Equal' || e.code === 'NumpadAdd'))
    {
      // e.code (the physical key) rather than e.key, since Ctrl+Plus is
      // usually pressed as Ctrl+Shift+= - e.key would be '+' there, not '=',
      // and checking only '=' silently missed that case.
      e.preventDefault();
      notebookZoomIn();
    }
    else if ((e.ctrlKey || e.metaKey) && (e.code === 'Minus' || e.code === 'NumpadSubtract'))
    {
      e.preventDefault();
      notebookZoomOut();
    }
    else if ((e.ctrlKey || e.metaKey) && (e.code === 'Digit0' || e.code === 'Numpad0'))
    {
      e.preventDefault();
      notebookZoomReset();
    }
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z')
    {
      e.preventDefault();
      notebookUndo();
    }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')))
    {
      e.preventDefault();
      notebookRedo();
    }
  }
);

// Ctrl+wheel zoom (the standard convention - browsers, Figma, Maps, etc.).
// Must be a non-passive listener for preventDefault() to actually suppress
// the page's own scroll instead of zooming and scrolling at the same time.
document.getElementById('notebook-pages').addEventListener
(
  'wheel',
  function(e)
  {
    if (!e.ctrlKey)
      return;

    e.preventDefault();

    if (e.deltaY < 0)
      notebookZoomIn();
    else if (e.deltaY > 0)
      notebookZoomOut();
  },
  { passive: false }
);

function notebookDeleteSelection()
{
  const page = nbData.pages[nbCurrentPage],
        byKind = { stroke: [], shape: [], text: [] };

  nbSelection.forEach(function(s){ byKind[s.kind].push(s.index); });

  [['stroke','strokes'], ['shape','shapes'], ['text','texts']].forEach(function(pair)
  {
    const indices = byKind[pair[0]].sort(function(a, b){ return b - a; });

    indices.forEach(function(idx)
    {
      page[pair[1]].splice(idx, 1);
    });
  });

  nbSelection = [];
}

function notebookHitTest(page, pt)
{
  for (let i = page.texts.length - 1; i >= 0; i--)
  {
    const b = notebookTextBounds(page.texts[i]);

    if (pt.x >= b.x1 && pt.x <= b.x2 && pt.y >= b.y1 && pt.y <= b.y2)
      return { kind: 'text', index: i };
  }

  for (let i = page.shapes.length - 1; i >= 0; i--)
  {
    const b = notebookShapeBounds(page.shapes[i]);

    if (pt.x >= b.x1 - 6 && pt.x <= b.x2 + 6 && pt.y >= b.y1 - 6 && pt.y <= b.y2 + 6)
      return { kind: 'shape', index: i };
  }

  for (let i = page.strokes.length - 1; i >= 0; i--)
  {
    const pts = page.strokes[i].points;

    for (let j = 0; j < pts.length; j++)
    {
      if (Math.hypot(pts[j].x - pt.x, pts[j].y - pt.y) <= 10)
        return { kind: 'stroke', index: i };
    }
  }

  return null;
}

function notebookItemsInRect(page, rect)
{
  const rx1 = Math.min(rect.x1, rect.x2),
        ry1 = Math.min(rect.y1, rect.y2),
        rx2 = Math.max(rect.x1, rect.x2),
        ry2 = Math.max(rect.y1, rect.y2),
        result = [];

  function intersects(b)
  {
    return (b.x2 >= rx1) && (b.x1 <= rx2) && (b.y2 >= ry1) && (b.y1 <= ry2);
  }

  page.strokes.forEach(function(s, i){ if (intersects(notebookStrokeBounds(s))) result.push({ kind: 'stroke', index: i }); });
  page.shapes.forEach(function(s, i){ if (intersects(notebookShapeBounds(s))) result.push({ kind: 'shape', index: i }); });
  page.texts.forEach(function(s, i){ if (intersects(notebookTextBounds(s))) result.push({ kind: 'text', index: i }); });

  return result;
}

function notebookMoveSelection(page, dx, dy)
{
  nbSelection.forEach(function(sel)
  {
    if (sel.kind === 'stroke')
    {
      page.strokes[sel.index].points.forEach(function(p){ p.x += dx; p.y += dy; });
    }
    else if (sel.kind === 'shape')
    {
      const s = page.shapes[sel.index];
      s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy;
    }
    else if (sel.kind === 'text')
    {
      page.texts[sel.index].x += dx;
      page.texts[sel.index].y += dy;
    }
  });
}

// ── Text boxes (DOM overlay, not canvas-drawn, so editing stays native) ──

function renderNotebookTextLayerForPage(pageIndex)
{
  const pageEl = document.querySelector('.notebook-page[data-page-index="' + pageIndex + '"]');

  if (!pageEl || !nbData)
    return;

  const layer = pageEl.querySelector('.notebook-text-layer'),
        page = nbData.pages[pageIndex];

  layer.innerHTML = '';

  page.texts.forEach(function(t, i)
  {
    const div = document.createElement('div');
    div.className = 'notebook-text-box';
    div.contentEditable = 'true';
    div.dataset.textIndex = i;
    div.style.left = t.x + 'px';
    div.style.top = t.y + 'px';
    div.style.width = t.width + 'px';
    div.style.minHeight = t.height + 'px';
    div.style.color = t.color;
    div.style.fontSize = t.fontSize + 'px';
    div.textContent = t.text;

    div.addEventListener('focus', function()
    {
      notebookSnapshotForUndo(pageIndex);
    });

    div.addEventListener('blur', function()
    {
      t.text = div.textContent;
      t.height = Math.max(40, div.offsetHeight);
      commitNotebookChange();
    });

    div.addEventListener('pointerdown', function(e)
    {
      e.stopPropagation();
    });

    layer.appendChild(div);
  });
}

function notebookCreateTextBoxAt(pageIndex, x, y)
{
  notebookSnapshotForUndo(pageIndex);

  nbData.pages[pageIndex].texts.push({ x: x, y: y, width: 220, height: 40, color: nbColor, fontSize: 16, text: '' });

  renderNotebookTextLayerForPage(pageIndex);

  const idx = nbData.pages[pageIndex].texts.length - 1,
        pageEl = document.querySelector('.notebook-page[data-page-index="' + pageIndex + '"]'),
        el = pageEl && pageEl.querySelector('.notebook-text-box[data-text-index="' + idx + '"]');

  // Focusing synchronously inside the same pointerdown that created this element
  // gets clobbered by the browser's own default mousedown focus-handling; deferring
  // it past that default action (a 0ms timeout is the standard fix) makes it stick.
  if (el)
    setTimeout(function(){ el.focus(); }, 0);

  setNotebookTool('select');
}
