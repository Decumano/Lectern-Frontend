// Login/register gate shown in front of the app on the web build. On Tauri
// there's no account system, so this just gets out of the way immediately.
// main.js is loaded dynamically (not via a static <script> tag) so it never
// runs — and never touches workFolderRoot-gated Platform calls — until we
// know either we're on Tauri or the user is authenticated.

(function () {
  var gate = document.getElementById('auth-gate');
  var form = document.getElementById('auth-gate-form');
  var emailInput = document.getElementById('auth-gate-email');
  var passwordInput = document.getElementById('auth-gate-password');
  var errorBox = document.getElementById('auth-gate-error');
  var submitBtn = document.getElementById('auth-gate-submit');
  var toggleLink = document.getElementById('auth-gate-toggle');
  var toggleLabel = document.getElementById('auth-gate-toggle-label');
  var mode = 'login';

  function fLoadApp() {
    gate.style.display = 'none';
    var script = document.createElement('script');
    script.src = 'main.js?v=32'; // keep the version in step with index.html's asset tags
    // main.js is the loader; it reuses this ?v= for the modules it pulls
    // in, so bumping the number here busts the whole frontend at once.
    document.body.appendChild(script);
  }

  function fShowError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function fSetMode(next) {
    mode = next;
    submitBtn.textContent = mode === 'login' ? 'Log in' : 'Create account';
    toggleLabel.textContent = mode === 'login' ? 'No account?' : 'Already have one?';
    toggleLink.textContent = mode === 'login' ? 'Register' : 'Log in';
    errorBox.style.display = 'none';
  }

  toggleLink.addEventListener('click', function (e) {
    e.preventDefault();
    fSetMode(mode === 'login' ? 'register' : 'login');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitBtn.disabled = true;
    var action = mode === 'login' ? Platform.fLogin : Platform.register;
    action(emailInput.value, passwordInput.value)
      .then(fLoadApp)
      .catch(function (err) {
        fShowError(err.message || 'Something went wrong');
        submitBtn.disabled = false;
      });
  });

  if (Platform.isNative) {
    fLoadApp();
    return;
  }

  // Share links carry their own authorization (the token); no login needed.
  if (/^#link=/.test(window.location.hash)) {
    fLoadApp();
    return;
  }

  Platform.fCurrentUser().then(function (user) {
    if (user) {
      fLoadApp();
    } else {
      gate.style.display = 'flex';
    }
  });
})();
