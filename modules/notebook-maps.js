// Notebook: map pages, pins, scale and travel tools
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── MAP PAGES ──
// A map page is a regular notebook page with type:'map'. It adds an image
// background, location pins linked to Doc files, a scale reference, and a
// travel-time calculator. Drawing tools still work on top of the map image.

var nbMapTool = null;        // null | 'pin' | 'travel' | 'scale'
var mapTravelPath = [];      // [{x,y}] in page coordinates
var mapTravelPageIndex = -1;
var mapScalePhase = 0;       // 0=idle, 1=waiting for second click
var mapScaleP1 = null;       // {x,y}
var mapScalePageIndex = -1;
var mapActivePinEdit = null; // {pageIndex, pinId}

var MAP_TERRAIN = [
  { id: 'road',  label: 'Road',          color: '#9ca3af' },
  { id: 'trail', label: 'Trail',         color: '#c4a26a' },
  { id: 'rough', label: 'Rough terrain', color: '#7a9e6a' },
  { id: 'sea',   label: 'Sea / River',   color: '#4a9fc8' }
];

function terrainColor(id)
{
  var t = MAP_TERRAIN.find(function(t){ return t.id === id; });
  return t ? t.color : '#9ca3af';
}

function onTerrainSelectChange(id)
{
  var dot = document.getElementById('map-terrain-dot');
  if (dot) dot.style.background = terrainColor(id);
}

// km/day per transport mode, keyed by terrain id.
// null means this mode is not applicable for that terrain.
var TRAVEL_MODES = [
  { id: 'walk',  label: 'Walking',       byTerrain: { road: 35,   trail: 20,   rough: 12,   sea: null } },
  { id: 'horse', label: 'Horse',         byTerrain: { road: 65,   trail: 40,   rough: 22,   sea: null } },
  { id: 'car',   label: 'Car',           byTerrain: { road: 700,  trail: 300,  rough: 100,  sea: null } },
  { id: 'train', label: 'Train',         byTerrain: { road: 900,  trail: null, rough: null, sea: null } },
  { id: 'sail',  label: 'Sailing ship',  byTerrain: { road: null, trail: null, rough: null, sea: 220  } },
  { id: 'motor', label: 'Motor ship',    byTerrain: { road: null, trail: null, rough: null, sea: 550  } },
  { id: 'plane', label: 'Plane',         byTerrain: { road: 8000, trail: 8000, rough: 8000, sea: 8000 } }
];

var mapLastTravelKm       = 0;
var mapLastTravelWpts     = 0;
var mapLastTravelSegments = []; // [{km, terrain}] one per leg

var PIN_COLORS = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#1abc9c'];

function defaultMapPage()
{
  return {
    type: 'map',
    width: 1600,
    height: 1200,
    background: { type: 'blank' },
    strokes: [],
    shapes: [],
    texts: [],
    imageData: null,
    kmPerPx: null,
    pins: []
  };
}

function notebookAddMapPage()
{
  if (!nbData) return;

  nbData.pages.push(defaultMapPage());
  renderNotebookPages();
  commitNotebookChange();
  notebookGoToPage(nbData.pages.length - 1);
}

function setMapTool(tool)
{
  var prevTool = nbMapTool;
  nbMapTool = (nbMapTool === tool) ? null : tool;

  if (prevTool === 'travel')
  {
    // Toggled off via travel button = user wants to calculate the accumulated path
    var toggled = (prevTool === tool);
    if (toggled && mapTravelPath.length >= 2 && mapTravelPageIndex !== -1)
      finishTravelCalc(mapTravelPageIndex);
    else
      clearTravelOverlay();

    mapTravelPath = [];
    mapTravelPageIndex = -1;
  }
  else if (nbMapTool !== 'travel')
  {
    clearTravelOverlay();
  }

  if (nbMapTool !== 'scale')
  {
    mapScalePhase = 0;
    mapScaleP1 = null;
    clearScaleOverlay();
  }

  updateMapToolbarState();
  updateMapCursor();

  if (nbMapTool === 'scale')
    showMapHint('Click the first reference point on the map.');
  else if (nbMapTool === 'travel')
    showMapHint('Click to add waypoints. Click the travel button again to calculate.');
  else if (nbMapTool === 'pin')
    showMapHint('Click on the map to place a pin.');
  else
    showMapHint('');
}

function showMapHint(text)
{
  var el = document.getElementById('map-hint');
  if (el) el.textContent = text;
}

function updateMapToolbarState()
{
  document.querySelectorAll('.map-tool-btn').forEach(function(btn)
  {
    btn.classList.toggle('active', btn.dataset.mapTool === nbMapTool);
  });

  var terrainGroup = document.getElementById('map-terrain-group');
  if (terrainGroup)
  {
    terrainGroup.style.display = (nbMapTool === 'travel') ? 'flex' : 'none';
    if (nbMapTool === 'travel')
    {
      var sel = document.getElementById('map-terrain-select');
      onTerrainSelectChange(sel ? sel.value : 'road');
    }
  }

  // Block pin clicks while travel tool is active
  document.querySelectorAll('.nb-pin-layer').forEach(function(pl)
  {
    pl.classList.toggle('travel-active', nbMapTool === 'travel');
  });
}

function updateMapCursor()
{
  var pages = document.getElementById('notebook-pages');
  if (!pages) return;

  pages.className = pages.className.replace(/\btool-map-\S+/g, '').trim();

  if (nbMapTool === 'pin')    pages.classList.add('tool-map-pin');
  if (nbMapTool === 'travel') pages.classList.add('tool-map-travel');
  if (nbMapTool === 'scale')  pages.classList.add('tool-map-scale');
}

function switchNbTab(tab)
{
  var draw = document.getElementById('nb-draw-tools');
  var map  = document.getElementById('nb-map-tools');
  if (draw) draw.style.display = (tab === 'draw') ? 'contents' : 'none';
  if (map)  map.style.display  = (tab === 'map')  ? 'flex'     : 'none';

  var btnDraw = document.getElementById('nb-tab-draw');
  var btnMap  = document.getElementById('nb-tab-map');
  if (btnDraw) btnDraw.classList.toggle('active', tab === 'draw');
  if (btnMap)  btnMap.classList.toggle('active',  tab === 'map');
}

function updateMapToolbarVisibility()
{
  var page = nbData && nbData.pages[nbCurrentPage];
  var isMap = !!(page && page.type === 'map');

  switchNbTab(isMap ? 'map' : 'draw');

  if (!isMap)
  {
    nbMapTool = null;
    mapTravelPath = [];
    mapTravelPageIndex = -1;
    clearTravelOverlay();
    clearScaleOverlay();
    showMapHint('');
  }
  else
  {
    updateMapCursor();
    updateMapToolbarState();
    refreshMapScaleDisplay();
  }
}

function refreshMapScaleDisplay()
{
  var page = nbData && nbData.pages[nbCurrentPage];
  var el = document.getElementById('map-scale-display');
  if (!el || !page) return;

  if (page.kmPerPx)
  {
    var pxPerKm = 1 / page.kmPerPx;
    el.textContent = '1 px = ' + page.kmPerPx.toFixed(3) + ' km';
    el.style.display = '';
  }
  else
  {
    el.textContent = 'Scale not set';
    el.style.display = '';
  }
}

// ── Pin layer ──

function renderMapPinLayer(pageIndex)
{
  var pinLayer = document.querySelector('.notebook-page[data-page-index="' + pageIndex + '"] .nb-pin-layer');
  if (!pinLayer || !nbData) return;

  var page = nbData.pages[pageIndex];
  if (!page || page.type !== 'map') return;

  var pins = page.pins || [];

  pinLayer.innerHTML = pins.map(function(pin)
  {
    var lp = ((pin.x / page.width) * 100).toFixed(4) + '%';
    var tp = ((pin.y / page.height) * 100).toFixed(4) + '%';
    var color = escAttr(pin.color || PIN_COLORS[0]);
    var label = escHtml(pin.label || '');

    var sw = Math.round(18 * nbZoom), sh = Math.round(22 * nbZoom);
    return '<div class="map-pin" style="left:' + lp + ';top:' + tp + ';--pin-color:' + color + '"' +
           ' onclick="openPinPopover(' + pageIndex + ',\'' + escAttr(pin.id) + '\',event)" title="' + label + '">' +
             '<svg width="' + sw + '" height="' + sh + '" viewBox="0 0 24 24" fill="' + color + '" stroke="#0005" stroke-width="0.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>' +
             (label ? '<span class="map-pin-label">' + label + '</span>' : '') +
           '</div>';
  }).join('');
}

// ── Pin popover ──

function openPinPopover(pageIndex, pinId, event)
{
  event.stopPropagation();

  var page = nbData && nbData.pages[pageIndex];
  if (!page) return;

  var pin = (page.pins || []).find(function(p){ return p.id === pinId; });
  if (!pin) return;

  mapActivePinEdit = { pageIndex: pageIndex, pinId: pinId };

  var pop = document.getElementById('pin-popover');
  if (!pop) return;

  document.getElementById('pin-label-input').value = pin.label || '';

  var docSel = document.getElementById('pin-doc-select');
  docSel.innerHTML = '<option value="">— No linked document —</option>' +
    Object.entries(files)
      .filter(function(e){ return e[1].type === 'doc'; })
      .sort(function(a, b){ return a[1].name.localeCompare(b[1].name); })
      .map(function(e){ return '<option value="' + escAttr(e[0]) + '"' + (e[0] === pin.docId ? ' selected' : '') + '>' + escHtml(e[1].name) + '</option>'; })
      .join('');

  var swatches = document.getElementById('pin-color-swatches');
  swatches.innerHTML = PIN_COLORS.map(function(c)
  {
    return '<span class="pin-swatch' + (c === (pin.color || PIN_COLORS[0]) ? ' active' : '') + '"' +
           ' style="background:' + c + '" onclick="selectPinColor(\'' + escAttr(c) + '\',this)"></span>';
  }).join('');

  pop.style.display = '';
  var rect = event.target.closest('.map-pin').getBoundingClientRect();
  pop.style.left = Math.min(rect.right + 8, window.innerWidth - 280) + 'px';
  pop.style.top  = Math.max(rect.top - 10, 10) + 'px';
}

function selectPinColor(color, el)
{
  document.querySelectorAll('#pin-color-swatches .pin-swatch').forEach(function(s){ s.classList.remove('active'); });
  el.classList.add('active');
}

function savePinEdits()
{
  if (!mapActivePinEdit) return;

  var pageIndex = mapActivePinEdit.pageIndex,
      pinId = mapActivePinEdit.pinId,
      page = nbData && nbData.pages[pageIndex];
  if (!page) return;

  var pin = (page.pins || []).find(function(p){ return p.id === pinId; });
  if (!pin) return;

  pin.label = document.getElementById('pin-label-input').value.trim();
  pin.docId = document.getElementById('pin-doc-select').value || null;

  var activeSwatchEl = document.querySelector('#pin-color-swatches .pin-swatch.active');
  if (activeSwatchEl)
    pin.color = activeSwatchEl.style.background;

  closePinPopover();
  renderMapPinLayer(pageIndex);
  commitNotebookChange();
}

function closePinPopover()
{
  var pop = document.getElementById('pin-popover');
  if (pop) pop.style.display = 'none';
  mapActivePinEdit = null;
}

function openPinDoc()
{
  if (!mapActivePinEdit) return;

  var pageIndex = mapActivePinEdit.pageIndex,
      pinId = mapActivePinEdit.pinId,
      page = nbData && nbData.pages[pageIndex];
  if (!page) return;

  var pin = (page.pins || []).find(function(p){ return p.id === pinId; });
  if (!pin || !pin.docId) { alert('No document linked to this pin.'); return; }

  closePinPopover();
  switchAppType('doc');
  openFile(pin.docId);
}

function deleteCurrentPin()
{
  if (!mapActivePinEdit) return;

  var pageIndex = mapActivePinEdit.pageIndex,
      pinId = mapActivePinEdit.pinId,
      page = nbData && nbData.pages[pageIndex];
  if (!page) return;

  page.pins = (page.pins || []).filter(function(p){ return p.id !== pinId; });

  closePinPopover();
  renderMapPinLayer(pageIndex);
  commitNotebookChange();
}

function addMapPin(pageIndex, x, y)
{
  var page = nbData && nbData.pages[pageIndex];
  if (!page) return;

  var pin = {
    id: 'pin_' + Date.now(),
    x: x,
    y: y,
    label: '',
    docId: null,
    color: PIN_COLORS[0]
  };

  if (!page.pins) page.pins = [];
  page.pins.push(pin);
  renderMapPinLayer(pageIndex);
  commitNotebookChange();

  // Open popover for immediate naming
  var pinEl = document.querySelector(
    '.notebook-page[data-page-index="' + pageIndex + '"] .map-pin:last-child'
  );
  if (pinEl)
  {
    // Fake a click event on the pin element
    var fakeEvent = { stopPropagation: function(){}, target: pinEl };
    openPinPopover(pageIndex, pin.id, fakeEvent);
  }
}

// ── Scale tool ──

function clearScaleOverlay()
{
  document.querySelectorAll('.nb-scale-canvas').forEach(function(c)
  {
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  });
}

function handleScaleClick(pageIndex, x, y, clientX, clientY)
{
  if (mapScalePhase === 0)
  {
    mapScalePhase = 1;
    mapScaleP1 = { x: x, y: y };
    mapScalePageIndex = pageIndex;
    showMapHint('Click the second reference point.');
    drawScalePoint(pageIndex, x, y, null, null);
  }
  else if (mapScalePhase === 1 && mapScalePageIndex === pageIndex)
  {
    var dx = x - mapScaleP1.x,
        dy = y - mapScaleP1.y,
        px = Math.sqrt(dx * dx + dy * dy);

    mapScalePhase = 0;
    clearScaleOverlay();

    if (px < 5) { showMapHint('Points too close — try again.'); return; }

    var km = parseFloat(prompt('Distance between the two points in km:'));
    if (!km || km <= 0) { showMapHint(''); return; }

    var page = nbData.pages[pageIndex];
    page.kmPerPx = km / px;

    commitNotebookChange();
    refreshMapScaleDisplay();
    showMapHint('Scale set: ' + page.kmPerPx.toFixed(4) + ' km/px.');
    nbMapTool = null;
    updateMapToolbarState();
    updateMapCursor();
  }
}

function drawScalePoint(pageIndex, x, y, x2, y2)
{
  var canvas = document.querySelector('.notebook-page[data-page-index="' + pageIndex + '"] .nb-scale-canvas');
  if (!canvas || !nbData) return;

  var page = nbData.pages[pageIndex];
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  var sx = canvas.width  / page.width;
  var sy = canvas.height / page.height;

  ctx.strokeStyle = '#3498db';
  ctx.fillStyle   = '#3498db';
  ctx.lineWidth   = 2;

  ctx.beginPath();
  ctx.arc(x * sx, y * sy, 6, 0, Math.PI * 2);
  ctx.fill();

  if (x2 !== null)
  {
    ctx.beginPath();
    ctx.arc(x2 * sx, y2 * sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x * sx, y * sy);
    ctx.lineTo(x2 * sx, y2 * sy);
    ctx.stroke();
  }
}

// ── Travel tool ──

function clearTravelOverlay()
{
  document.querySelectorAll('.nb-travel-canvas').forEach(function(c)
  {
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  });
  mapLastTravelKm = 0; mapLastTravelWpts = 0; mapLastTravelSegments = [];
  closeTravelPopover();
  var el = document.getElementById('map-travel-result');
  if (el) el.textContent = '';
}

function addTravelWaypoint(pageIndex, x, y)
{
  if (mapTravelPageIndex === -1) mapTravelPageIndex = pageIndex;
  if (mapTravelPageIndex !== pageIndex) return;

  var terrain = (document.getElementById('map-terrain-select') || {}).value || 'road';
  mapTravelPath.push({ x: x, y: y, terrain: terrain });
  renderTravelPath(pageIndex);

  var n = mapTravelPath.length;
  var tLabel = (MAP_TERRAIN.find(function(t){ return t.id === terrain; }) || {}).label || terrain;
  showMapHint(n + ' waypoint' + (n === 1 ? '' : 's') + ' · next leg: ' + tLabel + ' — change terrain or keep clicking.');
}

function formatDays(days)
{
  if (days < 1 / 24) return '< 1 hr';
  if (days < 1)
  {
    var hrs = Math.round(days * 24);
    return '~' + hrs + ' hr' + (hrs === 1 ? '' : 's');
  }
  var d = Math.floor(days);
  var h = Math.round((days - d) * 24);
  if (h === 0 || d >= 14) return '~' + d + (d === 1 ? ' day' : ' days');
  return '~' + d + 'd ' + h + 'h';
}

function formatTravelTime(km, kmPerDay)
{
  return formatDays(km / kmPerDay);
}

function finishTravelCalc(pageIndex)
{
  var page = nbData && nbData.pages[pageIndex];
  if (!page) return;

  if (mapTravelPath.length < 2)
  {
    showMapHint('Add at least 2 waypoints before calculating.');
    return;
  }

  if (!page.kmPerPx)
  {
    showMapHint('Scale not set — use the scale tool first.');
    clearTravelOverlay();
    return;
  }

  mapLastTravelSegments = [];
  var totalKm = 0;
  for (var i = 1; i < mapTravelPath.length; i++)
  {
    var dx = mapTravelPath[i].x - mapTravelPath[i-1].x,
        dy = mapTravelPath[i].y - mapTravelPath[i-1].y;
    var segKm = Math.sqrt(dx*dx + dy*dy) * page.kmPerPx;
    // terrain of a segment is the terrain recorded at the FROM waypoint
    mapLastTravelSegments.push({ km: segKm, terrain: mapTravelPath[i-1].terrain || 'road' });
    totalKm += segKm;
  }

  mapLastTravelKm   = totalKm;
  mapLastTravelWpts = mapTravelPath.length;

  var el = document.getElementById('map-travel-result');
  if (el) el.textContent = mapLastTravelWpts + ' pts · ' + mapLastTravelKm.toFixed(1) + ' km';

  renderTravelPath(pageIndex);
  showMapHint('Click the result chip for travel times.');
}

function openTravelPopover(e)
{
  if (e) e.stopPropagation();
  if (!mapLastTravelKm) return;

  var pop = document.getElementById('travel-popover');
  var header = document.getElementById('travel-pop-header');
  var modesEl = document.getElementById('travel-pop-modes');
  if (!pop || !header || !modesEl) return;

  header.textContent = mapLastTravelKm.toFixed(1) + ' km · ' + mapLastTravelWpts + ' waypoints';

  // Build a summary of which terrains appear in the route
  var terrainSeen = {};
  mapLastTravelSegments.forEach(function(s){ terrainSeen[s.terrain] = true; });

  modesEl.innerHTML = TRAVEL_MODES.map(function(mode)
  {
    // Sum days per segment using each segment's own terrain speed
    var totalDays = 0;
    var hasImpassable = false;
    mapLastTravelSegments.forEach(function(seg)
    {
      var speed = mode.byTerrain[seg.terrain];
      if (!speed) { hasImpassable = true; }
      else { totalDays += seg.km / speed; }
    });

    var na = hasImpassable && totalDays === 0;  // every segment impassable
    var partial = hasImpassable && totalDays > 0; // some segments impassable

    var timeStr, speedStr;
    if (na)
    {
      timeStr  = '—';
      speedStr = 'route has impassable terrain';
    }
    else if (partial)
    {
      timeStr  = formatDays(totalDays) + '*';
      speedStr = '* partial — some terrain N/A';
    }
    else
    {
      // All segments passable: show min–max speed range if mixed terrain
      var speeds = Object.keys(terrainSeen).map(function(id){ return mode.byTerrain[id]; }).filter(Boolean);
      var minSpd = Math.min.apply(null, speeds), maxSpd = Math.max.apply(null, speeds);
      speedStr = minSpd === maxSpd ? minSpd + ' km/day' : minSpd + '–' + maxSpd + ' km/day';
      timeStr  = formatDays(totalDays);
    }

    return '<div class="travel-mode-row' + (na ? ' travel-mode-na' : '') + '">' +
      '<span class="travel-mode-name">' + mode.label + '</span>' +
      '<span class="travel-mode-dur">' + timeStr + '</span>' +
      '<span class="travel-mode-rate">' + speedStr + '</span>' +
    '</div>';
  }).join('');

  var chip = document.getElementById('map-travel-result');
  if (chip)
  {
    var rect = chip.getBoundingClientRect();
    pop.style.left = rect.left + 'px';
    pop.style.top  = (rect.bottom + 6) + 'px';
  }
  pop.style.display = 'block';
}

function closeTravelPopover()
{
  var pop = document.getElementById('travel-popover');
  if (pop) pop.style.display = 'none';
}

function renderTravelPath(pageIndex)
{
  var canvas = document.querySelector('.notebook-page[data-page-index="' + pageIndex + '"] .nb-travel-canvas');
  if (!canvas || !nbData) return;

  var page = nbData.pages[pageIndex];
  var ctx = canvas.getContext('2d');

  // Scale from page units (0..page.width/height) to canvas buffer pixels.
  // canvas.width was created as page.width * notebookCanvasScale(), so the
  // ratio is simply notebookCanvasScale().  Recalculate each render to stay
  // correct if the canvas was recreated after an image upload.
  var sx = canvas.width  / page.width;
  var sy = canvas.height / page.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (mapTravelPath.length < 1) return;

  ctx.save();
  ctx.lineWidth = 3;
  ctx.lineCap   = 'round';
  ctx.setLineDash([Math.round(8 * sx), Math.round(4 * sx)]);

  // Draw each segment in its terrain colour
  for (var i = 1; i < mapTravelPath.length; i++)
  {
    var color = terrainColor(mapTravelPath[i-1].terrain || 'road');
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(mapTravelPath[i-1].x * sx, mapTravelPath[i-1].y * sy);
    ctx.lineTo(mapTravelPath[i].x   * sx, mapTravelPath[i].y   * sy);
    ctx.stroke();
  }

  // Draw waypoint dots in their terrain colour
  ctx.setLineDash([]);
  mapTravelPath.forEach(function(pt)
  {
    ctx.fillStyle = terrainColor(pt.terrain || 'road');
    ctx.beginPath();
    ctx.arc(pt.x * sx, pt.y * sy, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

// ── Map image upload ──

function triggerMapImageUpload()
{
  var inp = document.getElementById('map-image-input');
  if (inp) inp.click();
}

function handleMapImageUpload(event)
{
  var file = event.target.files[0];
  if (!file) return;

  event.target.value = '';

  var reader = new FileReader();

  reader.onload = function(e)
  {
    var img = new Image();

    img.onload = function()
    {
      var maxW = 1920, maxH = 1440;
      var scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      var dw = Math.round(img.naturalWidth * scale);
      var dh = Math.round(img.naturalHeight * scale);

      var tmp = document.createElement('canvas');
      tmp.width = dw;
      tmp.height = dh;
      tmp.getContext('2d').drawImage(img, 0, 0, dw, dh);

      var page = nbData.pages[nbCurrentPage];
      page.imageData = tmp.toDataURL('image/jpeg', 0.85);
      page.width = dw;
      page.height = dh;

      commitNotebookChange();
      renderNotebookPages();
      notebookGoToPage(nbCurrentPage);
    };

    img.src = e.target.result;
  };

  reader.readAsDataURL(file);
}

// ── Map pointer dispatching ──

// Converts a pointer event to page-space coordinates using the PAGE ELEMENT's
// bounding rect directly — the same reference as pin % positions — rather than
// the ink-canvas buffer dimensions, which can diverge due to CSS inset vs
// width/height differences or max-width constraints.
function mapPagePoint(e, pageIndex)
{
  var pageEl = document.querySelector('.notebook-page[data-page-index="' + pageIndex + '"]');
  if (!pageEl || !nbData) return { x: 0, y: 0 };
  var rect = pageEl.getBoundingClientRect();
  var page = nbData.pages[pageIndex];
  return {
    x: Math.max(0, Math.min(page.width,  (e.clientX - rect.left) / rect.width  * page.width)),
    y: Math.max(0, Math.min(page.height, (e.clientY - rect.top)  / rect.height * page.height))
  };
}

function findNearestPin(page, pt, hitRadius)
{
  hitRadius = hitRadius || 20;
  var best = null, bestD = Infinity;

  (page.pins || []).forEach(function(pin)
  {
    var d = Math.hypot(pin.x - pt.x, pin.y - pt.y);
    if (d < hitRadius && d < bestD) { best = pin; bestD = d; }
  });

  return best;
}

function handleMapPointerDown(e, _pt, canvas, pageIndex)
{
  // Use page-element coordinates for all map operations so they align with
  // pin % positions regardless of canvas buffer size or CSS constraints.
  var pt = mapPagePoint(e, pageIndex);
  var page = nbData.pages[pageIndex];

  if (nbMapTool === 'pin')
  {
    var hit = findNearestPin(page, pt, 16);
    if (hit)
    {
      var fakeEvent = { stopPropagation: function(){}, target: canvas };
      openPinPopover(pageIndex, hit.id, fakeEvent);
    }
    else
    {
      addMapPin(pageIndex, pt.x, pt.y);
    }
    return;
  }

  if (nbMapTool === 'scale')
  {
    handleScaleClick(pageIndex, pt.x, pt.y, e.clientX, e.clientY);
    return;
  }

  if (nbMapTool === 'travel')
  {
    if (e.button === 0)
      addTravelWaypoint(pageIndex, pt.x, pt.y);
    return;
  }

  // No map tool active — check if clicking a pin
  var hit = findNearestPin(page, pt, 20);
  if (hit)
  {
    var pinEl = document.querySelector(
      '.notebook-page[data-page-index="' + pageIndex + '"] .map-pin[title="' + (hit.label || '') + '"]'
    );
    var fakeEvt = {
      stopPropagation: function(){},
      target: pinEl || canvas
    };
    openPinPopover(pageIndex, hit.id, fakeEvt);
    return;
  }

  // Fall through to normal notebook tools
  return false;
}

function handleMapContextMenu(e, canvas, pageIndex)
{
  // Suppress browser context menu while any map tool is active
  if (nbMapTool) e.preventDefault();
}

// ── Pointer handling per page ──

function wireNotebookPointerEvents(canvas, pageIndex)
{
  canvas.addEventListener('pointerdown', function(e){ notebookPointerDown(e, canvas, pageIndex); });
  canvas.addEventListener('pointermove', function(e){ notebookPointerMove(e, canvas, pageIndex); });
  canvas.addEventListener('pointerup', function(e){ notebookPointerUp(e, canvas, pageIndex); });
  canvas.addEventListener('pointercancel', function(e){ notebookPointerUp(e, canvas, pageIndex); });
  canvas.addEventListener('contextmenu', function(e){ handleMapContextMenu(e, canvas, pageIndex); });
}

function notebookCanvasPoint(e, canvas)
{
  // canvas.width/height are the raw (oversampled) buffer size, but
  // drawing/storage all happens in logical page units - dividing the canvas
  // scale back out here first recovers the logical size, so what's left is
  // purely the CSS-responsive-shrink factor (the page can be narrower than
  // its logical width on a smaller window).
  const rect = canvas.getBoundingClientRect(),
        canvasScale = notebookCanvasScale(),
        scaleX = (canvas.width / canvasScale) / rect.width,
        scaleY = (canvas.height / canvasScale) / rect.height;

  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
    pressure: e.pressure,
    pointerType: e.pointerType
  };
}

function notebookEffectiveWidth(pt)
{
  if (pt.pointerType !== 'pen')
    return nbWidth;

  // A bare `pressure > 0` gate means a single stray zero-pressure sample (not
  // uncommon between driver samples) snaps the line straight to its thinnest
  // width for that point instead of holding steady - falling back to the
  // spec's neutral 0.5 avoids that visible pinch. The range here is wide
  // (0.3x-1.7x) since the previous 0.5x-1.5x spread was barely perceptible
  // once strokes were actually crisp.
  const pressure = (typeof pt.pressure === 'number' && pt.pressure > 0) ? pt.pressure : 0.5;

  return nbWidth * (0.3 + pressure * 1.4);
}

function notebookEraseAt(pt, active)
{
  const page = nbData.pages[active.pageIndex],
        r = active.radius,
        newStrokes = [];

  page.strokes.forEach(function(stroke)
  {
    // Filled strokes (SVG import fills) erase as whole objects: splitting a
    // fill outline into open fragments has no meaningful rendering.
    if (stroke.fill)
    {
      const hit = stroke.points.some(function(p){ return Math.hypot(p.x - pt.x, p.y - pt.y) <= r; });

      if (!hit)
        newStrokes.push(stroke);

      return;
    }

    const segments = [[]];

    stroke.points.forEach(function(p)
    {
      if (Math.hypot(p.x - pt.x, p.y - pt.y) <= r)
      {
        if (segments[segments.length - 1].length)
          segments.push([]);
      }
      else
      {
        segments[segments.length - 1].push(p);
      }
    });

    segments.forEach(function(seg)
    {
      if (seg.length > 1)
        newStrokes.push({ tool: stroke.tool, color: stroke.color, baseWidth: stroke.baseWidth, points: seg });
    });
  });

  page.strokes = newStrokes;
}

function notebookPointerDown(e, canvas, pageIndex)
{
  if (!nbData)
    return;

  canvas.setPointerCapture(e.pointerId);

  const pt = notebookCanvasPoint(e, canvas);
  nbCurrentPage = pageIndex;

  // A pending vector import captures all pointer input on its page: dragging
  // repositions it, the bottom-right handle resizes it, and normal tools stay
  // disabled until the import is accepted or cancelled.
  if (nbImport)
  {
    if (pageIndex !== nbImport.pageIndex)
      return;

    const hx = nbImport.x + nbImport.w * nbImport.scale + 6,
          hy = nbImport.y + nbImport.h * nbImport.scale + 6;

    if (Math.abs(pt.x - hx) <= 12 && Math.abs(pt.y - hy) <= 12)
      nbActive = { kind: 'import-scale', pageIndex: pageIndex };
    else
      nbActive = { kind: 'import-move', pageIndex: pageIndex, start: pt };

    return;
  }

  // Map pages: route to map tool handler first; fall through to drawing tools if not consumed.
  const _mapPage = nbData.pages[pageIndex];
  if (_mapPage && _mapPage.type === 'map')
  {
    const _consumed = handleMapPointerDown(e, pt, canvas, pageIndex);
    if (_consumed !== false)
      return;
  }

  if (nbTool === 'pen' || nbTool === 'highlighter')
  {
    notebookSnapshotForUndo(pageIndex);

    const stroke = { tool: nbTool, color: nbColor, baseWidth: nbWidth, points: [{ x: pt.x, y: pt.y, w: notebookEffectiveWidth(pt) }] };

    nbData.pages[pageIndex].strokes.push(stroke);
    // smoothX/Y track a filtered position (see notebookPointerMove) - seeded
    // from the real first point since there's nothing yet to smooth against.
    nbActive = { kind: 'stroke', pageIndex: pageIndex, stroke: stroke, smoothX: pt.x, smoothY: pt.y };
    redrawNotebookPage(pageIndex);
  }
  else if (nbTool === 'eraser')
  {
    notebookSnapshotForUndo(pageIndex);
    nbActive = { kind: 'erase', pageIndex: pageIndex, radius: Math.max(8, nbWidth * 3) };
    notebookEraseAt(pt, nbActive);
    redrawNotebookPage(pageIndex);
  }
  else if (nbTool === 'line' || nbTool === 'rectangle' || nbTool === 'ellipse')
  {
    notebookSnapshotForUndo(pageIndex);

    const shape = { tool: nbTool, color: nbColor, width: nbWidth, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };

    nbData.pages[pageIndex].shapes.push(shape);
    nbActive = { kind: 'shape', pageIndex: pageIndex, shape: shape };
    redrawNotebookPage(pageIndex);
  }
  else if (nbTool === 'select')
  {
    const page = nbData.pages[pageIndex],
          hit = notebookHitTest(page, pt),
          alreadySelected = hit && nbSelection.some(function(s){ return s.kind === hit.kind && s.index === hit.index; });

    if (hit && !alreadySelected)
      nbSelection = [hit];

    if (hit)
    {
      nbActive = { kind: 'move', pageIndex: pageIndex, start: pt, snapshotted: false };
    }
    else
    {
      nbSelection = [];
      nbActive = { kind: 'marquee', pageIndex: pageIndex, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    }

    redrawNotebookPage(pageIndex);
  }
  else if (nbTool === 'text')
  {
    notebookCreateTextBoxAt(pageIndex, pt.x, pt.y);
    nbActive = null;
  }
}

function notebookPointerMove(e, canvas, pageIndex)
{
  if (!nbActive || nbActive.pageIndex !== pageIndex)
    return;

  const pt = notebookCanvasPoint(e, canvas);

  if (nbActive.kind === 'stroke')
  {
    // Stylus samples carry real jitter that the quadratic-curve rendering
    // alone doesn't hide - it smooths the path *between* recorded points, but
    // can't fix noisy points. An exponential moving average on the position
    // (a simple, cheap "stroke stabilizer") filters that jitter out before the
    // point is even stored, which is what was making strokes look shaky/faceted
    // rather than like handwriting. 0.4 trades a little responsiveness for a
    // visibly steadier line; raw pressure is kept as-is for width.
    const SMOOTHING = 0.4;

    nbActive.smoothX += (pt.x - nbActive.smoothX) * SMOOTHING;
    nbActive.smoothY += (pt.y - nbActive.smoothY) * SMOOTHING;

    nbActive.stroke.points.push({ x: nbActive.smoothX, y: nbActive.smoothY, w: notebookEffectiveWidth(pt) });
    redrawNotebookPage(pageIndex);
  }
  else if (nbActive.kind === 'erase')
  {
    notebookEraseAt(pt, nbActive);
    redrawNotebookPage(pageIndex);
  }
  else if (nbActive.kind === 'shape')
  {
    nbActive.shape.x2 = pt.x;
    nbActive.shape.y2 = pt.y;
    redrawNotebookPage(pageIndex);
  }
  else if (nbActive.kind === 'marquee')
  {
    nbActive.x2 = pt.x;
    nbActive.y2 = pt.y;
    nbSelection = notebookItemsInRect(nbData.pages[pageIndex], nbActive);
    redrawNotebookPage(pageIndex);
  }
  else if (nbActive.kind === 'import-move')
  {
    nbImport.x += pt.x - nbActive.start.x;
    nbImport.y += pt.y - nbActive.start.y;
    nbActive.start = pt;
    redrawNotebookPage(pageIndex);
  }
  else if (nbActive.kind === 'import-scale')
  {
    // Scale so the corner handle tracks the pointer, anchored at the top-left.
    const s = Math.max((pt.x - nbImport.x) / nbImport.w, (pt.y - nbImport.y) / nbImport.h);

    nbImport.scale = Math.max(0.05, Math.min(20, s));
    redrawNotebookPage(pageIndex);
  }
  else if (nbActive.kind === 'move')
  {
    if (!nbActive.snapshotted)
    {
      notebookSnapshotForUndo(pageIndex);
      nbActive.snapshotted = true;
    }

    const dx = pt.x - nbActive.start.x,
          dy = pt.y - nbActive.start.y;

    nbActive.start = pt;
    notebookMoveSelection(nbData.pages[pageIndex], dx, dy);
    renderNotebookTextLayerForPage(pageIndex);
    redrawNotebookPage(pageIndex);
  }
}

function notebookPointerUp(e, canvas, pageIndex)
{
  if (!nbActive)
    return;

  const kind = nbActive.kind;

  // The smoothing filter in notebookPointerMove always trails slightly behind
  // the real pointer position: snap to the exact lift-off point so the stroke
  // visibly reaches all the way to where the pen actually left the surface.
  if (kind === 'stroke')
  {
    const pt = notebookCanvasPoint(e, canvas);
    nbActive.stroke.points.push({ x: pt.x, y: pt.y, w: notebookEffectiveWidth(pt) });
  }

  nbActive = null;

  if (kind === 'stroke' || kind === 'erase' || kind === 'shape' || kind === 'move')
  {
    rebuildNotebookCommittedCache(pageIndex);
    commitNotebookChange();
  }

  redrawNotebookPage(pageIndex);
}
