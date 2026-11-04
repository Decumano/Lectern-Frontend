// Economy
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── ECONOMY ──

var ecoData = null;
var ecoTab  = 'currencies';
var ecoFilter = { currencies: { type: '', tag: '' }, goods: { type: '', tag: '' }, regions: { type: '', tag: '' } };

function fLoadEconomyFile(file)
{
  try { ecoData = JSON.parse(file.content || '{}'); }
  catch(e) { ecoData = {}; }
  if (!ecoData.currencies)    ecoData.currencies    = [];
  if (!ecoData.exchangeRates) ecoData.exchangeRates = [];
  if (!ecoData.tradeGoods)    ecoData.tradeGoods    = [];
  if (!ecoData.regions)       ecoData.regions       = [];
  document.getElementById('economy-title-input').value = file.name || ecoData.name || '';
  var ft = document.getElementById('eco-file-tags');
  if (ft) ft.value = (ecoData.tags || []).join(', ');
  ecoFilter = { currencies: { type: '', tag: '' }, goods: { type: '', tag: '' }, regions: { type: '', tag: '' } };
  fSwitchEconomyTab('currencies');
  fRenderEconomy();
}

function fSaveEconomyData()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'economy') return;
  ecoData.name = document.getElementById('economy-title-input').value.trim() || ecoData.name || 'Economy';
  var ft = document.getElementById('eco-file-tags');
  if (ft) ecoData.tags = fParseTagsInput(ft.value);
  files[currentFileId].name     = ecoData.name;
  files[currentFileId].content  = JSON.stringify(ecoData, null, 2);
  files[currentFileId].fileTags = ecoData.tags || [];
  files[currentFileId].modified = Date.now();
  fScheduleSave();
  fRenderFileList();
}

function fOnEconomyTitleChange() { fSaveEconomyData(); }
function fOnEconomyFileTagsChange() { fSaveEconomyData(); }
function fOnEcoFilterType(v) { ecoFilter[ecoTab].type = v; fRenderEconomy(); }
function fOnEcoFilterTag(v)  { ecoFilter[ecoTab].tag  = v; fRenderEconomy(); }
function fEcoFilterByTag(t)  { ecoFilter[ecoTab].tag  = t; fRenderEconomy(); }

function fSwitchEconomyTab(tab)
{
  ecoTab = tab;
  ['currencies','goods','regions'].forEach(function(t){
    document.getElementById('eco-' + t + '-panel').style.display = (t === tab) ? '' : 'none';
    document.getElementById('eco-tab-' + t).classList.toggle('active', t === tab);
  });
  fRenderEconomy();
}

function fEcoAddCurrent()
{
  if (ecoTab === 'currencies') fOpenEcoCurrencyModal(null);
  else if (ecoTab === 'goods') fOpenEcoGoodModal(null);
  else if (ecoTab === 'regions') fOpenEcoRegionModal(null);
}

function fRenderEconomy()
{
  if (ecoTab === 'currencies')    fRenderEcoCurrencies();
  else if (ecoTab === 'goods')    fRenderEcoGoods();
  else if (ecoTab === 'regions')  fRenderEcoRegions();
}

var cEcoStatusColors = { Prosperous:'#2ecc71', Stable:'#3498db', Struggling:'#e67e22', Declining:'#e74c3c', Isolated:'#9b59b6', 'War-torn':'#c0392b', Unknown:'#9ca3af' };
var cEcoCurrPalette  = ['#f39c12','#3498db','#2ecc71','#e74c3c','#9b59b6','#1abc9c','#e67e22','#e91e63'];

function fEcoCurrColor(idx)
{
  return cEcoCurrPalette[idx % cEcoCurrPalette.length];
}

function fRenderEcoCurrencies()
{
  var currencies = ecoData.currencies || [];
  var flt = ecoFilter.currencies;
  flt.type = fFillFacetSelect('eco-filter-type', currencies.map(function(c){ return c.region; }), flt.type, 'All regions');
  flt.tag  = fFillFacetSelect('eco-filter-tag', fCollectItemTags(currencies), flt.tag, 'All tags');

  document.getElementById('eco-currencies-empty').style.display = currencies.length ? 'none' : '';
  document.getElementById('eco-exchange-calc').style.display    = currencies.length >= 2 ? '' : 'none';

  // Color and "base currency" status follow the position in the full list,
  // so filtering can't change which currency reads as the base.
  document.getElementById('eco-currencies-body').innerHTML = currencies.map(function(c, i){
    return { c: c, i: i };
  }).filter(function(x){
    return fItemMatchesFacets(x.c, flt.type, 'region', flt.tag);
  }).map(function(x){
    var c = x.c;
    var color = fEcoCurrColor(x.i);
    var isBase = (x.i === 0);
    return '<div class="eco-curr-card" onclick="fOpenEcoCurrencyModal(\'' + fEscAttr(c.id) + '\')">' +
      '<div class="eco-curr-symbol" style="color:' + color + ';border-color:' + color + '44">' + fEscHtml(c.symbol||'?') + '</div>' +
      '<div class="eco-curr-name">' + fEscHtml(c.name||'') + '</div>' +
      (c.region ? '<div class="eco-curr-region">' + fEscHtml(c.region) + '</div>' : '') +
      '<div class="eco-curr-value">' + (isBase ? 'Base currency' : '×' + (c.baseValue||1)) + '</div>' +
      (c.description ? '<div class="eco-curr-desc">' + fEscHtml(c.description) + '</div>' : '') +
      fTagChipsHtml(c.tags, 'fEcoFilterByTag') +
      '<button class="gls-card-del" onclick="fDeleteEcoCurrency(event,\'' + fEscAttr(c.id) + '\')">×</button>' +
    '</div>';
  }).join('');

  var opts = currencies.map(function(c){ return '<option value="' + fEscAttr(c.id) + '">' + fEscHtml(c.name||'') + ' (' + fEscHtml(c.symbol||'') + ')</option>'; }).join('');
  var fromSel = document.getElementById('eco-calc-from');
  var toSel   = document.getElementById('eco-calc-to');
  if (fromSel) fromSel.innerHTML = opts;
  if (toSel)   { toSel.innerHTML = opts; if (currencies.length >= 2) toSel.selectedIndex = 1; }
}

var cCatPalette = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#1abc9c','#e91e63','#00cec9','#fd79a8'];
function fEcoCatColor(cat)
{
  if (!cat) return '#9ca3af';
  var h = 0; for (var i = 0; i < cat.length; i++) h = ((h << 5) - h) + cat.charCodeAt(i);
  return cCatPalette[Math.abs(h) % cCatPalette.length];
}

function fRenderEcoGoods()
{
  var goods = ecoData.tradeGoods || [];
  var flt = ecoFilter.goods;
  flt.type = fFillFacetSelect('eco-filter-type', goods.map(function(g){ return g.category; }), flt.type, 'All categories');
  flt.tag  = fFillFacetSelect('eco-filter-tag', fCollectItemTags(goods), flt.tag, 'All tags');

  var shown = goods.filter(function(g){ return fItemMatchesFacets(g, flt.type, 'category', flt.tag); });
  document.getElementById('eco-goods-empty').style.display = shown.length ? 'none' : '';
  var sorted = shown.slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
  document.getElementById('eco-goods-body').innerHTML = sorted.map(function(g){
    var cur = (ecoData.currencies||[]).find(function(c){ return c.id === g.priceCurrencyId; });
    var price = g.priceAmount != null ? g.priceAmount + (cur ? ' ' + fEscHtml(cur.symbol) : '') : '';
    var cc = fEcoCatColor(g.category);
    return '<tr class="data-row" onclick="fOpenEcoGoodModal(\'' + fEscAttr(g.id) + '\')">' +
      '<td class="eco-good-name">' + fEscHtml(g.name||'') + fTagChipsHtml(g.tags, 'fEcoFilterByTag') + '</td>' +
      '<td>' + (g.category ? '<span class="eco-cat-badge" style="background:' + cc + '22;color:' + cc + ';border-color:' + cc + '44">' + fEscHtml(g.category) + '</span>' : '') + '</td>' +
      '<td class="eco-price-cell">' + fEscHtml(price) + '</td>' +
      '<td class="eco-origin-cell">' + fEscHtml(g.origin||'') + '</td>' +
      '<td class="eco-desc-cell">' + fEscHtml(g.description||'') + '</td>' +
      '<td><button class="gls-card-del" onclick="fDeleteEcoGood(event,\'' + fEscAttr(g.id) + '\')">×</button></td>' +
    '</tr>';
  }).join('');
}

function fRenderEcoRegions()
{
  var regions = ecoData.regions || [];
  var flt = ecoFilter.regions;
  flt.type = fFillFacetSelect('eco-filter-type', regions.map(function(r){ return r.economicStatus; }), flt.type, 'All statuses');
  flt.tag  = fFillFacetSelect('eco-filter-tag', fCollectItemTags(regions), flt.tag, 'All tags');

  var shown = regions.filter(function(r){ return fItemMatchesFacets(r, flt.type, 'economicStatus', flt.tag); });
  document.getElementById('eco-regions-empty').style.display = shown.length ? 'none' : '';
  document.getElementById('eco-regions-body').innerHTML = shown.map(function(r){
    var cur  = (ecoData.currencies||[]).find(function(c){ return c.id === r.primaryCurrencyId; });
    var sc   = cEcoStatusColors[r.economicStatus] || '#9ca3af';
    var exps = (r.exports||[]).map(function(e){ return '<span class="eco-trade-chip eco-export-chip">' + fEscHtml(e) + '</span>'; }).join('');
    var imps = (r.imports||[]).map(function(e){ return '<span class="eco-trade-chip eco-import-chip">' + fEscHtml(e) + '</span>'; }).join('');
    return '<div class="eco-region-card" onclick="fOpenEcoRegionModal(\'' + fEscAttr(r.id) + '\')">' +
      '<div class="eco-region-header">' +
        '<span class="eco-region-name">' + fEscHtml(r.name||'') + '</span>' +
        (r.economicStatus ? '<span class="eco-status-badge" style="background:' + sc + '22;color:' + sc + ';border-color:' + sc + '44">' + fEscHtml(r.economicStatus) + '</span>' : '') +
      '</div>' +
      (cur ? '<div class="eco-region-currency">Currency: ' + fEscHtml(cur.name||'') + (cur.symbol ? ' (' + fEscHtml(cur.symbol) + ')' : '') + '</div>' : '') +
      (exps ? '<div class="eco-region-trade"><span class="eco-trade-label">Exports</span>' + exps + '</div>' : '') +
      (imps ? '<div class="eco-region-trade"><span class="eco-trade-label">Imports</span>' + imps + '</div>' : '') +
      (r.notes ? '<div class="eco-region-notes">' + fEscHtml(r.notes) + '</div>' : '') +
      fTagChipsHtml(r.tags, 'fEcoFilterByTag') +
      '<button class="gls-card-del" onclick="fDeleteEcoRegion(event,\'' + fEscAttr(r.id) + '\')">×</button>' +
    '</div>';
  }).join('');
}

function fCalcEcoExchange()
{
  var amount   = parseFloat(document.getElementById('eco-calc-amount').value) || 1;
  var fromId   = document.getElementById('eco-calc-from').value;
  var toId     = document.getElementById('eco-calc-to').value;
  var result   = document.getElementById('eco-calc-result');
  var currencies = ecoData.currencies || [];
  var from = currencies.find(function(c){ return c.id === fromId; });
  var to   = currencies.find(function(c){ return c.id === toId; });
  if (!from || !to) { result.textContent = 'Select two currencies.'; return; }

  // Check stored exchange rates first (from→to and to→from)
  var rate = null;
  var stored = (ecoData.exchangeRates||[]).find(function(r){ return r.fromId === fromId && r.toId === toId; });
  if (stored) { rate = stored.rate; }
  else {
    var rev = (ecoData.exchangeRates||[]).find(function(r){ return r.fromId === toId && r.toId === fromId; });
    if (rev && rev.rate) rate = 1 / rev.rate;
  }
  // Fall back to base values
  if (rate === null && from.baseValue && to.baseValue) rate = to.baseValue / from.baseValue;

  if (rate === null) { result.textContent = 'No exchange rate defined between these currencies.'; return; }
  var converted = amount * rate;
  result.textContent = amount + ' ' + (from.symbol||from.name) + ' = ' + converted.toFixed(4).replace(/\.?0+$/, '') + ' ' + (to.symbol||to.name);
}

function fOpenEcoCurrencyModal(id)
{
  var c = id ? (ecoData.currencies||[]).find(function(x){ return x.id === id; }) : null;
  if (c) fNoteItemAnchor('eco-currency', c.id, c.name);
  // Build exchange rate rows for this currency
  var xrHtml = '';
  if (id && ecoData.currencies.length > 1)
  {
    var others = ecoData.currencies.filter(function(x){ return x.id !== id; });
    xrHtml = '<div class="field-label" style="margin-top:12px">Exchange rates (1 ' + fEscHtml((c||{}).symbol||'?') + ' =)</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">' +
      others.map(function(o){
        var stored = (ecoData.exchangeRates||[]).find(function(r){ return r.fromId === id && r.toId === o.id; });
        var rev    = (ecoData.exchangeRates||[]).find(function(r){ return r.fromId === o.id && r.toId === id; });
        var val    = stored ? stored.rate : (rev && rev.rate ? (1/rev.rate).toFixed(4) : '');
        return '<div style="display:flex;align-items:center;gap:8px;font-size:12px">' +
          '<span style="flex:1;color:var(--text2)">' + fEscHtml(o.name||'') + ' (' + fEscHtml(o.symbol||'') + ')</span>' +
          '<input class="modal-input tb-input-sm" data-xr-to="' + fEscAttr(o.id) + '" value="' + fEscAttr(String(val)) + '" type="number" step="any" style="width:100px" placeholder="rate">' +
        '</div>';
      }).join('') +
      '</div>';
  }

  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Name<input class="modal-input" id="ecf-name" value="' + fEscAttr((c||{}).name||'') + '" placeholder="e.g. Gold Crown"></label>' +
      '<label class="field-label">Symbol<input class="modal-input" id="ecf-sym" value="' + fEscAttr((c||{}).symbol||'') + '" placeholder="GC"></label>' +
    '</div>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Region / Faction<input class="modal-input" id="ecf-reg" value="' + fEscAttr((c||{}).region||'') + '"></label>' +
      '<label class="field-label">Base value<input class="modal-input" id="ecf-base" type="number" step="any" value="' + ((c||{}).baseValue||1) + '" placeholder="relative value"></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Notes<input class="modal-input" id="ecf-desc" value="' + fEscAttr((c||{}).description||'') + '"></label>' +
    fTagsField('ecf-tags', (c||{}).tags) +
    xrHtml;

  fOpenDataModal(id ? 'Edit currency' : 'Add currency', f, function()
  {
    var name = document.getElementById('ecf-name').value.trim();
    if (!name) return;
    var cid = id || fGenId();
    var currency = {
      id:          cid,
      name:        name,
      symbol:      document.getElementById('ecf-sym').value.trim(),
      region:      document.getElementById('ecf-reg').value.trim(),
      baseValue:   parseFloat(document.getElementById('ecf-base').value) || 1,
      description: document.getElementById('ecf-desc').value.trim(),
      tags:        fParseTagsInput(document.getElementById('ecf-tags').value)
    };

    if (id)
      ecoData.currencies = ecoData.currencies.map(function(x){ return x.id === id ? currency : x; });
    else
      ecoData.currencies.push(currency);

    // Save exchange rates
    document.querySelectorAll('#dem-fields input[data-xr-to]').forEach(function(inp){
      var toId = inp.dataset.xrTo;
      var val  = parseFloat(inp.value);
      ecoData.exchangeRates = (ecoData.exchangeRates||[]).filter(function(r){ return !(r.fromId === cid && r.toId === toId); });
      if (!isNaN(val) && val > 0) ecoData.exchangeRates.push({ id: fGenId(), fromId: cid, toId: toId, rate: val, notes: '' });
    });

    fCloseDataModal();
    fSaveEconomyData();
    fRenderEcoCurrencies();
  });
}

function fOpenEcoGoodModal(id)
{
  var g = id ? (ecoData.tradeGoods||[]).find(function(x){ return x.id === id; }) : null;
  if (g) fNoteItemAnchor('eco-good', g.id, g.name);
  var curOpts = (ecoData.currencies||[]).map(function(c){
    return '<option value="' + fEscAttr(c.id) + '"' + ((g&&g.priceCurrencyId===c.id)?' selected':'') + '>' + fEscHtml(c.name||'') + ' (' + fEscHtml(c.symbol||'') + ')</option>';
  }).join('');

  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Name<input class="modal-input" id="egf-name" value="' + fEscAttr((g||{}).name||'') + '" placeholder="e.g. Ironwood"></label>' +
      '<label class="field-label">Category<input class="modal-input" id="egf-cat" value="' + fEscAttr((g||{}).category||'') + '" placeholder="Material, Food, Luxury…"></label>' +
    '</div>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Base price<input class="modal-input" id="egf-price" type="number" step="any" value="' + ((g||{}).priceAmount||'') + '" placeholder="Amount"></label>' +
      '<label class="field-label">Currency<select class="modal-input tb-select" id="egf-cur"><option value="">— select —</option>' + curOpts + '</select></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Origin region<input class="modal-input" id="egf-origin" value="' + fEscAttr((g||{}).origin||'') + '"></label>' +
    '<label class="field-label" style="margin-top:8px">Description<textarea class="modal-input" id="egf-desc" rows="2">' + fEscHtml((g||{}).description||'') + '</textarea></label>' +
    fTagsField('egf-tags', (g||{}).tags);

  fOpenDataModal(id ? 'Edit trade good' : 'Add trade good', f, function()
  {
    var name = document.getElementById('egf-name').value.trim();
    if (!name) return;
    var good = {
      id:               id || fGenId(),
      name:             name,
      category:         document.getElementById('egf-cat').value.trim(),
      priceAmount:      parseFloat(document.getElementById('egf-price').value) || null,
      priceCurrencyId:  document.getElementById('egf-cur').value,
      origin:           document.getElementById('egf-origin').value.trim(),
      description:      document.getElementById('egf-desc').value.trim(),
      tags:             fParseTagsInput(document.getElementById('egf-tags').value)
    };
    if (id)
      ecoData.tradeGoods = ecoData.tradeGoods.map(function(x){ return x.id === id ? good : x; });
    else
      ecoData.tradeGoods.push(good);
    fCloseDataModal();
    fSaveEconomyData();
    fRenderEcoGoods();
  });
}

function fOpenEcoRegionModal(id)
{
  var r = id ? (ecoData.regions||[]).find(function(x){ return x.id === id; }) : null;
  if (r) fNoteItemAnchor('eco-region', r.id, r.name);
  var curOpts = (ecoData.currencies||[]).map(function(c){
    return '<option value="' + fEscAttr(c.id) + '"' + ((r&&r.primaryCurrencyId===c.id)?' selected':'') + '>' + fEscHtml(c.name||'') + '</option>';
  }).join('');
  var statusOpts = ['Prosperous','Stable','Struggling','Declining','Isolated','War-torn','Unknown'].map(function(s){
    return '<option value="' + s + '"' + ((r&&r.economicStatus===s)?' selected':'') + '>' + s + '</option>';
  }).join('');

  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Region / Faction<input class="modal-input" id="erf-name" value="' + fEscAttr((r||{}).name||'') + '" placeholder="Name…"></label>' +
      '<label class="field-label">Economic status<select class="modal-input tb-select" id="erf-status"><option value="">— select —</option>' + statusOpts + '</select></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Primary currency<select class="modal-input tb-select" id="erf-cur"><option value="">— none —</option>' + curOpts + '</select></label>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Main exports <span style="color:var(--text3);font-weight:400">(comma separated)</span><input class="modal-input" id="erf-exp" value="' + fEscAttr(((r||{}).exports||[]).join(', ')) + '"></label>' +
      '<label class="field-label">Main imports <span style="color:var(--text3);font-weight:400">(comma separated)</span><input class="modal-input" id="erf-imp" value="' + fEscAttr(((r||{}).imports||[]).join(', ')) + '"></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Notes<textarea class="modal-input" id="erf-notes" rows="2">' + fEscHtml((r||{}).notes||'') + '</textarea></label>' +
    fTagsField('erf-tags', (r||{}).tags);

  fOpenDataModal(id ? 'Edit region' : 'Add region', f, function()
  {
    var name = document.getElementById('erf-name').value.trim();
    if (!name) return;
    var region = {
      id:                id || fGenId(),
      name:              name,
      economicStatus:    document.getElementById('erf-status').value,
      primaryCurrencyId: document.getElementById('erf-cur').value,
      exports:           document.getElementById('erf-exp').value.split(',').map(function(t){ return t.trim(); }).filter(Boolean),
      imports:           document.getElementById('erf-imp').value.split(',').map(function(t){ return t.trim(); }).filter(Boolean),
      notes:             document.getElementById('erf-notes').value.trim(),
      tags:              fParseTagsInput(document.getElementById('erf-tags').value)
    };
    if (id)
      ecoData.regions = ecoData.regions.map(function(x){ return x.id === id ? region : x; });
    else
      ecoData.regions.push(region);
    fCloseDataModal();
    fSaveEconomyData();
    fRenderEcoRegions();
  });
}

function fDeleteEcoCurrency(e, id)
{
  e.stopPropagation();
  ecoData.currencies    = (ecoData.currencies||[]).filter(function(x){ return x.id !== id; });
  ecoData.exchangeRates = (ecoData.exchangeRates||[]).filter(function(r){ return r.fromId !== id && r.toId !== id; });
  fSaveEconomyData(); fRenderEcoCurrencies();
}

function fDeleteEcoGood(e, id)
{
  e.stopPropagation();
  ecoData.tradeGoods = (ecoData.tradeGoods||[]).filter(function(x){ return x.id !== id; });
  fSaveEconomyData(); fRenderEcoGoods();
}

function fDeleteEcoRegion(e, id)
{
  e.stopPropagation();
  ecoData.regions = (ecoData.regions||[]).filter(function(x){ return x.id !== id; });
  fSaveEconomyData(); fRenderEcoRegions();
}
