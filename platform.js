// Platform adapter: isolates every native file-system call behind one small
// interface, so main.js never talks to window.__TAURI__ (or the web API)
// directly. On Tauri, calls go through window.__TAURI__.core.invoke. In this
// web build, when Tauri isn't present, the same six work-folder methods are
// backed by fetch() calls to this server's /api/workspace/* endpoints instead
// of rejecting as "unavailable" — the server derives the workspace root from
// the logged-in session, so `root` is never actually sent to it.

var Platform = (function () {
  // The split pane embeds the app in a same-origin iframe; Tauri only injects
  // __TAURI__ into top-level windows, so child frames borrow the parent's.
  var tauriGlobal = window.__TAURI__ || (function () {
    try { return window.parent !== window ? window.parent.__TAURI__ : null; }
    catch (e) { return null; }
  })();
  var tauri = tauriGlobal && tauriGlobal.core;

  // Sentinel returned by fPickWorkFolder() once authenticated: there's no
  // folder to pick on the web, just an implicit per-user workspace.
  var cCloudRoot = 'cloud';

  // ── Cloud workspaces (web only) ──
  // A named workspace on the web is just a top-level folder of the user's one
  // server-side space, addressed with the root sentinel 'cloud:<folder>'.
  // Scoping is applied here, in the single funnel every API call goes
  // through: work-folder methods derive the folder from their `root`
  // argument; share/comment methods don't receive a root, so main.js tells
  // us the active folder once via fSetCloudWorkspace. The server only ever
  // sees full root-relative paths, so sync, sharing and deletion tombstones
  // work unchanged.
  var cloudWorkspaceFolder = '';

  function fSetCloudWorkspace(folder) {
    cloudWorkspaceFolder = folder || '';
  }

  function fCloudFolderOf(root) {
    return (typeof root === 'string' && root.indexOf('cloud:') === 0) ? root.slice(6) : '';
  }

  // Workspace-relative -> root-relative, for methods that take `root`.
  function fCloudRel(root, relPath) {
    var folder = fCloudFolderOf(root);
    return folder ? folder + '/' + relPath : relPath;
  }

  // Same, for the share/comment methods scoped via fSetCloudWorkspace.
  function fActiveRel(relPath) {
    return cloudWorkspaceFolder ? cloudWorkspaceFolder + '/' + relPath : relPath;
  }

  function fApi(path, options) {
    options = options || {};
    options.credentials = 'include';
    return fetch('/api' + path, options).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error || ('Request failed: ' + res.status));
        });
      }
      return res;
    });
  }

  function fApiJson(path, options) {
    return fApi(path, options).then(function (res) { return res.json(); });
  }

  function fPickWorkFolder() {
    if (tauri) return tauri.invoke('pick_work_folder');
    return fCurrentUser().then(function (user) {
      return user ? cCloudRoot : null;
    });
  }

  function fListWorkFolder(root) {
    if (tauri) return tauri.invoke('list_work_folder', { root: root });
    return fApiJson('/workspace').then(function (tree) {
      var folder = fCloudFolderOf(root);
      if (!folder) return tree;

      // Scoped workspace: present the named top-level folder's contents as
      // the whole tree, with workspace-relative paths.
      var node = null;
      (tree || []).forEach(function (e) {
        if (e.isDir && e.name === folder) node = e;
      });
      if (!node) return [];

      var strip = folder.length + 1;
      function fStripRel(list) {
        list.forEach(function (e) {
          e.relPath = e.relPath.slice(strip);
          if (e.children && e.children.length) fStripRel(e.children);
        });
        return list;
      }
      return fStripRel(node.children || []);
    });
  }

  function fReadWorkFile(root, relPath) {
    if (tauri) return tauri.invoke('read_work_file', { root: root, relPath: relPath });
    return fApi('/workspace/file?path=' + encodeURIComponent(fCloudRel(root, relPath))).then(function (res) { return res.text(); });
  }

  function fWriteWorkFile(root, relPath, content) {
    if (tauri) return tauri.invoke('write_work_file', { root: root, relPath: relPath, content: content });
    return fApi('/workspace/file?path=' + encodeURIComponent(fCloudRel(root, relPath)), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: content
    }).then(function () { return undefined; });
  }

  // ── Binary files (presentation images) ──
  // On the desktop the bridge carries JSON, so bytes travel as base64; the
  // web backend stores and returns a request body byte for byte already.

  function fBlobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var url = String(reader.result || '');
        resolve(url.slice(url.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error('could not read the file')); };
      reader.readAsDataURL(blob);
    });
  }

  function fBase64ToBlob(data, type) {
    var bin = atob(data || ''), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || '' });
  }

  // Resolves a Blob. `type` labels it (the stored bytes carry no MIME type).
  function fReadWorkFileBinary(root, relPath, type) {
    if (tauri) {
      return tauri.invoke('read_work_file_base64', { root: root, relPath: relPath }).then(function (data) {
        return fBase64ToBlob(data, type);
      });
    }
    return fApi('/workspace/file?path=' + encodeURIComponent(fCloudRel(root, relPath))).then(function (res) {
      return res.blob();
    }).then(function (blob) {
      return type ? new Blob([blob], { type: type }) : blob;
    });
  }

  function fWriteWorkFileBinary(root, relPath, blob) {
    if (tauri) {
      return fBlobToBase64(blob).then(function (data) {
        return tauri.invoke('write_work_file_base64', { root: root, relPath: relPath, data: data });
      });
    }
    return fApi('/workspace/file?path=' + encodeURIComponent(fCloudRel(root, relPath)), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob
    }).then(function () { return undefined; });
  }

  // Downloads a remote file (an image picked by URL) as a Blob. The desktop
  // fetches natively; a browser page can only read hosts that allow it (CORS),
  // so on the web this rejects for most image hosts and the caller says so.
  function fFetchRemoteFile(url) {
    if (tauri) {
      return tauri.invoke('fetch_remote_file', { url: url }).then(function (res) {
        return fBase64ToBlob(res && res.data, res && res.contentType);
      });
    }
    return fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
      if (!res.ok) throw new Error('the server answered ' + res.status);
      return res.blob();
    });
  }

  // Cheap change-detection: {modified, hash} for one file, without the
  // content. Resolves null on Tauri, where live sync doesn't apply (the
  // desktop app has its own explicit cloud-sync flow).
  function fStatWorkFile(root, relPath) {
    if (tauri) return Promise.resolve(null);
    return fApiJson('/workspace/stat?path=' + encodeURIComponent(fCloudRel(root, relPath)));
  }

  function fCreateWorkFolder(root, relPath) {
    if (tauri) return tauri.invoke('create_work_folder', { root: root, relPath: relPath });
    return fApi('/workspace/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: fCloudRel(root, relPath) })
    }).then(function () { return undefined; });
  }

  function fDeleteWorkEntry(root, relPath, isDir) {
    if (tauri) return tauri.invoke('delete_work_entry', { root: root, relPath: relPath, isDir: isDir });
    return fApi('/workspace/entry?path=' + encodeURIComponent(fCloudRel(root, relPath)) + '&isDir=' + !!isDir, {
      method: 'DELETE'
    }).then(function () { return undefined; });
  }

  function fMoveWorkEntry(root, fromRelPath, toRelPath) {
    if (tauri) return tauri.invoke('move_work_entry', { root: root, fromRelPath: fromRelPath, toRelPath: toRelPath });
    return fApi('/workspace/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fCloudRel(root, fromRelPath), to: fCloudRel(root, toRelPath) })
    }).then(function () { return undefined; });
  }

  // ── Auth (web only; no-ops don't apply to Tauri, which has no accounts) ──

  function fCurrentUser() {
    if (tauri) return Promise.resolve(null);
    return fetch('/api/auth/me', { credentials: 'include' }).then(function (res) {
      return res.ok ? res.json() : null;
    });
  }

  function fRegister(email, password) {
    return fApiJson('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
  }

  function fLogin(email, password) {
    return fApiJson('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
  }

  function fLogout() {
    return fApi('/auth/logout', { method: 'POST' }).then(function () { return undefined; });
  }

  // ── Cloud sync (Tauri only; the web build already talks to the cloud
  // natively through the calls above and has no separate "connect" step) ──

  function fCloudConnect(serverUrl, email, password, root) {
    if (!tauri) return Promise.reject(new Error('cloud sync is desktop-only'));
    return tauri.invoke('cloud_connect', { serverUrl: serverUrl, email: email, password: password, root: root });
  }

  function fCloudDisconnect() {
    if (!tauri) return Promise.reject(new Error('cloud sync is desktop-only'));
    return tauri.invoke('cloud_disconnect');
  }

  function fCloudStatus() {
    if (!tauri) return Promise.resolve({ connected: false, mode: 'disconnected' });
    return tauri.invoke('cloud_status');
  }

  function fCloudSyncNow() {
    if (!tauri) return Promise.reject(new Error('cloud sync is desktop-only'));
    return tauri.invoke('cloud_sync_now');
  }

  function fCloudListConflicts() {
    if (!tauri) return Promise.resolve([]);
    return tauri.invoke('cloud_list_conflicts');
  }

  function fCloudResolveConflict(relPath, choice) {
    if (!tauri) return Promise.reject(new Error('cloud sync is desktop-only'));
    return tauri.invoke('cloud_resolve_conflict', { relPath: relPath, choice: choice });
  }

  // ── Sharing & comments (web only; the desktop app works on a local folder
  // and reaches shared content through the website instead) ──

  function fWebOnly() { return Promise.reject(new Error('sharing is available on the web app')); }

  function fShareEntry(relPath, isDir, email, permission) {
    if (tauri) return fWebOnly();
    return fApiJson('/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: fActiveRel(relPath), isDir: isDir, email: email, permission: permission })
    });
  }

  function fListSharesFor(relPath) {
    if (tauri) return Promise.resolve([]);
    return fApiJson('/shares?path=' + encodeURIComponent(fActiveRel(relPath)));
  }

  function fRevokeShare(shareId) {
    if (tauri) return fWebOnly();
    return fApi('/shares/' + encodeURIComponent(shareId), { method: 'DELETE' }).then(function () { return undefined; });
  }

  function fListSharedWithMe() {
    if (tauri) return Promise.resolve([]);
    return fApiJson('/shared');
  }

  function fListSharedFolder(shareId, subPath) {
    if (tauri) return fWebOnly();
    return fApiJson('/shared/list?share=' + encodeURIComponent(shareId) + '&path=' + encodeURIComponent(subPath || ''));
  }

  function fReadSharedFile(shareId, subPath) {
    if (tauri) return fWebOnly();
    return fApi('/shared/file?share=' + encodeURIComponent(shareId) + '&path=' + encodeURIComponent(subPath || ''))
      .then(function (res) { return res.text(); });
  }

  function fStatSharedFile(shareId, subPath) {
    if (tauri) return Promise.resolve(null);
    return fApiJson('/shared/stat?share=' + encodeURIComponent(shareId) + '&path=' + encodeURIComponent(subPath || ''));
  }

  function fWriteSharedFile(shareId, subPath, content) {
    if (tauri) return fWebOnly();
    return fApi('/shared/file?share=' + encodeURIComponent(shareId) + '&path=' + encodeURIComponent(subPath || ''), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: content
    }).then(function () { return undefined; });
  }

  // ── Link shares ("anyone with the link"; the token is the authorization) ──

  function fCreateShareLink(relPath, isDir, permission) {
    if (tauri) return fWebOnly();
    return fApiJson('/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: fActiveRel(relPath), isDir: isDir, permission: permission })
    });
  }

  function fListShareLinks(relPath) {
    if (tauri) return Promise.resolve([]);
    return fApiJson('/links?path=' + encodeURIComponent(fActiveRel(relPath)));
  }

  function fRevokeShareLink(linkId) {
    if (tauri) return fWebOnly();
    return fApi('/links/' + encodeURIComponent(linkId), { method: 'DELETE' }).then(function () { return undefined; });
  }

  function fLinkMeta(token) {
    if (tauri) return fWebOnly();
    return fApiJson('/link/' + encodeURIComponent(token));
  }

  function fListLinkFolder(token, subPath) {
    if (tauri) return fWebOnly();
    return fApiJson('/link/' + encodeURIComponent(token) + '/list?path=' + encodeURIComponent(subPath || ''));
  }

  function fReadLinkFile(token, subPath) {
    if (tauri) return fWebOnly();
    return fApi('/link/' + encodeURIComponent(token) + '/file?path=' + encodeURIComponent(subPath || ''))
      .then(function (res) { return res.text(); });
  }

  function fStatLinkFile(token, subPath) {
    if (tauri) return Promise.resolve(null);
    return fApiJson('/link/' + encodeURIComponent(token) + '/stat?path=' + encodeURIComponent(subPath || ''));
  }

  function fWriteLinkFile(token, subPath, content) {
    if (tauri) return fWebOnly();
    return fApi('/link/' + encodeURIComponent(token) + '/file?path=' + encodeURIComponent(subPath || ''), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: content
    }).then(function () { return undefined; });
  }

  // target: { path } for my own file, { share, subPath } for an account
  // share, or { link, subPath } for a share link (works logged out).
  function fCommentQs(target) {
    if (target.link) return 'link=' + encodeURIComponent(target.link) + '&subPath=' + encodeURIComponent(target.subPath || '');
    if (target.share) return 'share=' + encodeURIComponent(target.share) + '&subPath=' + encodeURIComponent(target.subPath || '');
    return 'path=' + encodeURIComponent(fActiveRel(target.path));
  }

  function fListComments(target) {
    if (tauri) return Promise.resolve([]);
    return fApiJson('/comments?' + fCommentQs(target));
  }

  function fAddComment(target, body, anchor) {
    if (tauri) return fWebOnly();
    var payload = target.link
      ? { link: target.link, subPath: target.subPath || '', body: body }
      : target.share
        ? { share: target.share, subPath: target.subPath || '', body: body }
        : { path: fActiveRel(target.path), body: body };
    if (anchor) payload.anchor = anchor;
    return fApiJson('/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  function fDeleteComment(commentId) {
    if (tauri) return fWebOnly();
    return fApi('/comments/' + encodeURIComponent(commentId), { method: 'DELETE' }).then(function () { return undefined; });
  }

  // ── Custom fonts (account-level; see src/fonts.rs) ──
  // Web: served as real HTTP assets, so @font-face just works in any browser.
  // Tauri: fetched through the cloud connection (if any) as base64 data: URIs
  // via Rust commands, since the desktop app has no session/account of its
  // own to authenticate a direct fetch with.

  function fListCustomFonts() {
    if (tauri) return tauri.invoke('cloud_list_fonts').catch(function () { return []; });
    return fApiJson('/fonts').catch(function () { return []; });
  }

  function fUploadCustomFont(familyName, filename, bytes) {
    if (tauri) return fWebOnly();
    var qs = '?familyName=' + encodeURIComponent(familyName) + '&filename=' + encodeURIComponent(filename);
    return fApiJson('/fonts' + qs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes
    });
  }

  function fDeleteCustomFont(id) {
    if (tauri) return fWebOnly();
    return fApi('/fonts/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { return undefined; });
  }

  // Returns a data: URI (base64) for the font, playing the same role on
  // Tauri that a direct /api/fonts/:id fetch plays on the web — a same-origin
  // <link>/@font-face url() isn't available to an unauthenticated webview,
  // but an inlined data: URI needs no request at all.
  function fCustomFontDataUrl(id) {
    if (tauri) return tauri.invoke('cloud_font_data_url', { fontId: id });
    return Promise.resolve('/api/fonts/' + encodeURIComponent(id));
  }

  var cDefaultFileContent = [
    "# Welcome to Lectern\n\n",
    "Lectern is a lightweight office suite that stores everything in **Markdown**.\n\n",
    "## Features\n\n",
    "**Documents** rich markdown editing with live preview\n",
    "**Spreadsheets** formula-capable grid stored as cell=value pairs\n",
    "## Markdown Quick Reference\n",
    "| Element | Syntax |\n",
    "|---------|--------|\n",
    "| Bold | **text** |\n",
    "| Italic | *text* |\n",
    "| Heading | # H1 ## H2 |\n",
    "| List | - item |\n",
    "| Blockquote | > text |\n",
    "| Code | ``` code ``` |\n",
    "| Link | [text](url) |\n\n",
    "## Getting Started\n\n",
    "1. Click **New** in the sidebar to create a file\n",
    "2. Write in Markdown, use the toolbar for formatting\n",
    "3. Toggle the **split** view button to preview alongside your writing\n",
    "4. Click the **download** button to export your file\n\n",
    "> All files are saved automatically to your browser's local storage.\n\n",
    "Happy writing!"
  ].join('');

  // Returns canned welcome content for a brand-new install. On Tauri this
  // matches the Rust-side `fDefaultFile` command; elsewhere it's generated
  // here so first-run works without a native backend.
  function fDefaultFile(name) {
    if (tauri) return tauri.invoke('defaultFile', { name: name });
    return Promise.resolve({
      name: 'Welcome to Lectern ' + name,
      docType: 'doc',
      content: cDefaultFileContent
    });
  }

  // Triggers a standard browser download of a Blob under the given name.
  function fDownloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Saves a one-off exported file. On Tauri this opens a native save dialog;
  // elsewhere it triggers a standard browser download of the same content.
  function fSaveFile(name, content) {
    if (tauri) return tauri.invoke('save_file', { name: name, content: content });
    try {
      fDownloadBlob(name, new Blob([content], { type: 'text/plain;charset=utf-8' }));
      return Promise.resolve(true);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // Renders `html` to a PDF server-side (headless Chromium, headers/footers
  // disabled - see src/export.rs) and downloads the result. Not available on
  // Tauri, which renders/prints PDFs locally via the print-preview flow instead.
  function fExportPdf(name, html) {
    if (tauri) return Promise.reject(new Error('exportPdf is web-only'));
    return fApi('/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'text/html;charset=utf-8' },
      body: html
    }).then(function (res) {
      return res.blob();
    }).then(function (blob) {
      fDownloadBlob(name, blob);
      return true;
    });
  }

  return {
    isNative: !!tauri,
    fSetCloudWorkspace: fSetCloudWorkspace,
    fPickWorkFolder: fPickWorkFolder,
    fListWorkFolder: fListWorkFolder,
    fReadWorkFile: fReadWorkFile,
    fWriteWorkFile: fWriteWorkFile,
    fReadWorkFileBinary: fReadWorkFileBinary,
    fWriteWorkFileBinary: fWriteWorkFileBinary,
    fFetchRemoteFile: fFetchRemoteFile,
    fStatWorkFile: fStatWorkFile,
    fCreateWorkFolder: fCreateWorkFolder,
    fDeleteWorkEntry: fDeleteWorkEntry,
    fMoveWorkEntry: fMoveWorkEntry,
    fDefaultFile: fDefaultFile,
    fSaveFile: fSaveFile,
    fExportPdf: fExportPdf,
    fCurrentUser: fCurrentUser,
    register: fRegister,
    fLogin: fLogin,
    fLogout: fLogout,
    fCloudConnect: fCloudConnect,
    fCloudDisconnect: fCloudDisconnect,
    fCloudStatus: fCloudStatus,
    fCloudSyncNow: fCloudSyncNow,
    fCloudListConflicts: fCloudListConflicts,
    fCloudResolveConflict: fCloudResolveConflict,
    fShareEntry: fShareEntry,
    fListSharesFor: fListSharesFor,
    fRevokeShare: fRevokeShare,
    fListSharedWithMe: fListSharedWithMe,
    fListSharedFolder: fListSharedFolder,
    fReadSharedFile: fReadSharedFile,
    fWriteSharedFile: fWriteSharedFile,
    fStatSharedFile: fStatSharedFile,
    fListComments: fListComments,
    fAddComment: fAddComment,
    fDeleteComment: fDeleteComment,
    fCreateShareLink: fCreateShareLink,
    fListShareLinks: fListShareLinks,
    fRevokeShareLink: fRevokeShareLink,
    fLinkMeta: fLinkMeta,
    fListLinkFolder: fListLinkFolder,
    fReadLinkFile: fReadLinkFile,
    fWriteLinkFile: fWriteLinkFile,
    fStatLinkFile: fStatLinkFile,
    fListCustomFonts: fListCustomFonts,
    fUploadCustomFont: fUploadCustomFont,
    fDeleteCustomFont: fDeleteCustomFont,
    fCustomFontDataUrl: fCustomFontDataUrl
  };
})();
