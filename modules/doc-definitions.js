// Definitions at the top of a document
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.
//
// Lines at the very start of a .mdp, each of the form (selector)[attributes],
// set how things look for the whole document:
//
//   (#)[font=Arial, size=15pt, ;; {command} ;;]
//       every "# heading" in Arial, 15pt and centered. The selector is a
//       heading level (#, ##, … ######, or h1…h6); several may share one line:
//       (#, ##)[…]
//
//   (new_macro{text}end_of_new_macro)[font=default, size=11pt, smallcaps]
//       a macro of your own: new_macro some words end_of_new_macro, on one line,
//       is rendered with those attributes. Defining an existing macro,
//       (;;{text};;)[…], replaces what ;; text ;; means.
//
// Attributes are separated by commas. They are font=…, size=…, spacing=…, the
// text directives used elsewhere (color=…, tracking=…, bold, italic, underline,
// smallcaps, left/center/right/justify), and a template naming a macro around
// {command}: `;; {command} ;;` stands for "what ;; … ;; does" (here: center),
// likewise `||(font=Georgia) {command} ||`, `[{command}]{color=#a00}` and any
// macro defined above it. {text} works in place of {command} everywhere.
//
// Everything becomes the markers fPreprocessFontBlocks already uses, with the
// same style table, so these nest with font blocks and reach the TOC the same way.

var cHeadingSelectorRe = /^(?:#{1,6}|h[1-6])$/i,
    cPlaceholderRe = /\{(?:text|command)\}/i,
    cAlignSymbols = { '::': 'left', ':::': 'right', ';;': 'center', ';;;': 'justify' };

// Splits on `sep` where it isn't inside quotes or any kind of bracket.
function fSplitTopLevel(text, sep)
{
  var parts = [], depth = 0, quote = null, last = 0;

  for (var i = 0; i < text.length; i++)
  {
    var c = text[i];

    if (quote)
    {
      if (c === quote) quote = null;
    }
    else if (c === '"' || c === "'")
      quote = c;
    else if (c === '(' || c === '[' || c === '{')
      depth++;
    else if (c === ')' || c === ']' || c === '}')
      depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0)
    {
      parts.push(text.slice(last, i));
      last = i + 1;
    }
  }

  parts.push(text.slice(last));
  return parts;
}

function fMergeDefinitionStyle(into, from)
{
  ['font', 'size', 'spacing', 'align'].forEach(function(k) { if (from[k]) into[k] = from[k]; });
  into.css = (into.css || '') + (from.css || '');
  return into;
}

function fIsEmptyDefinitionStyle(style)
{
  return !style.font && !style.size && !style.spacing && !style.align && !style.css;
}

// One bare attribute ("smallcaps", "color=#a00", "center") → style.
function fDirectiveDefinitionStyle(item)
{
  var style = { css: '' };

  fParseDirectiveTokens(item).forEach
  (
    function(t)
    {
      var css = fDirectiveStyle(t.key, t.hasValue, t.value),
          align = /^text-align:(\w+);$/.exec(css);

      if (align)
        style.align = align[1];
      else
        style.css += css;
    }
  );

  return style;
}

// What a macro wrapped around {command} amounts to, as a style, or null.
function fResolveDefinitionTemplate(prefix, suffix, macros)
{
  prefix = prefix.trim();
  suffix = suffix.trim();

  if (prefix && prefix === suffix && cAlignSymbols[prefix])
    return { css: '', align: cAlignSymbols[prefix] };

  var font = /^\|\|\((.*)\)$/.exec(prefix);

  if (font && suffix === '||')
  {
    var parsed = fParseFontBlockOptions(font[1]);
    return parsed ? fMergeDefinitionStyle({ css: '' }, parsed) : null;
  }

  var span = /^\[$/.test(prefix) ? /^\]\{(.*)\}$/.exec(suffix) : null;

  if (span)
    return fDirectiveDefinitionStyle(span[1]);

  for (var i = macros.length - 1; i >= 0; i--)
    if (macros[i].open === prefix && macros[i].close === suffix)
      return fMergeDefinitionStyle({ css: '' }, macros[i].style);

  return null;
}

// "font=Arial, size=15pt, center" → { font, size, spacing, align, css }, or
// null when nothing in it means anything.
function fParseDefinitionAttributes(text, macros)
{
  var style = { css: '' };

  fSplitTopLevel(text, ',').forEach
  (
    function(raw)
    {
      var item = raw.trim(), keyed;

      if (!item)
        return;

      var placeholder = cPlaceholderRe.exec(item);

      if (placeholder)
      {
        var resolved = fResolveDefinitionTemplate(item.slice(0, placeholder.index), item.slice(placeholder.index + placeholder[0].length), macros);

        if (resolved)
          fMergeDefinitionStyle(style, resolved);

        return;
      }

      if ((keyed = /^(font|size|spacing)\s*=\s*([\s\S]*)$/i.exec(item)))
      {
        var key = keyed[1].toLowerCase(),
            value = keyed[2].replace(/^(["'])([\s\S]*)\1$/, '$2').trim();

        if (key === 'font' && value)
          style.font = /^(default|inherit)$/i.test(value) ? 'inherit' : fCssFontFamilyValue(value);
        else if (key === 'size' && fCssSizeValue(value))
          style.size = fCssSizeValue(value);
        else if (key === 'spacing' && /^\d+(\.\d+)?(pt|px|em|rem|%|cm|mm|in)?$/i.test(value))
          style.spacing = value.toLowerCase();

        return;
      }

      fMergeDefinitionStyle(style, fDirectiveDefinitionStyle(item));
    }
  );

  return fIsEmptyDefinitionStyle(style) ? null : style;
}

// → { body, headings: {1..6: style}, macros: [{open, close, style}] }, or null
// when the document doesn't start with definitions. `body` is the source
// without them.
function fParseDocumentDefinitions(source)
{
  var lines = source.replace(/^﻿/, '').split('\n'),
      headings = {},
      macros = [],
      end = -1,
      any = false;

  for (var i = 0; i < lines.length; i++)
  {
    var line = lines[i].trim();

    if (!line)
      continue;

    var def = /^\((.*?)\)\[(.*)\]$/.exec(line);

    if (!def)
      break;

    var selector = def[1].trim(),
        style = fParseDefinitionAttributes(def[2], macros);

    if (!style)
      break;

    var placeholder = cPlaceholderRe.exec(selector);

    if (placeholder)
    {
      var open = selector.slice(0, placeholder.index).trim(),
          close = selector.slice(placeholder.index + placeholder[0].length).trim();

      if (!open || !close)
        break;

      macros.push({ open: open, close: close, style: style });
    }
    else
    {
      var levels = fSplitTopLevel(selector, ',').map(function(s) { return s.trim(); });

      if (!levels.length || !levels.every(function(s) { return cHeadingSelectorRe.test(s); }))
        break;

      levels.forEach
      (
        function(s)
        {
          var level = s[0] === '#' ? s.length : parseInt(s[1], 10);
          headings[level] = fMergeDefinitionStyle(headings[level] || { css: '' }, style);
        }
      );
    }

    any = true;
    end = i;
  }

  if (!any)
    return null;

  // Longest opener first, so (;;;{text};;;) is tried before (;;{text};;).
  macros.sort(function(a, b) { return b.open.length - a.open.length; });

  return { body: lines.slice(end + 1).join('\n'), headings: headings, macros: macros };
}

function fIsSymbolChar(c)
{
  return !!c && !/[\w\s]/.test(c);
}

// The next `delim` at or after `from`. A delimiter made of symbols doesn't
// match inside a longer run of the same symbol (so ;; is not found in ;;;).
function fFindDelimiter(text, delim, from)
{
  for (var at = text.indexOf(delim, from); at !== -1; at = text.indexOf(delim, at + 1))
  {
    var before = text[at - 1], after = text[at + delim.length];

    if (fIsSymbolChar(delim[0]) && before === delim[0])
      continue;

    if (fIsSymbolChar(delim[delim.length - 1]) && after === delim[delim.length - 1])
      continue;

    return at;
  }

  return -1;
}

function fExpandMacroInText(text, macro, styles)
{
  var out = '', last = 0, from = 0;

  for (;;)
  {
    var a = fFindDelimiter(text, macro.open, from);

    if (a === -1)
      break;

    var innerStart = a + macro.open.length,
        b = fFindDelimiter(text, macro.close, innerStart);

    if (b === -1)
      break;

    var inner = text.slice(innerStart, b).trim();

    if (!inner)
    {
      from = innerStart;
      continue;
    }

    out += text.slice(last, a) + cFontOpenMark + styles.length + cFontOpenMarkEnd + inner + cFontCloseMark;
    styles.push(macro.style);
    last = from = b + macro.close.length;
  }

  return out + text.slice(last);
}

// The source without its definitions, with every heading rule and macro
// applied as font markers (their styles appended to `styles`).
function fExpandDefinitions(definitions, styles)
{
  var lines = definitions.body.split('\n'),
      fence = null,
      inMath = false,
      hasHeadings = Object.keys(definitions.headings).length > 0;

  for (var i = 0; i < lines.length; i++)
  {
    var line = lines[i],
        fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);

    if (fence)
    {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;

      continue;
    }

    if (fenceMatch)
    {
      fence = fenceMatch[1];
      continue;
    }

    if (((line.match(/\$\$/g) || []).length) % 2 === 1)
    {
      inMath = !inMath;
      continue;
    }

    if (inMath)
      continue;

    var heading = hasHeadings ? /^( {0,3}(#{1,6}))([ \t]+)(\S.*)$/.exec(line) : null;

    if (heading && definitions.headings[heading[2].length])
    {
      var content = heading[4],
          attrs = /\s*\{([^{}\n]*)\}\s*$/.exec(content),
          tail = '';

      // A trailing {size=Huge center} has to stay last, or it stops being read.
      if (attrs && cHeadingAttrKeys.test(attrs[1].trim()))
      {
        tail = content.slice(attrs.index);
        content = content.slice(0, attrs.index);
      }

      line = heading[1] + heading[3] + cFontOpenMark + styles.length + cFontOpenMarkEnd + content + cFontCloseMark + tail;
      styles.push(definitions.headings[heading[2].length]);
    }

    if (definitions.macros.length)
    {
      // Code spans are left alone: expand only the stretches between them.
      line = line.split(/(`[^`\n]*`)/).map
      (
        function(piece, index)
        {
          if (index % 2 === 1)
            return piece;

          definitions.macros.forEach(function(macro) { piece = fExpandMacroInText(piece, macro, styles); });
          return piece;
        }
      ).join('');
    }

    lines[i] = line;
  }

  return lines.join('\n');
}
