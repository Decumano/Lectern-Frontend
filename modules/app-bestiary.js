// Bestiary
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── BESTIARY ──

var bstData  = null;
var bstQuery = '';
var bstFilter = { type: '', tag: '', world: '' };

var BST_DANGER_LABELS = ['Harmless', 'Low', 'Moderate', 'High', 'Deadly'];
var BST_DANGER_COLORS = ['#2ecc71', '#a3c94a', '#f1c40f', '#e67e22', '#e74c3c'];

function loadBestiaryFile(file)
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
  renderBestiary();
}

function saveBestiaryData()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'bestiary') return;
  bstData.name = document.getElementById('bestiary-title-input').value.trim() || bstData.name || 'Bestiary';
  var ft = document.getElementById('bst-file-tags');
  if (ft) bstData.tags = parseTagsInput(ft.value);
  files[currentFileId].name     = bstData.name;
  files[currentFileId].content  = JSON.stringify(bstData, null, 2);
  files[currentFileId].fileTags = bstData.tags || [];
  files[currentFileId].modified = Date.now();
  scheduleSave();
  renderFileList();
}

function onBestiaryTitleChange() { saveBestiaryData(); }
function onBestiaryFileTagsChange() { saveBestiaryData(); }

function onBestiarySearch(q) { bstQuery = q; renderBestiary(); }
function onBstFilterType(v)  { bstFilter.type  = v; renderBestiary(); }
function onBstFilterWorld(v) { bstFilter.world = v; renderBestiary(); }
function onBstFilterTag(v)   { bstFilter.tag   = v; renderBestiary(); }
function bstFilterByTag(t)   { bstFilter.tag   = t; renderBestiary(); }
function bstFilterByWorld(w) { bstFilter.world = w; renderBestiary(); }

function bstDangerBadge(level)
{
  var idx = Math.min(Math.max((level|0) - 1, 0), 4);
  var color = BST_DANGER_COLORS[idx];
  return '<span class="bst-danger" style="background:' + color + '22;color:' + color + ';border-color:' + color + '55" title="Danger: ' + BST_DANGER_LABELS[idx] + '">' +
    '&#9679;'.repeat(idx + 1) + '<span class="bst-danger-label">' + BST_DANGER_LABELS[idx] + '</span></span>';
}

function renderBestiary()
{
  var q   = bstQuery.toLowerCase();
  var all = bstData.beasts || [];
  bstFilter.type  = fillFacetSelect('bst-filter-type', all.map(function(b){ return b.category; }), bstFilter.type, 'All categories');
  bstFilter.world = fillFacetSelect('bst-filter-world', all.map(function(b){ return b.world; }), bstFilter.world, 'All worlds');
  bstFilter.tag   = fillFacetSelect('bst-filter-tag', collectItemTags(all), bstFilter.tag, 'All tags');

  var beasts = all
    .filter(function(b){ return itemMatchesFacets(b, bstFilter.type, 'category', bstFilter.tag); })
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
    var cc = glsLangColor(cat);
    return '<div class="gls-letter-group">' +
      '<div class="gls-letter-divider" style="color:' + cc + '">' + escHtml(cat) + '</div>' +
      groups[cat].map(function(b){
        var abilities = (b.abilities||[]).map(function(a){ return '<span class="gls-tag">' + escHtml(a) + '</span>'; }).join('');
        return '<div class="bst-card" onclick="openBeastModal(\'' + escAttr(b.id) + '\')">' +
          '<div class="bst-card-head">' +
            '<div class="bst-name">' + escHtml(b.commonName || b.name || '') +
              (b.commonName && b.name ? ' <span class="bst-sci-name">' + escHtml(b.name) + '</span>' : '') +
            '</div>' +
            bstDangerBadge(b.danger || 1) +
            (b.habitat ? '<span class="bst-habitat" title="Habitat">' + escHtml(b.habitat) + '</span>' : '') +
            (b.world ? '<span class="bst-world" title="World / Region" onclick="event.stopPropagation();bstFilterByWorld(\'' + escAttr(b.world) + '\')">' + escHtml(b.world) + '</span>' : '') +
          '</div>' +
          (b.description ? '<div class="bst-desc">' + escHtml(b.description) + '</div>' : '') +
          (abilities ? '<div class="bst-abilities">' + abilities + '</div>' : '') +
          tagChipsHtml(b.tags, 'bstFilterByTag') +
          '<button class="gls-card-del" onclick="deleteBeast(event,\'' + escAttr(b.id) + '\')">×</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');
}

function openBeastModal(id)
{
  var b = id ? (bstData.beasts||[]).find(function(x){ return x.id === id; }) : null;
  if (b) noteItemAnchor('beast', b.id, b.commonName || b.name);
  var danger = (b||{}).danger || 1;
  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Common name<input class="modal-input" id="bef-common" value="' + escAttr((b||{}).commonName||'') + '" placeholder="Everyday name…"></label>' +
      '<label class="field-label">Scientific name<input class="modal-input" id="bef-name" value="' + escAttr((b||{}).name||'') + '" placeholder="Formal / scholarly name…"></label>' +
    '</div>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Category<input class="modal-input" id="bef-cat" value="' + escAttr((b||{}).category||'') + '" placeholder="e.g. Dragon, Undead, Fey…"></label>' +
      '<label class="field-label">Danger level<select class="modal-input tb-select" id="bef-danger">' +
        BST_DANGER_LABELS.map(function(lbl, i){
          return '<option value="' + (i + 1) + '"' + (danger === i + 1 ? ' selected' : '') + '>' + (i + 1) + ' — ' + lbl + '</option>';
        }).join('') +
      '</select></label>' +
    '</div>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Habitat<input class="modal-input" id="bef-habitat" value="' + escAttr((b||{}).habitat||'') + '" placeholder="Where it lives…"></label>' +
      '<label class="field-label">World / Region<input class="modal-input" id="bef-world" value="' + escAttr((b||{}).world||'') + '" placeholder="e.g. Faerûn, Northern Wastes…"></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Description<textarea class="modal-input" id="bef-desc" rows="4" placeholder="Appearance, behaviour, lore…">' + escHtml((b||{}).description||'') + '</textarea></label>' +
    '<label class="field-label" style="margin-top:8px">Abilities <span style="color:var(--text3);font-weight:400">(comma separated)</span><input class="modal-input" id="bef-abilities" value="' + escAttr(((b||{}).abilities||[]).join(', ')) + '" placeholder="e.g. Fire breath, Flight…"></label>' +
    tagsField('bef-tags', (b||{}).tags);

  openDataModal(id ? 'Edit beast' : 'Add beast', f, function()
  {
    var beast = {
      id:          id || genId(),
      name:        document.getElementById('bef-name').value.trim(),
      commonName:  document.getElementById('bef-common').value.trim(),
      category:    document.getElementById('bef-cat').value.trim(),
      danger:      parseInt(document.getElementById('bef-danger').value, 10) || 1,
      habitat:     document.getElementById('bef-habitat').value.trim(),
      world:       document.getElementById('bef-world').value.trim(),
      description: document.getElementById('bef-desc').value.trim(),
      abilities:   document.getElementById('bef-abilities').value.split(',').map(function(t){ return t.trim(); }).filter(Boolean),
      tags:        parseTagsInput(document.getElementById('bef-tags').value)
    };
    if (!beast.name && !beast.commonName) return;
    if (id)
      bstData.beasts = bstData.beasts.map(function(x){ return x.id === id ? beast : x; });
    else
      bstData.beasts.push(beast);
    closeDataModal();
    saveBestiaryData();
    renderBestiary();
  });
}

function deleteBeast(e, id)
{
  e.stopPropagation();
  bstData.beasts = (bstData.beasts||[]).filter(function(x){ return x.id !== id; });
  saveBestiaryData(); renderBestiary();
}
