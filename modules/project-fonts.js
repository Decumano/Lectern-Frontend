// Fonts that live in the project
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.
//
// Any TTF/OTF/WOFF/WOFF2 file inside a folder named `fonts` (at any depth,
// any capitalisation) of the work folder is registered as a font, so
//
//     ||(font=My Brand Sans) text ||
//
// works with nothing installed and nothing uploaded. The files travel with
// the project: they sync like any other file, and an exported document
// embeds the ones it uses, so a PDF looks the same on every machine.
//
// The family name comes from the font's own `name` table (TTF/OTF and WOFF),
// falling back to the file name ("Inter-BoldItalic.ttf" → Inter, 700,
// italic). WOFF2 is Brotli-compressed, so it always uses the file name.

var cProjectFontExtRe = /\.(ttf|otf|woff2?)$/i,
    cProjectFontMaxBytes = 25 * 1024 * 1024;

var cProjectFontKinds =
{
  ttf:   { mime: 'font/ttf',   format: 'truetype' },
  otf:   { mime: 'font/otf',   format: 'opentype' },
  woff:  { mime: 'font/woff',  format: 'woff' },
  woff2: { mime: 'font/woff2', format: 'woff2' }
};

var cFontWeightWords =
[
  ['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600],
  ['extrabold', 800], ['ultrabold', 800], ['hairline', 100], ['regular', 400],
  ['medium', 500], ['normal', 400], ['light', 300], ['thin', 100], ['bold', 700],
  ['black', 900], ['heavy', 900], ['book', 400]
];

var projectFonts = {},          // relPath → { relPath, modified, family, weight, style, kind, blob, url }
    projectFontErrors = {},     // relPath → message, for the settings list
    projectFontsRunning = false,
    projectFontsAgain = null;   // entries waiting for the current pass to end

// ── Reading a font's name ──

function fFontWeightFromWords(text)
{
  var lower = String(text || '').toLowerCase().replace(/[\s_-]+/g, '');

  for (var i = 0; i < cFontWeightWords.length; i++)
    if (lower.indexOf(cFontWeightWords[i][0]) !== -1)
      return cFontWeightWords[i][1];

  return 400;
}

// "Inter-BoldItalic.ttf" → { family: 'Inter', weight: 700, style: 'italic' }
function fFontMetaFromFileName(fileName)
{
  var base = String(fileName || '').replace(/\.[^.]+$/, ''),
      tokens = base.split(/[-_ ]+/).filter(Boolean),
      style = 'normal',
      weight = 400,
      family = [];

  tokens.forEach(function(token, i)
  {
    var lower = token.toLowerCase();

    // The first token is always the family, even for a font called "Black".
    if (i > 0)
    {
      var isItalic = /(italic|oblique)$/.test(lower),
          rest = lower.replace(/(italic|oblique)$/, '');

      if (isItalic) style = 'italic';

      if (isItalic && !rest) return;

      var w = fFontWeightFromWords(rest || lower);

      if (w !== 400 || /^(regular|normal|book)$/.test(rest || lower))
      {
        weight = w;
        return;
      }
    }

    family.push(token);
  });

  return { family: family.join(' ') || base, weight: weight, style: style };
}

// A DataView over one table of a TTF/OTF/WOFF file, or null.
async function fFontTable(buffer, tag)
{
  var view = new DataView(buffer);

  if (buffer.byteLength < 16) return null;

  var signature = view.getUint32(0),
      isWoff = signature === 0x774F4646, // 'wOFF'
      isSfnt = signature === 0x00010000 || signature === 0x4F54544F || signature === 0x74727565; // 1.0, 'OTTO', 'true'

  if (!isWoff && !isSfnt) return null; // WOFF2, collections

  var count = view.getUint16(isWoff ? 12 : 4),
      start = isWoff ? 44 : 12,
      size = isWoff ? 20 : 16;

  for (var i = 0; i < count; i++)
  {
    var at = start + i * size;

    if (at + size > buffer.byteLength) return null;

    var name = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

    if (name !== tag) continue;

    var offset = view.getUint32(at + (isWoff ? 4 : 8)),
        length = view.getUint32(at + 12), // original length
        packed = isWoff ? view.getUint32(at + 8) : length;

    if (offset + packed > buffer.byteLength) return null;

    var data = buffer.slice(offset, offset + packed);

    if (isWoff && packed < length)
    {
      if (typeof DecompressionStream === 'undefined') return null;

      var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
      data = await new Response(stream).arrayBuffer();
    }

    return new DataView(data);
  }

  return null;
}

function fReadNameRecord(table, wanted)
{
  var count = table.getUint16(2),
      stringsAt = table.getUint16(4),
      best = null, bestRank = -1;

  for (var i = 0; i < count; i++)
  {
    var at = 6 + i * 12;

    if (at + 12 > table.byteLength) break;

    var platform = table.getUint16(at),
        language = table.getUint16(at + 4),
        id = table.getUint16(at + 6),
        length = table.getUint16(at + 8),
        offset = stringsAt + table.getUint16(at + 10);

    if (id !== wanted || offset + length > table.byteLength) continue;

    var rank = platform === 3 ? (language === 0x409 ? 4 : 3) : platform === 0 ? 2 : platform === 1 ? 1 : 0;

    if (rank <= bestRank) continue;

    var text = '';

    if (platform === 1)
      for (var k = 0; k < length; k++)
        text += String.fromCharCode(table.getUint8(offset + k));
    else
      for (var j = 0; j + 1 < length; j += 2)
        text += String.fromCharCode(table.getUint16(offset + j));

    if (text) { best = text; bestRank = rank; }
  }

  return best;
}

async function fFontMetaFromFile(buffer, fileName)
{
  var meta = fFontMetaFromFileName(fileName);

  try
  {
    var nameTable = await fFontTable(buffer, 'name');

    if (!nameTable) return meta;

    // 16/17 are the typographic family and style ("Inter" / "Bold"); 1/2 are
    // the legacy ones ("Inter Light" / "Regular"), used when 16/17 are absent.
    var family = fReadNameRecord(nameTable, 16) || fReadNameRecord(nameTable, 1),
        subfamily = fReadNameRecord(nameTable, 17) || fReadNameRecord(nameTable, 2) || '';

    if (family) meta.family = family;

    meta.weight = fFontWeightFromWords(subfamily);
    meta.style = /italic|oblique/i.test(subfamily) ? 'italic' : 'normal';

    var os2 = await fFontTable(buffer, 'OS/2');

    if (os2 && os2.byteLength >= 64)
    {
      meta.weight = os2.getUint16(4) || meta.weight;

      var selection = os2.getUint16(62);
      meta.style = (selection & 1) || (selection & 512) ? 'italic' : 'normal';
    }

    // A variable font covers a whole range of weights in one file.
    if (await fFontTable(buffer, 'fvar'))
      meta.weight = '100 900';
  }
  catch(e)
  {
    console.warn('Could not read the name of ' + fileName + '; using the file name', e);
  }

  meta.family = String(meta.family).replace(/['"\\<>{}]/g, '').trim() || meta.family;
  return meta;
}

// ── Loading the project's fonts ──

function fCollectProjectFontEntries(entries)
{
  var found = [];

  (function walk(list, inFonts)
  {
    (list || []).forEach(function(entry)
    {
      if (entry.isDir)
        walk(entry.children, inFonts || String(entry.name).toLowerCase() === 'fonts');
      else if (inFonts && cProjectFontExtRe.test(entry.name))
        found.push(entry);
    });
  })(entries, false);

  return found;
}

function fFontKindOf(name)
{
  return cProjectFontKinds[String(name).slice(String(name).lastIndexOf('.') + 1).toLowerCase()];
}

// Called with the work-folder listing every time the tree is rebuilt. Only
// files that are new or changed are read; the rest keep their blob.
async function fLoadProjectFonts(entries)
{
  if (projectFontsRunning)
  {
    projectFontsAgain = entries; // the newest listing wins
    return;
  }

  projectFontsRunning = true;

  try
  {
    var wanted = fCollectProjectFontEntries(entries),
        keep = {},
        changed = false;

    for (var i = 0; i < wanted.length; i++)
    {
      var entry = wanted[i],
          have = projectFonts[entry.relPath];

      keep[entry.relPath] = true;

      if (have && have.modified === entry.modified) continue;

      try
      {
        var kind = fFontKindOf(entry.name),
            blob = await Platform.fReadWorkFileBinary(workFolderRoot, entry.relPath, kind.mime);

        if (blob.size > cProjectFontMaxBytes)
          throw new Error('larger than ' + Math.round(cProjectFontMaxBytes / 1048576) + ' MB');

        var bytes = await blob.arrayBuffer(),
            magic = bytes.byteLength >= 4 ? new DataView(bytes).getUint32(0) : 0;

        // sfnt (TrueType 1.0, 'OTTO', 'true'), 'wOFF' or 'wOF2'.
        if ([0x00010000, 0x4F54544F, 0x74727565, 0x774F4646, 0x774F4632].indexOf(magic) === -1)
          throw new Error('not a font file');

        var meta = await fFontMetaFromFile(bytes, entry.name);

        if (have) URL.revokeObjectURL(have.url);

        projectFonts[entry.relPath] =
        {
          relPath: entry.relPath, modified: entry.modified,
          family: meta.family, weight: meta.weight, style: meta.style,
          kind: kind, blob: blob, url: URL.createObjectURL(blob)
        };
        delete projectFontErrors[entry.relPath];
        changed = true;
      }
      catch(e)
      {
        console.warn('Could not load the font ' + entry.relPath, e);
        projectFontErrors[entry.relPath] = e.message || 'could not be read';
        changed = true;
      }
    }

    Object.keys(projectFonts).forEach(function(relPath)
    {
      if (keep[relPath]) return;

      URL.revokeObjectURL(projectFonts[relPath].url);
      delete projectFonts[relPath];
      delete projectFontErrors[relPath];
      changed = true;
    });

    Object.keys(projectFontErrors).forEach(function(relPath)
    {
      if (keep[relPath]) return;
      delete projectFontErrors[relPath];
      changed = true;
    });

    if (changed)
    {
      fApplyProjectFontsStyle();
      cachedFontList = null; // the "Font…" picker lists them
      fRenderProjectFontsSection();
    }
  }
  finally
  {
    projectFontsRunning = false;
  }

  if (projectFontsAgain)
  {
    var next = projectFontsAgain;
    projectFontsAgain = null;
    await fLoadProjectFonts(next);
  }
}

function fProjectFontFaceRule(font, url)
{
  return "@font-face{font-family:'" + font.family + "';font-weight:" + font.weight +
         ";font-style:" + font.style + ";font-display:swap;src:url('" + url +
         "') format('" + font.kind.format + "');}";
}

function fApplyProjectFontsStyle()
{
  var tag = document.getElementById('project-fonts-style');

  if (!tag)
  {
    tag = document.createElement('style');
    tag.id = 'project-fonts-style';
    document.head.appendChild(tag);
  }

  tag.textContent = Object.keys(projectFonts).sort().map(function(relPath)
  {
    return fProjectFontFaceRule(projectFonts[relPath], projectFonts[relPath].url);
  }).join('\n');
}

function fProjectFontFamilies()
{
  var seen = {}, names = [];

  Object.keys(projectFonts).forEach(function(relPath)
  {
    var family = projectFonts[relPath].family;

    if (!seen[family.toLowerCase()]) { seen[family.toLowerCase()] = true; names.push(family); }
  });

  return names.sort(function(a, b) { return a.localeCompare(b); });
}

function fBlobToDataUrl(blob)
{
  return new Promise(function(resolve, reject)
  {
    var reader = new FileReader();

    reader.onload = function() { resolve(String(reader.result)); };
    reader.onerror = function() { reject(reader.error); };
    reader.readAsDataURL(blob);
  });
}

// @font-face rules for an exported file: self-contained (data: URLs) and
// limited to the fonts the exported text actually names, so a project with
// forty fonts doesn't put forty fonts in every PDF.
async function fProjectFontsExportCss(usedText)
{
  var haystack = String(usedText || '').toLowerCase(),
      rules = [],
      paths = Object.keys(projectFonts).sort();

  for (var i = 0; i < paths.length; i++)
  {
    var font = projectFonts[paths[i]];

    if (haystack.indexOf(font.family.toLowerCase()) === -1) continue;

    rules.push(fProjectFontFaceRule(font, await fBlobToDataUrl(font.blob)));
  }

  return rules.join('\n') + (rules.length ? '\n' : '');
}

function fRenderProjectFontsSection()
{
  var list = document.getElementById('project-fonts-list');

  if (!list) return;

  var paths = Object.keys(projectFonts).sort(),
      failed = Object.keys(projectFontErrors).sort();

  list.innerHTML = (paths.length || failed.length)
    ? paths.map(function(relPath)
      {
        var f = projectFonts[relPath];

        return '<div class="custom-font-row">' +
          '<span class="custom-font-name" style="font-family:' + fEscAttr(fCssFontFamilyValue(f.family)) + ';font-weight:' +
            fEscAttr(String(f.weight).split(' ')[0]) + ';font-style:' + f.style + '">' + fEscHtml(f.family) + '</span>' +
          '<span class="custom-font-size" title="' + fEscAttr(relPath) + '">' + fEscHtml(relPath) + '</span>' +
        '</div>';
      }).join('') +
      failed.map(function(relPath)
      {
        return '<div class="custom-font-row">' +
          '<span class="custom-font-name" style="color:#e57373">' + fEscHtml(relPath) + '</span>' +
          '<span class="custom-font-size">' + fEscHtml(projectFontErrors[relPath]) + '</span>' +
        '</div>';
      }).join('')
    : '<div class="settings-help-text" style="margin:0">No fonts found. Put .ttf, .otf, .woff or .woff2 files in a folder named <code>fonts</code>.</div>';
}
