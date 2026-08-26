# Frontend modules

The app used to be one 18,337-line `main.js`. It is now `main.js` as a loader
plus the files here, one per area of the app. This was a pure reorganisation:
the modules rejoin into the original file byte for byte, so nothing about the
app's behaviour changed.

## How they load

`auth-gate.js` loads `main.js`, and `main.js` loads these in the order its
`MODULES` list gives. They are **plain classic scripts sharing one global
scope** — the same arrangement as when they were consecutive sections of a
single file. A function defined in one is callable from any other with no
imports, no exports, no bundler and no build step.

That was a deliberate choice over ES modules. Converting would have meant
adding `import`/`export` to hundreds of cross-references across 913 top-level
declarations — a large, risky edit for no behavioural gain, on a codebase that
four repositories share.

## Two rules

**Order matters.** The list in `main.js` is the original file's order. A module
only sees what earlier modules have already defined, so anything running at
load time — the `addEventListener` wiring, `configureMermaid()`,
`configureChartJs()` — must come after what it uses. Appending a new module is
safe. Reordering the existing ones is not.

**`async = false` is load-bearing.** A script element created with
`createElement` is async by default, and async scripts run in whatever order
they finish downloading. `main.js` sets `async = false` on each, which restores
insertion order. Without it the app would work on a warm cache and break on a
cold one — the worst kind of bug to chase.

`init()` is called once, from `main.js`, after the last module has run, rather
than at the bottom of the last file. Every module is guaranteed to be present
by then.

## Adding to a module

Add functions wherever they belong; there is nothing to register. If you add a
module, append it to `MODULES` in `main.js` — at the end unless it defines
something an earlier module needs at load time.

Bump the `?v=` number in `index.html`'s `auth-gate.js` tag when shipping
changes. `index.html` is served `no-cache`, so that is the one edit that
reliably reaches a returning browser; `auth-gate.js` passes the version to
`main.js`, which passes it to every module here.

## This is a shared submodule

These files live in `officesuite-frontend`, which the Tauri desktop app, the
C++ desktop app, the Rust server and the C++ server all consume as a git
submodule. A change here reaches all four. Each server serves this directory as
static files, so `modules/` needs no server-side configuration — but a server
with an extension allowlist has to permit `.js` from a subdirectory.
