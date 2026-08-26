// Glossary
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── GLOSSARY ──

var glsData  = null;
var glsTab   = 'words';
var glsQuery = '';
var glsFilter = { words: { type: '', tag: '' }, roots: { type: '', tag: '' } };

function loadGlossaryFile(file)
{
  try { glsData = JSON.parse(file.content || '{}'); }
  catch(e) { glsData = {}; }
  if (!glsData.entries) glsData.entries = [];
  if (!glsData.roots)   glsData.roots   = [];
  // The file's own (user-given) name wins over the embedded title, so a
  // canned default inside the JSON can never rename the file on save.
  document.getElementById('glossary-title-input').value = file.name || glsData.name || '';
  var ft = document.getElementById('gls-file-tags');
  if (ft) ft.value = (glsData.tags || []).join(', ');
  glsQuery = '';
  glsFilter = { words: { type: '', tag: '' }, roots: { type: '', tag: '' } };
  document.getElementById('gls-search').value = '';
  switchGlossaryTab('words');
  renderGlossary();
}

function saveGlossaryData()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'glossary') return;
  glsData.name = document.getElementById('glossary-title-input').value.trim() || glsData.name || 'Glossary';
  var ft = document.getElementById('gls-file-tags');
  if (ft) glsData.tags = parseTagsInput(ft.value);
  files[currentFileId].name     = glsData.name;
  files[currentFileId].content  = JSON.stringify(glsData, null, 2);
  files[currentFileId].fileTags = glsData.tags || [];
  files[currentFileId].modified = Date.now();
  scheduleSave();
  renderFileList();
}

function onGlossaryTitleChange() { saveGlossaryData(); }

function switchGlossaryTab(tab)
{
  glsTab = tab;
  document.getElementById('gls-words-panel').style.display  = (tab === 'words') ? '' : 'none';
  document.getElementById('gls-roots-panel').style.display  = (tab === 'roots') ? '' : 'none';
  document.getElementById('gls-tab-words').classList.toggle('active', tab === 'words');
  document.getElementById('gls-tab-roots').classList.toggle('active', tab === 'roots');
  renderGlossary();
}

function onGlossarySearch(q) { glsQuery = q; renderGlossary(); }
function onGlsFilterType(v)  { glsFilter[glsTab].type = v; renderGlossary(); }
function onGlsFilterTag(v)   { glsFilter[glsTab].tag  = v; renderGlossary(); }
function glsFilterByTag(t)   { glsFilter[glsTab].tag  = t; renderGlossary(); }
function onGlossaryFileTagsChange() { saveGlossaryData(); }

function renderGlossary()
{
  if (glsTab === 'words') renderGlossaryWords();
  else renderGlossaryRoots();
}

var GLS_LANG_PALETTE = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#1abc9c','#e91e63','#00b894','#fd79a8'];
function glsLangColor(lang)
{
  if (!lang) return '#9ca3af';
  var h = 0; for (var i = 0; i < lang.length; i++) h = ((h << 5) - h) + lang.charCodeAt(i);
  return GLS_LANG_PALETTE[Math.abs(h) % GLS_LANG_PALETTE.length];
}

var ROOT_TYPE_COLORS = { prefix:'#3498db', suffix:'#e67e22', root:'#2ecc71', infix:'#9b59b6' };

function renderGlossaryWords()
{
  var q   = glsQuery.toLowerCase();
  var all = glsData.entries || [];
  var flt = glsFilter.words;
  flt.type = fillFacetSelect('gls-filter-type', all.map(function(e){ return e.language; }), flt.type, 'All languages');
  flt.tag  = fillFacetSelect('gls-filter-tag', collectItemTags(all), flt.tag, 'All tags');

  var entries = all
    .filter(function(e){ return itemMatchesFacets(e, flt.type, 'language', flt.tag); })
    .filter(function(e){
      return !q || (e.word||'').toLowerCase().includes(q) ||
             (e.definition||'').toLowerCase().includes(q) ||
             (e.language||'').toLowerCase().includes(q) ||
             (e.tags||[]).some(function(t){ return t.toLowerCase().includes(q); });
    })
    .sort(function(a, b){ return (a.word||'').localeCompare(b.word||''); });

  document.getElementById('gls-words-empty').style.display = entries.length ? 'none' : '';

  var groups = {};
  entries.forEach(function(e){
    var letter = (e.word||'').charAt(0).toUpperCase() || '#';
    (groups[letter] = groups[letter] || []).push(e);
  });

  document.getElementById('gls-words-body').innerHTML = Object.keys(groups).sort().map(function(letter){
    return '<div class="gls-letter-group">' +
      '<div class="gls-letter-divider">' + escHtml(letter) + '</div>' +
      groups[letter].map(function(e){
        var lc  = glsLangColor(e.language);
        return '<div class="gls-entry-card" style="--lang-color:' + lc + '" onclick="openGlossaryEntryModal(\'' + escAttr(e.id) + '\')">' +
          '<div class="gls-entry-left">' +
            '<div class="gls-entry-word">' + escHtml(e.word||'') + '</div>' +
            (e.language ? '<span class="gls-lang-badge" style="background:' + lc + '22;color:' + lc + ';border-color:' + lc + '44">' + escHtml(e.language) + '</span>' : '') +
          '</div>' +
          '<div class="gls-entry-right">' +
            '<div class="gls-entry-def">' + escHtml(e.definition||'') + '</div>' +
            (e.example ? '<div class="gls-entry-ex">"' + escHtml(e.example) + '"</div>' : '') +
            tagChipsHtml(e.tags, 'glsFilterByTag') +
          '</div>' +
          '<button class="gls-card-del" onclick="deleteGlossaryEntry(event,\'' + escAttr(e.id) + '\')">×</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');
}

function renderGlossaryRoots()
{
  var q   = glsQuery.toLowerCase();
  var all = glsData.roots || [];
  var flt = glsFilter.roots;
  flt.type = fillFacetSelect('gls-filter-type', all.map(function(r){ return r.type; }), flt.type, 'All types');
  flt.tag  = fillFacetSelect('gls-filter-tag', collectItemTags(all), flt.tag, 'All tags');

  var rows = all
    .filter(function(r){ return itemMatchesFacets(r, flt.type, 'type', flt.tag); })
    .filter(function(r){
      return !q || (r.form||'').toLowerCase().includes(q) ||
             (r.meaning||'').toLowerCase().includes(q) ||
             (r.tags||[]).some(function(t){ return t.toLowerCase().includes(q); });
    })
    .sort(function(a, b){ return (a.form||'').localeCompare(b.form||''); });

  document.getElementById('gls-roots-empty').style.display = rows.length ? 'none' : '';
  document.getElementById('gls-roots-body').innerHTML = rows.map(function(r){
    var tc = ROOT_TYPE_COLORS[r.type] || '#9ca3af';
    var exs = (r.examples||[]).map(function(ex){ return '<span class="gls-tag">' + escHtml(ex) + '</span>'; }).join('');
    return '<div class="gls-root-card" onclick="openGlossaryRootModal(\'' + escAttr(r.id) + '\')">' +
      '<div class="gls-root-form">' + escHtml(r.form||'') + '</div>' +
      '<span class="gls-root-type" style="background:' + tc + '22;color:' + tc + ';border-color:' + tc + '55">' + escHtml(r.type||'root') + '</span>' +
      '<div class="gls-root-meaning">' + escHtml(r.meaning||'') + '</div>' +
      (exs ? '<div class="gls-root-examples">' + exs + '</div>' : '') +
      tagChipsHtml(r.tags, 'glsFilterByTag') +
      '<button class="gls-card-del" onclick="deleteGlossaryRoot(event,\'' + escAttr(r.id) + '\')">×</button>' +
    '</div>';
  }).join('');
}

function glsAddCurrent()
{
  if (glsTab === 'words') openGlossaryEntryModal(null);
  else openGlossaryRootModal(null);
}

function openGlossaryEntryModal(id)
{
  var e = id ? (glsData.entries||[]).find(function(x){ return x.id === id; }) : null;
  if (e) noteItemAnchor('glossary-entry', e.id, e.word);
  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Word<input class="modal-input" id="gef-word" value="' + escAttr((e||{}).word||'') + '" placeholder="Word or phrase"></label>' +
      '<label class="field-label">Language<input class="modal-input" id="gef-lang" value="' + escAttr((e||{}).language||'') + '" placeholder="Language or dialect"></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Definition<textarea class="modal-input" id="gef-def" rows="2" placeholder="Meaning…">' + escHtml((e||{}).definition||'') + '</textarea></label>' +
    '<label class="field-label" style="margin-top:8px">Example<textarea class="modal-input" id="gef-ex" rows="2" placeholder="Usage example…">' + escHtml((e||{}).example||'') + '</textarea></label>' +
    tagsField('gef-tags', (e||{}).tags);

  openDataModal(id ? 'Edit entry' : 'Add entry', f, function()
  {
    var entry = {
      id:         id || genId(),
      word:       document.getElementById('gef-word').value.trim(),
      language:   document.getElementById('gef-lang').value.trim(),
      definition: document.getElementById('gef-def').value.trim(),
      example:    document.getElementById('gef-ex').value.trim(),
      tags:       parseTagsInput(document.getElementById('gef-tags').value)
    };
    if (!entry.word) return;
    if (id)
      glsData.entries = glsData.entries.map(function(x){ return x.id === id ? entry : x; });
    else
      glsData.entries.push(entry);
    closeDataModal();
    saveGlossaryData();
    renderGlossaryWords();
  });
}

function openGlossaryRootModal(id)
{
  var r = id ? (glsData.roots||[]).find(function(x){ return x.id === id; }) : null;
  if (r) noteItemAnchor('glossary-root', r.id, r.form);
  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Form<input class="modal-input" id="grf-form" value="' + escAttr((r||{}).form||'') + '" placeholder="e.g. -ael, kron-"></label>' +
      '<label class="field-label">Type<select class="modal-input tb-select" id="grf-type">' +
        '<option value="prefix"' + ((r||{}).type==='prefix'?' selected':'') + '>Prefix</option>' +
        '<option value="suffix"' + ((r||{}).type==='suffix'?' selected':'') + '>Suffix</option>' +
        '<option value="root"'  + ((r||{}).type==='root'  ?' selected':'') + '>Root</option>' +
        '<option value="infix"' + ((r||{}).type==='infix' ?' selected':'') + '>Infix</option>' +
      '</select></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Meaning<input class="modal-input" id="grf-mean" value="' + escAttr((r||{}).meaning||'') + '" placeholder="What it means…"></label>' +
    '<label class="field-label" style="margin-top:8px">Examples <span style="color:var(--text3);font-weight:400">(comma separated)</span><input class="modal-input" id="grf-ex" value="' + escAttr(((r||{}).examples||[]).join(', ')) + '"></label>' +
    tagsField('grf-tags', (r||{}).tags);

  openDataModal(id ? 'Edit root / affix' : 'Add root / affix', f, function()
  {
    var root = {
      id:       id || genId(),
      form:     document.getElementById('grf-form').value.trim(),
      type:     document.getElementById('grf-type').value,
      meaning:  document.getElementById('grf-mean').value.trim(),
      examples: document.getElementById('grf-ex').value.split(',').map(function(t){ return t.trim(); }).filter(Boolean),
      tags:     parseTagsInput(document.getElementById('grf-tags').value)
    };
    if (!root.form) return;
    if (id)
      glsData.roots = glsData.roots.map(function(x){ return x.id === id ? root : x; });
    else
      glsData.roots.push(root);
    closeDataModal();
    saveGlossaryData();
    renderGlossaryRoots();
  });
}

function deleteGlossaryEntry(e, id)
{
  e.stopPropagation();
  glsData.entries = (glsData.entries||[]).filter(function(x){ return x.id !== id; });
  saveGlossaryData(); renderGlossaryWords();
}

function deleteGlossaryRoot(e, id)
{
  e.stopPropagation();
  glsData.roots = (glsData.roots||[]).filter(function(x){ return x.id !== id; });
  saveGlossaryData(); renderGlossaryRoots();
}
