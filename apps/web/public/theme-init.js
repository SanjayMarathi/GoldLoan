// Apply the saved theme before first paint (no flash). Light (gold & white) is the default.
// A separate file, not an inline script, so the server's Content-Security-Policy can forbid inline scripts.
(function () {
  var theme = 'light';
  try {
    if (localStorage.getItem('gl-theme') === 'dark') theme = 'dark';
  } catch (e) {
    /* storage blocked (private mode) */
  }
  document.documentElement.dataset.theme = theme;
})();
