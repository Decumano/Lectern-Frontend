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

var cSlideDefaultW = 1280;
var cSlideDefaultH = 720;

var cSlideHeaderRe = /^---[ \t]*(\d+)[ \t]*---[ \t]*$/;
var cSlideBlockRe = /^\[[ \t]*(-?\d+(?:\.\d+)?)[ \t]*,[ \t]*(-?\d+(?:\.\d+)?)[ \t]*,[ \t]*(\d+(?:\.\d+)?)[ \t]*,[ \t]*(\d+(?:\.\d+)?)[ \t]*,[ \t]?/;

// Declarations applied to the slide element as CSS. Anything else in the
// style block is kept in the file but has no effect, the way a browser
// ignores a property it doesn't know.
var cSlideCssProps =
[
  'background', 'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat', 'background-blend-mode',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-shadow'
];

// Drawing declarations: decorations painted over the background, under the
// text, in the order they appear.
var cSlideDecoProps = ['line', 'rect', 'ellipse', 'stroke'];

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

function fDefaultSlidesContent()
{
  return  '---\ntype: presentation\nsize: ' + cSlideDefaultW + 'x' + cSlideDefaultH + '\n---\n\n' +
          '--- 1 ---\n' +
          '{\nbackground-color: #ffffff;\ncolor: #1a1a1a;\n}\n' +
          '[120, 260, 1040, 200, ;;\n# Title\n;;]\n';
}

function fNewSlideModel()
{
  return { decls: [], blocks: [], loose: [] };
}

// Splits a declaration list on ';', ignoring the ones inside parentheses —
// a data: URL (url(data:image/png;base64,…)) carries its own.
function fSplitSlideDecls(text)
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

function fParseSlideDecls(text, into)
{
  fSplitSlideDecls(text).forEach(function(part)
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

function fParseSlides(content)
{
  var lines = String(content || '').replace(/\r\n?/g, '\n').split('\n'),
      deck = { meta: [], width: cSlideDefaultW, height: cSlideDefaultH, slides: [] },
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

  function fFinishBlock()
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

    if (cSlideHeaderRe.test(line.trim()))
    {
      fFinishBlock();
      slide = fNewSlideModel();
      deck.slides.push(slide);
      inStyle = false;
      continue;
    }

    if (inStyle)
    {
      var close = line.indexOf('}');
      if (close !== -1)
      {
        fParseSlideDecls(line.slice(0, close), slide.decls);
        inStyle = false;
      }
      else
        fParseSlideDecls(line, slide.decls);
      continue;
    }

    var bm = cSlideBlockRe.exec(line);

    if (bm)
    {
      // Text before the first header still deserves a slide to live on.
      if (!slide) { slide = fNewSlideModel(); deck.slides.push(slide); }

      fFinishBlock();
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
        fParseSlideDecls(body.slice(0, closeAt), slide.decls);
      else
      {
        fParseSlideDecls(body, slide.decls);
        inStyle = true;
      }
      continue;
    }

    if (line.trim())
    {
      if (!slide) { slide = fNewSlideModel(); deck.slides.push(slide); }
      slide.loose.push(line);
    }
  }

  fFinishBlock();

  if (!deck.slides.length)
    deck.slides.push(fNewSlideModel());

  return deck;
}

function fSlNum(n)
{
  return String(Math.round(n * 100) / 100);
}

function fSerializeSlides(deck)
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
      out += '[' + fSlNum(b.x) + ', ' + fSlNum(b.y) + ', ' + fSlNum(b.w) + ', ' + fSlNum(b.h) + ', ' + (b.text || '') + ']\n';
    });
  });

  return out;
}

// ── Declarations ──

function fSlDeclValue(slide, prop)
{
  for (var i = slide.decls.length - 1; i >= 0; i--)
    if (slide.decls[i].prop === prop) return slide.decls[i].value;
  return null;
}

function fSlSetDecl(slide, prop, value)
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
    var at = slide.decls.findIndex(function(d){ return cSlideDecoProps.indexOf(d.prop) !== -1; });
    if (at === -1) slide.decls.push({ prop: prop, value: value });
    else slide.decls.splice(at, 0, { prop: prop, value: value });
  }
}

function fSlDecoIndices(slide)
{
  var out = [];
  slide.decls.forEach(function(d, i){ if (cSlideDecoProps.indexOf(d.prop) !== -1) out.push(i); });
  return out;
}

// A decoration's declaration as data: { kind, nums: [...], colors: [...] }.
function fParseSlideDeco(decl)
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

function fSerializeSlideDeco(d)
{
  if (d.kind === 'stroke')
    return { prop: 'stroke', value: d.color + ', ' + fSlNum(d.width) + ', ' + d.points.map(function(p){ return fSlNum(p.x) + ' ' + fSlNum(p.y); }).join(', ') };

  if (d.kind === 'line')
    return { prop: 'line', value: [d.x1, d.y1, d.x2, d.y2].map(fSlNum).join(', ') + ', ' + d.color + ', ' + fSlNum(d.width) };

  return { prop: d.kind, value: [d.x, d.y, d.w, d.h].map(fSlNum).join(', ') + ', ' + d.fill + ', ' + d.color + ', ' + fSlNum(d.width) };
}

function fSlDecoBounds(d)
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

function fSlMoveDeco(d, dx, dy)
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

var cSlideImageTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };

function fSlAssetPath(raw)
{
  return String(raw || '').trim().replace(/^\.\//, '').replace(/^\/+/, '');
}

function fSlIsExternalUrl(ref)
{
  return /^(data:|https?:|blob:)/i.test(ref);
}

// The displayable URL for an asset reference, or '' while it loads (the
// slide is re-rendered once it arrives).
function fSlAssetUrl(ref)
{
  ref = String(ref || '').trim();
  if (!ref) return '';
  if (fSlIsExternalUrl(ref)) return ref;

  var path = fSlAssetPath(ref),
      entry = slAssetCache[path];

  if (entry) return entry.url || '';
  if (!workFolderRoot) return '';

  slAssetCache[path] = { url: '', state: 'loading' };

  var ext = (path.split('.').pop() || '').toLowerCase();

  Platform.fReadWorkFileBinary(workFolderRoot, path, cSlideImageTypes[ext] || '')
    .then(function(blob)
    {
      slAssetCache[path] = { url: URL.createObjectURL(blob), state: 'ready' };
      fSlRenderAll();
    })
    .catch(function(e)
    {
      console.warn('Slide image could not be read: ' + path, e);
      slAssetCache[path] = { url: '', state: 'error' };
    });

  return '';
}

// Rewrites every url(…) in a CSS value to something the page can display.
function fSlResolveCssUrls(value)
{
  return String(value).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, function(_, q, ref)
  {
    var url = fSlAssetUrl(ref);
    return url ? 'url("' + url.replace(/["\\\n]/g, '') + '")' : 'none';
  });
}

// The spec allows the bare forms `background-image: [path]` and a plain path;
// both mean url(path).
function fSlNormalizeImageValue(value)
{
  var v = String(value || '').trim(),
      bracket = /^\[(.*)\]$/.exec(v);

  if (bracket) return 'url(' + bracket[1].trim() + ')';
  if (v && !/[()]/.test(v) && !/^none$/i.test(v)) return 'url(' + v + ')';
  return v;
}

function fSlExtensionForBlob(blob, name)
{
  var fromName = /\.([a-z0-9]+)$/i.exec(name || '');
  if (fromName && cSlideImageTypes[fromName[1].toLowerCase()]) return fromName[1].toLowerCase();

  var type = (blob.type || '').toLowerCase();
  for (var ext in cSlideImageTypes)
    if (cSlideImageTypes[ext] === type) return ext === 'jpeg' ? 'jpg' : ext;

  return 'png';
}

function fSlBlobToDataUrl(blob)
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
async function fSlStoreImage(blob, sourceName)
{
  if (blob.size > 20 * 1024 * 1024)
    throw new Error('the image is larger than 20 MB');

  if (blob.type && blob.type.indexOf('image/') !== 0)
    throw new Error('that file is not an image');

  if (!workFolderRoot)
    return await fSlBlobToDataUrl(blob);

  var deckName = fSanitizeFileName(files[currentFileId] && files[currentFileId].name) || 'Slides',
      ext = fSlExtensionForBlob(blob, sourceName),
      base = fSanitizeFileName(String(sourceName || 'image').replace(/\.[^.]*$/, '').replace(/[?#].*$/, '')).replace(/\s+/g, '-') || 'image',
      dir = 'assets/' + deckName,
      rel = dir + '/' + base.slice(0, 60) + '-' + Math.random().toString(16).slice(2, 8) + '.' + ext;

  try { await Platform.fCreateWorkFolder(workFolderRoot, 'assets'); } catch(e) {}
  try { await Platform.fCreateWorkFolder(workFolderRoot, dir); } catch(e) {}

  await Platform.fWriteWorkFileBinary(workFolderRoot, rel, blob);

  slAssetCache[rel] = { url: URL.createObjectURL(blob), state: 'ready' };
  return rel;
}

// ── Rendering ──

// Markdown+ for one text box. The document renderer numbers headings and
// checkboxes through shared counters; those are saved and restored so
// rendering slides never disturbs an open document's preview.
function fSlRenderMarkdown(text)
{
  if (typeof marked === 'undefined')
    return fEscHtml(text || '');

  var saved = [documentHeadings, slugCounts, headingRenderCursor, checkboxRenderIndex];

  documentHeadings = [];
  slugCounts = {};
  headingRenderCursor = 0;
  checkboxRenderIndex = 0;

  try
  {
    return fSanitizeHtml(fRenderMarkdownFragment(text || ''));
  }
  catch(e)
  {
    return fEscHtml(text || '');
  }
  finally
  {
    documentHeadings = saved[0];
    slugCounts = saved[1];
    headingRenderCursor = saved[2];
    checkboxRenderIndex = saved[3];
  }
}

function fSlSvg(tag, attrs)
{
  var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (var k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// The notebook's smoothing: a quadratic through each midpoint, so freehand
// lines look drawn rather than faceted.
function fSlStrokePath(points)
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

function fSlDecoElement(d)
{
  var el;

  if (d.kind === 'line')
    el = fSlSvg('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, stroke: d.color, 'stroke-width': d.width, 'stroke-linecap': 'round' });
  else if (d.kind === 'stroke')
    el = fSlSvg('path', { d: fSlStrokePath(d.points), fill: 'none', stroke: d.color, 'stroke-width': d.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  else if (d.kind === 'rect')
    el = fSlSvg('rect', { x: d.x, y: d.y, width: Math.max(0, d.w), height: Math.max(0, d.h), fill: d.fill, stroke: d.color, 'stroke-width': d.width });
  else
    el = fSlSvg('ellipse', { cx: d.x + d.w / 2, cy: d.y + d.h / 2, rx: Math.max(0, d.w / 2), ry: Math.max(0, d.h / 2), fill: d.fill, stroke: d.color, 'stroke-width': d.width });

  return el;
}

// Builds a slide's DOM at full size (deck.width × deck.height). `interactive`
// adds the hooks the editor needs (indices, selection, handles).
function fSlBuildSlide(deck, slide, interactive)
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
    if (cSlideCssProps.indexOf(d.prop) === -1) return;

    var value = d.value;
    if (d.prop === 'background-image') value = fSlNormalizeImageValue(value);
    if (/url\(/i.test(value)) value = fSlResolveCssUrls(value);

    el.style.setProperty(d.prop, value);
  });

  var svg = fSlSvg('svg', { class: 'sl-deco', width: deck.width, height: deck.height, viewBox: '0 0 ' + deck.width + ' ' + deck.height });

  fSlDecoIndices(slide).forEach(function(declIdx)
  {
    var d = fParseSlideDeco(slide.decls[declIdx]);
    if (!d) return;

    var shape = fSlDecoElement(d);
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
    content.innerHTML = fSlRenderMarkdown(b.text);
    box.appendChild(content);

    if (interactive) box.setAttribute('data-block', i);
    el.appendChild(box);
  });

  if (typeof fRenderMermaidDiagrams === 'function' && el.querySelector('.mermaid'))
  {
    // Mermaid measures text as it lays out, so it needs the node in the page.
    setTimeout(function(){ if (el.isConnected) fRenderMermaidDiagrams(el); }, 0);
  }

  return el;
}

// Places a full-size slide inside `host`, scaled to fit it.
function fSlMountScaled(host, slideEl, deck, maxW, maxH)
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

function fSlCurrentSlide()
{
  return slDeck && slDeck.slides[slIndex];
}

var slStageScale = 1;

function fSlRenderStage()
{
  var stage = document.getElementById('slides-stage'),
      host = document.getElementById('slides-canvas');

  if (!stage || !host || !slDeck) return;

  var slide = fSlCurrentSlide();
  if (!slide) return;

  // A text box being edited survives the rebuild with what was typed so far.
  var openEditor = host.querySelector('.sl-block-editor'),
      typing = openEditor && slEditing !== null
               ? { value: openEditor.value, start: openEditor.selectionStart, end: openEditor.selectionEnd, focused: document.activeElement === openEditor }
               : null;

  var el = fSlBuildSlide(slDeck, slide, true),
      pad = 48;

  slStageScale = fSlMountScaled(host, el, slDeck, Math.max(80, stage.clientWidth - pad), Math.max(60, stage.clientHeight - pad));

  host.classList.toggle('sl-tool-draw', slTool !== 'select');

  fSlRenderSelection();

  if (slEditing !== null)
  {
    fSlOpenBlockEditor(slEditing, false, !typing || typing.focused);

    var ta = host.querySelector('.sl-block-editor');
    if (ta && typing)
    {
      ta.value = typing.value;
      ta.setSelectionRange(typing.start, typing.end);
    }
  }
}

function fSlRenderSelection()
{
  var host = document.getElementById('slides-canvas'),
      slideEl = host && host.querySelector('.sl-slide');

  if (!slideEl) return;

  slideEl.querySelectorAll('.sl-sel-box').forEach(function(n){ n.remove(); });
  slideEl.querySelectorAll('.sl-block.sl-selected').forEach(function(n){ n.classList.remove('sl-selected'); });

  var slide = fSlCurrentSlide();
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
        d = decl && fParseSlideDeco(decl);
    if (!d) { slSelection = null; return; }
    box = fSlDecoBounds(d);
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
  var d2 = slSelection.kind === 'deco' ? fParseSlideDeco(slide.decls[slSelection.index]) : null;

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

function fSlRenderStrip()
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

    var fNum = document.createElement('span');
    fNum.className = 'sl-thumb-num';
    fNum.textContent = i + 1;

    var host = document.createElement('div');
    host.className = 'sl-thumb-frame';
    fSlMountScaled(host, fSlBuildSlide(slDeck, slide, false), slDeck, thumbW, thumbW);

    item.appendChild(fNum);
    item.appendChild(host);
    strip.appendChild(item);
  });

  var add = document.createElement('button');
  add.type = 'button';
  add.className = 'sl-thumb-add';
  add.textContent = '+ Slide';
  add.onclick = fSlAddSlide;
  strip.appendChild(add);

  var active = strip.querySelector('.sl-thumb.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

function fSlScheduleStrip()
{
  clearTimeout(slThumbTimer);
  slThumbTimer = setTimeout(fSlRenderStrip, 250);
}

function fSlSyncToolbar()
{
  var slide = fSlCurrentSlide();
  if (!slide) return;

  var bg = fSlDeclValue(slide, 'background-color'),
      fg = fSlDeclValue(slide, 'color'),
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

function fSlRenderAll()
{
  if (!slDeck || currentAppType !== 'slides') return;

  if (slView === 'visual')
  {
    fSlRenderStage();
    fSlRenderStrip();
  }

  fSlSyncToolbar();

  if (slPresenting) fSlRenderPresent();
}

// ── Load / save / undo ──

function fLoadSlidesFile(file)
{
  document.getElementById('slides-title-input').value = file.name;

  // Reloading the deck that's already open (a restored version, a change
  // from another window) stays on the same slide; another deck starts at 1.
  var sameFile = slDeck && slDeck.__file === currentFileId;

  slDeck = fParseSlides(file.content || fDefaultSlidesContent());
  slIndex = sameFile ? Math.max(0, Math.min(slIndex, slDeck.slides.length - 1)) : 0;
  slDeck.__file = currentFileId;

  slSelection = null;
  slEditing = null;
  slUndoStack = [];
  slRedoStack = [];

  document.getElementById('slides-source').value = file.content || '';
  fSlApplyView();
  fSlRenderAll();
}

function fOnSlidesTitleChange()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'slides')
    return;

  files[currentFileId].name = (document.getElementById('slides-title-input').value || files[currentFileId].name);
  fScheduleSave();
  fRenderFileList();
}

// Takes what's typed in an open text box into the model (as its own undo
// step) and ends the edit. Runs before any other change, so an edit in
// progress is never lost to a toolbar action or a slide switch.
function fSlFlushEditor()
{
  if (slEditing === null) return false;

  var index = slEditing,
      slide = fSlCurrentSlide(),
      ta = document.querySelector('#slides-canvas .sl-block-editor');

  slEditing = null;

  if (!ta || !slide || !slide.blocks[index] || ta.value === slide.blocks[index].text)
    return false;

  slUndoStack.push(fSerializeSlides(slDeck));
  if (slUndoStack.length > 100) slUndoStack.shift();
  slRedoStack = [];
  slide.blocks[index].text = ta.value;
  return true;
}

function fSlSnapshot()
{
  if (!slDeck) return;
  fSlFlushEditor();
  slUndoStack.push(fSerializeSlides(slDeck));
  if (slUndoStack.length > 100) slUndoStack.shift();
  slRedoStack = [];
}

// Writes the model back to the file. `structural` re-renders everything;
// otherwise only what the edit could have changed.
function fSlCommit(structural)
{
  if (!slDeck || !currentFileId || !files[currentFileId] || files[currentFileId].type !== 'slides')
    return;

  var text = fSerializeSlides(slDeck);
  files[currentFileId].content = text;
  document.getElementById('slides-source').value = text;
  fScheduleSave();

  if (structural) fSlRenderAll();
  else
  {
    fSlRenderStage();
    fSlSyncToolbar();
    fSlScheduleStrip();
  }
}

function fSlRestore(from, to)
{
  if (!from.length || !slDeck) return;

  to.push(fSerializeSlides(slDeck));

  var keepFile = slDeck.__file;
  slDeck = fParseSlides(from.pop());
  slDeck.__file = keepFile;
  slIndex = Math.min(slIndex, slDeck.slides.length - 1);
  slSelection = null;
  slEditing = null;
  fSlCommit(true);
}

function fSlUndo() { fSlRestore(slUndoStack, slRedoStack); }
function fSlRedo() { fSlRestore(slRedoStack, slUndoStack); }

// ── Views ──

function fSetSlidesView(view)
{
  if (view === slView) return;

  if (slView === 'source')
    fSlApplySourceNow();
  else
    fSlCloseBlockEditor(true);

  slView = view;
  fSlApplyView();
  fSlRenderAll();
}

function fSlApplyView()
{
  var visual = slView === 'visual';

  document.getElementById('slides-visual').style.display = visual ? '' : 'none';
  document.getElementById('slides-source-pane').style.display = visual ? 'none' : '';
  document.getElementById('svbtn-visual').classList.toggle('active', visual);
  document.getElementById('svbtn-source').classList.toggle('active', !visual);
  document.querySelectorAll('#slides-toolbar .sl-visual-only').forEach(function(el){ el.style.display = visual ? '' : 'none'; });
}

function fOnSlidesSourceInput()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'slides')
    return;

  files[currentFileId].content = document.getElementById('slides-source').value;
  fScheduleSave();

  clearTimeout(slSourceTimer);
  slSourceTimer = setTimeout(fSlApplySourceNow, 300);
}

function fSlApplySourceNow()
{
  clearTimeout(slSourceTimer);

  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'slides')
    return;

  var keepFile = slDeck && slDeck.__file;
  slDeck = fParseSlides(document.getElementById('slides-source').value);
  slDeck.__file = keepFile;
  slIndex = Math.min(slIndex, slDeck.slides.length - 1);
  slSelection = null;
  fSlSyncToolbar();
}

// ── Slides: add, remove, reorder ──

function fSlGoTo(i)
{
  if (!slDeck) return;
  fSlCloseBlockEditor(true);
  slIndex = Math.max(0, Math.min(slDeck.slides.length - 1, i));
  slSelection = null;
  fSlRenderAll();
}

function fSlAddSlide()
{
  if (!slDeck) return;
  fSlSnapshot();

  // A new slide keeps the look of the current one, but not its content.
  var cur = fSlCurrentSlide(),
      slide = fNewSlideModel();

  if (cur)
    cur.decls.forEach(function(d)
    {
      if (cSlideDecoProps.indexOf(d.prop) === -1) slide.decls.push({ prop: d.prop, value: d.value });
    });

  slDeck.slides.splice(slIndex + 1, 0, slide);
  slIndex++;
  slSelection = null;
  fSlCommit(true);
}

function fSlDuplicateSlide()
{
  var cur = fSlCurrentSlide();
  if (!cur) return;
  fSlSnapshot();

  slDeck.slides.splice(slIndex + 1, 0, JSON.parse(JSON.stringify(cur)));
  slIndex++;
  slSelection = null;
  fSlCommit(true);
}

function fSlDeleteSlide()
{
  if (!slDeck) return;

  if (slDeck.slides.length === 1)
  {
    alert('A presentation needs at least one slide.');
    return;
  }

  if (!confirm('Delete slide ' + (slIndex + 1) + '?')) return;

  fSlSnapshot();
  slDeck.slides.splice(slIndex, 1);
  slIndex = Math.min(slIndex, slDeck.slides.length - 1);
  slSelection = null;
  fSlCommit(true);
}

function fSlMoveSlide(from, to)
{
  if (!slDeck || from === to || from < 0 || to < 0 || from >= slDeck.slides.length || to >= slDeck.slides.length) return;
  fSlSnapshot();

  var moved = slDeck.slides.splice(from, 1)[0];
  slDeck.slides.splice(to, 0, moved);
  slIndex = to;
  slSelection = null;
  fSlCommit(true);
}

// ── Slide style: background, text color ──

function fSlSetBackgroundColor(value)
{
  var slide = fSlCurrentSlide();
  if (!slide) return;
  fSlSnapshot();
  fSlSetDecl(slide, 'background-color', value);
  fSlCommit(false);
}

function fSlSetTextColor(value)
{
  var slide = fSlCurrentSlide();
  if (!slide) return;
  fSlSnapshot();
  fSlSetDecl(slide, 'color', value);
  fSlCommit(false);
}

function fSlApplyBackgroundToAll()
{
  var cur = fSlCurrentSlide();
  if (!cur || !slDeck) return;
  fSlSnapshot();

  var props = ['background', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'color'];

  slDeck.slides.forEach(function(s)
  {
    if (s === cur) return;
    props.forEach(function(p){ fSlSetDecl(s, p, fSlDeclValue(cur, p)); });
  });

  fSlCloseBgMenu();
  fSlCommit(true);
}

function fToggleSlidesBgMenu(e)
{
  if (e) e.stopPropagation();
  var menu = document.getElementById('slides-bg-menu');
  menu.classList.toggle('open');
}

function fSlCloseBgMenu()
{
  var menu = document.getElementById('slides-bg-menu');
  if (menu) menu.classList.remove('open');
}

async function fSlUseImageBlob(blob, name)
{
  var slide = fSlCurrentSlide();
  if (!slide) return;

  var ref;

  try
  {
    ref = await fSlStoreImage(blob, name);
  }
  catch(e)
  {
    alert('Could not add the image: ' + (e && e.message || e));
    return;
  }

  fSlSnapshot();
  fSlSetDecl(slide, 'background-image', 'url(' + ref + ')');
  fSlCommit(true);
}

function fSlPickImageFile()
{
  fSlCloseBgMenu();
  document.getElementById('slides-image-input').click();
}

function fOnSlidesImageChosen(e)
{
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) fSlUseImageBlob(file, file.name);
}

async function fSlPickImageUrl()
{
  fSlCloseBgMenu();

  var url = prompt('Image address (it is downloaded and stored with this presentation):', 'https://');
  if (!url || !/^https?:\/\/\S+$/i.test(url.trim())) return;

  url = url.trim();

  var blob;

  try
  {
    blob = await Platform.fFetchRemoteFile(url);
  }
  catch(e)
  {
    alert(Platform.isNative
            ? 'Could not download the image: ' + (e && e.message || e)
            : 'That site doesn\'t let the browser copy its images. Save the image to your computer, then use "From this computer…".');
    return;
  }

  var name = decodeURIComponent((url.split(/[?#]/)[0].split('/').pop() || 'image'));
  fSlUseImageBlob(blob, name);
}

function fSlRemoveImage()
{
  var slide = fSlCurrentSlide();
  fSlCloseBgMenu();
  if (!slide) return;
  fSlSnapshot();
  fSlSetDecl(slide, 'background-image', null);
  fSlCommit(true);
}

// ── Tools ──

function fSetSlidesTool(tool)
{
  fSlCloseBlockEditor(true);
  slTool = tool;
  if (tool !== 'select') slSelection = null;
  fSlRenderStage();
  fSlSyncToolbar();
}

function fSetSlidesStrokeColor(v) { slStrokeColor = v; fSlApplyStyleToSelection(); }
function fSetSlidesFillColor(v) { slFillColor = v; slFillNone = false; document.getElementById('slides-fill-none').checked = false; fSlApplyStyleToSelection(); }
function fSetSlidesFillNone(none) { slFillNone = none; fSlApplyStyleToSelection(); }
function fSetSlidesLineWidth(v) { slLineWidth = Math.max(1, Math.min(60, parseFloat(v) || 1)); fSlApplyStyleToSelection(); }

// Changing a color or width with a shape selected restyles that shape.
function fSlApplyStyleToSelection()
{
  var slide = fSlCurrentSlide();
  if (!slide || !slSelection || slSelection.kind !== 'deco') return;

  var d = fParseSlideDeco(slide.decls[slSelection.index]);
  if (!d) return;

  fSlSnapshot();
  d.color = slStrokeColor;
  d.width = slLineWidth;
  if (d.kind === 'rect' || d.kind === 'ellipse') d.fill = slFillNone ? 'none' : slFillColor;
  slide.decls[slSelection.index] = fSerializeSlideDeco(d);
  fSlCommit(false);
}

function fSlAddTextBox()
{
  var slide = fSlCurrentSlide();
  if (!slide) return;
  fSlSnapshot();

  var w = Math.round(slDeck.width * 0.6), h = Math.round(slDeck.height * 0.2);
  slide.blocks.push({ x: Math.round((slDeck.width - w) / 2), y: Math.round((slDeck.height - h) / 2), w: w, h: h, text: 'Text' });
  slSelection = { kind: 'block', index: slide.blocks.length - 1 };
  slTool = 'select';
  fSlCommit(false);
  fSlOpenBlockEditor(slSelection.index, true);
}

function fSlDeleteSelection()
{
  var slide = fSlCurrentSlide();
  if (!slide || !slSelection) return;
  fSlSnapshot();

  if (slSelection.kind === 'block') slide.blocks.splice(slSelection.index, 1);
  else slide.decls.splice(slSelection.index, 1);

  slSelection = null;
  fSlCommit(false);
}

// Bring the selected item to the front (end of its list) or send it back.
function fSlReorderSelection(toFront)
{
  var slide = fSlCurrentSlide();
  if (!slide || !slSelection) return;
  fSlSnapshot();

  if (slSelection.kind === 'block')
  {
    var b = slide.blocks.splice(slSelection.index, 1)[0];
    if (toFront) slide.blocks.push(b); else slide.blocks.unshift(b);
    slSelection.index = toFront ? slide.blocks.length - 1 : 0;
  }
  else
  {
    var decos = fSlDecoIndices(slide),
        d = slide.decls.splice(slSelection.index, 1)[0];
    decos = fSlDecoIndices(slide);

    var at = toFront ? (decos.length ? decos[decos.length - 1] + 1 : slide.decls.length)
                     : (decos.length ? decos[0] : slide.decls.length);
    slide.decls.splice(at, 0, d);
    slSelection.index = at;
  }

  fSlCommit(false);
}

// ── Text box editing ──

function fSlOpenBlockEditor(index, selectAll, focus)
{
  var slide = fSlCurrentSlide(),
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
      fSlCloseBlockEditor(true);
    }
  });
  ta.addEventListener('mousedown', function(e){ e.stopPropagation(); });
  // A re-render replaces the textarea, and the old one may report a blur on
  // its way out; only the live one ends the edit.
  ta.addEventListener('blur', function(){ setTimeout(function(){ if (ta.isConnected && document.activeElement !== ta) fSlCloseBlockEditor(true); }, 0); });

  blockEl.appendChild(ta);
  if (focus === false) return;
  ta.focus({ preventScroll: true });
  if (selectAll) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
}

function fSlCloseBlockEditor(fCommit)
{
  if (slEditing === null) return;

  if (fCommit && fSlFlushEditor())
  {
    fSlCommit(false);
    return;
  }

  slEditing = null;
  fSlRenderStage();
}

// ── Pointer interaction on the slide ──

function fSlPointFromEvent(e)
{
  var slideEl = document.querySelector('#slides-canvas .sl-slide');
  if (!slideEl) return { x: 0, y: 0 };

  var r = slideEl.getBoundingClientRect();
  return { x: (e.clientX - r.left) / slStageScale, y: (e.clientY - r.top) / slStageScale };
}

function fSlRound(v) { return Math.round(v); }

function fOnSlidesCanvasMouseDown(e)
{
  if (e.button !== 0 || !slDeck) return;

  var slide = fSlCurrentSlide();
  if (!slide) return;

  if (e.target.closest('.sl-block-editor')) return;

  fSlCloseBlockEditor(true);

  var pt = fSlPointFromEvent(e);

  if (slTool === 'select')
  {
    var handle = e.target.closest('[data-handle]');

    if (handle && slSelection)
    {
      e.preventDefault();
      var item = slSelection.kind === 'block' ? slide.blocks[slSelection.index] : fParseSlideDeco(slide.decls[slSelection.index]);
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
      fSlRenderSelection();
      fSlSyncToolbar();
      return;
    }

    e.preventDefault();

    var target = slSelection.kind === 'block' ? slide.blocks[slSelection.index] : fParseSlideDeco(slide.decls[slSelection.index]);
    slDrag = { mode: 'move', start: pt, orig: JSON.parse(JSON.stringify(target)), snapped: false };

    if (slSelection.kind === 'deco' && target)
    {
      slStrokeColor = target.color && target.color !== 'none' ? target.color : slStrokeColor;
      slLineWidth = target.width || slLineWidth;
      var sc = document.getElementById('slides-stroke-color'), lw = document.getElementById('slides-line-width');
      if (sc && /^#[0-9a-f]{6}$/i.test(slStrokeColor)) sc.value = slStrokeColor;
      if (lw) lw.value = slLineWidth;
    }

    fSlRenderSelection();
    fSlSyncToolbar();
    return;
  }

  e.preventDefault();

  // Drawing tools: the item is created on mousedown and shaped while dragging.
  slDrag = { mode: 'create', tool: slTool, start: pt, points: [pt], snapped: false };
}

function fOnSlidesMouseMove(e)
{
  if (!slDrag || !slDeck) return;

  var slide = fSlCurrentSlide(),
      pt = fSlPointFromEvent(e),
      dx = pt.x - slDrag.start.x,
      dy = pt.y - slDrag.start.y;

  if (!slDrag.snapped)
  {
    if (Math.abs(dx) * slStageScale < 3 && Math.abs(dy) * slStageScale < 3) return;
    slDrag.snapped = true;
    if (slDrag.mode !== 'create') fSlSnapshot();
  }

  if (slDrag.mode === 'move' && slSelection)
  {
    if (slSelection.kind === 'block')
    {
      var b = slide.blocks[slSelection.index];
      b.x = fSlRound(slDrag.orig.x + dx);
      b.y = fSlRound(slDrag.orig.y + dy);
    }
    else
    {
      var d = JSON.parse(JSON.stringify(slDrag.orig));
      fSlMoveDeco(d, fSlRound(dx), fSlRound(dy));
      slide.decls[slSelection.index] = fSerializeSlideDeco(d);
    }
    fSlRenderStage();
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

    var r = { x: fSlRound(x1), y: fSlRound(y1), w: fSlRound(x2 - x1), h: fSlRound(y2 - y1) };

    if (slSelection.kind === 'block')
      Object.assign(slide.blocks[slSelection.index], r);
    else
    {
      var shape = JSON.parse(JSON.stringify(o));
      Object.assign(shape, r);
      slide.decls[slSelection.index] = fSerializeSlideDeco(shape);
    }
    fSlRenderStage();
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
    fSlRenderDraft();
  }
}

// The shape being drawn, before it is committed to the file.
function fSlDraftItem()
{
  var s = slDrag.start, p = slDrag.current || s;

  if (slDrag.tool === 'pen')
    return { kind: 'stroke', color: slStrokeColor, width: slLineWidth, points: slDrag.points.map(function(q){ return { x: fSlRound(q.x), y: fSlRound(q.y) }; }) };

  if (slDrag.tool === 'line')
    return { kind: 'line', x1: fSlRound(s.x), y1: fSlRound(s.y), x2: fSlRound(p.x), y2: fSlRound(p.y), color: slStrokeColor, width: slLineWidth };

  var rect = { x: fSlRound(Math.min(s.x, p.x)), y: fSlRound(Math.min(s.y, p.y)), w: fSlRound(Math.abs(p.x - s.x)), h: fSlRound(Math.abs(p.y - s.y)) };

  if (slDrag.tool === 'text') return Object.assign({ kind: 'text' }, rect);

  return Object.assign({ kind: slDrag.tool, fill: slFillNone ? 'none' : slFillColor, color: slStrokeColor, width: slLineWidth }, rect);
}

function fSlRenderDraft()
{
  var slideEl = document.querySelector('#slides-canvas .sl-slide'),
      svg = slideEl && slideEl.querySelector('svg.sl-deco');

  if (!svg) return;

  var old = svg.querySelector('.sl-draft');
  if (old) old.remove();

  var item = fSlDraftItem(), el;

  if (item.kind === 'text')
    el = fSlSvg('rect', { x: item.x, y: item.y, width: item.w, height: item.h, fill: 'none', stroke: '#d4a843', 'stroke-dasharray': '8 6', 'stroke-width': 2 / slStageScale });
  else
    el = fSlDecoElement(item);

  el.classList.add('sl-draft');
  svg.appendChild(el);
}

function fOnSlidesMouseUp()
{
  if (!slDrag || !slDeck) return;

  var drag = slDrag;
  slDrag = null;

  var slide = fSlCurrentSlide();
  if (!slide) return;

  if (drag.mode === 'move' || drag.mode === 'resize')
  {
    if (drag.snapped) fSlCommit(false);
    return;
  }

  // create
  if (!drag.current) drag.current = drag.start;
  slDrag = drag;
  var item = fSlDraftItem();
  slDrag = null;

  var fTiny = function(w, h){ return w * slStageScale < 4 && h * slStageScale < 4; };

  if (item.kind === 'text')
  {
    // A click (no drag) drops a default-sized box at the pointer.
    if (fTiny(item.w, item.h)) { item.w = Math.round(slDeck.width * 0.4); item.h = Math.round(slDeck.height * 0.15); }
    fSlSnapshot();
    slide.blocks.push({ x: item.x, y: item.y, w: item.w, h: item.h, text: '' });
    slSelection = { kind: 'block', index: slide.blocks.length - 1 };
    slTool = 'select';
    fSlCommit(false);
    fSlOpenBlockEditor(slSelection.index);
    return;
  }

  if (item.kind === 'stroke' ? item.points.length < 2 && !drag.snapped : (item.kind === 'line' ? fTiny(Math.abs(item.x2 - item.x1), Math.abs(item.y2 - item.y1)) : fTiny(item.w, item.h)))
  {
    fSlRenderStage();
    return;
  }

  fSlSnapshot();
  slide.decls.push(fSerializeSlideDeco(item));
  fSlCommit(false);
}

function fOnSlidesCanvasDblClick(e)
{
  if (slTool !== 'select') return;

  var blockEl = e.target.closest('.sl-block');
  if (!blockEl || blockEl.classList.contains('sl-editing')) return;

  fSlOpenBlockEditor(parseInt(blockEl.getAttribute('data-block'), 10));
}

function fOnSlidesKeyDown(e)
{
  if (currentAppType !== 'slides' || !slDeck || slView !== 'visual' || slPresenting) return;

  var t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'color') || t.isContentEditable)) return;

  // Only while the slides app is what's being worked on: not with a modal open.
  if (document.querySelector('.modal-overlay.open')) return;

  var mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();

  if (mod && !e.shiftKey && key === 'z') { e.preventDefault(); fSlUndo(); return; }
  if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) { e.preventDefault(); fSlRedo(); return; }
  if (mod && key === 'd' && slSelection) { e.preventDefault(); fSlDuplicateSelection(); return; }

  if ((e.key === 'Delete' || e.key === 'Backspace') && slSelection) { e.preventDefault(); fSlDeleteSelection(); return; }
  if (e.key === 'Enter' && slSelection && slSelection.kind === 'block') { e.preventDefault(); fSlOpenBlockEditor(slSelection.index); return; }
  if (e.key === 'Escape') { slSelection = null; fSetSlidesTool('select'); return; }

  if (e.key === 'PageDown') { e.preventDefault(); fSlGoTo(slIndex + 1); return; }
  if (e.key === 'PageUp') { e.preventDefault(); fSlGoTo(slIndex - 1); return; }
  if (e.key === 'F5') { e.preventDefault(); fStartSlidesPresentation(e.shiftKey ? slIndex : 0); return; }

  if (slSelection && /^Arrow/.test(e.key))
  {
    e.preventDefault();
    var step = e.shiftKey ? 10 : 1,
        dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        slide = fSlCurrentSlide();

    fSlSnapshot();
    if (slSelection.kind === 'block') { slide.blocks[slSelection.index].x += dx; slide.blocks[slSelection.index].y += dy; }
    else
    {
      var d = fParseSlideDeco(slide.decls[slSelection.index]);
      fSlMoveDeco(d, dx, dy);
      slide.decls[slSelection.index] = fSerializeSlideDeco(d);
    }
    fSlCommit(false);
    return;
  }

  if (!slSelection && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) { e.preventDefault(); fSlGoTo(slIndex + 1); }
  else if (!slSelection && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) { e.preventDefault(); fSlGoTo(slIndex - 1); }
}

function fSlDuplicateSelection()
{
  var slide = fSlCurrentSlide();
  if (!slide || !slSelection) return;
  fSlSnapshot();

  if (slSelection.kind === 'block')
  {
    var b = JSON.parse(JSON.stringify(slide.blocks[slSelection.index]));
    b.x += 20; b.y += 20;
    slide.blocks.push(b);
    slSelection = { kind: 'block', index: slide.blocks.length - 1 };
  }
  else
  {
    var d = fParseSlideDeco(slide.decls[slSelection.index]);
    fSlMoveDeco(d, 20, 20);
    slide.decls.push(fSerializeSlideDeco(d));
    slSelection = { kind: 'deco', index: slide.decls.length - 1 };
  }

  fSlCommit(false);
}

// ── Present ──

function fStartSlidesPresentation(from)
{
  if (!slDeck) return;

  if (slView === 'source') fSlApplySourceNow();
  fSlCloseBlockEditor(true);

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

  fSlRenderPresent();
}

function fStopSlidesPresentation()
{
  if (!slPresenting) return;
  slPresenting = false;

  document.getElementById('slides-present').classList.remove('open');

  try
  {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){});
  }
  catch(e) {}

  fSlRenderAll();
}

function fSlRenderPresent()
{
  var overlay = document.getElementById('slides-present'),
      host = document.getElementById('slides-present-frame'),
      slide = fSlCurrentSlide();

  if (!overlay || !host || !slide) return;

  fSlMountScaled(host, fSlBuildSlide(slDeck, slide, false), slDeck, overlay.clientWidth || window.innerWidth, overlay.clientHeight || window.innerHeight);

  var counter = document.getElementById('slides-present-counter');
  if (counter) counter.textContent = (slIndex + 1) + ' / ' + slDeck.slides.length;
}

function fSlPresentStep(delta)
{
  if (!slDeck) return;
  var next = slIndex + delta;
  if (next < 0 || next >= slDeck.slides.length) return;
  slIndex = next;
  fSlRenderPresent();
}

// ── Export ──
// One page per slide at the deck's own size. Images are inlined as data:
// URLs, so the exported file stands on its own.

async function fSlInlineAssetsFor(deck)
{
  var refs = {};

  deck.slides.forEach(function(s)
  {
    s.decls.forEach(function(d)
    {
      var v = d.prop === 'background-image' ? fSlNormalizeImageValue(d.value) : d.value;
      String(v).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, function(_, q, ref){ if (!fSlIsExternalUrl(ref)) refs[fSlAssetPath(ref)] = 1; return _; });
    });
  });

  var inlined = {};

  for (var path in refs)
  {
    try
    {
      var ext = (path.split('.').pop() || '').toLowerCase(),
          blob = await Platform.fReadWorkFileBinary(workFolderRoot, path, cSlideImageTypes[ext] || '');
      inlined[path] = await fSlBlobToDataUrl(blob);
    }
    catch(e) { console.warn('Export: could not inline ' + path, e); }
  }

  return inlined;
}

async function fBuildSlidesExportHtml(file)
{
  var deck = fParseSlides(file.content || ''),
      saved = slAssetCache;

  if (workFolderRoot)
  {
    var inlined = await fSlInlineAssetsFor(deck);
    slAssetCache = {};
    Object.keys(inlined).forEach(function(p){ slAssetCache[p] = { url: inlined[p], state: 'ready' }; });
  }

  var pages = '';

  try
  {
    deck.slides.forEach(function(slide)
    {
      var el = fSlBuildSlide(deck, slide, false);
      pages += '<section class="page">' + el.outerHTML + '</section>\n';
    });
  }
  finally
  {
    slAssetCache = saved;
  }

  pages = await fInlineMermaidSvgs(pages);

  return  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
          '<title>' + fEscHtml(file.name) + '</title>\n<style>\n' +
          '@page{size:' + deck.width + 'px ' + deck.height + 'px;margin:0;}\n' +
          'html,body{margin:0;padding:0;background:#555;}\n' +
          '.page{width:' + deck.width + 'px;height:' + deck.height + 'px;margin:0 auto 24px;overflow:hidden;break-after:page;position:relative;}\n' +
          '.page:last-child{break-after:auto;}\n' +
          cSlideExportCss +
          '@media print{html,body{background:none;}.page{margin:0;}}\n' +
          '</style>\n</head>\n<body>\n' + pages + '</body>\n</html>';
}

// The slide look, shared by the editor stylesheet and exported files.
var cSlideExportCss =
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
  style.textContent = cSlideExportCss;
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

  canvas.addEventListener('mousedown', fOnSlidesCanvasMouseDown);
  canvas.addEventListener('dblclick', fOnSlidesCanvasDblClick);
  document.addEventListener('mousemove', fOnSlidesMouseMove);
  document.addEventListener('mouseup', fOnSlidesMouseUp);
  document.addEventListener('keydown', fOnSlidesKeyDown);

  document.addEventListener('click', function(e)
  {
    var menu = document.getElementById('slides-bg-menu');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target)) fSlCloseBgMenu();
  });

  // Clicking the grey around the slide clears the selection.
  stage.addEventListener('mousedown', function(e)
  {
    if (e.target === stage && slSelection) { slSelection = null; fSlRenderSelection(); fSlSyncToolbar(); }
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
    fSlUseImageBlob(f, f.name);
  });

  strip.addEventListener('click', function(e)
  {
    var item = e.target.closest('.sl-thumb');
    if (item) fSlGoTo(parseInt(item.getAttribute('data-index'), 10));
  });
  strip.addEventListener('dblclick', function(e)
  {
    var item = e.target.closest('.sl-thumb');
    if (item) fStartSlidesPresentation(parseInt(item.getAttribute('data-index'), 10));
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
    if (!item) { fSlRenderStrip(); return; }
    var r = item.getBoundingClientRect(),
        to = parseInt(item.getAttribute('data-index'), 10) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
    if (to > from) to--;
    fSlMoveSlide(from, Math.max(0, Math.min(slDeck.slides.length - 1, to)));
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
    if (e.key === 'Escape') fStopSlidesPresentation();
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].indexOf(e.key) !== -1) fSlPresentStep(1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].indexOf(e.key) !== -1) fSlPresentStep(-1);
    else if (e.key === 'Home') { slIndex = 0; fSlRenderPresent(); }
    else if (e.key === 'End') { slIndex = slDeck.slides.length - 1; fSlRenderPresent(); }
  });
  present.addEventListener('click', function(e)
  {
    if (e.target.closest('.sl-present-exit')) { fStopSlidesPresentation(); return; }
    fSlPresentStep(e.clientX < window.innerWidth / 4 ? -1 : 1);
  });

  document.addEventListener('fullscreenchange', function()
  {
    if (slPresenting && !document.fullscreenElement) fStopSlidesPresentation();
    else if (slPresenting) fSlRenderPresent();
  });

  window.addEventListener('resize', function()
  {
    if (slPresenting) fSlRenderPresent();
    else if (currentAppType === 'slides' && slView === 'visual') fSlRenderStage();
  });

  if (typeof ResizeObserver !== 'undefined')
    new ResizeObserver(function()
    {
      if (currentAppType === 'slides' && slView === 'visual' && !slDrag && !slPresenting) fSlRenderStage();
    }).observe(stage);
})();
