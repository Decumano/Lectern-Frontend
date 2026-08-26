// Notebook: PDF and SVG import, PNG export
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── PDF import ──

function triggerNotebookPdfImport()
{
  document.getElementById('notebook-pdf-input').click();
}

async function handleNotebookPdfImport(e)
{
  const file = e.target.files[0];
  e.target.value = '';

  if (!file || !nbData)
    return;

  if (typeof pdfjsLib === 'undefined')
  {
    alert('PDF support is still loading - please try again in a moment.');
    return;
  }

  const arrayBuffer = await file.arrayBuffer(),
        bytes = new Uint8Array(arrayBuffer);

  let base64 = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize)
    base64 += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));

  base64 = btoa(base64);

  try
  {
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise,
          newPages = [];

    for (let p = 1; p <= pdfDoc.numPages; p++)
    {
      const pdfPage = await pdfDoc.getPage(p),
            viewport = pdfPage.getViewport({ scale: 1.5 });

      newPages.push
      (
        {
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
          background: { type: 'pdf', pdfPageIndex: p - 1 },
          strokes: [],
          shapes: [],
          texts: []
        }
      );
    }

    nbData.pdfData = 'data:application/pdf;base64,' + base64;
    nbData.pages = nbData.pages.concat(newPages);
    const firstNewPageIndex = nbData.pages.length - newPages.length;

    nbPdfDocCache = pdfDoc;
    nbPdfDocCacheKey = nbData.pdfData;

    renderNotebookPages();
    commitNotebookChange();
    notebookGoToPage(firstNewPageIndex);
  }
  catch(err)
  {
    console.warn('PDF import error', err);
    alert('Could not import that PDF.');
  }
}

// ── SVG vector import ──

function triggerNotebookVectorImport()
{
  document.getElementById('notebook-svg-input').click();
}

async function handleNotebookVectorImport(e)
{
  const file = e.target.files[0];
  e.target.value = '';

  if (!file || !nbData)
    return;

  const text = await file.text(),
        converted = convertSvgToNotebookStrokes(text);

  if (!converted || !converted.strokes.length)
  {
    alert('No drawable vector shapes were found in that SVG.');
    return;
  }

  const page = nbData.pages[nbCurrentPage],
        // Start at a comfortable size: natural size when it fits, otherwise
        // shrunk to at most ~70% of the page.
        scale = Math.min(1, (page.width * 0.7) / converted.w, (page.height * 0.7) / converted.h);

  nbImport = {
    pageIndex: nbCurrentPage,
    strokes: converted.strokes,
    w: converted.w,
    h: converted.h,
    scale: scale,
    x: (page.width - converted.w * scale) / 2,
    y: (page.height - converted.h * scale) / 2
  };

  document.getElementById('nb-import-bar').style.display = 'flex';
  redrawNotebookPage(nbCurrentPage);
}

// Parses an SVG path's `d` into flattened polyline runs (one per subpath),
// evaluating lines and quadratic/cubic curves directly. The DOM alternative,
// getPointAtLength, re-walks the whole segment list on every call, which
// turns dense sampling of big paths (Excalidraw freedraw exports easily
// reach hundreds of curve segments each) quadratic - tens of seconds for a
// large drawing - while direct evaluation keeps the import linear.
// Returns null for anything it doesn't cover (arcs, malformed data), so the
// caller can fall back to the slow-but-complete DOM sampler.
function flattenSvgPathData(d)
{
  const tokens = d.match(/[A-Za-z]|-?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);

  if (!tokens || !tokens.length)
    return null;

  const runs = [];

  let run = null,
      i = 0,
      cx = 0, cy = 0,       // current point
      sx = 0, sy = 0,       // subpath start (Z closes back to it)
      pcx = null, pcy = null, // previous curve control point (S/T reflection)
      prevCmd = '';

  function num()
  {
    const v = parseFloat(tokens[i++]);
    return isFinite(v) ? v : NaN;
  }

  function quadTo(qx, qy, x, y)
  {
    const x0 = cx, y0 = cy;

    for (let t = 1; t <= 8; t++)
    {
      const u = t / 8, v = 1 - u;
      run.push({ x: v * v * x0 + 2 * v * u * qx + u * u * x, y: v * v * y0 + 2 * v * u * qy + u * u * y });
    }

    cx = x; cy = y; pcx = qx; pcy = qy;
  }

  function cubicTo(x1, y1, x2, y2, x, y)
  {
    const x0 = cx, y0 = cy;

    for (let t = 1; t <= 10; t++)
    {
      const u = t / 10, v = 1 - u;
      run.push
      (
        {
          x: v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x,
          y: v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y
        }
      );
    }

    cx = x; cy = y; pcx = x2; pcy = y2;
  }

  while (i < tokens.length)
  {
    let cmd = tokens[i];

    if (/^[A-Za-z]$/.test(cmd))
      i++;
    else
      cmd = (prevCmd === 'M') ? 'L' : (prevCmd === 'm') ? 'l' : prevCmd; // implicit command repetition

    const rel = (cmd >= 'a');
    let x, y, x1, y1, x2, y2;

    if (!run && cmd !== 'M' && cmd !== 'm')
      return null; // drawing command before any moveto

    switch (cmd)
    {
      case 'M': case 'm':
        x = num(); y = num();
        if (rel) { x += cx; y += cy; }
        if (run && run.length > 1) runs.push(run);
        run = [{ x: x, y: y }];
        cx = sx = x; cy = sy = y; pcx = pcy = null;
        break;

      case 'L': case 'l':
        x = num(); y = num();
        if (rel) { x += cx; y += cy; }
        run.push({ x: x, y: y }); cx = x; cy = y; pcx = pcy = null;
        break;

      case 'H': case 'h':
        x = num(); if (rel) x += cx;
        run.push({ x: x, y: cy }); cx = x; pcx = pcy = null;
        break;

      case 'V': case 'v':
        y = num(); if (rel) y += cy;
        run.push({ x: cx, y: y }); cy = y; pcx = pcy = null;
        break;

      case 'Q': case 'q':
        x1 = num(); y1 = num(); x = num(); y = num();
        if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
        quadTo(x1, y1, x, y);
        break;

      case 'T': case 't':
        x = num(); y = num();
        if (rel) { x += cx; y += cy; }
        x1 = (pcx === null || !/^[QqTt]$/.test(prevCmd)) ? cx : 2 * cx - pcx;
        y1 = (pcy === null || !/^[QqTt]$/.test(prevCmd)) ? cy : 2 * cy - pcy;
        quadTo(x1, y1, x, y);
        break;

      case 'C': case 'c':
        x1 = num(); y1 = num(); x2 = num(); y2 = num(); x = num(); y = num();
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        cubicTo(x1, y1, x2, y2, x, y);
        break;

      case 'S': case 's':
        x2 = num(); y2 = num(); x = num(); y = num();
        if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
        x1 = (pcx === null || !/^[CcSs]$/.test(prevCmd)) ? cx : 2 * cx - pcx;
        y1 = (pcy === null || !/^[CcSs]$/.test(prevCmd)) ? cy : 2 * cy - pcy;
        cubicTo(x1, y1, x2, y2, x, y);
        break;

      case 'Z': case 'z':
        if (!run || (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])))
          return null; // numbers after Z aren't valid - bail rather than loop
        run.push({ x: sx, y: sy }); cx = sx; cy = sy; pcx = pcy = null;
        break;

      default:
        return null; // arcs and anything unrecognized use the DOM sampler
    }

    if (!run || isNaN(cx) || isNaN(cy))
      return null;

    prevCmd = cmd;
  }

  if (run && run.length > 1)
    runs.push(run);

  return runs.length ? runs : null;
}

// Thins a polyline to roughly evenly spaced points at least 1.5 units apart
// (and at most maxPoints total), always preserving the endpoints.
function thinRunByArcLength(run, maxPoints)
{
  if (run.length < 3)
    return run;

  let len = 0;

  for (let i = 1; i < run.length; i++)
    len += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);

  const step = Math.max(1.5, len / maxPoints),
        out = [run[0]];

  let acc = 0;

  for (let i = 1; i < run.length - 1; i++)
  {
    acc += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);

    if (acc >= step)
    {
      out.push(run[i]);
      acc = 0;
    }
  }

  out.push(run[run.length - 1]);
  return out;
}

// Converts SVG markup into notebook pen strokes. Every geometry element
// (path, line, rect, circle, ellipse, polyline, polygon) is sampled along its
// outline with getPointAtLength and mapped through its cumulative transform,
// so the result is plain point lists in a common coordinate space - exactly
// the {points:[{x,y,w}]} shape the notebook's own pen produces, which is what
// lets the import render/erase/select like hand-drawn ink afterwards.
// Filled geometry additionally becomes fill:true strokes whose points trace
// the shape's outline(s), with `breaks` marking subpath starts - the renderer
// paints those as even-odd filled polygons, which is what keeps solid-color
// art (e.g. Excalidraw exports, where even pen strokes and text are filled
// paths) looking like the browser's rendering instead of hollow outlines.
// Returns { strokes, w, h } with points normalized so their bounds start at
// (0,0), or null if the markup isn't parseable SVG.
function convertSvgToNotebookStrokes(svgText)
{
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');

  if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.nodeName.toLowerCase() !== 'svg')
    return null;

  // The SVG has to actually be laid out in the live document for the geometry
  // APIs (getTotalLength / getPointAtLength / getScreenCTM) to work, so it's
  // parked far off-screen for the duration of the conversion.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';

  const svgEl = document.importNode(doc.documentElement, true);
  host.appendChild(svgEl);
  document.body.appendChild(host);

  try
  {
    const rootCTM = svgEl.getScreenCTM();

    if (!rootCTM)
      return null;

    const rootInv = rootCTM.inverse(),
          strokes = [],
          MAX_ELEMENTS = 2000,
          MAX_POINTS_PER_ELEMENT = 600,
          round = function(v){ return Math.round(v * 100) / 100; };

    let els = Array.prototype.slice.call(svgEl.querySelectorAll('path,line,rect,circle,ellipse,polyline,polygon'));

    if (els.length > MAX_ELEMENTS)
      els = els.slice(0, MAX_ELEMENTS);

    // Phase 1: resolve each element's effective style and transform up front,
    // keeping the later geometry work free of layout queries.
    const jobs = [];

    els.forEach(function(el)
    {
      if (typeof el.getTotalLength !== 'function')
        return;

      const cs = getComputedStyle(el);

      if (cs.display === 'none' || cs.visibility === 'hidden')
        return;

      const ctm = el.getScreenCTM();

      if (!ctm)
        return;

      const m = rootInv.multiply(ctm),
            // Determinant-based estimate of the transform's uniform scale, so
            // stroke widths survive scaled/nested groups reasonably.
            mScale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

      const tag = el.nodeName.toLowerCase(),
            fillColor = (cs.fill && cs.fill !== 'none' && tag !== 'line') ? cs.fill : null,
            strokeColor = (cs.stroke && cs.stroke !== 'none') ? cs.stroke : null;

      if (!fillColor && !strokeColor)
        return;

      jobs.push({
        el: el,
        m: m,
        width: Math.max(0.5, (parseFloat(cs.strokeWidth) || 1) * mScale),
        fillColor: fillColor,
        fillRule: cs.fillRule,
        strokeColor: strokeColor
      });
    });

    // Phase 2: turn each element into local-space polyline runs, one per
    // subpath - separate runs are what keep glyph holes and disjoint pieces
    // from getting connected. Paths flatten analytically (see
    // flattenSvgPathData for why the DOM sampling APIs are avoided);
    // everything else - rect/circle/ellipse/line/poly*, plus the rare path
    // with arcs - samples via getPointAtLength, which is fine for those
    // cheap single-geometry elements.
    jobs.forEach(function(job)
    {
      let rawRuns = null;

      if (job.el.nodeName.toLowerCase() === 'path')
        rawRuns = flattenSvgPathData(job.el.getAttribute('d') || '');

      if (!rawRuns)
      {
        let len;
        try { len = job.el.getTotalLength(); }
        catch(err) { return; }

        if (!isFinite(len) || len <= 0)
          return;

        const step = Math.max(1.5, len / MAX_POINTS_PER_ELEMENT),
              run = [];

        for (let d = 0; d < len; d += step)
        {
          const p = job.el.getPointAtLength(d);
          run.push({ x: p.x, y: p.y });
        }

        const pEnd = job.el.getPointAtLength(len);
        run.push({ x: pEnd.x, y: pEnd.y });
        rawRuns = [run];
      }

      // Map into the root coordinate space, then thin by arc length so the
      // dense curve flattening doesn't bloat the stored stroke data.
      const m = job.m,
            runs = [];

      rawRuns.forEach(function(rawRun)
      {
        const t = rawRun.map(function(p)
        {
          return { x: round(m.a * p.x + m.c * p.y + m.e), y: round(m.b * p.x + m.d * p.y + m.f) };
        });

        const thinned = thinRunByArcLength(t, MAX_POINTS_PER_ELEMENT);

        if (thinned.length >= 2)
          runs.push(thinned);
      });

      if (!runs.length)
        return;

      // Fill first, outline second, so the outline paints on top just like
      // the browser does.
      if (job.fillColor)
      {
        const points = [], breaks = [];

        runs.forEach(function(run)
        {
          if (points.length)
            breaks.push(points.length);

          run.forEach(function(p){ points.push({ x: p.x, y: p.y, w: 1 }); });
        });

        if (points.length >= 3)
        {
          const stroke = { tool: 'pen', fill: true, color: job.fillColor, baseWidth: 1, points: points, breaks: breaks };

          if (job.fillRule === 'evenodd')
            stroke.fillRule = 'evenodd';

          strokes.push(stroke);
        }
      }

      if (job.strokeColor)
      {
        runs.forEach(function(run)
        {
          strokes.push({
            tool: 'pen',
            color: job.strokeColor,
            baseWidth: job.width,
            points: run.map(function(p){ return { x: p.x, y: p.y, w: job.width }; })
          });
        });
      }
    });

    if (!strokes.length)
      return { strokes: [], w: 1, h: 1 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    strokes.forEach(function(s)
    {
      s.points.forEach(function(p)
      {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
    });

    strokes.forEach(function(s)
    {
      s.points.forEach(function(p) { p.x -= minX; p.y -= minY; });
    });

    return { strokes: strokes, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }
  finally
  {
    document.body.removeChild(host);
  }
}

// Bakes the pending import into the page: placement offset/scale are applied
// to every point, then the strokes join page.strokes as ordinary pen ink
// (undoable, erasable, selectable, saved with the file).
function acceptNotebookVectorImport()
{
  if (!nbImport || !nbData)
    return;

  const imp = nbImport,
        page = nbData.pages[imp.pageIndex];

  if (!page)
  {
    cancelNotebookVectorImport();
    return;
  }

  notebookSnapshotForUndo(imp.pageIndex);

  imp.strokes.forEach(function(s)
  {
    const stroke = {
      tool: s.tool,
      color: s.color,
      baseWidth: Math.max(0.5, s.baseWidth * imp.scale),
      points: s.points.map(function(p)
      {
        return {
          x: imp.x + p.x * imp.scale,
          y: imp.y + p.y * imp.scale,
          w: Math.max(0.5, (p.w || s.baseWidth) * imp.scale)
        };
      })
    };

    if (s.fill)
    {
      stroke.fill = true;

      if (s.fillRule)
        stroke.fillRule = s.fillRule;

      if (s.breaks && s.breaks.length)
        stroke.breaks = s.breaks.slice();
    }

    page.strokes.push(stroke);
  });

  nbImport = null;
  nbActive = null;
  document.getElementById('nb-import-bar').style.display = 'none';

  rebuildNotebookCommittedCache(imp.pageIndex);
  commitNotebookChange();
  redrawNotebookPage(imp.pageIndex);
}

function cancelNotebookVectorImport()
{
  if (!nbImport)
    return;

  const pageIndex = nbImport.pageIndex;

  nbImport = null;
  nbActive = null;
  document.getElementById('nb-import-bar').style.display = 'none';
  redrawNotebookPage(pageIndex);
}

function notebookVectorScaleBy(factor)
{
  if (!nbImport)
    return;

  nbImport.scale = Math.max(0.05, Math.min(20, nbImport.scale * factor));
  redrawNotebookPage(nbImport.pageIndex);
}

// ── Export (composites each page to a PNG, embedded as <img> in the wrapped HTML) ──

async function buildNotebookExportHtml(file)
{
  const data = parseNotebookContent(file.content || '');

  let imagesHtml = '';

  for (let i = 0; i < data.pages.length; i++)
  {
    const page = data.pages[i],
          canvas = document.createElement('canvas');

    canvas.width = page.width;
    canvas.height = page.height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (page.type === 'map' && page.imageData)
    {
      try
      {
        await new Promise(function(resolve, reject)
        {
          const mapImg = new Image();
          mapImg.onload = function()
          {
            ctx.drawImage(mapImg, 0, 0, canvas.width, canvas.height);
            resolve();
          };
          mapImg.onerror = reject;
          mapImg.src = page.imageData;
        });
		
		ctx.drawImage(mapImg, 0, 0, canvas.width, canvas.height);
      }
      catch(e)
      {
        console.warn('Notebook export map render error', e);
      }
    }
    else if (page.background.type === 'pdf' && data.pdfData && typeof pdfjsLib !== 'undefined')
    {
      try
      {
        const base64 = data.pdfData.split(',').pop(),
              binary = atob(base64),
              bytes = new Uint8Array(binary.length);

        for (let k = 0; k < binary.length; k++)
          bytes[k] = binary.charCodeAt(k);

        const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise,
              pdfPage = await pdfDoc.getPage(page.background.pdfPageIndex + 1),
              scale = canvas.width / pdfPage.getViewport({ scale: 1 }).width,
              viewport = pdfPage.getViewport({ scale: scale });

        await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;
      }
      catch(e)
      {
        console.warn('Notebook export PDF render error', e);
      }
    }
    else if (page.background.type === 'ruled' || page.background.type === 'grid')
    {
      renderNotebookPageBackground(page, canvas);
    }

    page.strokes.forEach(function(s){ drawNotebookStroke(ctx, s); });
    page.shapes.forEach(function(s){ drawNotebookShape(ctx, s); });

    page.texts.forEach(function(t)
    {
      ctx.fillStyle = t.color;
      ctx.font = t.fontSize + 'px sans-serif';
      ctx.textBaseline = 'top';

      const words = (t.text || '').split(/\s+/);
      let line = '', y = t.y;
      const lineHeight = t.fontSize * 1.3;

      words.forEach(function(word)
      {
        const test = line ? (line + ' ' + word) : word;

        if (line && (ctx.measureText(test).width > t.width))
        {
          ctx.fillText(line, t.x, y);
          line = word;
          y += lineHeight;
        }
        else
        {
          line = test;
        }
      });

      if (line)
        ctx.fillText(line, t.x, y);
    });

    if (page.type === 'map')
    {
      (page.pins || []).forEach(function(pin)
      {
        const color = pin.color || PIN_COLORS[0],
              px = pin.x, py = pin.y, r = 9;

        ctx.save();
        ctx.translate(px, py - r * 2);
        ctx.beginPath();
        ctx.moveTo(0, r * 2);
        ctx.bezierCurveTo(-r * 1.1, r * 0.6, -r, -r * 0.3, 0, -r * 1.1);
        ctx.bezierCurveTo(r, -r * 0.3, r * 1.1, r * 0.6, 0, r * 2);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.5;
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        if (pin.label)
        {
          ctx.fillStyle = '#1f2937';
          ctx.font = '13px sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(pin.label, px + r + 4, py - r * 2);
        }
      });
    }

    imagesHtml += '<img class="notebook-page" src="' + canvas.toDataURL('image/png') + '" style="display:block;max-width:100%;margin:0 auto 24px;border:1px solid #ddd;">\n';
  }

  return wrapExportHtml(file.name, '<h1>' + escHtml(file.name) + '</h1>\n' + imagesHtml);
}
