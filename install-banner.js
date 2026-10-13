/*
  Duckcellent install banner
  ---------------------------------------------------------------
  - Android + desktop Chrome/Edge: shows an "Install" button that opens
    the browser's real install dialog.
  - iPhone/iPad: shows "Tap Share, then Add to Home Screen" (Apple does
    not allow a real install button).
  - Instagram/TikTok/Facebook in-app browsers: suggests opening in a
    normal browser, since installing isn't possible there.
  - Hidden when the app is already installed / opened from the home screen.
  - "Not now" hides it for 14 days on that device.

  Optional: any element with the attribute  data-install-app
  (e.g. a menu item) will also trigger the install / instructions.
*/
(function () {
  if (window.__duckInstallBanner) return;
  window.__duckInstallBanner = true;

  var STORAGE_KEY = 'duckcellent-install-dismissed';
  var HIDE_DAYS = 14;
  var SHOW_DELAY_MS = 3000;
  var ICON = '/icon-192.png';

  var ua = navigator.userAgent || '';
  var isStandalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
  var isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isInApp = /FBAN|FBAV|Instagram|TikTok|musical_ly|Snapchat|Line\/|Twitter/i.test(ua);

  var deferredPrompt = null;
  var banner = null;

  function dismissedRecently() {
    try {
      var t = Number(localStorage.getItem(STORAGE_KEY));
      return t && Date.now() - t < HIDE_DAYS * 86400000;
    } catch (e) {
      return false;
    }
  }
  function rememberDismiss() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (e) {}
  }

  var shareIcon =
    '<svg class="dib-share" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path fill="currentColor" d="M12 2l4 4-1.4 1.4L13 5.8V15h-2V5.8L9.4 7.4 8 6l4-4z"/>' +
    '<path fill="currentColor" d="M5 10h3v2H6v8h12v-8h-2v-2h3a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V11a1 1 0 011-1z"/></svg>';

  function injectStyles() {
    if (document.getElementById('dib-styles')) return;
    var css =
      '.dib{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483000;' +
      'max-width:480px;margin:0 auto;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;' +
      'background:#ffffff;color:#0E161A;box-shadow:0 8px 30px rgba(14,22,26,.18);' +
      'font:15px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transform:translateY(140%);transition:transform .35s ease}' +
      '.dib.dib-show{transform:translateY(0)}' +
      '.dib img{width:44px;height:44px;border-radius:10px;flex:none}' +
      '.dib-text{flex:1;min-width:0}' +
      '.dib-title{font-weight:600;margin:0 0 2px}' +
      '.dib-sub{margin:0;color:#4A5A60;font-size:13.5px}' +
      '.dib-share{vertical-align:-3px;color:#0B7A75}' +
      '.dib-actions{display:flex;gap:6px;flex:none}' +
      '.dib button{font:inherit;font-size:14px;border:0;border-radius:10px;padding:8px 12px;cursor:pointer}' +
      '.dib-install{background:#0B7A75;color:#fff;font-weight:600}' +
      '.dib-close{background:transparent;color:#4A5A60}' +
      '@media (prefers-color-scheme:dark){.dib{background:#18242A;color:#EBF0EF;box-shadow:0 8px 30px rgba(0,0,0,.5)}' +
      '.dib-sub,.dib-close{color:#A9B8BD}.dib-share{color:#4FC2BB}}' +
      '@media (prefers-reduced-motion:reduce){.dib{transition:none}}';
    var style = document.createElement('style');
    style.id = 'dib-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildBanner(mode) {
    injectStyles();
    if (banner) banner.remove();

    var title = 'Get the Duckcellent app';
    var sub, actions;

    if (mode === 'prompt') {
      sub = 'Install it on your device for quick, full-screen access.';
      actions =
        '<button type="button" class="dib-close">Not now</button>' +
        '<button type="button" class="dib-install">Install</button>';
    } else if (mode === 'ios') {
      sub = 'Tap ' + shareIcon + ' <strong>Share</strong>, then <strong>Add to Home Screen</strong>.';
      actions = '<button type="button" class="dib-close" aria-label="Close">Close</button>';
    } else {
      sub = 'Open this page in Safari or Chrome to install the app.';
      actions = '<button type="button" class="dib-close" aria-label="Close">Close</button>';
    }

    banner = document.createElement('div');
    banner.className = 'dib';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', title);
    banner.innerHTML =
      '<img src="' + ICON + '" alt="">' +
      '<div class="dib-text"><p class="dib-title">' + title + '</p><p class="dib-sub">' + sub + '</p></div>' +
      '<div class="dib-actions">' + actions + '</div>';
    document.body.appendChild(banner);

    banner.querySelector('.dib-close').addEventListener('click', function () {
      rememberDismiss();
      hideBanner();
    });
    var installBtn = banner.querySelector('.dib-install');
    if (installBtn) installBtn.addEventListener('click', runInstall);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { banner && banner.classList.add('dib-show'); });
    });
  }

  function hideBanner() {
    if (!banner) return;
    var b = banner;
    banner = null;
    b.classList.remove('dib-show');
    setTimeout(function () { b.remove(); }, 400);
  }

  function runInstall() {
    if (!deferredPrompt) return;
    var p = deferredPrompt;
    deferredPrompt = null;
    hideBanner();
    p.prompt();
    p.userChoice.then(function (choice) {
      if (choice && choice.outcome === 'dismissed') rememberDismiss();
    });
  }

  // Lets any element with data-install-app trigger install or instructions.
  function bindTriggers() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-install-app]');
      if (!el) return;
      e.preventDefault();
      if (isStandalone) return;
      if (deferredPrompt) runInstall();
      else if (isInApp) buildBanner('inapp');
      else if (isIOS) buildBanner('ios');
    });
  }

  function start() {
    bindTriggers();
    if (isStandalone) return;

    // Android + desktop Chrome/Edge
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (!dismissedRecently()) {
        setTimeout(function () { if (deferredPrompt) buildBanner('prompt'); }, SHOW_DELAY_MS);
      }
    });

    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      rememberDismiss();
      hideBanner();
    });

    if (dismissedRecently()) return;

    if (isInApp) {
      setTimeout(function () { buildBanner('inapp'); }, SHOW_DELAY_MS);
    } else if (isIOS) {
      setTimeout(function () { buildBanner('ios'); }, SHOW_DELAY_MS);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
