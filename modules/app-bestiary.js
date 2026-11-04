// Bestiary
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── BESTIARY ──

var bstData  = null;
var bstQuery = '';
var bstFilter = { type: '', tag: '', world: '' };

var cBstDangerLabels = ['Harmless', 'Low', 'Moderate', 'High', 'Deadly'];
var cBstDangerColors = ['#2ecc71', '#a3c94a', '#f1c40f', '#e67e22', '#e74c3c'];

function fLoadBestiaryFile(file)
{
  try { bstData = JSON.parse(file.content || '{}'); }
  catch(e) { bstData = {}; }
  if (!bstData.beasts) bstData.beasts = [];
  document.getElementById('bestiary-title-input').value = file.name || bstData.name || '';
  var ft = document.getElementById('bst-file-tags');
  if (ft) ft.value = (bstData.tags || []).join(', ');
  bstQuery  = '';
  bstFilter = { type: '', tag: '', world: '' };
  document.getElementById('bst-search').value = '';
  fRenderBestiary();
}

function fSaveBestiaryData()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'bestiary') return;
  bstData.name = document.getElementById('bestiary-title-input').value.trim() || bstData.name || 'Bestiary';
  var ft = document.getElementById('bst-file-tags');
  if (ft) bstData.tags = fParseTagsInput(ft.value);
  files[currentFileId].name     = bstData.name;
  files[currentFileId].content  = JSON.stringify(bstData, null, 2);
  files[currentFileId].fileTags = bstData.tags || [];
  files[currentFileId].modified = Date.now();
  fScheduleSave();
  fRenderFileList();
}

function fOnBestiaryTitleChange() { fSaveBestiaryData(); }
function fOnBestiaryFileTagsChange() { fSaveBestiaryData(); }

function fOnBestiarySearch(q) { bstQuery = q; fRenderBestiary(); }
function fOnBstFilterType(v)  { bstFilter.type  = v; fRenderBestiary(); }
function fOnBstFilterWorld(v) { bstFilter.world = v; fRenderBestiary(); }
function fOnBstFilterTag(v)   { bstFilter.tag   = v; fRenderBestiary(); }
function fBstFilterByTag(t)   { bstFilter.tag   = t; fRenderBestiary(); }
function fBstFilterByWorld(w) { bstFilter.world = w; fRenderBestiary(); }

function fBstDangerBadge(level)
{
  var idx = Math.min(Math.max((level|0) - 1, 0), 4);
  var color = cBstDangerColors[idx];
  return '<span class="bst-danger" style="background:' + color + '22;color:' + color + ';border-color:' + color + '55" title="Danger: ' + cBstDangerLabels[idx] + '">' +
    '&#9679;'.repeat(idx + 1) + '<span class="bst-danger-label">' + cBstDangerLabels[idx] + '</span></span>';
}

function fRenderBestiary()
{
  var q   = bstQuery.toLowerCase();
  var all = bstData.beasts || [];
  bstFilter.type  = fFillFacetSelect('bst-filter-type', all.map(function(b){ return b.category; }), bstFilter.type, 'All categories');
  bstFilter.world = fFillFacetSelect('bst-filter-world', all.map(function(b){ return b.world; }), bstFilter.world, 'All worlds');
  bstFilter.tag   = fFillFacetSelect('bst-filter-tag', fCollectItemTags(all), bstFilter.tag, 'All tags');

  var beasts = all
    .filter(function(b){ return fItemMatchesFacets(b, bstFilter.type, 'category', bstFilter.tag); })
    .filter(function(b){ return !bstFilter.world || (b.world||'') === bstFilter.world; })
    .filter(function(b){
      return !q || (b.name||'').toLowerCase().includes(q) ||
             (b.commonName||'').toLowerCase().includes(q) ||
             (b.category||'').toLowerCase().includes(q) ||
             (b.habitat||'').toLowerCase().includes(q) ||
             (b.world||'').toLowerCase().includes(q) ||
             (b.description||'').toLowerCase().includes(q) ||
             (b.tags||[]).some(function(t){ return t.toLowerCase().includes(q); }) ||
             (b.abilities||[]).some(function(a){ return a.toLowerCase().includes(q); });
    })
    .sort(function(a, b){ return (a.commonName||a.name||'').localeCompare(b.commonName||b.name||''); });

  document.getElementById('bst-empty').style.display = beasts.length ? 'none' : '';

  // Group by category so related creatures sit together.
  var groups = {};
  beasts.forEach(function(b){
    var cat = (b.category||'').trim() || 'Uncategorised';
    (groups[cat] = groups[cat] || []).push(b);
  });

  document.getElementById('bst-body').innerHTML = Object.keys(groups).sort().map(function(cat){
    var cc = fGlsLangColor(cat);
    return '<div class="gls-letter-group">' +
      '<div class="gls-letter-divider" style="color:' + cc + '">' + fEscHtml(cat) + '</div>' +
      groups[cat].map(function(b){
        var abilities = (b.abilities||[]).map(function(a){ return '<span class="gls-tag">' + fEscHtml(a) + '</span>'; }).join('');
        return '<div class="bst-card" onclick="fOpenBeastModal(\'' + fEscAttr(b.id) + '\')">' +
          '<div class="bst-card-head">' +
            '<div class="bst-name">' + fEscHtml(b.commonName || b.name || '') +
              (b.commonName && b.name ? ' <span class="bst-sci-name">' + fEscHtml(b.name) + '</span>' : '') +
            '</div>' +
            fBstDangerBadge(b.danger || 1) +
            (b.habitat ? '<span class="bst-habitat" title="Habitat">' + fEscHtml(b.habitat) + '</span>' : '') +
            (b.world ? '<span class="bst-world" title="World / Region" onclick="event.stopPropagation();fBstFilterByWorld(\'' + fEscAttr(b.world) + '\')">' + fEscHtml(b.world) + '</span>' : '') +
          '</div>' +
          (b.description ? '<div class="bst-desc">' + fEscHtml(b.description) + '</div>' : '') +
          (abilities ? '<div class="bst-abilities">' + abilities + '</div>' : '') +
          fTagChipsHtml(b.tags, 'fBstFilterByTag') +
          '<button class="gls-card-del" onclick="fDeleteBeast(event,\'' + fEscAttr(b.id) + '\')">×</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');
}

function fOpenBeastModal(id)
{
  var b = id ? (bstData.beasts||[]).find(function(x){ return x.id === id; }) : null;
  if (b) fNoteItemAnchor('beast', b.id, b.commonName || b.name);
  var danger = (b||{}).danger || 1;
  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Common name<input class="modal-input" id="bef-common" value="' + fEscAttr((b||{}).commonName||'') + '" placeholder="Everyday name…"></label>' +
      '<label class="field-label">Scientific name<input class="modal-input" id="bef-name" value="' + fEscAttr((b||{}).name||'') + '" placeholder="Formal / scholarly name…"></label>' +
    '</div>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Category<input class="modal-input" id="bef-cat" value="' + fEscAttr((b||{}).category||'') + '" placeholder="e.g. Dragon, Undead, Fey…"></label>' +
      '<label class="field-label">Danger level<select class="modal-input tb-select" id="bef-danger">' +
        cBstDangerLabels.map(function(lbl, i){
          return '<option value="' + (i + 1) + '"' + (danger === i + 1 ? ' selected' : '') + '>' + (i + 1) + ' — ' + lbl + '</option>';
        }).join('') +
      '</select></label>' +
    '</div>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Habitat<input class="modal-input" id="bef-habitat" value="' + fEscAttr((b||{}).habitat||'') + '" placeholder="Where it lives…"></label>' +
      '<label class="field-label">World / Region<input class="modal-input" id="bef-world" value="' + fEscAttr((b||{}).world||'') + '" placeholder="e.g. Faerûn, Northern Wastes…"></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Description<textarea class="modal-input" id="bef-desc" rows="4" placeholder="Appearance, behaviour, lore…">' + fEscHtml((b||{}).description||'') + '</textarea></label>' +
    '<label class="field-label" style="margin-top:8px">Abilities <span style="color:var(--text3);font-weight:400">(comma separated)</span><input class="modal-input" id="bef-abilities" value="' + fEscAttr(((b||{}).abilities||[]).join(', ')) + '" placeholder="e.g. Fire breath, Flight…"></label>' +
    fTagsField('bef-tags', (b||{}).tags);

  fOpenDataModal(id ? 'Edit beast' : 'Add beast', f, function()
  {
    var beast = {
      id:          id || fGenId(),
      name:        document.getElementById('bef-name').value.trim(),
      commonName:  document.getElementById('bef-common').value.trim(),
      category:    document.getElementById('bef-cat').value.trim(),
      danger:      parseInt(document.getElementById('bef-danger').value, 10) || 1,
      habitat:     document.getElementById('bef-habitat').value.trim(),
      world:       document.getElementById('bef-world').value.trim(),
      description: document.getElementById('bef-desc').value.trim(),
      abilities:   document.getElementById('bef-abilities').value.split(',').map(function(t){ return t.trim(); }).filter(Boolean),
      tags:        fParseTagsInput(document.getElementById('bef-tags').value)
    };
    if (!beast.name && !beast.commonName) return;
    if (id)
      bstData.beasts = bstData.beasts.map(function(x){ return x.id === id ? beast : x; });
    else
      bstData.beasts.push(beast);
    fCloseDataModal();
    fSaveBestiaryData();
    fRenderBestiary();
  });
}

function fDeleteBeast(e, id)
{
  e.stopPropagation();
  bstData.beasts = (bstData.beasts||[]).filter(function(x){ return x.id !== id; });
  fSaveBestiaryData(); fRenderBestiary();
}
