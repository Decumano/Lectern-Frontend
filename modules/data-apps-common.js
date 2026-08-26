// Shared data-edit modal, tags and facet filters
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── SHARED DATA-EDIT MODAL ──

var demSaveFn = null;

function openDataModal(title, fieldsHtml, saveFn)
{
  document.getElementById('dem-title').textContent = title;
  document.getElementById('dem-fields').innerHTML  = fieldsHtml;
  demSaveFn = saveFn;
  document.getElementById('data-edit-modal').style.display = 'flex';
  var first = document.getElementById('dem-fields').querySelector('input,select,textarea');
  if (first) setTimeout(function(){ first.focus(); }, 40);
}

function closeDataModal()
{
  document.getElementById('data-edit-modal').style.display = 'none';
  demSaveFn = null;
}

function demSave()
{
  if (demSaveFn) demSaveFn();
}

function genId()
{
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// ── TAGS & FACET FILTERS (shared by the JSON data apps) ──
// Every Glossary / Bestiary / Calendar / Economy item can carry free-form
// tags, and each list view gets two facet dropdowns: one for the item's
// natural "type" field (language, category, season, status…) and one for
// tags. The dropdowns are rebuilt from the data on every render so they
// always offer exactly the values that exist.

var DATA_FILE_TYPES = { glossary: 1, bestiary: 1, calendar: 1, economy: 1 };

function parseTagsInput(value)
{
  return String(value || '').split(',').map(function(t){ return t.trim(); }).filter(Boolean);
}

function tagsField(inputId, tags)
{
  return '<label class="field-label" style="margin-top:8px">Tags <span style="color:var(--text3);font-weight:400">(comma separated)</span>' +
         '<input class="modal-input" id="' + inputId + '" value="' + escAttr((tags || []).join(', ')) + '" placeholder="e.g. draft, important…"></label>';
}

// Clickable #tag chips on an item card; clicking one sets that app's tag facet.
function tagChipsHtml(tags, filterFnName)
{
  if (!tags || !tags.length) return '';
  return '<div class="item-tags">' + tags.map(function(t){
    return '<span class="item-tag" onclick="event.stopPropagation();' + filterFnName + '(\'' + escAttr(t) + '\')">#' + escHtml(t) + '</span>';
  }).join('') + '</div>';
}

function collectItemTags(items)
{
  var out = [];
  (items || []).forEach(function(it){
    (it.tags || []).forEach(function(t){ if (out.indexOf(t) === -1) out.push(t); });
  });
  return out;
}

// Rebuilds a facet <select> from the values present in the data, keeping the
// current selection. Returns the effective value: '' when the previously
// selected value no longer exists (so a stale filter can't hide everything).
function fillFacetSelect(selId, values, current, allLabel)
{
  var sel = document.getElementById(selId);
  if (!sel) return current || '';
  var uniq = [];
  (values || []).forEach(function(v){ if (v && uniq.indexOf(v) === -1) uniq.push(v); });
  uniq.sort(function(a, b){ return String(a).localeCompare(String(b)); });
  if (current && uniq.indexOf(current) === -1) current = '';
  sel.innerHTML = '<option value="">' + escHtml(allLabel) + '</option>' +
    uniq.map(function(v){
      return '<option value="' + escAttr(v) + '"' + (v === current ? ' selected' : '') + '>' + escHtml(v) + '</option>';
    }).join('');
  return current;
}

function itemMatchesFacets(item, typeVal, typeKey, tagVal)
{
  if (typeVal && String(item[typeKey] || '') !== typeVal) return false;
  if (tagVal && (item.tags || []).indexOf(tagVal) === -1) return false;
  return true;
}

// File-level tags for the data apps live in the JSON root ({ tags: [...] })
// and are cached on the sidebar entry for filtering without a reparse.
function fileTagsOf(f)
{
  if (!f || !DATA_FILE_TYPES[f.type]) return [];
  if (f.fileTags) return f.fileTags;
  if (f.content === undefined) return [];
  try { f.fileTags = JSON.parse(f.content || '{}').tags || []; }
  catch(e) { f.fileTags = []; }
  return f.fileTags;
}
