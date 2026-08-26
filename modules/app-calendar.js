// Calendar
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── CALENDAR ──

var calData = null;
var calTab  = 'months';
var calFilter = { months: { type: '', tag: '' }, holidays: { type: '', tag: '' } };

function loadCalendarFile(file)
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
  switchCalendarTab('months');
  renderCalendar();
}

function saveCalendarData()
{
  if (!currentFileId || !files[currentFileId] || files[currentFileId].type !== 'calendar') return;
  calData.name = document.getElementById('calendar-title-input').value.trim() || calData.name || 'Calendar';
  var ft = document.getElementById('cal-file-tags');
  if (ft) calData.tags = parseTagsInput(ft.value);
  files[currentFileId].name     = calData.name;
  files[currentFileId].content  = JSON.stringify(calData, null, 2);
  files[currentFileId].fileTags = calData.tags || [];
  files[currentFileId].modified = Date.now();
  scheduleSave();
  renderFileList();
}

function onCalendarTitleChange() { saveCalendarData(); }
function onCalendarFileTagsChange() { saveCalendarData(); }
function onCalFilterType(v) { calFilter[calTab === 'holidays' ? 'holidays' : 'months'].type = v; renderCalendar(); }
function onCalFilterTag(v)  { calFilter[calTab === 'holidays' ? 'holidays' : 'months'].tag  = v; renderCalendar(); }
function calFilterByTag(t)  { calFilter[calTab === 'holidays' ? 'holidays' : 'months'].tag  = t; renderCalendar(); }
function onCalDaysChange(v)  { calData.daysPerYear = parseInt(v,10)||365; saveCalendarData(); }
function onCalEpochChange()  { calData.epochRealDate = document.getElementById('cal-epoch-real').value; saveCalendarData(); }

function switchCalendarTab(tab)
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
  renderCalendar();
}

function calAddCurrent()
{
  if (calTab === 'months')   { openCalendarAddModal(); }
  else if (calTab === 'holidays') { openCalendarHolidayModal(null); }
}

function renderCalendar()
{
  if (calTab === 'months')        renderCalendarMonths();
  else if (calTab === 'holidays') renderCalendarHolidays();
  else if (calTab === 'convert')  renderCalendarConverter();
}

function renderCalendarMonths()
{
  var seasons  = calData.seasons  || [];
  var months   = calData.months   || [];
  var hasData  = seasons.length + months.length > 0;
  document.getElementById('cal-months-empty').style.display = hasData ? 'none' : '';

  var flt = calFilter.months;
  flt.type = fillFacetSelect('cal-filter-type', seasons.map(function(s){ return s.name; }), flt.type, 'All seasons');
  flt.tag  = fillFacetSelect('cal-filter-tag', collectItemTags(months), flt.tag, 'All tags');

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
          var pct    = ((m.days||0) / totalDays * 100).toFixed(2);
          var hols   = (calData.holidays||[]).filter(function(h){ return h.monthId === m.id; });
          var dots   = hols.map(function(h){ return '<span class="cal-tl-hol" title="' + escAttr(h.name||'') + '" style="left:' + ((h.day||1)/(m.days||30)*100).toFixed(1) + '%"></span>'; }).join('');
          return '<div class="cal-tl-seg" style="width:' + pct + '%;background:' + escAttr(color) + '" title="' + escAttr(m.name||'') + ' · ' + (m.days||0) + ' days" onclick="openCalendarMonthModal(\'' + escAttr(m.id) + '\')">' +
            '<span class="cal-tl-name">' + escHtml(m.name||'') + '</span>' +
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
    var days = calSeasonDays(s);
    var mcount = (s.monthIds||[]).length;
    return '<div class="cal-season-chip" style="--season-color:' + escAttr(s.color||'#888') + '" onclick="openCalendarSeasonModal(\'' + escAttr(s.id) + '\')">' +
      '<span class="cal-season-dot" style="background:' + escAttr(s.color||'#888') + '"></span>' +
      '<span class="cal-season-name">' + escHtml(s.name||'') + '</span>' +
      '<span class="cal-season-meta">' + mcount + (mcount===1?' month':' months') + (days ? ' · ' + days + ' days' : '') + '</span>' +
      '<button class="gls-card-del" style="margin-left:4px" onclick="deleteCalendarSeason(event,\'' + escAttr(s.id) + '\')">×</button>' +
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
          (holDays[d] ? ' title="' + escAttr(holDays[d].name||'') + '"' : '') +
          ' style="' + (holDays[d] ? 'background:' + escAttr(sColor) + '' : '') + '"></span>');
      dotHtml = '<div class="cal-day-dots">' + dotsArr.join('') + '</div>';
    }
    var holHtml = hols.map(function(h){
      return '<div class="cal-month-hol"><span class="cal-hol-dot" style="background:' + escAttr(sColor) + '"></span>' + escHtml(h.name||'') + ' <span class="cal-hol-day">day ' + (h.day||'?') + '</span></div>';
    }).join('');
    return '<div class="cal-month-card" style="--season-color:' + escAttr(sColor) + '" onclick="openCalendarMonthModal(\'' + escAttr(m.id) + '\')">' +
      '<div class="cal-month-header">' +
        '<span class="cal-month-name">' + escHtml(m.name||'') + '</span>' +
        '<span class="cal-month-days-badge">' + (m.days||'?') + '</span>' +
      '</div>' +
      (sName ? '<div class="cal-month-season-label">' + escHtml(sName) + '</div>' : '') +
      (m.description ? '<div class="cal-month-desc">' + escHtml(m.description) + '</div>' : '') +
      dotHtml +
      tagChipsHtml(m.tags, 'calFilterByTag') +
      (holHtml ? '<div class="cal-month-hols">' + holHtml + '</div>' : '') +
      '<button class="gls-card-del cal-card-del" onclick="deleteCalendarMonth(event,\'' + escAttr(m.id) + '\')">×</button>' +
    '</div>';
  }).join('');
}

function calSeasonDays(season)
{
  var total = 0;
  (season.monthIds||[]).forEach(function(mid){
    var m = (calData.months||[]).find(function(x){ return x.id === mid; });
    if (m) total += m.days || 0;
  });
  return total;
}

var HOL_TYPE_ICONS = { festival:'🎉', observance:'🔔', memorial:'🕯', harvest:'🌾', solstice:'☀', other:'◆' };
var HOL_TYPE_COLORS = { festival:'#e67e22', observance:'#3498db', memorial:'#9b59b6', harvest:'#2ecc71', solstice:'#f1c40f', other:'#9ca3af' };

function renderCalendarHolidays()
{
  var all = calData.holidays || [];
  var flt = calFilter.holidays;
  flt.type = fillFacetSelect('cal-filter-type', all.map(function(h){ return h.type; }), flt.type, 'All types');
  flt.tag  = fillFacetSelect('cal-filter-tag', collectItemTags(all), flt.tag, 'All tags');

  var holidays = all.filter(function(h){ return itemMatchesFacets(h, flt.type, 'type', flt.tag); });
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
    var tc     = HOL_TYPE_COLORS[h.type] || '#9ca3af';
    return '<div class="cal-hol-card" onclick="openCalendarHolidayModal(\'' + escAttr(h.id) + '\')">' +
      '<div class="cal-hol-marker" style="background:' + escAttr(sc) + '"></div>' +
      '<div class="cal-hol-body">' +
        '<div class="cal-hol-title">' +
          '<span class="cal-hol-name">' + escHtml(h.name||'') + '</span>' +
          '<span class="cal-hol-type-badge" style="background:' + tc + '22;color:' + tc + ';border-color:' + tc + '55">' + escHtml(h.type||'festival') + '</span>' +
        '</div>' +
        '<div class="cal-hol-when">' +
          (month ? escHtml(month.name) + ', day ' + (h.day||'?') : 'day ' + (h.day||'?')) +
        '</div>' +
        (h.description ? '<div class="cal-hol-desc">' + escHtml(h.description) + '</div>' : '') +
        tagChipsHtml(h.tags, 'calFilterByTag') +
      '</div>' +
      '<button class="gls-card-del" onclick="deleteCalendarHoliday(event,\'' + escAttr(h.id) + '\')">×</button>' +
    '</div>';
  }).join('');
}

function renderCalendarConverter()
{
  var months = calData.months || [];
  var sel = document.getElementById('cal-conv-fm');
  if (sel) sel.innerHTML = months.map(function(m){ return '<option value="' + escAttr(m.id) + '">' + escHtml(m.name||'') + ' (' + (m.days||'?') + ' days)</option>'; }).join('');
}

function convertFictionToReal()
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

function convertRealToFiction()
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

function openCalendarAddModal()
{
  var seasonOpts = (calData.seasons||[]).map(function(s){
    return '<option value="' + escAttr(s.id) + '">' + escHtml(s.name||'Season') + '</option>';
  }).join('');

  var f =
    '<p style="font-size:12px;color:var(--text2);margin-bottom:10px">Add a month or a season</p>' +
    '<div style="display:flex;gap:10px;margin-bottom:12px">' +
      '<button class="btn-create" style="flex:1" onclick="closeDataModal();openCalendarMonthModal(null)">+ Month</button>' +
      '<button class="btn-create" style="flex:1" onclick="closeDataModal();openCalendarSeasonModal(null)">+ Season</button>' +
    '</div>';

  openDataModal('Add to calendar', f, null);
  document.getElementById('dem-save-btn').style.display = 'none';
  document.getElementById('data-edit-modal').querySelector('.modal-actions .btn-cancel').textContent = 'Close';
}

function openCalendarMonthModal(id)
{
  document.getElementById('dem-save-btn').style.display = '';
  document.getElementById('data-edit-modal').querySelector('.modal-actions .btn-cancel').textContent = 'Cancel';
  var m = id ? (calData.months||[]).find(function(x){ return x.id === id; }) : null;
  var seasonOpts = (calData.seasons||[]).map(function(s){
    var selMonth = m && (s.monthIds||[]).includes(m.id);
    return '<option value="' + escAttr(s.id) + '"' + (selMonth?' selected':'') + '>' + escHtml(s.name||'') + '</option>';
  }).join('');

  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Month name<input class="modal-input" id="cmf-name" value="' + escAttr((m||{}).name||'') + '" placeholder="e.g. Frostmoon"></label>' +
      '<label class="field-label">Days<input class="modal-input" id="cmf-days" type="number" min="1" value="' + ((m||{}).days||30) + '"></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Season<select class="modal-input tb-select" id="cmf-season"><option value="">— None —</option>' + seasonOpts + '</select></label>' +
    '<label class="field-label" style="margin-top:8px">Description<input class="modal-input" id="cmf-desc" value="' + escAttr((m||{}).description||'') + '" placeholder="Brief description…"></label>' +
    tagsField('cmf-tags', (m||{}).tags);

  openDataModal(id ? 'Edit month' : 'Add month', f, function()
  {
    var name     = document.getElementById('cmf-name').value.trim();
    var days     = parseInt(document.getElementById('cmf-days').value,10) || 30;
    var seasonId = document.getElementById('cmf-season').value;
    var desc     = document.getElementById('cmf-desc').value.trim();
    if (!name) return;

    var mid = id || genId();
    var month = { id: mid, name: name, days: days, description: desc, tags: parseTagsInput(document.getElementById('cmf-tags').value) };

    if (id)
      calData.months = calData.months.map(function(x){ return x.id === id ? month : x; });
    else
      calData.months.push(month);

    // Update season membership
    calData.seasons.forEach(function(s){
      s.monthIds = (s.monthIds||[]).filter(function(x){ return x !== mid; });
      if (seasonId && s.id === seasonId) s.monthIds.push(mid);
    });

    closeDataModal();
    saveCalendarData();
    renderCalendarMonths();
  });
}

function openCalendarSeasonModal(id)
{
  document.getElementById('dem-save-btn').style.display = '';
  document.getElementById('data-edit-modal').querySelector('.modal-actions .btn-cancel').textContent = 'Cancel';
  var s = id ? (calData.seasons||[]).find(function(x){ return x.id === id; }) : null;
  var monthOpts = (calData.months||[]).map(function(m){
    var checked = s && (s.monthIds||[]).includes(m.id) ? ' checked' : '';
    return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">' +
      '<input type="checkbox" value="' + escAttr(m.id) + '"' + checked + '> ' + escHtml(m.name||'') +
    '</label>';
  }).join('');

  var f =
    '<div class="dem-grid">' +
      '<label class="field-label">Season name<input class="modal-input" id="csf-name" value="' + escAttr((s||{}).name||'') + '" placeholder="e.g. Winter"></label>' +
      '<label class="field-label">Color<input class="modal-input" id="csf-color" type="color" value="' + escAttr((s||{}).color||'#4a9fc8') + '"></label>' +
    '</div>' +
    (monthOpts ? '<div class="field-label" style="margin-top:8px">Months in this season<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">' + monthOpts + '</div></div>' : '');

  openDataModal(id ? 'Edit season' : 'Add season', f, function()
  {
    var name  = document.getElementById('csf-name').value.trim();
    var color = document.getElementById('csf-color').value;
    if (!name) return;

    var monthIds = [];
    document.querySelectorAll('#dem-fields input[type=checkbox]:checked').forEach(function(cb){ monthIds.push(cb.value); });

    var season = { id: id || genId(), name: name, color: color, monthIds: monthIds };
    if (id)
      calData.seasons = calData.seasons.map(function(x){ return x.id === id ? season : x; });
    else
      calData.seasons.push(season);

    closeDataModal();
    saveCalendarData();
    renderCalendarMonths();
  });
}

function openCalendarHolidayModal(id)
{
  document.getElementById('dem-save-btn').style.display = '';
  document.getElementById('data-edit-modal').querySelector('.modal-actions .btn-cancel').textContent = 'Cancel';
  var h = id ? (calData.holidays||[]).find(function(x){ return x.id === id; }) : null;
  var monthOpts = (calData.months||[]).map(function(m){
    return '<option value="' + escAttr(m.id) + '"' + ((h&&h.monthId===m.id)?' selected':'') + '>' + escHtml(m.name||'') + '</option>';
  }).join('');

  var typeOpts = ['festival','observance','memorial','harvest','solstice','other'].map(function(t){
    return '<option value="' + t + '"' + ((h&&h.type===t)?' selected':'') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
  }).join('');

  var f =
    '<label class="field-label">Name<input class="modal-input" id="chf-name" value="' + escAttr((h||{}).name||'') + '" placeholder="Holiday name…"></label>' +
    '<div class="dem-grid" style="margin-top:8px">' +
      '<label class="field-label">Month<select class="modal-input tb-select" id="chf-month"><option value="">— select —</option>' + monthOpts + '</select></label>' +
      '<label class="field-label">Day<input class="modal-input" id="chf-day" type="number" min="1" value="' + ((h||{}).day||1) + '"></label>' +
      '<label class="field-label">Type<select class="modal-input tb-select" id="chf-type">' + typeOpts + '</select></label>' +
    '</div>' +
    '<label class="field-label" style="margin-top:8px">Description<textarea class="modal-input" id="chf-desc" rows="2">' + escHtml((h||{}).description||'') + '</textarea></label>' +
    tagsField('chf-tags', (h||{}).tags);

  openDataModal(id ? 'Edit holiday' : 'Add holiday', f, function()
  {
    var name = document.getElementById('chf-name').value.trim();
    if (!name) return;
    var holiday = {
      id:          id || genId(),
      name:        name,
      monthId:     document.getElementById('chf-month').value,
      day:         parseInt(document.getElementById('chf-day').value, 10) || 1,
      type:        document.getElementById('chf-type').value,
      description: document.getElementById('chf-desc').value.trim(),
      tags:        parseTagsInput(document.getElementById('chf-tags').value)
    };
    if (id)
      calData.holidays = calData.holidays.map(function(x){ return x.id === id ? holiday : x; });
    else
      calData.holidays.push(holiday);
    closeDataModal();
    saveCalendarData();
    renderCalendarHolidays();
  });
}

function deleteCalendarSeason(e, id)
{
  e.stopPropagation();
  calData.seasons = (calData.seasons||[]).filter(function(x){ return x.id !== id; });
  saveCalendarData(); renderCalendarMonths();
}

function deleteCalendarMonth(e, id)
{
  e.stopPropagation();
  calData.months = (calData.months||[]).filter(function(x){ return x.id !== id; });
  calData.seasons.forEach(function(s){ s.monthIds = (s.monthIds||[]).filter(function(x){ return x !== id; }); });
  saveCalendarData(); renderCalendarMonths();
}

function deleteCalendarHoliday(e, id)
{
  e.stopPropagation();
  calData.holidays = (calData.holidays||[]).filter(function(x){ return x.id !== id; });
  saveCalendarData(); renderCalendarHolidays();
}
