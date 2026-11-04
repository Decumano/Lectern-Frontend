// Calendar
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── CALENDAR ──

var calData = null;
var calTab  = 'months';
var calFilter = { months: { type: '', tag: '' }, holidays: { type: '', tag: '' } };

function fLoadCalendarFile(file)
{
  calFilter = { months: { type: '', tag: '' }, holidays: { type: '', tag: '' } };
  try { calData = JSON.parse(file.content || '{}'); }
  catch(e) { calData = {}; }
  if (!calData.months)   calData.months   = [];
  if (!calData.seasons)  calData.seasons  = [];
  if (!calData.holidays) calData.holidays = [];
  if (!calData.epochRealDate)    calData.epochRealDate    = new Date().toISOString().slice(0,10);
  if (!calData.epochFictionYear) calData.epochFictionYear = 1;
  if (!calData.daysPerYear)      calData.daysPerYear      = 365;

  document.getElementById('calendar-title-input').value = file.name || calData.name || '';
  document.getElementById('cal-days-per-year').value    = calData.daysPerYear;
  document.getElementById('cal-epoch-real').value       = calData.epochRealDate;
  var ft = document.getElementById('cal-file-tags');
  if (ft) ft.value = (calData.tags || []).join(', ');
  fSwitchCalendarTab('months');
  fRenderCalendar();
}

function fSaveCalendarData()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'calendar') return;
  calData.name = document.getElementById('calendar-title-input').value.trim() || calData.name || 'Calendar';
  var ft = document.getElementById('cal-file-tags');
  if (ft) calData.tags = fParseTagsInput(ft.value);
  files[currentFileId].name     = calData.name;
  files[currentFileId].content  = JSON.stringify(calData, null, 2);
  files[currentFileId].fileTags = calData.tags || [];
  files[currentFileId].modified = Date.now();
  fScheduleSave();
  fRenderFileList();
}

function fOnCalendarTitleChange() { fSaveCalendarData(); }
function fOnCalendarFileTagsChange() { fSaveCalendarData(); }
function fOnCalFilterType(v) { calFilter[calTab === 'holidays' ? 'holidays' : 'months'].type = v; fRenderCalendar(); }
function fOnCalFilterTag(v)  { calFilter[calTab === 'holidays' ? 'holidays' : 'months'].tag  = v; fRenderCalendar(); }
function fCalFilterByTag(t)  { calFilter[calTab === 'holidays' ? 'holidays' : 'months'].tag  = t; fRenderCalendar(); }
function fOnCalDaysChange(v)  { calData.daysPerYear = parseInt(v,10)||365; fSaveCalendarData(); }
function fOnCalEpochChange()  { calData.epochRealDate = document.getElementById('cal-epoch-real').value; fSaveCalendarData(); }

function fSwitchCalendarTab(tab)
{
  calTab = tab;
  ['months','holidays','convert'].forEach(function(t){
    document.getElementById('cal-' + t + '-panel').style.display = (t === tab) ? '' : 'none';
    document.getElementById('cal-tab-' + t).classList.toggle('active', t === tab);
  });
  var addBtn = document.getElementById('cal-add-btn');
  if (addBtn) addBtn.style.display = (tab === 'convert') ? 'none' : '';
  // The date converter has nothing to filter.
  ['cal-filter-type', 'cal-filter-tag'].forEach(function(fid){
    var el = document.getElementById(fid);
    if (el) el.style.display = (tab === 'convert') ? 'none' : '';
  });
  fRenderCalendar();
}

function fCalAddCurrent()
{
  if (calTab === 'months')   { fOpenCalendarAddModal(); }
  else if (calTab === 'holidays') { fOpenCalendarHolidayModal(null); }
}

function fRenderCalendar()
{
  if (calTab === 'months')        fRenderCalendarMonths();
  else if (calTab === 'holidays') fRenderCalendarHolidays();
  else if (calTab === 'convert')  fRenderCalendarConverter();
}

function fRenderCalendarMonths()
{
  var seasons  = calData.seasons  || [];
  var months   = calData.months   || [];
  var hasData  = seasons.length + months.length > 0;
  document.getElementById('cal-months-empty').style.display = hasData ? 'none' : '';

  var flt = calFilter.months;
  flt.type = fFillFacetSelect('cal-filter-type', seasons.map(function(s){ return s.name; }), flt.type, 'All seasons');
  flt.tag  = fFillFacetSelect('cal-filter-tag', fCollectItemTags(months), flt.tag, 'All tags');

  // Year timeline
  var totalDays = months.reduce(function(sum, m){ return sum + (m.days||0); }, 0);
  var timeline  = document.getElementById('cal-year-timeline');
  if (timeline)
  {
    if (months.length && totalDays > 0)
    {
      timeline.style.display = '';
      timeline.innerHTML = '<div class="cal-timeline-label">Year overview</div>' +
        '<div class="cal-timeline-bar">' +
        months.map(function(m){
          var season = seasons.find(function(s){ return (s.monthIds||[]).includes(m.id); });
          var color  = season ? season.color : '#555';
          var fPct    = ((m.days||0) / totalDays * 100).toFixed(2);
          var hols   = (calData.holidays||[]).filter(function(h){ return h.monthId === m.id; });
          var dots   = hols.map(function(h){ return '<span class="cal-tl-hol" title="' + fEscAttr(h.name||'') + '" style="left:' + ((h.day||1)/(m.days||30)*100).toFixed(1) + '%"></span>'; }).join('');
          return '<div class="cal-tl-seg" style="width:' + fPct + '%;background:' + fEscAttr(color) + '" title="' + fEscAttr(m.name||'') + ' · ' + (m.days||0) + ' days" onclick="fOpenCalendarMonthModal(\'' + fEscAttr(m.id) + '\')">' +
            '<span class="cal-tl-name">' + fEscHtml(m.name||'') + '</span>' +
            dots +
          '</div>';
        }).join('') +
        '</div>';
    }
    else timeline.style.display = 'none';
  }

  // Season strip
  var strip = document.getElementById('cal-seasons-strip');
  strip.innerHTML = seasons.map(function(s){
    var days = fCalSeasonDays(s);
    var mcount = (s.monthIds||[]).length;
    return '<div class="cal-season-chip" style="--season-color:' + fEscAttr(s.color||'#888') + '" onclick="fOpenCalendarSeasonModal(\'' + fEscAttr(s.id) + '\')">' +
      '<span class="cal-season-dot" style="background:' + fEscAttr(s.color||'#888') + '"></span>' +
      '<span class="cal-season-name">' + fEscHtml(s.name||'') + '</span>' +
      '<span class="cal-season-meta">' + mcount + (mcount===1?' month':' months') + (days ? ' · ' + days + ' days' : '') + '</span>' +
      '<button class="gls-card-del" style="margin-left:4px" onclick="fDeleteCalendarSeason(event,\'' + fEscAttr(s.id) + '\')">×</button>' +
    '</div>';
  }).join('');

  // Month cards. The year timeline and season strip above stay unfiltered
  // (they show the whole year by design); the facets narrow the cards only.
  var shownMonths = months.filter(function(m){
    var season = seasons.find(function(s){ return (s.monthIds||[]).includes(m.id); });
    if (flt.type && (!season || season.name !== flt.type)) return false;
    if (flt.tag && (m.tags||[]).indexOf(flt.tag) === -1) return false;
    return true;
  });

  var grid = document.getElementById('cal-months-grid');
  grid.innerHTML = shownMonths.map(function(m){
    var season = seasons.find(function(s){ return (s.monthIds||[]).includes(m.id); });
    var sColor = season ? season.color : '#555';
    var sName  = season ? season.name  : '';
    var hols   = (calData.holidays||[]).filter(function(h){ return h.monthId === m.id; });
    var days   = m.days || 0;
    // mini day-dot grid (max 42 dots)
    var dotHtml = '';
    if (days > 0 && days <= 42)
    {
      var holDays = {};
      hols.forEach(function(h){ if (h.day) holDays[h.day] = h; });
      var dotsArr = [];
      for (var d = 1; d <= days; d++)
        dotsArr.push('<span class="cal-day-dot' + (holDays[d] ? ' cal-day-hol-dot' : '') + '"' +
          (holDays[d] ? ' title="' + fEscAttr(holDays[d].name||'') + '"' : '') +
          ' style="' + (holDays[d] ? 'background:' + fEscAttr(sColor) + '' : '') + '"></span>');
      dotHtml = '<div class="cal-day-dots">' + dotsArr.join('') + '</div>';
    }
    var holHtml = hols.map(function(h){
      return '<div class="cal-month-hol"><span class="cal-hol-dot" style="background:' + fEscAttr(sColor) + '"></span>' + fEscHtml(h.name||'') + ' <span class="cal-hol-day">day ' + (h.day||'?') + '</span></div>';
    }).join('');
    return '<div class="cal-month-card" style="--season-color:' + fEscAttr(sColor) + '" onclick="fOpenCalendarMonthModal(\'' + fEscAttr(m.id) + '\')">' +
      '<div class="cal-month-header">' +
        '<span class="cal-month-name">' + fEscHtml(m.name||'') + '</span>' +
        '<span class="cal-month-days-badge">' + (m.days||'?') + '</span>' +
      '</div>' +
      (sName ? '<div class="cal-month-season-label">' + fEscHtml(sName) + '</div>' : '') +
      (m.description ? '<div class="cal-month-desc">' + fEscHtml(m.description) + '</div>' : '') +
      dotHtml +
      fTagChipsHtml(m.tags, 'fCalFilterByTag') +
      (holHtml ? '<div class="cal-month-hols">' + holHtml + '</div>' : '') +
      '<button class="gls-card-del cal-card-del" onclick="fDeleteCalendarMonth(event,\'' + fEscAttr(m.id) + '\')">×</button>' +
    '</div>';
  }).join('');
}

function fCalSeasonDays(season)
{
  var total = 0;
  (season.monthIds||[]).forEach(function(mid){
    var m = (calData.months||[]).find(function(x){ return x.id === mid; });
    if (m) total += m.days || 0;
  });
  return total;
}

var cHolTypeIcons = { festival:'🎉', observance:'🔔', memorial:'🕯', harvest:'🌾', solstice:'☀', other:'◆' };
var cHolTypeColors = { festival:'#e67e22', observance:'#3498db', memorial:'#9b59b6', harvest:'#2ecc71', solstice:'#f1c40f', other:'#9ca3af' };

function fRenderCalendarHolidays()
{
  var all = calData.holidays || [];
  var flt = calFilter.holidays;
  flt.type = fFillFacetSelect('cal-filter-type', all.map(function(h){ return h.type; }), flt.type, 'All types');
  flt.tag  = fFillFacetSelect('cal-filter-tag', fCollectItemTags(all), flt.tag, 'All tags');

  var holidays = all.filter(function(h){ return fItemMatchesFacets(h, flt.type, 'type', flt.tag); });
  document.getElementById('cal-holidays-empty').style.display = holidays.length ? 'none' : '';
  var sorted = holidays.slice().sort(function(a, b){
    var ai = (calData.months||[]).findIndex(function(m){ return m.id === a.monthId; });
    var bi = (calData.months||[]).findIndex(function(m){ return m.id === b.monthId; });
    return ai - bi || (a.day||0) - (b.day||0);
  });
  document.getElementById('cal-holidays-body').innerHTML = sorted.map(function(h){
    var month  = (calData.months||[]).find(function(m){ return m.id === h.monthId; });
    var season = month ? (calData.seasons||[]).find(function(s){ return (s.monthIds||[]).includes(month.id); }) : null;
    var sc     = season ? season.color : '#9ca3af';
    var tc     = cHolTypeColors[h.type] || '#9ca3af';
    return '<div class="cal-hol-card" onclick="fOpenCalendarHolidayModal(\'' + fEscAttr(h.id) + '\')">' +
      '<div class="cal-hol-marker" style="background:' + fEscAttr(sc) + '"></div>' +
      '<div class="cal-hol-body">' +
        '<div class="cal-hol-title">' +
          '<span class="cal-hol-name">' + fEscHtml(h.name||'') + '</span>' +
          '<span class="cal-hol-type-badge" style="background:' + tc + '22;color:' + tc + ';border-color:' + tc + '55">' + fEscHtml(h.type||'festival') + '</span>' +
        '</div>' +
        '<div class="cal-hol-when">' +
          (month ? fEscHtml(month.name) + ', day ' + (h.day||'?') : 'day ' + (h.day||'?')) +
        '</div>' +
        (h.description ? '<div class="cal-hol-desc">' + fEscHtml(h.description) + '</div>' : '') +
        fTagChipsHtml(h.tags, 'fCalFilterByTag') +
      '</div>' +
      '<button class="gls-card-del" onclick="fDeleteCalendarHoliday(event,\'' + fEscAttr(h.id) + '\')">×</button>' +
    '</div>';
  }).join('');
}

function fRenderCalendarConverter()
{
  var months = calData.months || [];
  var sel = document.getElementById('cal-conv-fm');
  if (sel) sel.innerHTML = months.map(function(m){ return '<option value="' + fEscAttr(m.id) + '">' + fEscHtml(m.name||'') + ' (' + (m.days||'?') + ' days)</option>'; }).join('');
}

function fConvertFictionToReal()
{
  var fyear = parseInt(document.getElementById('cal-conv-fy').value, 10);
  var fmid  = document.getElementById('cal-conv-fm').value;
  var fday  = parseInt(document.getElementById('cal-conv-fd').value, 10) || 1;
  var res   = document.getElementById('cal-conv-f2r');

  if (!calData.epochRealDate || !fyear) { res.textContent = 'Set epoch and enter a year.'; return; }

  var months = calData.months || [];
  var mIdx   = months.findIndex(function(m){ return m.id === fmid; });
  if (mIdx < 0 && months.length) mIdx = 0;

  var dayOfYear = 0;
  for (var i = 0; i < mIdx; i++) dayOfYear += months[i].days || 0;
  dayOfYear += fday - 1;

  var totalDays = (fyear - (calData.epochFictionYear || 1)) * (calData.daysPerYear || 365) + dayOfYear;
  var real = new Date(calData.epochRealDate);
  real.setDate(real.getDate() + totalDays);
  res.textContent = real.toDateString();
}

function fConvertRealToFiction()
{
  var rd  = document.getElementById('cal-conv-rd').value;
  var res = document.getElementById('cal-conv-r2f');
  if (!rd || !calData.epochRealDate) { res.textContent = 'Set epoch and enter a real date.'; return; }

  var diff = Math.round((new Date(rd) - new Date(calData.epochRealDate)) / 86400000);
  var dpy  = calData.daysPerYear || 365;
  var fyear = (calData.epochFictionYear || 1) + Math.floor(diff / dpy);
  var rem   = ((diff % dpy) + dpy) % dpy;

  var months = calData.months || [];
  var mName  = '(no months defined)';
  var day    = rem + 1;
  for (var i = 0; i < months.length; i++)
  {
    if (rem < (months[i].days||0)) { mName = months[i].name; day = rem + 1; break; }
    rem -= months[i].days || 0;
  }

  res.textContent = 'Year ' + fyear + ', ' + mName + ' day ' + day;
}

function fOpenCalendarAddModal()
{
  var seasonOpts = (calData.seasons||[]).map(function(s){
    return '<option value="' + fEscAttr(s.id) + '">' + fEscHtml(s.name||'Season') + '</option>';
  }).join('');

  var f =
    '<p style="font-size:12px;color:var(--text2);margin-bottom:10px">Add a month or a season</p>' +
    '<div style="display:flex;gap:10px;margin-bottom:12px">' +
      '<button class="btn-create" style="flex:1" onclick="fCloseDataModal();fOpenCalendarMonthModal(null)">+ Month</button>' +
      '<button class="btn-create" style="flex:1" onclick="fCloseDataModal();fOpenCalendarSeasonModal(null)">+ Season</button>' +
    '</div>';

  fOpenDataModal('Add to calendar', f, null);
  document.getElementById('dem-save-btn').style.display = 'none';
  document.getElementById('data-edit-modal').querySelector('.modal-actions .btn-cancel').textContent = 'Close';
}

function fOpenCalendarMonthModal(id)
{
  document.getElementById('dem-save-btn').style.display = '';
  document.getElementById('data-edit-modal').querySelector('.modal-actions .btn-cancel').textContent = 'Cancel';
  var m = id ? (calData.months||[]).find(function(x){ return x.id === id; }) : null;
  var seasonOpts = (calData.seasons||[]).map(function(s){
    var selMonth = m && (s.monthIds||[]).includes(m.id);
    return '<option value="' + fEscAttr(s.id) + '"' + (selMonth?' selected':'') + '>' + fEscHtml(s.name||'') + '</option>';
  }).join('');

  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Month name<input class="modal-input" id="cmf-name" value="' + fEscAttr((m||{}).name||'') + '" placeholder="e.g. Frostmoon"></label>' +
      '<label class="field-label">Days<input class="modal-input" id="cmf-days" type="number" min="1" value="' + ((m||{}).days||30) + '"></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Season<select class="modal-input tb-select" id="cmf-season"><option value="">— None —</option>' + seasonOpts + '</select></label>' +
    '<label class="field-label" style="margin-top:8px">Description<input class="modal-input" id="cmf-desc" value="' + fEscAttr((m||{}).description||'') + '" placeholder="Brief description…"></label>' +
    fTagsField('cmf-tags', (m||{}).tags);

  fOpenDataModal(id ? 'Edit month' : 'Add month', f, function()
  {
    var name     = document.getElementById('cmf-name').value.trim();
    var days     = parseInt(document.getElementById('cmf-days').value,10) || 30;
    var seasonId = document.getElementById('cmf-season').value;
    var desc     = document.getElementById('cmf-desc').value.trim();
    if (!name) return;

    var mid = id || fGenId();
    var month = { id: mid, name: name, days: days, description: desc, tags: fParseTagsInput(document.getElementById('cmf-tags').value) };

    if (id)
      calData.months = calData.months.map(function(x){ return x.id === id ? month : x; });
    else
      calData.months.push(month);

    // Update season membership
    calData.seasons.forEach(function(s){
      s.monthIds = (s.monthIds||[]).filter(function(x){ return x !== mid; });
      if (seasonId && s.id === seasonId) s.monthIds.push(mid);
    });

    fCloseDataModal();
    fSaveCalendarData();
    fRenderCalendarMonths();
  });
}

function fOpenCalendarSeasonModal(id)
{
  document.getElementById('dem-save-btn').style.display = '';
  document.getElementById('data-edit-modal').querySelector('.modal-actions .btn-cancel').textContent = 'Cancel';
  var s = id ? (calData.seasons||[]).find(function(x){ return x.id === id; }) : null;
  var monthOpts = (calData.months||[]).map(function(m){
    var checked = s && (s.monthIds||[]).includes(m.id) ? ' checked' : '';
    return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">' +
      '<input type="checkbox" value="' + fEscAttr(m.id) + '"' + checked + '> ' + fEscHtml(m.name||'') +
    '</label>';
  }).join('');

  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Season name<input class="modal-input" id="csf-name" value="' + fEscAttr((s||{}).name||'') + '" placeholder="e.g. Winter"></label>' +
      '<label class="field-label">Color<input class="modal-input" id="csf-color" type="color" value="' + fEscAttr((s||{}).color||'#4a9fc8') + '"></label>' +
    '</div>' +
    (monthOpts ? '<div class="field-label" style="margin-top:8px">Months in this season<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">' + monthOpts + '</div></div>' : '');

  fOpenDataModal(id ? 'Edit season' : 'Add season', f, function()
  {
    var name  = document.getElementById('csf-name').value.trim();
    var color = document.getElementById('csf-color').value;
    if (!name) return;

    var monthIds = [];
    document.querySelectorAll('#dem-fields input[type=checkbox]:checked').forEach(function(cb){ monthIds.push(cb.value); });

    var season = { id: id || fGenId(), name: name, color: color, monthIds: monthIds };
    if (id)
      calData.seasons = calData.seasons.map(function(x){ return x.id === id ? season : x; });
    else
      calData.seasons.push(season);

    fCloseDataModal();
    fSaveCalendarData();
    fRenderCalendarMonths();
  });
}

function fOpenCalendarHolidayModal(id)
{
  document.getElementById('dem-save-btn').style.display = '';
  document.getElementById('data-edit-modal').querySelector('.modal-actions .btn-cancel').textContent = 'Cancel';
  var h = id ? (calData.holidays||[]).find(function(x){ return x.id === id; }) : null;
  var monthOpts = (calData.months||[]).map(function(m){
    return '<option value="' + fEscAttr(m.id) + '"' + ((h&&h.monthId===m.id)?' selected':'') + '>' + fEscHtml(m.name||'') + '</option>';
  }).join('');

  var typeOpts = ['festival','observance','memorial','harvest','solstice','other'].map(function(t){
    return '<option value="' + t + '"' + ((h&&h.type===t)?' selected':'') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
  }).join('');

  var f =
    '<label class="field-label">Name<input class="modal-input" id="chf-name" value="' + fEscAttr((h||{}).name||'') + '" placeholder="Holiday name…"></label>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Month<select class="modal-input tb-select" id="chf-month"><option value="">— select —</option>' + monthOpts + '</select></label>' +
      '<label class="field-label">Day<input class="modal-input" id="chf-day" type="number" min="1" value="' + ((h||{}).day||1) + '"></label>' +
      '<label class="field-label">Type<select class="modal-input tb-select" id="chf-type">' + typeOpts + '</select></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Description<textarea class="modal-input" id="chf-desc" rows="2">' + fEscHtml((h||{}).description||'') + '</textarea></label>' +
    fTagsField('chf-tags', (h||{}).tags);

  fOpenDataModal(id ? 'Edit holiday' : 'Add holiday', f, function()
  {
    var name = document.getElementById('chf-name').value.trim();
    if (!name) return;
    var holiday = {
      id:          id || fGenId(),
      name:        name,
      monthId:     document.getElementById('chf-month').value,
      day:         parseInt(document.getElementById('chf-day').value, 10) || 1,
      type:        document.getElementById('chf-type').value,
      description: document.getElementById('chf-desc').value.trim(),
      tags:        fParseTagsInput(document.getElementById('chf-tags').value)
    };
    if (id)
      calData.holidays = calData.holidays.map(function(x){ return x.id === id ? holiday : x; });
    else
      calData.holidays.push(holiday);
    fCloseDataModal();
    fSaveCalendarData();
    fRenderCalendarHolidays();
  });
}

function fDeleteCalendarSeason(e, id)
{
  e.stopPropagation();
  calData.seasons = (calData.seasons||[]).filter(function(x){ return x.id !== id; });
  fSaveCalendarData(); fRenderCalendarMonths();
}

function fDeleteCalendarMonth(e, id)
{
  e.stopPropagation();
  calData.months = (calData.months||[]).filter(function(x){ return x.id !== id; });
  calData.seasons.forEach(function(s){ s.monthIds = (s.monthIds||[]).filter(function(x){ return x !== id; }); });
  fSaveCalendarData(); fRenderCalendarMonths();
}

function fDeleteCalendarHoliday(e, id)
{
  e.stopPropagation();
  calData.holidays = (calData.holidays||[]).filter(function(x){ return x.id !== id; });
  fSaveCalendarData(); fRenderCalendarHolidays();
}
