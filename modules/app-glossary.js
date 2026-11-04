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

function fLoadGlossaryFile(file)
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
  fSwitchGlossaryTab('words');
  fRenderGlossary();
}

function fSaveGlossaryData()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'glossary') return;
  glsData.name = document.getElementById('glossary-title-input').value.trim() || glsData.name || 'Glossary';
  var ft = document.getElementById('gls-file-tags');
  if (ft) glsData.tags = fParseTagsInput(ft.value);
  files[currentFileId].name     = glsData.name;
  files[currentFileId].content  = JSON.stringify(glsData, null, 2);
  files[currentFileId].fileTags = glsData.tags || [];
  files[currentFileId].modified = Date.now();
  fScheduleSave();
  fRenderFileList();
}

function fOnGlossaryTitleChange() { fSaveGlossaryData(); }

function fSwitchGlossaryTab(tab)
{
  glsTab = tab;
  document.getElementById('gls-words-panel').style.display  = (tab === 'words') ? '' : 'none';
  document.getElementById('gls-roots-panel').style.display  = (tab === 'roots') ? '' : 'none';
  document.getElementById('gls-tab-words').classList.toggle('active', tab === 'words');
  document.getElementById('gls-tab-roots').classList.toggle('active', tab === 'roots');
  fRenderGlossary();
}

function fOnGlossarySearch(q) { glsQuery = q; fRenderGlossary(); }
function fOnGlsFilterType(v)  { glsFilter[glsTab].type = v; fRenderGlossary(); }
function fOnGlsFilterTag(v)   { glsFilter[glsTab].tag  = v; fRenderGlossary(); }
function fGlsFilterByTag(t)   { glsFilter[glsTab].tag  = t; fRenderGlossary(); }
function fOnGlossaryFileTagsChange() { fSaveGlossaryData(); }

function fRenderGlossary()
{
  if (glsTab === 'words') fRenderGlossaryWords();
  else fRenderGlossaryRoots();
}

var cGlsLangPalette = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#1abc9c','#e91e63','#00b894','#fd79a8'];
function fGlsLangColor(lang)
{
  if (!lang) return '#9ca3af';
  var h = 0; for (var i = 0; i < lang.length; i++) h = ((h << 5) - h) + lang.charCodeAt(i);
  return cGlsLangPalette[Math.abs(h) % cGlsLangPalette.length];
}

var cRootTypeColors = { prefix:'#3498db', suffix:'#e67e22', root:'#2ecc71', infix:'#9b59b6' };

function fRenderGlossaryWords()
{
  var q   = glsQuery.toLowerCase();
  var all = glsData.entries || [];
  var flt = glsFilter.words;
  flt.type = fFillFacetSelect('gls-filter-type', all.map(function(e){ return e.language; }), flt.type, 'All languages');
  flt.tag  = fFillFacetSelect('gls-filter-tag', fCollectItemTags(all), flt.tag, 'All tags');

  var entries = all
    .filter(function(e){ return fItemMatchesFacets(e, flt.type, 'language', flt.tag); })
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
      '<div class="gls-letter-divider">' + fEscHtml(letter) + '</div>' +
      groups[letter].map(function(e){
        var lc  = fGlsLangColor(e.language);
        return '<div class="gls-entry-card" style="--lang-color:' + lc + '" onclick="fOpenGlossaryEntryModal(\'' + fEscAttr(e.id) + '\')">' +
          '<div class="gls-entry-left">' +
            '<div class="gls-entry-word">' + fEscHtml(e.word||'') + '</div>' +
            (e.language ? '<span class="gls-lang-badge" style="background:' + lc + '22;color:' + lc + ';border-color:' + lc + '44">' + fEscHtml(e.language) + '</span>' : '') +
          '</div>' +
          '<div class="gls-entry-right">' +
            '<div class="gls-entry-def">' + fEscHtml(e.definition||'') + '</div>' +
            (e.example ? '<div class="gls-entry-ex">"' + fEscHtml(e.example) + '"</div>' : '') +
            fTagChipsHtml(e.tags, 'fGlsFilterByTag') +
          '</div>' +
          '<button class="gls-card-del" onclick="fDeleteGlossaryEntry(event,\'' + fEscAttr(e.id) + '\')">×</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');
}

function fRenderGlossaryRoots()
{
  var q   = glsQuery.toLowerCase();
  var all = glsData.roots || [];
  var flt = glsFilter.roots;
  flt.type = fFillFacetSelect('gls-filter-type', all.map(function(r){ return r.type; }), flt.type, 'All types');
  flt.tag  = fFillFacetSelect('gls-filter-tag', fCollectItemTags(all), flt.tag, 'All tags');

  var rows = all
    .filter(function(r){ return fItemMatchesFacets(r, flt.type, 'type', flt.tag); })
    .filter(function(r){
      return !q || (r.form||'').toLowerCase().includes(q) ||
             (r.meaning||'').toLowerCase().includes(q) ||
             (r.tags||[]).some(function(t){ return t.toLowerCase().includes(q); });
    })
    .sort(function(a, b){ return (a.form||'').localeCompare(b.form||''); });

  document.getElementById('gls-roots-empty').style.display = rows.length ? 'none' : '';
  document.getElementById('gls-roots-body').innerHTML = rows.map(function(r){
    var tc = cRootTypeColors[r.type] || '#9ca3af';
    var exs = (r.examples||[]).map(function(ex){ return '<span class="gls-tag">' + fEscHtml(ex) + '</span>'; }).join('');
    return '<div class="gls-root-card" onclick="fOpenGlossaryRootModal(\'' + fEscAttr(r.id) + '\')">' +
      '<div class="gls-root-form">' + fEscHtml(r.form||'') + '</div>' +
      '<span class="gls-root-type" style="background:' + tc + '22;color:' + tc + ';border-color:' + tc + '55">' + fEscHtml(r.type||'root') + '</span>' +
      '<div class="gls-root-meaning">' + fEscHtml(r.meaning||'') + '</div>' +
      (exs ? '<div class="gls-root-examples">' + exs + '</div>' : '') +
      fTagChipsHtml(r.tags, 'fGlsFilterByTag') +
      '<button class="gls-card-del" onclick="fDeleteGlossaryRoot(event,\'' + fEscAttr(r.id) + '\')">×</button>' +
    '</div>';
  }).join('');
}

function fGlsAddCurrent()
{
  if (glsTab === 'words') fOpenGlossaryEntryModal(null);
  else fOpenGlossaryRootModal(null);
}

function fOpenGlossaryEntryModal(id)
{
  var e = id ? (glsData.entries||[]).find(function(x){ return x.id === id; }) : null;
  if (e) fNoteItemAnchor('glossary-entry', e.id, e.word);
  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Word<input class="modal-input" id="gef-word" value="' + fEscAttr((e||{}).word||'') + '" placeholder="Word or phrase"></label>' +
      '<label class="field-label">Language<input class="modal-input" id="gef-lang" value="' + fEscAttr((e||{}).language||'') + '" placeholder="Language or dialect"></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Definition<textarea class="modal-input" id="gef-def" rows="2" placeholder="Meaning…">' + fEscHtml((e||{}).definition||'') + '</textarea></label>' +
    '<label class="field-label" style="margin-top:8px">Example<textarea class="modal-input" id="gef-ex" rows="2" placeholder="Usage example…">' + fEscHtml((e||{}).example||'') + '</textarea></label>' +
    fTagsField('gef-tags', (e||{}).tags);

  fOpenDataModal(id ? 'Edit entry' : 'Add entry', f, function()
  {
    var entry = {
      id:         id || fGenId(),
      word:       document.getElementById('gef-word').value.trim(),
      language:   document.getElementById('gef-lang').value.trim(),
      definition: document.getElementById('gef-def').value.trim(),
      example:    document.getElementById('gef-ex').value.trim(),
      tags:       fParseTagsInput(document.getElementById('gef-tags').value)
    };
    if (!entry.word) return;
    if (id)
      glsData.entries = glsData.entries.map(function(x){ return x.id === id ? entry : x; });
    else
      glsData.entries.push(entry);
    fCloseDataModal();
    fSaveGlossaryData();
    fRenderGlossaryWords();
  });
}

function fOpenGlossaryRootModal(id)
{
  var r = id ? (glsData.roots||[]).find(function(x){ return x.id === id; }) : null;
  if (r) fNoteItemAnchor('glossary-root', r.id, r.form);
  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Form<input class="modal-input" id="grf-form" value="' + fEscAttr((r||{}).form||'') + '" placeholder="e.g. -ael, kron-"></label>' +
      '<label class="field-label">Type<select class="modal-input tb-select" id="grf-type">' +
        '<option value="prefix"' + ((r||{}).type==='prefix'?' selected':'') + '>Prefix</option>' +
        '<option value="suffix"' + ((r||{}).type==='suffix'?' selected':'') + '>Suffix</option>' +
        '<option value="root"'  + ((r||{}).type==='root'  ?' selected':'') + '>Root</option>' +
        '<option value="infix"' + ((r||{}).type==='infix' ?' selected':'') + '>Infix</option>' +
      '</select></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Meaning<input class="modal-input" id="grf-mean" value="' + fEscAttr((r||{}).meaning||'') + '" placeholder="What it means…"></label>' +
    '<label class="field-label" style="margin-top:8px">Examples <span style="color:var(--text3);font-weight:400">(comma separated)</span><input class="modal-input" id="grf-ex" value="' + fEscAttr(((r||{}).examples||[]).join(', ')) + '"></label>' +
    fTagsField('grf-tags', (r||{}).tags);

  fOpenDataModal(id ? 'Edit root / affix' : 'Add root / affix', f, function()
  {
    var root = {
      id:       id || fGenId(),
      form:     document.getElementById('grf-form').value.trim(),
      type:     document.getElementById('grf-type').value,
      meaning:  document.getElementById('grf-mean').value.trim(),
      examples: document.getElementById('grf-ex').value.split(',').map(function(t){ return t.trim(); }).filter(Boolean),
      tags:     fParseTagsInput(document.getElementById('grf-tags').value)
    };
    if (!root.form) return;
    if (id)
      glsData.roots = glsData.roots.map(function(x){ return x.id === id ? root : x; });
    else
      glsData.roots.push(root);
    fCloseDataModal();
    fSaveGlossaryData();
    fRenderGlossaryRoots();
  });
}

function fDeleteGlossaryEntry(e, id)
{
  e.stopPropagation();
  glsData.entries = (glsData.entries||[]).filter(function(x){ return x.id !== id; });
  fSaveGlossaryData(); fRenderGlossaryWords();
}

function fDeleteGlossaryRoot(e, id)
{
  e.stopPropagation();
  glsData.roots = (glsData.roots||[]).filter(function(x){ return x.id !== id; });
  fSaveGlossaryData(); fRenderGlossaryRoots();
}
