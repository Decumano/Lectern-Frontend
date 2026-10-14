// Slides (presentations)
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── SLIDES ──
// A deck is plain text (.mdd), written so it reads and diffs like the other
// formats — see "Slides" in FLAVOR.md for the full spec:
//
//   ---
//   type: presentation
//   size: 1280x720
//   ---
//
//   --- 1 ---
//   {
//   background-color: #1b2a41;
//   background-image: url(assets/Campaign/ocean.png);
//   line: 80, 620, 1200, 620, #d4a843, 4;
//   }
//   [120, 200, 1040, 140, # The Northmarch Campaign]
//
// `--- N ---` starts a slide and it runs until the next one. The optional
// `{ … }` block right after it styles the slide the way CSS would, plus a few
// drawing declarations (line, rect, ellipse, stroke) for decorations. Each
// `[x, y, dx, dy, text]` is a text box in slide units, its text in the same
// Markdown+ the documents use.
//
// The in-memory model is parsed from the file and written back on every
// edit, so the visual editor and the source view are two faces of one text.

var SLIDE_DEFAULT_W = 1280;
var SLIDE_DEFAULT_H = 720;

var SLIDE_HEADER_RE = /^---[ \t]*(\d+)[ \t]*---[ \t]*$/;
var SLIDE_BLOCK_RE = /^\[[ \t]*(-?\d+(?:\.\d+)?)[ \t]*,[ \t]*(-?\d+(?:\.\d+)?)[ \t]*,[ \t]*(\d+(?:\.\d+)?)[ \t]*,[ \t]*(\d+(?:\.\d+)?)[ \t]*,[ \t]?/;

// Declarations applied to the slide element as CSS. Anything else in the
// style block is kept in the file but has no effect, the way a browser
// ignores a property it doesn't know.
var SLIDE_CSS_PROPS =
[
  'background', 'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat', 'background-blend-mode',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-shadow'
];

// Drawing declarations: decorations painted over the background, under the
// text, in the order they appear.
var SLIDE_DECO_PROPS = ['line', 'rect', 'ellipse', 'stroke'];

let slDeck = null;
let slIndex = 0;
let slSelection = null;     // { kind: 'block' | 'deco', index }
let slTool = 'select';
let slEditing = null;       // index of the text box being edited
let slView = 'visual';      // 'visual' | 'source'
let slUndoStack = [];
let slRedoStack = [];
let slDrag = null;
let slStrokeColor = '#d4a843';
let slFillColor = '#d4a843';
let slFillNone = true;
let slLineWidth = 4;
let slSourceTimer = null;
let slThumbTimer = null;
let slPresenting = false;
let slAssetCache = {};      // asset path -> { url, state }

// ── Parsing and serialization ──

function defaultSlidesContent()
{
  return  '---\ntype: presentation\nsize: ' + SLIDE_DEFAULT_W + 'x' + SLIDE_DEFAULT_H + '\n---\n\n' +
          '--- 1 ---\n' +
          '{\nbackground-color: #ffffff;\ncolor: #1a1a1a;\n}\n' +
          '[120, 260, 1040, 200, ;;\n# Title\n;;]\n';
}

function newSlideModel()
{
  return { decls: [], blocks: [], loose: [] };
}

// Splits a declaration list on ';', ignoring the ones inside parentheses —
// a data: URL (url(data:image/png;base64,…)) carries its own.
function splitSlideDecls(text)
{
  var out = [], depth = 0, quote = null, start = 0;

  for (var i = 0; i < text.length; i++)
  {
    var c = text[i];

    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0)
    {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }

  out.push(text.slice(start));
  return out;
}

function parseSlideDecls(text, into)
{
  splitSlideDecls(text).forEach(function(part)
  {
    var colon = part.indexOf(':');
    if (colon <= 0) return;

    var prop = part.slice(0, colon).trim().toLowerCase(),
        value = part.slice(colon + 1).trim();

    // The spec's own spelling, background/color, is read as background-color.
    if (prop === 'background/color') prop = 'background-color';

    if (prop && /^[a-z-]+$/.test(prop))
      into.push({ prop: prop, value: value });
  });
}

function parseSlides(content)
{
  var lines = String(content || '').replace(/\r\n?/g, '\n').split('\n'),
      deck = { meta: [], width: SLIDE_DEFAULT_W, height: SLIDE_DEFAULT_H, slides: [] },
      i = 0;

  if (lines.length && lines[0].trim() === '---')
  {
    for (var end = 1; end < lines.length; end++)
      if (lines[end].trim() === '---') break;

    if (end < lines.length)
    {
      for (var k = 1; k < end; k++)
      {
        var mm = /^([\w-]+)[ \t]*:[ \t]*(.*)$/.exec(lines[k]);
        if (mm) deck.meta.push([mm[1], mm[2].trim()]);
      }
      i = end + 1;
    }
  }

  deck.meta.forEach(function(kv)
  {
    var sm = kv[0] === 'size' && /^(\d+)\s*[x×]\s*(\d+)$/i.exec(kv[1]);
    if (sm)
    {
      deck.width = Math.max(100, Math.min(10000, parseInt(sm[1], 10)));
      deck.height = Math.max(100, Math.min(10000, parseInt(sm[2], 10)));
    }
  });

  var slide = null, block = null, inStyle = false;

  function finishBlock()
  {
    if (!block) return;

    var text = block.lines.join('\n').replace(/\s+$/, '');

    // The box closes with the last ']' — anything the text itself ends with
    // (a [TOC], a link label) sits before that one.
    if (text.endsWith(']'))
      text = text.slice(0, -1);

    block.text = text;
    delete block.lines;
    block = null;
  }

  for (; i < lines.length; i++)
  {
    var line = lines[i];

    if (SLIDE_HEADER_RE.test(line.trim()))
    {
      finishBlock();
      slide = newSlideModel();
      deck.slides.push(slide);
      inStyle = false;
      continue;
    }

    if (inStyle)
    {
      var close = line.indexOf('}');
      if (close !== -1)
      {
        parseSlideDecls(line.slice(0, close), slide.decls);
        inStyle = false;
      }
      else
        parseSlideDecls(line, slide.decls);
      continue;
    }

    var bm = SLIDE_BLOCK_RE.exec(line);

    if (bm)
    {
      // Text before the first header still deserves a slide to live on.
      if (!slide) { slide = newSlideModel(); deck.slides.push(slide); }

      finishBlock();
      block =
      {
        x: parseFloat(bm[1]), y: parseFloat(bm[2]),
        w: parseFloat(bm[3]), h: parseFloat(bm[4]),
        lines: [line.slice(bm[0].length)]
      };
      slide.blocks.push(block);
      continue;
    }

    if (block)
    {
      block.lines.push(line);
      continue;
    }

    // The style block is only recognised before the slide's first text box,
    // so a Markdown+ field card ({type: …}) inside a box is never eaten.
    if (slide && !slide.blocks.length && /^\s*\{/.test(line))
    {
      var body = line.replace(/^\s*\{/, ''),
          closeAt = body.indexOf('}');

      if (closeAt !== -1)
        parseSlideDecls(body.slice(0, closeAt), slide.decls);
      else
      {
        parseSlideDecls(body, slide.decls);
        inStyle = true;
      }
      continue;
    }

    if (line.trim())
    {
      if (!slide) { slide = newSlideModel(); deck.slides.push(slide); }
      slide.loose.push(line);
    }
  }

  finishBlock();

  if (!deck.slides.length)
    deck.slides.push(newSlideModel());

  return deck;
}

function slNum(n)
{
  return String(Math.round(n * 100) / 100);
}

function serializeSlides(deck)
{
  var meta = deck.meta.slice(),
      hasType = false,
      hasSize = false;

  meta = meta.map(function(kv)
  {
    if (kv[0] === 'type') hasType = true;
    if (kv[0] === 'size') { hasSize = true; return ['size', deck.width + 'x' + deck.height]; }
    return kv;
  });

  if (!hasType) meta.unshift(['type', 'presentation']);
  if (!hasSize) meta.push(['size', deck.width + 'x' + deck.height]);

  var out = '---\n' + meta.map(function(kv){ return kv[0] + ': ' + kv[1]; }).join('\n') + '\n---\n';

  deck.slides.forEach(function(slide, n)
  {
    out += '\n--- ' + (n + 1) + ' ---\n';

    if (slide.decls.length)
      out += '{\n' + slide.decls.map(function(d){ return d.prop + ': ' + d.value + ';'; }).join('\n') + '\n}\n';

    slide.loose.forEach(function(l){ out += l + '\n'; });

    slide.blocks.forEach(function(b)
    {
      out += '[' + slNum(b.x) + ', ' + slNum(b.y) + ', ' + slNum(b.w) + ', ' + slNum(b.h) + ', ' + (b.text || '') + ']\n';
    });
  });

  return out;
}

// ── Declarations ──

function slDeclValue(slide, prop)
{
  for (var i = slide.decls.length - 1; i >= 0; i--)
    if (slide.decls[i].prop === prop) return slide.decls[i].value;
  return null;
}

function slSetDecl(slide, prop, value)
{
  var found = false;

  slide.decls = slide.decls.filter(function(d)
  {
    if (d.prop !== prop) return true;
    if (found || value === null) return false;
    d.value = value;
    found = true;
    return true;
  });

  if (!found && value !== null)
  {
    // Styling goes before the drawings, which read better at the end.
    var at = slide.decls.findIndex(function(d){ return SLIDE_DECO_PROPS.indexOf(d.prop) !== -1; });
    if (at === -1) slide.decls.push({ prop: prop, value: value });
    else slide.decls.splice(at, 0, { prop: prop, value: value });
  }
}

function slDecoIndices(slide)
{
  var out = [];
  slide.decls.forEach(function(d, i){ if (SLIDE_DECO_PROPS.indexOf(d.prop) !== -1) out.push(i); });
  return out;
}

// A decoration's declaration as data: { kind, nums: [...], colors: [...] }.
function parseSlideDeco(decl)
{
  var parts = decl.value.split(',').map(function(s){ return s.trim(); });

  if (decl.prop === 'stroke')
  {
    var pts = [];
    parts.slice(2).forEach(function(p)
    {
      var xy = p.split(/\s+/).map(parseFloat);
      if (xy.length >= 2 && isFinite(xy[0]) && isFinite(xy[1])) pts.push({ x: xy[0], y: xy[1] });
    });
    return { kind: 'stroke', color: parts[0] || '#000000', width: parseFloat(parts[1]) || 3, points: pts };
  }

  var n = parts.slice(0, 4).map(parseFloat);
  if (n.some(function(v){ return !isFinite(v); })) return null;

  if (decl.prop === 'line')
    return { kind: 'line', x1: n[0], y1: n[1], x2: n[2], y2: n[3], color: parts[4] || '#000000', width: parseFloat(parts[5]) || 2 };

  return  {
            kind: decl.prop, x: n[0], y: n[1], w: n[2], h: n[3],
            fill: parts[4] || 'none', color: parts[5] || 'none', width: parseFloat(parts[6]) || 0
          };
}

function serializeSlideDeco(d)
{
  if (d.kind === 'stroke')
    return { prop: 'stroke', value: d.color + ', ' + slNum(d.width) + ', ' + d.points.map(function(p){ return slNum(p.x) + ' ' + slNum(p.y); }).join(', ') };

  if (d.kind === 'line')
    return { prop: 'line', value: [d.x1, d.y1, d.x2, d.y2].map(slNum).join(', ') + ', ' + d.color + ', ' + slNum(d.width) };

  return { prop: d.kind, value: [d.x, d.y, d.w, d.h].map(slNum).join(', ') + ', ' + d.fill + ', ' + d.color + ', ' + slNum(d.width) };
}

function slDecoBounds(d)
{
  if (d.kind === 'line')
    return { x: Math.min(d.x1, d.x2), y: Math.min(d.y1, d.y2), w: Math.abs(d.x2 - d.x1), h: Math.abs(d.y2 - d.y1) };

  if (d.kind === 'stroke')
  {
    if (!d.points.length) return { x: 0, y: 0, w: 0, h: 0 };
    var xs = d.points.map(function(p){ return p.x; }), ys = d.points.map(function(p){ return p.y; }),
        x1 = Math.min.apply(null, xs), y1 = Math.min.apply(null, ys);
    return { x: x1, y: y1, w: Math.max.apply(null, xs) - x1, h: Math.max.apply(null, ys) - y1 };
  }

  return { x: d.x, y: d.y, w: d.w, h: d.h };
}

function slMoveDeco(d, dx, dy)
{
  if (d.kind === 'line') { d.x1 += dx; d.y1 += dy; d.x2 += dx; d.y2 += dy; }
  else if (d.kind === 'stroke') d.points.forEach(function(p){ p.x += dx; p.y += dy; });
  else { d.x += dx; d.y += dy; }
}

// ── Assets (background images) ──
// Images live in the work folder as ordinary files and the deck names them
// by path (url(assets/Deck/ocean.png)), so a deck travels with its project.
// Without a work folder there is no project to put them in, and the image is
// embedded in the file as a data: URL instead.

var SLIDE_IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };

function slAssetPath(raw)
{
  return String(raw || '').trim().replace(/^\.\//, '').replace(/^\/+/, '');
}

function slIsExternalUrl(ref)
{
  return /^(data:|https?:|blob:)/i.test(ref);
}

// The displayable URL for an asset reference, or '' while it loads (the
// slide is re-rendered once it arrives).
function slAssetUrl(ref)
{
  ref = String(ref || '').trim();
  if (!ref) return '';
  if (slIsExternalUrl(ref)) return ref;

  var path = slAssetPath(ref),
      entry = slAssetCache[path];

  if (entry) return entry.url || '';
  if (!workFolderRoot) return '';

  slAssetCache[path] = { url: '', state: 'loading' };

  var ext = (path.split('.').pop() || '').toLowerCase();

  Platform.readWorkFileBinary(workFolderRoot, path, SLIDE_IMAGE_TYPES[ext] || '')
    .then(function(blob)
    {
      slAssetCache[path] = { url: URL.createObjectURL(blob), state: 'ready' };
      slRenderAll();
    })
    .catch(function(e)
    {
      console.warn('Slide image could not be read: ' + path, e);
      slAssetCache[path] = { url: '', state: 'error' };
    });

  return '';
}

// Rewrites every url(…) in a CSS value to something the page can display.
function slResolveCssUrls(value)
{
  return String(value).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, function(_, q, ref)
  {
    var url = slAssetUrl(ref);
    return url ? 'url("' + url.replace(/["\\\n]/g, '') + '")' : 'none';
  });
}

// The spec allows the bare forms `background-image: [path]` and a plain path;
// both mean url(path).
function slNormalizeImageValue(value)
{
  var v = String(value || '').trim(),
      bracket = /^\[(.*)\]$/.exec(v);

  if (bracket) return 'url(' + bracket[1].trim() + ')';
  if (v && !/[()]/.test(v) && !/^none$/i.test(v)) return 'url(' + v + ')';
  return v;
}

function slExtensionForBlob(blob, name)
{
  var fromName = /\.([a-z0-9]+)$/i.exec(name || '');
  if (fromName && SLIDE_IMAGE_TYPES[fromName[1].toLowerCase()]) return fromName[1].toLowerCase();

  var type = (blob.type || '').toLowerCase();
  for (var ext in SLIDE_IMAGE_TYPES)
    if (SLIDE_IMAGE_TYPES[ext] === type) return ext === 'jpeg' ? 'jpg' : ext;

  return 'png';
}

function slBlobToDataUrl(blob)
{
  return new Promise(function(resolve, reject)
  {
    var reader = new FileReader();
    reader.onload = function(){ resolve(String(reader.result)); };
    reader.onerror = function(){ reject(reader.error); };
    reader.readAsDataURL(blob);
  });
}

// Stores an image for the open deck and resolves the reference to write into
// it: a work-folder path, or (with no work folder) a data: URL.
async function slStoreImage(blob, sourceName)
{
  if (blob.size > 20 * 1024 * 1024)
    throw new Error('the image is larger than 20 MB');

  if (blob.type && blob.type.indexOf('image/') !== 0)
    throw new Error('that file is not an image');

  if (!workFolderRoot)
    return await slBlobToDataUrl(blob);

  var deckName = sanitizeFileName(files[currentFileId] && files[currentFileId].name) || 'Slides',
      ext = slExtensionForBlob(blob, sourceName),
      base = sanitizeFileName(String(sourceName || 'image').replace(/\.[^.]*$/, '').replace(/[?#].*$/, '')).replace(/\s+/g, '-') || 'image',
      dir = 'assets/' + deckName,
      rel = dir + '/' + base.slice(0, 60) + '-' + Math.random().toString(16).slice(2, 8) + '.' + ext;

  try { await Platform.createWorkFolder(workFolderRoot, 'assets'); } catch(e) {}
  try { await Platform.createWorkFolder(workFolderRoot, dir); } catch(e) {}

  await Platform.writeWorkFileBinary(workFolderRoot, rel, blob);

  slAssetCache[rel] = { url: URL.createObjectURL(blob), state: 'ready' };
  return rel;
}

// ── Rendering ──

// Markdown+ for one text box. The document renderer numbers headings and
// checkboxes through shared counters; those are saved and restored so
// rendering slides never disturbs an open document's preview.
function slRenderMarkdown(text)
{
  if (typeof marked === 'undefined')
    return escHtml(text || '');

  var saved = [documentHeadings, slugCounts, headingRenderCursor, checkboxRenderIndex];

  documentHeadings = [];
  slugCounts = {};
  headingRenderCursor = 0;
  checkboxRenderIndex = 0;

  try
  {
    return sanitizeHtml(marked.parser(marked.lexer(text || '')));
  }
  catch(e)
  {
    return escHtml(text || '');
  }
  finally
  {
    documentHeadings = saved[0];
    slugCounts = saved[1];
    headingRenderCursor = saved[2];
    checkboxRenderIndex = saved[3];
  }
}

function slSvg(tag, attrs)
{
  var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (var k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// The notebook's smoothing: a quadratic through each midpoint, so freehand
// lines look drawn rather than faceted.
function slStrokePath(points)
{
  if (!points.length) return '';
  if (points.length === 1) return 'M' + points[0].x + ' ' + points[0].y + 'l0.01 0';

  var d = 'M' + points[0].x + ' ' + points[0].y;

  for (var i = 1; i < points.length - 1; i++)
  {
    var p = points[i], q = points[i + 1];
    d += 'Q' + p.x + ' ' + p.y + ' ' + ((p.x + q.x) / 2) + ' ' + ((p.y + q.y) / 2);
  }

  var last = points[points.length - 1];
  return d + 'L' + last.x + ' ' + last.y;
}

function slDecoElement(d)
{
  var el;

  if (d.kind === 'line')
    el = slSvg('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, stroke: d.color, 'stroke-width': d.width, 'stroke-linecap': 'round' });
  else if (d.kind === 'stroke')
    el = slSvg('path', { d: slStrokePath(d.points), fill: 'none', stroke: d.color, 'stroke-width': d.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  else if (d.kind === 'rect')
    el = slSvg('rect', { x: d.x, y: d.y, width: Math.max(0, d.w), height: Math.max(0, d.h), fill: d.fill, stroke: d.color, 'stroke-width': d.width });
  else
    el = slSvg('ellipse', { cx: d.x + d.w / 2, cy: d.y + d.h / 2, rx: Math.max(0, d.w / 2), ry: Math.max(0, d.h / 2), fill: d.fill, stroke: d.color, 'stroke-width': d.width });

  return el;
}

// Builds a slide's DOM at full size (deck.width × deck.height). `interactive`
// adds the hooks the editor needs (indices, selection, handles).
function slBuildSlide(deck, slide, interactive)
{
  var el = document.createElement('div');
  el.className = 'sl-slide';
  el.style.width = deck.width + 'px';
  el.style.height = deck.height + 'px';

  var hasImage = slide.decls.some(function(d){ return d.prop === 'background-image' || d.prop === 'background'; });
  if (hasImage)
  {
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
  }

  slide.decls.forEach(function(d)
  {
    if (SLIDE_CSS_PROPS.indexOf(d.prop) === -1) return;

    var value = d.value;
    if (d.prop === 'background-image') value = slNormalizeImageValue(value);
    if (/url\(/i.test(value)) value = slResolveCssUrls(value);

    el.style.setProperty(d.prop, value);
  });

  var svg = slSvg('svg', { class: 'sl-deco', width: deck.width, height: deck.height, viewBox: '0 0 ' + deck.width + ' ' + deck.height });

  slDecoIndices(slide).forEach(function(declIdx)
  {
    var d = parseSlideDeco(slide.decls[declIdx]);
    if (!d) return;

    var shape = slDecoElement(d);
    if (interactive) shape.setAttribute('data-decl', declIdx);
    svg.appendChild(shape);
  });

  el.appendChild(svg);

  slide.blocks.forEach(function(b, i)
  {
    var box = document.createElement('div');
    box.className = 'sl-block';
    box.style.left = b.x + 'px';
    box.style.top = b.y + 'px';
    box.style.width = b.w + 'px';
    box.style.height = b.h + 'px';

    var content = document.createElement('div');
    content.className = 'sl-block-content';
    content.innerHTML = slRenderMarkdown(b.text);
    box.appendChild(content);

    if (interactive) box.setAttribute('data-block', i);
    el.appendChild(box);
  });

  if (typeof renderMermaidDiagrams === 'function' && el.querySelector('.mermaid'))
  {
    // Mermaid measures text as it lays out, so it needs the node in the page.
    setTimeout(function(){ if (el.isConnected) renderMermaidDiagrams(el); }, 0);
  }

  return el;
}

// Places a full-size slide inside `host`, scaled to fit it.
function slMountScaled(host, slideEl, deck, maxW, maxH)
{
  var scale = Math.min(maxW / deck.width, maxH / deck.height);
  if (!isFinite(scale) || scale <= 0) scale = 1;

  host.style.width = Math.round(deck.width * scale) + 'px';
  host.style.height = Math.round(deck.height * scale) + 'px';
  slideEl.style.transform = 'scale(' + scale + ')';
  slideEl.style.transformOrigin = '0 0';
  host.innerHTML = '';
  host.appendChild(slideEl);

  return scale;
}

function slCurrentSlide()
{
  return slDeck && slDeck.slides[slIndex];
}

var slStageScale = 1;

function slRenderStage()
{
  var stage = document.getElementById('slides-stage'),
      host = document.getElementById('slides-canvas');

  if (!stage || !host || !slDeck) return;

  var slide = slCurrentSlide();
  if (!slide) return;

  // A text box being edited survives the rebuild with what was typed so far.
  var openEditor = host.querySelector('.sl-block-editor'),
      typing = openEditor && slEditing !== null
               ? { value: openEditor.value, start: openEditor.selectionStart, end: openEditor.selectionEnd, focused: document.activeElement === openEditor }
               : null;

  var el = slBuildSlide(slDeck, slide, true),
      pad = 48;

  slStageScale = slMountScaled(host, el, slDeck, Math.max(80, stage.clientWidth - pad), Math.max(60, stage.clientHeight - pad));

  host.classList.toggle('sl-tool-draw', slTool !== 'select');

  slRenderSelection();

  if (slEditing !== null)
  {
    slOpenBlockEditor(slEditing, false, !typing || typing.focused);

    var ta = host.querySelector('.sl-block-editor');
    if (ta && typing)
    {
      ta.value = typing.value;
      ta.setSelectionRange(typing.start, typing.end);
    }
  }
}

function slRenderSelection()
{
  var host = document.getElementById('slides-canvas'),
      slideEl = host && host.querySelector('.sl-slide');

  if (!slideEl) return;

  slideEl.querySelectorAll('.sl-sel-box').forEach(function(n){ n.remove(); });
  slideEl.querySelectorAll('.sl-block.sl-selected').forEach(function(n){ n.classList.remove('sl-selected'); });

  var slide = slCurrentSlide();
  if (!slSelection || !slide) return;

  var box;

  if (slSelection.kind === 'block')
  {
    var b = slide.blocks[slSelection.index];
    if (!b) { slSelection = null; return; }
    box = { x: b.x, y: b.y, w: b.w, h: b.h };
    var blockEl = slideEl.querySelector('.sl-block[data-block="' + slSelection.index + '"]');
    if (blockEl) blockEl.classList.add('sl-selected');
  }
  else
  {
    var decl = slide.decls[slSelection.index],
        d = decl && parseSlideDeco(decl);
    if (!d) { slSelection = null; return; }
    box = slDecoBounds(d);
  }

  var sel = document.createElement('div'),
      inv = 1 / slStageScale;

  sel.className = 'sl-sel-box';
  sel.style.left = (box.x - 4 * inv) + 'px';
  sel.style.top = (box.y - 4 * inv) + 'px';
  sel.style.width = (box.w + 8 * inv) + 'px';
  sel.style.height = (box.h + 8 * inv) + 'px';
  sel.style.borderWidth = (1.5 * inv) + 'px';

  // Text boxes and shapes with an area resize from the corners; lines and
  // freehand strokes only move.
  var d2 = slSelection.kind === 'deco' ? parseSlideDeco(slide.decls[slSelection.index]) : null;

  if (slSelection.kind === 'block' || (d2 && (d2.kind === 'rect' || d2.kind === 'ellipse')))
  {
    ['nw', 'ne', 'sw', 'se'].forEach(function(corner)
    {
      var h = document.createElement('div');
      h.className = 'sl-handle sl-handle-' + corner;
      h.setAttribute('data-handle', corner);
      h.style.width = h.style.height = (10 * inv) + 'px';
      h.style.margin = (-5 * inv) + 'px';
      sel.appendChild(h);
    });
  }

  slideEl.appendChild(sel);
}

function slRenderStrip()
{
  var strip = document.getElementById('slides-strip');
  if (!strip || !slDeck) return;

  strip.innerHTML = '';

  // Thumbnails fill the strip's width (less the number column and padding).
  var thumbW = Math.max(60, (strip.clientWidth || 190) - 48);

  slDeck.slides.forEach(function(slide, i)
  {
    var item = document.createElement('div');
    item.className = 'sl-thumb' + (i === slIndex ? ' active' : '');
    item.setAttribute('draggable', 'true');
    item.setAttribute('data-index', i);
    item.title = 'Slide ' + (i + 1);

    var num = document.createElement('span');
    num.className = 'sl-thumb-num';
    num.textContent = i + 1;

    var host = document.createElement('div');
    host.className = 'sl-thumb-frame';
    slMountScaled(host, slBuildSlide(slDeck, slide, false), slDeck, thumbW, thumbW);

    item.appendChild(num);
    item.appendChild(host);
    strip.appendChild(item);
  });

  var add = document.createElement('button');
  add.type = 'button';
  add.className = 'sl-thumb-add';
  add.textContent = '+ Slide';
  add.onclick = slAddSlide;
  strip.appendChild(add);

  var active = strip.querySelector('.sl-thumb.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

function slScheduleStrip()
{
  clearTimeout(slThumbTimer);
  slThumbTimer = setTimeout(slRenderStrip, 250);
}

function slSyncToolbar()
{
  var slide = slCurrentSlide();
  if (!slide) return;

  var bg = slDeclValue(slide, 'background-color'),
      fg = slDeclValue(slide, 'color'),
      bgInput = document.getElementById('slides-bg-color'),
      fgInput = document.getElementById('slides-text-color');

  if (bgInput && /^#[0-9a-f]{6}$/i.test(bg || '')) bgInput.value = bg;
  if (fgInput && /^#[0-9a-f]{6}$/i.test(fg || '')) fgInput.value = fg;

  var counter = document.getElementById('slides-counter');
  if (counter) counter.textContent = (slIndex + 1) + ' / ' + slDeck.slides.length;

  document.querySelectorAll('#slides-toolbar [data-sl-tool]').forEach(function(b)
  {
    b.classList.toggle('active', b.getAttribute('data-sl-tool') === slTool);
  });

  var del = document.getElementById('slides-delete-sel');
  if (del) del.disabled = !slSelection;
}

function slRenderAll()
{
  if (!slDeck || currentAppType !== 'slides') return;

  if (slView === 'visual')
  {
    slRenderStage();
    slRenderStrip();
  }

  slSyncToolbar();

  if (slPresenting) slRenderPresent();
}

// ── Load / save / undo ──

function loadSlidesFile(file)
{
  document.getElementById('slides-title-input').value = file.name;

  // Reloading the deck that's already open (a restored version, a change
  // from another window) stays on the same slide; another deck starts at 1.
  var sameFile = slDeck && slDeck.__file === currentFileId;

  slDeck = parseSlides(file.content || defaultSlidesContent());
  slIndex = sameFile ? Math.max(0, Math.min(slIndex, slDeck.slides.length - 1)) : 0;
  slDeck.__file = currentFileId;

  slSelection = null;
  slEditing = null;
  slUndoStack = [];
  slRedoStack = [];

  document.getElementById('slides-source').value = file.content || '';
  slApplyView();
  slRenderAll();
}

function onSlidesTitleChange()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'slides')
    return;

  files[currentFileId].name = (document.getElementById('slides-title-input').value || files[currentFileId].name);
  scheduleSave();
  renderFileList();
}

// Takes what's typed in an open text box into the model (as its own undo
// step) and ends the edit. Runs before any other change, so an edit in
// progress is never lost to a toolbar action or a slide switch.
function slFlushEditor()
{
  if (slEditing === null) return false;

  var index = slEditing,
      slide = slCurrentSlide(),
      ta = document.querySelector('#slides-canvas .sl-block-editor');

  slEditing = null;

  if (!ta || !slide || !slide.blocks[index] || ta.value === slide.blocks[index].text)
    return false;

  slUndoStack.push(serializeSlides(slDeck));
  if (slUndoStack.length > 100) slUndoStack.shift();
  slRedoStack = [];
  slide.blocks[index].text = ta.value;
  return true;
}

function slSnapshot()
{
  if (!slDeck) return;
  slFlushEditor();
  slUndoStack.push(serializeSlides(slDeck));
  if (slUndoStack.length > 100) slUndoStack.shift();
  slRedoStack = [];
}

// Writes the model back to the file. `structural` re-renders everything;
// otherwise only what the edit could have changed.
function slCommit(structural)
{
  if (!slDeck || !currentFileId || !files[currentFileId] || files[currentFileId].type !== 'slides')
    return;

  var text = serializeSlides(slDeck);
  files[currentFileId].content = text;
  document.getElementById('slides-source').value = text;
  scheduleSave();

  if (structural) slRenderAll();
  else
  {
    slRenderStage();
    slSyncToolbar();
    slScheduleStrip();
  }
}

function slRestore(from, to)
{
  if (!from.length || !slDeck) return;

  to.push(serializeSlides(slDeck));

  var keepFile = slDeck.__file;
  slDeck = parseSlides(from.pop());
  slDeck.__file = keepFile;
  slIndex = Math.min(slIndex, slDeck.slides.length - 1);
  slSelection = null;
  slEditing = null;
  slCommit(true);
}

function slUndo() { slRestore(slUndoStack, slRedoStack); }
function slRedo() { slRestore(slRedoStack, slUndoStack); }

// ── Views ──

function setSlidesView(view)
{
  if (view === slView) return;

  if (slView === 'source')
    slApplySourceNow();
  else
    slCloseBlockEditor(true);

  slView = view;
  slApplyView();
  slRenderAll();
}

function slApplyView()
{
  var visual = slView === 'visual';

  document.getElementById('slides-visual').style.display = visual ? '' : 'none';
  document.getElementById('slides-source-pane').style.display = visual ? 'none' : '';
  document.getElementById('svbtn-visual').classList.toggle('active', visual);
  document.getElementById('svbtn-source').classList.toggle('active', !visual);
  document.querySelectorAll('#slides-toolbar .sl-visual-only').forEach(function(el){ el.style.display = visual ? '' : 'none'; });
}

function onSlidesSourceInput()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'slides')
    return;

  files[currentFileId].content = document.getElementById('slides-source').value;
  scheduleSave();

  clearTimeout(slSourceTimer);
  slSourceTimer = setTimeout(slApplySourceNow, 300);
}

function slApplySourceNow()
{
  clearTimeout(slSourceTimer);

  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'slides')
    return;

  var keepFile = slDeck && slDeck.__file;
  slDeck = parseSlides(document.getElementById('slides-source').value);
  slDeck.__file = keepFile;
  slIndex = Math.min(slIndex, slDeck.slides.length - 1);
  slSelection = null;
  slSyncToolbar();
}

// ── Slides: add, remove, reorder ──

function slGoTo(i)
{
  if (!slDeck) return;
  slCloseBlockEditor(true);
  slIndex = Math.max(0, Math.min(slDeck.slides.length - 1, i));
  slSelection = null;
  slRenderAll();
}

function slAddSlide()
{
  if (!slDeck) return;
  slSnapshot();

  // A new slide keeps the look of the current one, but not its content.
  var cur = slCurrentSlide(),
      slide = newSlideModel();

  if (cur)
    cur.decls.forEach(function(d)
    {
      if (SLIDE_DECO_PROPS.indexOf(d.prop) === -1) slide.decls.push({ prop: d.prop, value: d.value });
    });

  slDeck.slides.splice(slIndex + 1, 0, slide);
  slIndex++;
  slSelection = null;
  slCommit(true);
}

function slDuplicateSlide()
{
  var cur = slCurrentSlide();
  if (!cur) return;
  slSnapshot();

  slDeck.slides.splice(slIndex + 1, 0, JSON.parse(JSON.stringify(cur)));
  slIndex++;
  slSelection = null;
  slCommit(true);
}

function slDeleteSlide()
{
  if (!slDeck) return;

  if (slDeck.slides.length === 1)
  {
    alert('A presentation needs at least one slide.');
    return;
  }

  if (!confirm('Delete slide ' + (slIndex + 1) + '?')) return;

  slSnapshot();
  slDeck.slides.splice(slIndex, 1);
  slIndex = Math.min(slIndex, slDeck.slides.length - 1);
  slSelection = null;
  slCommit(true);
}

function slMoveSlide(from, to)
{
  if (!slDeck || from === to || from < 0 || to < 0 || from >= slDeck.slides.length || to >= slDeck.slides.length) return;
  slSnapshot();

  var moved = slDeck.slides.splice(from, 1)[0];
  slDeck.slides.splice(to, 0, moved);
  slIndex = to;
  slSelection = null;
  slCommit(true);
}

// ── Slide style: background, text color ──

function slSetBackgroundColor(value)
{
  var slide = slCurrentSlide();
  if (!slide) return;
  slSnapshot();
  slSetDecl(slide, 'background-color', value);
  slCommit(false);
}

function slSetTextColor(value)
{
  var slide = slCurrentSlide();
  if (!slide) return;
  slSnapshot();
  slSetDecl(slide, 'color', value);
  slCommit(false);
}

function slApplyBackgroundToAll()
{
  var cur = slCurrentSlide();
  if (!cur || !slDeck) return;
  slSnapshot();

  var props = ['background', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'color'];

  slDeck.slides.forEach(function(s)
  {
    if (s === cur) return;
    props.forEach(function(p){ slSetDecl(s, p, slDeclValue(cur, p)); });
  });

  slCloseBgMenu();
  slCommit(true);
}

function toggleSlidesBgMenu(e)
{
  if (e) e.stopPropagation();
  var menu = document.getElementById('slides-bg-menu');
  menu.classList.toggle('open');
}

function slCloseBgMenu()
{
  var menu = document.getElementById('slides-bg-menu');
  if (menu) menu.classList.remove('open');
}

async function slUseImageBlob(blob, name)
{
  var slide = slCurrentSlide();
  if (!slide) return;

  var ref;

  try
  {
    ref = await slStoreImage(blob, name);
  }
  catch(e)
  {
    alert('Could not add the image: ' + (e && e.message || e));
    return;
  }

  slSnapshot();
  slSetDecl(slide, 'background-image', 'url(' + ref + ')');
  slCommit(true);
}

function slPickImageFile()
{
  slCloseBgMenu();
  document.getElementById('slides-image-input').click();
}

function onSlidesImageChosen(e)
{
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) slUseImageBlob(file, file.name);
}

async function slPickImageUrl()
{
  slCloseBgMenu();

  var url = prompt('Image address (it is downloaded and stored with this presentation):', 'https://');
  if (!url || !/^https?:\/\/\S+$/i.test(url.trim())) return;

  url = url.trim();

  var blob;

  try
  {
    blob = await Platform.fetchRemoteFile(url);
  }
  catch(e)
  {
    alert(Platform.isNative
            ? 'Could not download the image: ' + (e && e.message || e)
            : 'That site doesn\'t let the browser copy its images. Save the image to your computer, then use "From this computer…".');
    return;
  }

  var name = decodeURIComponent((url.split(/[?#]/)[0].split('/').pop() || 'image'));
  slUseImageBlob(blob, name);
}

function slRemoveImage()
{
  var slide = slCurrentSlide();
  slCloseBgMenu();
  if (!slide) return;
  slSnapshot();
  slSetDecl(slide, 'background-image', null);
  slCommit(true);
}

// ── Tools ──

function setSlidesTool(tool)
{
  slCloseBlockEditor(true);
  slTool = tool;
  if (tool !== 'select') slSelection = null;
  slRenderStage();
  slSyncToolbar();
}

function setSlidesStrokeColor(v) { slStrokeColor = v; slApplyStyleToSelection(); }
function setSlidesFillColor(v) { slFillColor = v; slFillNone = false; document.getElementById('slides-fill-none').checked = false; slApplyStyleToSelection(); }
function setSlidesFillNone(none) { slFillNone = none; slApplyStyleToSelection(); }
function setSlidesLineWidth(v) { slLineWidth = Math.max(1, Math.min(60, parseFloat(v) || 1)); slApplyStyleToSelection(); }

// Changing a color or width with a shape selected restyles that shape.
function slApplyStyleToSelection()
{
  var slide = slCurrentSlide();
  if (!slide || !slSelection || slSelection.kind !== 'deco') return;

  var d = parseSlideDeco(slide.decls[slSelection.index]);
  if (!d) return;

  slSnapshot();
  d.color = slStrokeColor;
  d.width = slLineWidth;
  if (d.kind === 'rect' || d.kind === 'ellipse') d.fill = slFillNone ? 'none' : slFillColor;
  slide.decls[slSelection.index] = serializeSlideDeco(d);
  slCommit(false);
}

function slAddTextBox()
{
  var slide = slCurrentSlide();
  if (!slide) return;
  slSnapshot();

  var w = Math.round(slDeck.width * 0.6), h = Math.round(slDeck.height * 0.2);
  slide.blocks.push({ x: Math.round((slDeck.width - w) / 2), y: Math.round((slDeck.height - h) / 2), w: w, h: h, text: 'Text' });
  slSelection = { kind: 'block', index: slide.blocks.length - 1 };
  slTool = 'select';
  slCommit(false);
  slOpenBlockEditor(slSelection.index, true);
}

function slDeleteSelection()
{
  var slide = slCurrentSlide();
  if (!slide || !slSelection) return;
  slSnapshot();

  if (slSelection.kind === 'block') slide.blocks.splice(slSelection.index, 1);
  else slide.decls.splice(slSelection.index, 1);

  slSelection = null;
  slCommit(false);
}

// Bring the selected item to the front (end of its list) or send it back.
function slReorderSelection(toFront)
{
  var slide = slCurrentSlide();
  if (!slide || !slSelection) return;
  slSnapshot();

  if (slSelection.kind === 'block')
  {
    var b = slide.blocks.splice(slSelection.index, 1)[0];
    if (toFront) slide.blocks.push(b); else slide.blocks.unshift(b);
    slSelection.index = toFront ? slide.blocks.length - 1 : 0;
  }
  else
  {
    var decos = slDecoIndices(slide),
        d = slide.decls.splice(slSelection.index, 1)[0];
    decos = slDecoIndices(slide);

    var at = toFront ? (decos.length ? decos[decos.length - 1] + 1 : slide.decls.length)
                     : (decos.length ? decos[0] : slide.decls.length);
    slide.decls.splice(at, 0, d);
    slSelection.index = at;
  }

  slCommit(false);
}

// ── Text box editing ──

function slOpenBlockEditor(index, selectAll, focus)
{
  var slide = slCurrentSlide(),
      host = document.getElementById('slides-canvas'),
      slideEl = host && host.querySelector('.sl-slide'),
      blockEl = slideEl && slideEl.querySelector('.sl-block[data-block="' + index + '"]');

  if (!slide || !slide.blocks[index] || !blockEl) return;

  slEditing = index;
  slSelection = { kind: 'block', index: index };

  var existing = blockEl.querySelector('textarea');
  if (existing) return;

  blockEl.classList.add('sl-editing');
  blockEl.innerHTML = '';

  var ta = document.createElement('textarea');
  ta.className = 'sl-block-editor';
  ta.value = slide.blocks[index].text || '';
  ta.spellcheck = true;
  ta.style.fontSize = Math.max(12, 14 / slStageScale) + 'px';

  ta.addEventListener('keydown', function(e)
  {
    e.stopPropagation();
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter'))
    {
      e.preventDefault();
      slCloseBlockEditor(true);
    }
  });
  ta.addEventListener('mousedown', function(e){ e.stopPropagation(); });
  // A re-render replaces the textarea, and the old one may report a blur on
  // its way out; only the live one ends the edit.
  ta.addEventListener('blur', function(){ setTimeout(function(){ if (ta.isConnected && document.activeElement !== ta) slCloseBlockEditor(true); }, 0); });

  blockEl.appendChild(ta);
  if (focus === false) return;
  ta.focus({ preventScroll: true });
  if (selectAll) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
}

function slCloseBlockEditor(commit)
{
  if (slEditing === null) return;

  if (commit && slFlushEditor())
  {
    slCommit(false);
    return;
  }

  slEditing = null;
  slRenderStage();
}

// ── Pointer interaction on the slide ──

function slPointFromEvent(e)
{
  var slideEl = document.querySelector('#slides-canvas .sl-slide');
  if (!slideEl) return { x: 0, y: 0 };

  var r = slideEl.getBoundingClientRect();
  return { x: (e.clientX - r.left) / slStageScale, y: (e.clientY - r.top) / slStageScale };
}

function slRound(v) { return Math.round(v); }

function onSlidesCanvasMouseDown(e)
{
  if (e.button !== 0 || !slDeck) return;

  var slide = slCurrentSlide();
  if (!slide) return;

  if (e.target.closest('.sl-block-editor')) return;

  slCloseBlockEditor(true);

  var pt = slPointFromEvent(e);

  if (slTool === 'select')
  {
    var handle = e.target.closest('[data-handle]');

    if (handle && slSelection)
    {
      e.preventDefault();
      var item = slSelection.kind === 'block' ? slide.blocks[slSelection.index] : parseSlideDeco(slide.decls[slSelection.index]);
      slDrag = { mode: 'resize', corner: handle.getAttribute('data-handle'), start: pt, orig: JSON.parse(JSON.stringify(item)), snapped: false };
      return;
    }

    var blockEl = e.target.closest('.sl-block'),
        decoEl = e.target.closest('[data-decl]');

    if (blockEl)
      slSelection = { kind: 'block', index: parseInt(blockEl.getAttribute('data-block'), 10) };
    else if (decoEl)
      slSelection = { kind: 'deco', index: parseInt(decoEl.getAttribute('data-decl'), 10) };
    else
    {
      slSelection = null;
      slRenderSelection();
      slSyncToolbar();
      return;
    }

    e.preventDefault();

    var target = slSelection.kind === 'block' ? slide.blocks[slSelection.index] : parseSlideDeco(slide.decls[slSelection.index]);
    slDrag = { mode: 'move', start: pt, orig: JSON.parse(JSON.stringify(target)), snapped: false };

    if (slSelection.kind === 'deco' && target)
    {
      slStrokeColor = target.color && target.color !== 'none' ? target.color : slStrokeColor;
      slLineWidth = target.width || slLineWidth;
      var sc = document.getElementById('slides-stroke-color'), lw = document.getElementById('slides-line-width');
      if (sc && /^#[0-9a-f]{6}$/i.test(slStrokeColor)) sc.value = slStrokeColor;
      if (lw) lw.value = slLineWidth;
    }

    slRenderSelection();
    slSyncToolbar();
    return;
  }

  e.preventDefault();

  // Drawing tools: the item is created on mousedown and shaped while dragging.
  slDrag = { mode: 'create', tool: slTool, start: pt, points: [pt], snapped: false };
}

function onSlidesMouseMove(e)
{
  if (!slDrag || !slDeck) return;

  var slide = slCurrentSlide(),
      pt = slPointFromEvent(e),
      dx = pt.x - slDrag.start.x,
      dy = pt.y - slDrag.start.y;

  if (!slDrag.snapped)
  {
    if (Math.abs(dx) * slStageScale < 3 && Math.abs(dy) * slStageScale < 3) return;
    slDrag.snapped = true;
    if (slDrag.mode !== 'create') slSnapshot();
  }

  if (slDrag.mode === 'move' && slSelection)
  {
    if (slSelection.kind === 'block')
    {
      var b = slide.blocks[slSelection.index];
      b.x = slRound(slDrag.orig.x + dx);
      b.y = slRound(slDrag.orig.y + dy);
    }
    else
    {
      var d = JSON.parse(JSON.stringify(slDrag.orig));
      slMoveDeco(d, slRound(dx), slRound(dy));
      slide.decls[slSelection.index] = serializeSlideDeco(d);
    }
    slRenderStage();
    return;
  }

  if (slDrag.mode === 'resize' && slSelection)
  {
    var o = slDrag.orig,
        c = slDrag.corner,
        x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;

    if (c.indexOf('w') !== -1) x1 = Math.min(x2 - 20, o.x + dx);
    if (c.indexOf('e') !== -1) x2 = Math.max(x1 + 20, o.x + o.w + dx);
    if (c.indexOf('n') !== -1) y1 = Math.min(y2 - 20, o.y + dy);
    if (c.indexOf('s') !== -1) y2 = Math.max(y1 + 20, o.y + o.h + dy);

    var r = { x: slRound(x1), y: slRound(y1), w: slRound(x2 - x1), h: slRound(y2 - y1) };

    if (slSelection.kind === 'block')
      Object.assign(slide.blocks[slSelection.index], r);
    else
    {
      var shape = JSON.parse(JSON.stringify(o));
      Object.assign(shape, r);
      slide.decls[slSelection.index] = serializeSlideDeco(shape);
    }
    slRenderStage();
    return;
  }

  if (slDrag.mode === 'create')
  {
    if (slDrag.tool === 'pen')
    {
      var last = slDrag.points[slDrag.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) * slStageScale >= 2)
        slDrag.points.push(pt);
    }
    slDrag.current = pt;
    slRenderDraft();
  }
}

// The shape being drawn, before it is committed to the file.
function slDraftItem()
{
  var s = slDrag.start, p = slDrag.current || s;

  if (slDrag.tool === 'pen')
    return { kind: 'stroke', color: slStrokeColor, width: slLineWidth, points: slDrag.points.map(function(q){ return { x: slRound(q.x), y: slRound(q.y) }; }) };

  if (slDrag.tool === 'line')
    return { kind: 'line', x1: slRound(s.x), y1: slRound(s.y), x2: slRound(p.x), y2: slRound(p.y), color: slStrokeColor, width: slLineWidth };

  var rect = { x: slRound(Math.min(s.x, p.x)), y: slRound(Math.min(s.y, p.y)), w: slRound(Math.abs(p.x - s.x)), h: slRound(Math.abs(p.y - s.y)) };

  if (slDrag.tool === 'text') return Object.assign({ kind: 'text' }, rect);

  return Object.assign({ kind: slDrag.tool, fill: slFillNone ? 'none' : slFillColor, color: slStrokeColor, width: slLineWidth }, rect);
}

function slRenderDraft()
{
  var slideEl = document.querySelector('#slides-canvas .sl-slide'),
      svg = slideEl && slideEl.querySelector('svg.sl-deco');

  if (!svg) return;

  var old = svg.querySelector('.sl-draft');
  if (old) old.remove();

  var item = slDraftItem(), el;

  if (item.kind === 'text')
    el = slSvg('rect', { x: item.x, y: item.y, width: item.w, height: item.h, fill: 'none', stroke: '#d4a843', 'stroke-dasharray': '8 6', 'stroke-width': 2 / slStageScale });
  else
    el = slDecoElement(item);

  el.classList.add('sl-draft');
  svg.appendChild(el);
}

function onSlidesMouseUp()
{
  if (!slDrag || !slDeck) return;

  var drag = slDrag;
  slDrag = null;

  var slide = slCurrentSlide();
  if (!slide) return;

  if (drag.mode === 'move' || drag.mode === 'resize')
  {
    if (drag.snapped) slCommit(false);
    return;
  }

  // create
  if (!drag.current) drag.current = drag.start;
  slDrag = drag;
  var item = slDraftItem();
  slDrag = null;

  var tiny = function(w, h){ return w * slStageScale < 4 && h * slStageScale < 4; };

  if (item.kind === 'text')
  {
    // A click (no drag) drops a default-sized box at the pointer.
    if (tiny(item.w, item.h)) { item.w = Math.round(slDeck.width * 0.4); item.h = Math.round(slDeck.height * 0.15); }
    slSnapshot();
    slide.blocks.push({ x: item.x, y: item.y, w: item.w, h: item.h, text: '' });
    slSelection = { kind: 'block', index: slide.blocks.length - 1 };
    slTool = 'select';
    slCommit(false);
    slOpenBlockEditor(slSelection.index);
    return;
  }

  if (item.kind === 'stroke' ? item.points.length < 2 && !drag.snapped : (item.kind === 'line' ? tiny(Math.abs(item.x2 - item.x1), Math.abs(item.y2 - item.y1)) : tiny(item.w, item.h)))
  {
    slRenderStage();
    return;
  }

  slSnapshot();
  slide.decls.push(serializeSlideDeco(item));
  slCommit(false);
}

function onSlidesCanvasDblClick(e)
{
  if (slTool !== 'select') return;

  var blockEl = e.target.closest('.sl-block');
  if (!blockEl || blockEl.classList.contains('sl-editing')) return;

  slOpenBlockEditor(parseInt(blockEl.getAttribute('data-block'), 10));
}

function onSlidesKeyDown(e)
{
  if (currentAppType !== 'slides' || !slDeck || slView !== 'visual' || slPresenting) return;

  var t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'color') || t.isContentEditable)) return;

  // Only while the slides app is what's being worked on: not with a modal open.
  if (document.querySelector('.modal-overlay.open')) return;

  var mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();

  if (mod && !e.shiftKey && key === 'z') { e.preventDefault(); slUndo(); return; }
  if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) { e.preventDefault(); slRedo(); return; }
  if (mod && key === 'd' && slSelection) { e.preventDefault(); slDuplicateSelection(); return; }

  if ((e.key === 'Delete' || e.key === 'Backspace') && slSelection) { e.preventDefault(); slDeleteSelection(); return; }
  if (e.key === 'Enter' && slSelection && slSelection.kind === 'block') { e.preventDefault(); slOpenBlockEditor(slSelection.index); return; }
  if (e.key === 'Escape') { slSelection = null; setSlidesTool('select'); return; }

  if (e.key === 'PageDown') { e.preventDefault(); slGoTo(slIndex + 1); return; }
  if (e.key === 'PageUp') { e.preventDefault(); slGoTo(slIndex - 1); return; }
  if (e.key === 'F5') { e.preventDefault(); startSlidesPresentation(e.shiftKey ? slIndex : 0); return; }

  if (slSelection && /^Arrow/.test(e.key))
  {
    e.preventDefault();
    var step = e.shiftKey ? 10 : 1,
        dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        slide = slCurrentSlide();

    slSnapshot();
    if (slSelection.kind === 'block') { slide.blocks[slSelection.index].x += dx; slide.blocks[slSelection.index].y += dy; }
    else
    {
      var d = parseSlideDeco(slide.decls[slSelection.index]);
      slMoveDeco(d, dx, dy);
      slide.decls[slSelection.index] = serializeSlideDeco(d);
    }
    slCommit(false);
    return;
  }

  if (!slSelection && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) { e.preventDefault(); slGoTo(slIndex + 1); }
  else if (!slSelection && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) { e.preventDefault(); slGoTo(slIndex - 1); }
}

function slDuplicateSelection()
{
  var slide = slCurrentSlide();
  if (!slide || !slSelection) return;
  slSnapshot();

  if (slSelection.kind === 'block')
  {
    var b = JSON.parse(JSON.stringify(slide.blocks[slSelection.index]));
    b.x += 20; b.y += 20;
    slide.blocks.push(b);
    slSelection = { kind: 'block', index: slide.blocks.length - 1 };
  }
  else
  {
    var d = parseSlideDeco(slide.decls[slSelection.index]);
    slMoveDeco(d, 20, 20);
    slide.decls.push(serializeSlideDeco(d));
    slSelection = { kind: 'deco', index: slide.decls.length - 1 };
  }

  slCommit(false);
}

// ── Present ──

function startSlidesPresentation(from)
{
  if (!slDeck) return;

  if (slView === 'source') slApplySourceNow();
  slCloseBlockEditor(true);

  slPresenting = true;
  slIndex = Math.max(0, Math.min(slDeck.slides.length - 1, typeof from === 'number' ? from : slIndex));

  var overlay = document.getElementById('slides-present');
  overlay.classList.add('open');
  overlay.focus({ preventScroll: true });

  try
  {
    if (overlay.requestFullscreen) overlay.requestFullscreen().catch(function(){});
  }
  catch(e) {}

  slRenderPresent();
}

function stopSlidesPresentation()
{
  if (!slPresenting) return;
  slPresenting = false;

  document.getElementById('slides-present').classList.remove('open');

  try
  {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){});
  }
  catch(e) {}

  slRenderAll();
}

function slRenderPresent()
{
  var overlay = document.getElementById('slides-present'),
      host = document.getElementById('slides-present-frame'),
      slide = slCurrentSlide();

  if (!overlay || !host || !slide) return;

  slMountScaled(host, slBuildSlide(slDeck, slide, false), slDeck, overlay.clientWidth || window.innerWidth, overlay.clientHeight || window.innerHeight);

  var counter = document.getElementById('slides-present-counter');
  if (counter) counter.textContent = (slIndex + 1) + ' / ' + slDeck.slides.length;
}

function slPresentStep(delta)
{
  if (!slDeck) return;
  var next = slIndex + delta;
  if (next < 0 || next >= slDeck.slides.length) return;
  slIndex = next;
  slRenderPresent();
}

// ── Export ──
// One page per slide at the deck's own size. Images are inlined as data:
// URLs, so the exported file stands on its own.

async function slInlineAssetsFor(deck)
{
  var refs = {};

  deck.slides.forEach(function(s)
  {
    s.decls.forEach(function(d)
    {
      var v = d.prop === 'background-image' ? slNormalizeImageValue(d.value) : d.value;
      String(v).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, function(_, q, ref){ if (!slIsExternalUrl(ref)) refs[slAssetPath(ref)] = 1; return _; });
    });
  });

  var inlined = {};

  for (var path in refs)
  {
    try
    {
      var ext = (path.split('.').pop() || '').toLowerCase(),
          blob = await Platform.readWorkFileBinary(workFolderRoot, path, SLIDE_IMAGE_TYPES[ext] || '');
      inlined[path] = await slBlobToDataUrl(blob);
    }
    catch(e) { console.warn('Export: could not inline ' + path, e); }
  }

  return inlined;
}

async function buildSlidesExportHtml(file)
{
  var deck = parseSlides(file.content || ''),
      saved = slAssetCache;

  if (workFolderRoot)
  {
    var inlined = await slInlineAssetsFor(deck);
    slAssetCache = {};
    Object.keys(inlined).forEach(function(p){ slAssetCache[p] = { url: inlined[p], state: 'ready' }; });
  }

  var pages = '';

  try
  {
    deck.slides.forEach(function(slide)
    {
      var el = slBuildSlide(deck, slide, false);
      pages += '<section class="page">' + el.outerHTML + '</section>\n';
    });
  }
  finally
  {
    slAssetCache = saved;
  }

  pages = await inlineMermaidSvgs(pages);

  return  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
          '<title>' + escHtml(file.name) + '</title>\n<style>\n' +
          '@page{size:' + deck.width + 'px ' + deck.height + 'px;margin:0;}\n' +
          'html,body{margin:0;padding:0;background:#555;}\n' +
          '.page{width:' + deck.width + 'px;height:' + deck.height + 'px;margin:0 auto 24px;overflow:hidden;break-after:page;position:relative;}\n' +
          '.page:last-child{break-after:auto;}\n' +
          SLIDE_EXPORT_CSS +
          '@media print{html,body{background:none;}.page{margin:0;}}\n' +
          '</style>\n</head>\n<body>\n' + pages + '</body>\n</html>';
}

// The slide look, shared by the editor stylesheet and exported files.
var SLIDE_EXPORT_CSS =
  '.sl-slide{position:relative;overflow:hidden;background-color:#ffffff;color:#1a1a1a;font-family:Georgia,"Times New Roman",serif;font-size:28px;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact;}\n' +
  '.sl-deco{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;}\n' +
  '.sl-block{position:absolute;box-sizing:border-box;overflow:hidden;}\n' +
  '.sl-block-content>:first-child{margin-top:0;}\n' +
  '.sl-block-content>:last-child{margin-bottom:0;}\n' +
  '.sl-block-content h1{font-size:2.1em;margin:0 0 .3em;line-height:1.1;}\n' +
  '.sl-block-content h2{font-size:1.6em;margin:0 0 .3em;line-height:1.15;}\n' +
  '.sl-block-content h3{font-size:1.3em;margin:0 0 .3em;}\n' +
  '.sl-block-content p{margin:0 0 .5em;}\n' +
  '.sl-block-content ul,.sl-block-content ol{margin:0 0 .5em;padding-left:1.3em;}\n' +
  '.sl-block-content img{max-width:100%;}\n' +
  '.sl-block-content table{border-collapse:collapse;}\n' +
  '.sl-block-content td,.sl-block-content th{border:1px solid currentColor;padding:.15em .4em;}\n' +
  '.sl-block-content code{font-family:Consolas,monospace;font-size:.85em;}\n' +
  '.sl-block-content .mermaid-diagram svg,.sl-block-content .mermaid svg{max-width:100%;height:auto;}\n' +
  '.sl-block-content blockquote{margin:0 0 .5em;padding-left:.6em;border-left:.15em solid currentColor;opacity:.85;}\n' +
  // Field cards follow the slide's own colors rather than the app theme.
  '.sl-slide .doc-fields{display:flex;flex-wrap:wrap;gap:.25em .5em;margin:0 0 .5em;padding:.3em .6em;background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.35);border-radius:.25em;}\n' +
  '.sl-slide .doc-fields.doc-fields-vertical{display:inline-grid;grid-template-columns:auto 1fr;column-gap:.8em;}\n' +
  '.sl-slide .doc-field,.sl-slide .doc-field-key,.sl-slide .doc-field-value{font-size:.6em;color:inherit;white-space:nowrap;}\n' +
  '.sl-slide .doc-field b,.sl-slide .doc-field-key{color:inherit;font-weight:600;opacity:.8;}\n' +
  '.sl-slide .doc-field+.doc-field::before{color:inherit;opacity:.5;}\n';

(function()
{
  var style = document.createElement('style');
  style.textContent = SLIDE_EXPORT_CSS;
  document.head.appendChild(style);
})();

// ── Wiring ──

(function()
{
  var canvas = document.getElementById('slides-canvas'),
      strip = document.getElementById('slides-strip'),
      stage = document.getElementById('slides-stage'),
      present = document.getElementById('slides-present');

  if (!canvas) return;

  canvas.addEventListener('mousedown', onSlidesCanvasMouseDown);
  canvas.addEventListener('dblclick', onSlidesCanvasDblClick);
  document.addEventListener('mousemove', onSlidesMouseMove);
  document.addEventListener('mouseup', onSlidesMouseUp);
  document.addEventListener('keydown', onSlidesKeyDown);

  document.addEventListener('click', function(e)
  {
    var menu = document.getElementById('slides-bg-menu');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target)) slCloseBgMenu();
  });

  // Clicking the grey around the slide clears the selection.
  stage.addEventListener('mousedown', function(e)
  {
    if (e.target === stage && slSelection) { slSelection = null; slRenderSelection(); slSyncToolbar(); }
  });

  // Dropping an image file on the slide makes it the background.
  stage.addEventListener('dragover', function(e)
  {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1)
    {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  stage.addEventListener('drop', function(e)
  {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/^image\//.test(f.type)) return;
    e.preventDefault();
    slUseImageBlob(f, f.name);
  });

  strip.addEventListener('click', function(e)
  {
    var item = e.target.closest('.sl-thumb');
    if (item) slGoTo(parseInt(item.getAttribute('data-index'), 10));
  });
  strip.addEventListener('dblclick', function(e)
  {
    var item = e.target.closest('.sl-thumb');
    if (item) startSlidesPresentation(parseInt(item.getAttribute('data-index'), 10));
  });

  // Drag a thumbnail to reorder.
  var stripDragFrom = null;
  strip.addEventListener('dragstart', function(e)
  {
    var item = e.target.closest('.sl-thumb');
    if (!item) return;
    stripDragFrom = parseInt(item.getAttribute('data-index'), 10);
    e.dataTransfer.setData('application/x-lectern-slide', String(stripDragFrom));
    e.dataTransfer.effectAllowed = 'move';
  });
  strip.addEventListener('dragover', function(e)
  {
    if (stripDragFrom === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    strip.querySelectorAll('.sl-thumb').forEach(function(t){ t.classList.remove('drop-before', 'drop-after'); });
    var item = e.target.closest('.sl-thumb');
    if (!item) return;
    var r = item.getBoundingClientRect();
    item.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  strip.addEventListener('drop', function(e)
  {
    if (stripDragFrom === null) return;
    e.preventDefault();
    var item = e.target.closest('.sl-thumb'),
        from = stripDragFrom;
    stripDragFrom = null;
    if (!item) { slRenderStrip(); return; }
    var r = item.getBoundingClientRect(),
        to = parseInt(item.getAttribute('data-index'), 10) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
    if (to > from) to--;
    slMoveSlide(from, Math.max(0, Math.min(slDeck.slides.length - 1, to)));
  });
  strip.addEventListener('dragend', function()
  {
    stripDragFrom = null;
    strip.querySelectorAll('.sl-thumb').forEach(function(t){ t.classList.remove('drop-before', 'drop-after'); });
  });

  present.addEventListener('keydown', function(e)
  {
    if (!slPresenting) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') stopSlidesPresentation();
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].indexOf(e.key) !== -1) slPresentStep(1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].indexOf(e.key) !== -1) slPresentStep(-1);
    else if (e.key === 'Home') { slIndex = 0; slRenderPresent(); }
    else if (e.key === 'End') { slIndex = slDeck.slides.length - 1; slRenderPresent(); }
  });
  present.addEventListener('click', function(e)
  {
    if (e.target.closest('.sl-present-exit')) { stopSlidesPresentation(); return; }
    slPresentStep(e.clientX < window.innerWidth / 4 ? -1 : 1);
  });

  document.addEventListener('fullscreenchange', function()
  {
    if (slPresenting && !document.fullscreenElement) stopSlidesPresentation();
    else if (slPresenting) slRenderPresent();
  });

  window.addEventListener('resize', function()
  {
    if (slPresenting) slRenderPresent();
    else if (currentAppType === 'slides' && slView === 'visual') slRenderStage();
  });

  if (typeof ResizeObserver !== 'undefined')
    new ResizeObserver(function()
    {
      if (currentAppType === 'slides' && slView === 'visual' && !slDrag && !slPresenting) slRenderStage();
    }).observe(stage);
})();
