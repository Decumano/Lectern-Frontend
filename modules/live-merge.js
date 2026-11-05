// Live merge: combining two people's edits to the same text
//
// Part of the Lectern frontend. Loaded in order by main.js, which is
// the only entry point; these are plain scripts sharing one global
// scope, exactly as when this was a single file.

// ── LIVE MERGE ──
//
// When a change to the open document arrives from someone else (over the live
// sync socket in a browser, or from the desktop's sync engine), it is folded
// into what is on screen with a three-way merge: base is the text both sides last
// agreed on, local is what the editor holds now, remote is what arrived.
//
// Lines are merged first, so edits to different paragraphs always combine.
// Where both sides touched the same lines the merge goes down to words, so two
// people typing in the same paragraph still keep both edits. Only when both
// rewrote the very same words does one have to give way, and it is decided by
// comparing the two texts rather than by who is "local": merge(b, x, y) is
// always the same as merge(b, y, x), which is what stops two clients from each
// replacing the other's merge with their own forever.

// Pairs [i, j] of equal elements of `a` and `b` that form a longest common
// subsequence, in ascending order. Myers' O(ND) diff, so it is fast for the
// small edits that make up nearly all live editing; a pair of texts differing
// by more than `cMergeMaxEdits` is reported as having nothing in common.
var cMergeMaxEdits = 2500;

function fLcsPairs(a, b)
{
  var start = 0, endA = a.length, endB = b.length;

  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  var pairs = [], i;

  for (i = 0; i < start; i++) pairs.push([i, i]);

  var mid = fMyersPairs(a.slice(start, endA), b.slice(start, endB));

  for (i = 0; i < mid.length; i++) pairs.push([mid[i][0] + start, mid[i][1] + start]);
  for (i = 0; i < a.length - endA; i++) pairs.push([endA + i, endB + i]);

  return pairs;
}

function fMyersPairs(a, b)
{
  var n = a.length, m = b.length;

  if (!n || !m) return [];

  var cap = Math.min(n + m, cMergeMaxEdits),
      size = 2 * cap + 3,
      v = new Int32Array(size),
      trace = [],
      d, k, x, y;

  v[cap + 2] = 0; // v[k = 1]

  for (d = 0; d <= cap; d++)
  {
    // The state before this step, for the walk back; only the diagonals this
    // step can read, -d-1 .. d+1.
    trace.push(v.slice(cap - d, cap + d + 3));

    for (k = -d; k <= d; k += 2)
    {
      var ix = k + cap + 1;

      if (k === -d || (k !== d && v[ix - 1] < v[ix + 1])) x = v[ix + 1];
      else x = v[ix - 1] + 1;

      y = x - k;

      while (x < n && y < m && a[x] === b[y]) { x++; y++; }

      v[ix] = x;

      if (x >= n && y >= m)
      {
        var pairs = [], bx = n, by = m;

        for (var step = d; step >= 0; step--)
        {
          var snap = trace[step], off = step + 1, bk = bx - by, prevK;

          if (bk === -step || (bk !== step && snap[bk - 1 + off] < snap[bk + 1 + off])) prevK = bk + 1;
          else prevK = bk - 1;

          var prevX = snap[prevK + off], prevY = prevX - prevK;

          while (bx > prevX && by > prevY) { bx--; by--; pairs.push([bx, by]); }

          if (step > 0) { bx = prevX; by = prevY; }
        }

        return pairs.reverse();
      }
    }
  }

  return [];
}

// The runs where `b` differs from `a`: { s, e, lines } replaces a[s..e) with
// `lines` (a pure insertion has s === e, a pure deletion has no lines).
function fDiffHunks(a, b)
{
  var pairs = fLcsPairs(a, b), hunks = [], i = 0, j = 0;

  pairs.forEach
  (
    function(p)
    {
      if (p[0] > i || p[1] > j) hunks.push({ s: i, e: p[0], lines: b.slice(j, p[1]) });
      i = p[0] + 1;
      j = p[1] + 1;
    }
  );

  if (i < a.length || j < b.length) hunks.push({ s: i, e: a.length, lines: b.slice(j) });

  return hunks;
}

function fApplyHunks(base, s, e, hunks)
{
  var out = [], p = s;

  hunks.forEach(function(h) { out = out.concat(base.slice(p, h.s), h.lines); p = h.e; });

  return out.concat(base.slice(p, e));
}

function fSameArray(a, b)
{
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Three-way merge of arrays. Edits that touch different places combine;
// where both sides changed the same stretch, `resolve(base, local, remote)`
// returns the array to use for it.
function fDiff3(base, local, remote, resolve)
{
  var hl = fDiffHunks(base, local), hr = fDiffHunks(base, remote),
      out = [], pos = 0, il = 0, ir = 0;

  function fTouches(h, s, e) { return h.s < e || (h.s === e && (h.e === h.s || s === e)); }

  while (il < hl.length || ir < hr.length)
  {
    var a = hl[il], b = hr[ir],
        fromLocal = a && (!b || a.s <= b.s),
        first = fromLocal ? a : b,
        s = first.s, e = first.e,
        gl = [], gr = [];

    (fromLocal ? gl : gr).push(first);
    if (fromLocal) il++; else ir++;

    for (var grew = true; grew;)
    {
      grew = false;
      if (il < hl.length && fTouches(hl[il], s, e)) { e = Math.max(e, hl[il].e); gl.push(hl[il++]); grew = true; }
      if (ir < hr.length && fTouches(hr[ir], s, e)) { e = Math.max(e, hr[ir].e); gr.push(hr[ir++]); grew = true; }
    }

    out = out.concat(base.slice(pos, s));

    var mine = fApplyHunks(base, s, e, gl),
        theirs = fApplyHunks(base, s, e, gr);

    if (!gl.length) out = out.concat(theirs);
    else if (!gr.length) out = out.concat(mine);
    else if (fSameArray(mine, theirs)) out = out.concat(mine);
    else out = out.concat(resolve(base.slice(s, e), mine, theirs));

    pos = e;
  }

  return out.concat(base.slice(pos));
}

// Both sides rewrote the same words. Decided by the texts alone (never by
// which side is "ours"), so every client reaches the same answer.
function fPickWords(base, a, b)
{
  var as = a.join(''), bs = b.join('');

  if (as === bs) return a;
  if (!base.length) return as < bs ? a.concat(b) : b.concat(a); // both inserted here: keep both
  return as > bs ? a : b;                                       // an edit outranks a deletion
}

function fWordTokens(text)
{
  return text.match(/\s+|[A-Za-z0-9_À-￿]+|[^\sA-Za-z0-9_À-￿]/g) || [];
}

// Merges two edits of `base`; never throws and never loses a paragraph.
function fMergeText(base, local, remote)
{
  base = base || '';

  if (local === remote) return local;
  if (local === base) return remote;
  if (remote === base) return local;

  return fDiff3
  (
    base.split('\n'), local.split('\n'), remote.split('\n'),
    function(b, l, r)
    {
      return fDiff3
      (
        fWordTokens(b.join('\n')), fWordTokens(l.join('\n')), fWordTokens(r.join('\n')),
        fPickWords
      ).join('').split('\n');
    }
  ).join('\n');
}

// Where a caret at `offset` in `before` lands in `after`: carried along by
// the words around it, so text arriving above or beside it never moves it.
function fMapOffset(before, after, offset)
{
  if (before === after) return offset;

  var a = fWordTokens(before), b = fWordTokens(after),
      startA = [], startB = [], pos = 0, i;

  for (i = 0; i < a.length; i++) { startA.push(pos); pos += a[i].length; }
  pos = 0;
  for (i = 0; i < b.length; i++) { startB.push(pos); pos += b[i].length; }

  var matched = new Int32Array(a.length).fill(-1);

  fLcsPairs(a, b).forEach(function(p) { matched[p[0]] = p[1]; });

  // The token the caret sits in (or after, at the very end).
  var t = 0;

  while (t < a.length && startA[t] + a[t].length <= offset) t++;

  if (t < a.length && matched[t] >= 0) return startB[matched[t]] + (offset - startA[t]);

  // On a word that was replaced: stay just after the nearest word that survived.
  for (var u = t - 1; u >= 0; u--)
    if (matched[u] >= 0) return startB[matched[u]] + b[matched[u]].length;

  return 0;
}
