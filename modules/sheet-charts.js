// Spreadsheet: charts
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── SHEET CHARTS (Chart.js) ──

var CHART_COLORS = ['#d4a843', '#4a7fa8', '#5a9a6e', '#c0574a', '#9d6fd1', '#d18b3f', '#3fa7b0'];

function configureChartJs()
{
  if (typeof Chart === 'undefined')
    return;

  Chart.register
  (
    Chart.BarController, Chart.LineController, Chart.PieController, Chart.DoughnutController,
    Chart.RadarController, Chart.ScatterController,
    Chart.BarElement, Chart.LineElement, Chart.PointElement, Chart.ArcElement,
    Chart.CategoryScale, Chart.LinearScale, Chart.RadialLinearScale,
    Chart.Legend, Chart.Title, Chart.Tooltip, Chart.Filler
  );
}

configureChartJs();

function parseChartRange(range)
{
  var parts = (range || '').split(':');

  if (parts.length !== 2)
    return null;

  var pa = parseName(parts[0].trim()),
      pb = parseName(parts[1].trim());

  if (!pa || !pb)
    return null;

  return  {
            colStart: Math.min(colIndex(pa.col), colIndex(pb.col)),
            colEnd: Math.max(colIndex(pa.col), colIndex(pb.col)),
            rowStart: Math.min(pa.row, pb.row),
            rowEnd: Math.max(pa.row, pb.row)
          };
}

function getChartRangeGrid(range)
{
  var dims = parseChartRange(range);

  if (!dims)
    return null;

  var grid = [];

  for (var r = dims.rowStart; r <= dims.rowEnd; r++)
  {
    var row = [];

    for (var c = dims.colStart; c <= dims.colEnd; c++)
      row.push(getDisplayValue(colName(c) + r));

    grid.push(row);
  }

  return grid;
}

// Standard Excel/Sheets table orientation: row 1 -> category labels,
// column 1 -> series names, the rest -> the data matrix.
// Categories from row 1 (across columns), series from column 1 (down rows) -
// the right shape for a "Quarter columns x Product rows" comparison table.
function categoricalByRowSeries(grid, firstRow, firstCol)
{
  var rowStart = firstRow ? 1 : 0,
      colStart = firstCol ? 1 : 0,
      labels = [],
      datasets = [],
      c, r;

  for (c = colStart; c < grid[0].length; c++)
    labels.push(firstRow ? grid[0][c] : ('Col ' + (c + 1)));

  for (r = rowStart; r < grid.length; r++)
  {
    var values = [];

    for (c = colStart; c < grid[r].length; c++)
      values.push(parseFloat(grid[r][c]) || 0);

    datasets.push({ label: firstCol ? grid[r][0] : ('Series ' + (r + 1 - rowStart)), data: values });
  }

  return { labels: labels, datasets: datasets };
}

// Categories from column 1 (down rows), series from row 1 (across columns) -
// the right shape for a simple "Month rows x Revenue column(s)" list, which
// is the more common case for small everyday tables.
function categoricalByColumnSeries(grid, firstRow, firstCol)
{
  var rowStart = firstRow ? 1 : 0,
      colStart = firstCol ? 1 : 0,
      labels = [],
      datasets = [],
      c, r;

  for (r = rowStart; r < grid.length; r++)
    labels.push(firstCol ? grid[r][0] : ('Row ' + (r + 1)));

  for (c = colStart; c < grid[0].length; c++)
  {
    var values = [];

    for (r = rowStart; r < grid.length; r++)
      values.push(parseFloat(grid[r][c]) || 0);

    datasets.push({ label: firstRow ? grid[0][c] : ('Series ' + (c + 1 - colStart)), data: values });
  }

  return { labels: labels, datasets: datasets };
}

// The effective orientation of a chart: an explicit choice wins; 'auto'
// matches Excel/Sheets' default — a range with more data rows than data
// columns (e.g. a simple Month/Revenue list) charts each COLUMN as a series,
// otherwise (e.g. a wide Quarter-by-Product table) each ROW is a series.
function chartEffectiveOrientation(chartDef, grid)
{
  if (chartDef.orientation === 'rows' || chartDef.orientation === 'cols')
    return chartDef.orientation;

  var dataRowCount = grid.length - (chartDef.firstRowLabels ? 1 : 0),
      dataColCount = grid[0].length - (chartDef.firstColSeries ? 1 : 0);

  return (dataRowCount > dataColCount) ? 'cols' : 'rows';
}

function buildCategoricalChartData(chartDef, grid)
{
  if (!grid.length || !grid[0].length)
    return { labels: [], datasets: [] };

  var firstRow = chartDef.firstRowLabels,
      firstCol = chartDef.firstColSeries;

  // 'rows': each row is a series (legend from the first column, axis labels
  // from the first row). 'cols': each column is a series (legend from the
  // first row, axis labels from the first column).
  return  chartEffectiveOrientation(chartDef, grid) === 'cols'
          ?
            categoricalByColumnSeries(grid, firstRow, firstCol)
          :
            categoricalByRowSeries(grid, firstRow, firstCol);
}

// Scatter wants {x,y} pairs rather than labels+parallel arrays: column 1 is
// the shared X axis, every other column is its own series plotted against it.
function buildScatterChartData(chartDef, grid)
{
  var firstRow = chartDef.firstRowLabels,
      rowStart = firstRow ? 1 : 0,
      datasets = [];

  if (!grid.length || grid[0].length < 2)
    return { labels: [], datasets: [] };

  for (var c = 1; c < grid[0].length; c++)
  {
    var points = [];

    for (var r = rowStart; r < grid.length; r++)
    {
      var x = parseFloat(grid[r][0]),
          y = parseFloat(grid[r][c]);

      if (!isNaN(x) && !isNaN(y))
        points.push({ x: x, y: y });
    }

    datasets.push({ label: firstRow ? grid[0][c] : ('Series ' + c), data: points });
  }

  return { labels: [], datasets: datasets };
}

function buildChartData(chartDef)
{
  var grid = getChartRangeGrid(chartDef.range);

  if (!grid || !grid.length)
    return { labels: [], datasets: [] };

  if (chartDef.type === 'scatter')
    return buildScatterChartData(chartDef, grid);

  var data = buildCategoricalChartData(chartDef, grid);

  // Pie/doughnut are single-series chart types - if the range has more than
  // one data row, only the first is used rather than silently merging them.
  if (chartDef.type === 'pie' || chartDef.type === 'doughnut')
    data.datasets = data.datasets.slice(0, 1);

  if (chartDef.type === 'percent')
    data = percentStackDatasets(data, chartDef);

  return data;
}

// % Stacked: absolute values render as segments of 100%-stacked columns,
// colored per series — a pie/doughnut reading, but as bars. A range with a
// SINGLE data series pivots into one bar whose segments are the categories
// (each category becomes its own colored, legended dataset), the closest
// bar-shaped equivalent of a pie chart; multi-series ranges normalize each
// category's stack. chartDef.percentTotal, when given, replaces the per-bar
// sum as the 100% denominator, so bars may then top out below 100%.
function percentStackDatasets(data, chartDef)
{
  if (!data.datasets.length)
    return data;

  function pct(v, total)
  {
    return total ? Math.round(((parseFloat(v) || 0) / total) * 1000) / 10 : 0;
  }

  if (data.datasets.length === 1)
  {
    var ds = data.datasets[0],
        total = chartDef.percentTotal ||
                ds.data.reduce(function(a, b){ return a + (parseFloat(b) || 0); }, 0);

    return {
      labels: [ds.label || 'Total'],
      datasets: data.labels.map(function(lab, i)
      {
        return { label: String(lab), data: [pct(ds.data[i], total)] };
      })
    };
  }

  var categoryTotals = data.labels.map(function(_, j)
  {
    return chartDef.percentTotal ||
           data.datasets.reduce(function(a, ds){ return a + (parseFloat(ds.data[j]) || 0); }, 0);
  });

  return {
    labels: data.labels,
    datasets: data.datasets.map(function(ds)
    {
      return {
        label: ds.label,
        data: ds.data.map(function(v, j){ return pct(v, categoryTotals[j]); })
      };
    })
  };
}

function buildChartScales(chartDef)
{
  var gridColor = 'rgba(255,255,255,0.08)',
      tickColor = '#9e9b94';

  if (chartDef.type === 'radar')
  {
    return { r: { angleLines: { color: gridColor }, grid: { color: gridColor }, pointLabels: { color: tickColor }, ticks: { color: tickColor, backdropColor: 'transparent' } } };
  }

  if (chartDef.type === 'scatter')
  {
    return  {
              x: { type: 'linear', position: 'bottom', grid: { color: gridColor }, ticks: { color: tickColor } },
              y: { grid: { color: gridColor }, ticks: { color: tickColor } }
            };
  }

  if (chartDef.type === 'percent')
  {
    return  {
              x: { grid: { color: gridColor }, ticks: { color: tickColor }, stacked: true },
              y: { beginAtZero: true, grid: { color: gridColor },
                   ticks: { color: tickColor, callback: function(v){ return v + '%'; } }, stacked: true }
            };
  }

  return  {
            x: { grid: { color: gridColor }, ticks: { color: tickColor } },
            y: { grid: { color: gridColor }, ticks: { color: tickColor } }
          };
}

function buildChartJsConfig(chartDef)
{
  var data = buildChartData(chartDef),
      isPie = (chartDef.type === 'pie' || chartDef.type === 'doughnut'),
      baseType = (chartDef.type === 'combo' || chartDef.type === 'percent') ? 'bar' : chartDef.type;

  var datasets = data.datasets.map(function(ds, i)
  {
    var color = CHART_COLORS[i % CHART_COLORS.length],
        styled =
        {
          label: ds.label,
          data: ds.data,
          backgroundColor: isPie ? ds.data.map(function(_, j){ return CHART_COLORS[j % CHART_COLORS.length]; }) : color,
          borderColor: color,
          borderWidth: (chartDef.type === 'line' || chartDef.type === 'radar') ? 2 : 1
        };

    if (chartDef.type === 'combo')
      styled.type = (i === 0) ? 'bar' : 'line';

    if (chartDef.type === 'line' || chartDef.type === 'radar' || (chartDef.type === 'combo' && i > 0))
    {
      styled.fill = false;
      styled.tension = 0.25;
    }

    return styled;
  });

  return  {
            type: baseType,
            data: { labels: data.labels, datasets: datasets },
            options:
            {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              plugins:
              {
                title: { display: !!chartDef.title, text: chartDef.title, color: '#f0ede6' },
                legend: { display: datasets.length > 1 || isPie, labels: { color: '#9e9b94' } },
                tooltip: (chartDef.type === 'percent')
                  ? { callbacks: { label: function(ctx){ return (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + ctx.parsed.y + '%'; } } }
                  : {}
              },
              scales: isPie ? {} : buildChartScales(chartDef)
            }
          };
}

function renderSheetCharts()
{
  var layer = document.getElementById('sheet-charts-layer');

  if (!layer)
    return;

  Object.values(sheetChartInstances).forEach(function(chart){ chart.destroy(); });
  sheetChartInstances = {};
  layer.innerHTML = '';

  // Only the active tab's charts render; switching tabs re-runs this.
  var activePage = sheetPages[sheetPageIdx].name;

  sheetCharts.forEach(function(chartDef)
  {
    if (chartDef.page && chartDef.page !== activePage)
      return;
    var box = document.createElement('div');
    box.className = 'sheet-chart-box';
    box.dataset.chartId = chartDef.id;
    box.style.left = chartDef.x + 'px';
    box.style.top = chartDef.y + 'px';
    box.style.width = chartDef.width + 'px';
    box.style.height = chartDef.height + 'px';

    var swapBtn = chartDef.type === 'scatter' ? '' :
        '<span class="sheet-chart-del" title="Swap legend and axis (rows ↔ columns)" onmousedown="event.stopPropagation()" onclick="toggleChartOrientation(event,\'' + escAttr(chartDef.id) + '\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17,3 21,7 17,11"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7,13 3,17 7,21"/><line x1="3" y1="17" x2="15" y2="17"/></svg>' +
        '</span>';

    box.innerHTML =
      '<div class="sheet-chart-header" onmousedown="chartBoxMouseDown(event,\'' + escAttr(chartDef.id) + '\')">' +
        '<span class="sheet-chart-title">' + escHtml(chartDef.title || 'Chart') + '</span>' +
        swapBtn +
        '<span class="sheet-chart-del" onmousedown="event.stopPropagation()" onclick="deleteChart(event,\'' + escAttr(chartDef.id) + '\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</span>' +
      '</div>' +
      '<div class="sheet-chart-canvas-wrap"><canvas></canvas></div>' +
      '<div class="sheet-chart-resize-handle" onmousedown="chartResizeMouseDown(event,\'' + escAttr(chartDef.id) + '\')"></div>';

    layer.appendChild(box);

    if (typeof Chart === 'undefined')
      return;

    var canvas = box.querySelector('canvas');
    sheetChartInstances[chartDef.id] = new Chart(canvas.getContext('2d'), buildChartJsConfig(chartDef));
  });
}

function refreshSheetCharts()
{
  sheetCharts.forEach(function(chartDef)
  {
    var chart = sheetChartInstances[chartDef.id];

    if (!chart)
      return;

    var data = buildChartData(chartDef);

    chart.data.labels = data.labels;

    data.datasets.forEach(function(ds, i)
    {
      if (chart.data.datasets[i])
      {
        chart.data.datasets[i].data = ds.data;
        chart.data.datasets[i].label = ds.label;
      }
    });

    chart.update();
  });
}

function openChartModal()
{
  newChartType = 'bar';

  document.querySelectorAll('#chart-modal .type-card').forEach(function(card)
  {
    card.classList.toggle('selected', card.dataset.type === 'bar');
  });

  var box = selectionAnchor ? getSelectionBoundingBox() : null,
      prefill = box ? (colName(box.colStart) + box.rowStart + ':' + colName(box.colEnd) + box.rowEnd) : '';

  document.getElementById('chart-range-input').value = prefill;
  document.getElementById('chart-title-input').value = '';
  document.getElementById('chart-percent-total').value = '';
  document.getElementById('chart-percent-total').style.display = 'none';
  document.getElementById('chart-first-row-labels').checked = true;
  document.getElementById('chart-first-col-series').checked = true;
  document.getElementById('chart-orientation').value = 'auto';

  document.getElementById('chart-modal').classList.add('open');
}

function closeChartModal()
{
  document.getElementById('chart-modal').classList.remove('open');
}

function selectChartType(type, el)
{
  newChartType = type;

  document.querySelectorAll('#chart-modal .type-card').forEach(function(c){ c.classList.remove('selected'); });
  el.classList.add('selected');

  // % Columns converts absolute values into percentages of a total; the
  // total is optional (defaults to each series' own sum).
  document.getElementById('chart-percent-total').style.display = (type === 'percent') ? '' : 'none';
}

document.getElementById('chart-modal').addEventListener
(
  'click',
  function(e)
  {
    if (e.target === document.getElementById('chart-modal'))
      closeChartModal();
  }
);

function createChart()
{
  var range = document.getElementById('chart-range-input').value.trim();

  if (!range || !parseChartRange(range))
  {
    alert('Enter a valid range, e.g. A1:C5');
    return;
  }

  sheetSnapshotForUndo();

  var offset = (sheetCharts.length % 4) * 30;

  var percentTotal = parseFloat(document.getElementById('chart-percent-total').value);

  sheetCharts.push
  (
    {
      id: 'chart_' + Date.now(),
      type: newChartType,
      title: document.getElementById('chart-title-input').value.trim(),
      range: range,
      // Charts belong to the tab they were created on and only render there.
      page: sheetPages[sheetPageIdx].name,
      percentTotal: (newChartType === 'percent' && !isNaN(percentTotal) && percentTotal > 0) ? percentTotal : null,
      firstRowLabels: document.getElementById('chart-first-row-labels').checked,
      firstColSeries: document.getElementById('chart-first-col-series').checked,
      orientation: document.getElementById('chart-orientation').value,
      x: 40 + offset,
      y: 40 + offset,
      width: 420,
      height: 280
    }
  );

  closeChartModal();
  renderSheetCharts();
  saveSheetToFile();
}

// Flips which table direction a chart uses as its legend (Excel's "Switch
// Row/Column"). An 'auto' chart resolves to what it's currently showing
// first, so the click always visibly flips it.
function toggleChartOrientation(e, chartId)
{
  e.stopPropagation();

  var chartDef = sheetCharts.find(function(c){ return c.id === chartId; });
  if (!chartDef)
    return;

  var grid = getChartRangeGrid(chartDef.range);
  if (!grid || !grid.length || !grid[0].length)
    return;

  sheetSnapshotForUndo();
  chartDef.orientation = chartEffectiveOrientation(chartDef, grid) === 'rows' ? 'cols' : 'rows';

  renderSheetCharts();
  saveSheetToFile();
}

function deleteChart(e, chartId)
{
  e.stopPropagation();

  if (!confirm('Delete this chart?'))
    return;

  var idx = sheetCharts.findIndex(function(c){ return c.id === chartId; });

  if (idx === -1)
    return;

  sheetSnapshotForUndo();
  sheetCharts.splice(idx, 1);

  if (sheetChartInstances[chartId])
  {
    sheetChartInstances[chartId].destroy();
    delete sheetChartInstances[chartId];
  }

  var box = document.querySelector('.sheet-chart-box[data-chart-id="' + chartId + '"]');

  if (box)
    box.remove();

  saveSheetToFile();
}

function chartBoxMouseDown(e, chartId)
{
  e.preventDefault();

  var chartDef = sheetCharts.find(function(c){ return c.id === chartId; });

  if (!chartDef)
    return;

  sheetSnapshotForUndo();
  sheetChartDrag = { kind: 'move', id: chartId, startX: e.clientX, startY: e.clientY, origX: chartDef.x, origY: chartDef.y };
}

function chartResizeMouseDown(e, chartId)
{
  e.preventDefault();
  e.stopPropagation();

  var chartDef = sheetCharts.find(function(c){ return c.id === chartId; });

  if (!chartDef)
    return;

  sheetSnapshotForUndo();
  sheetChartDrag = { kind: 'resize', id: chartId, startX: e.clientX, startY: e.clientY, origWidth: chartDef.width, origHeight: chartDef.height };
}

document.addEventListener
(
  'mousemove',
  function(e)
  {
    if (!sheetChartDrag)
      return;

    var chartDef = sheetCharts.find(function(c){ return c.id === sheetChartDrag.id; });

    if (!chartDef)
      return;

    var box = document.querySelector('.sheet-chart-box[data-chart-id="' + sheetChartDrag.id + '"]');

    if (sheetChartDrag.kind === 'move')
    {
      chartDef.x = Math.max(0, sheetChartDrag.origX + (e.clientX - sheetChartDrag.startX));
      chartDef.y = Math.max(0, sheetChartDrag.origY + (e.clientY - sheetChartDrag.startY));

      if (box)
      {
        box.style.left = chartDef.x + 'px';
        box.style.top = chartDef.y + 'px';
      }
    }
    else if (sheetChartDrag.kind === 'resize')
    {
      chartDef.width = Math.max(220, sheetChartDrag.origWidth + (e.clientX - sheetChartDrag.startX));
      chartDef.height = Math.max(160, sheetChartDrag.origHeight + (e.clientY - sheetChartDrag.startY));

      if (box)
      {
        box.style.width = chartDef.width + 'px';
        box.style.height = chartDef.height + 'px';
      }

      var chart = sheetChartInstances[sheetChartDrag.id];

      if (chart)
        chart.resize();
    }
  }
);

document.addEventListener
(
  'mouseup',
  function()
  {
    if (!sheetChartDrag)
      return;

    sheetChartDrag = null;
    saveSheetToFile();
  }
);

// Deferred-save flush. Registered after every drag's own mouseup handler, so
// by the time it runs the drag flags are cleared and the save goes through.
document.addEventListener
(
  'mouseup',
  function()
  {
    if (!sheetSaveDeferred || sheetDragActive())
      return;

    sheetSaveDeferred = false;
    saveSheetToFile();
  }
);
