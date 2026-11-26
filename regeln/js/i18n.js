// Language: English or German. Static text sits twice in the page (class "en" / "de"), CSS shows one.
// Scripts use T(english, german). The choice is remembered; the first visit follows the browser language.
(function (root) {
  'use strict';
  let lang = null;
  try { lang = localStorage.getItem('errantry-lang'); } catch (e) { /* private mode */ }
  if (lang !== 'de' && lang !== 'en') lang = /^de\b/i.test((root.navigator && navigator.language) || '') ? 'de' : 'en';
  const html = root.document && document.documentElement;
  if (html) { html.classList.add(lang); html.lang = lang; }
  const T = (en, de) => (lang === 'de' && de !== undefined ? de : en);
  function set(l) {
    if (l === lang) return;
    try { localStorage.setItem('errantry-lang', l); } catch (e) { /* private mode */ }
    try { sessionStorage.setItem('errantry-scroll', String(root.scrollY)); } catch (e) { /* ignore */ }
    root.location.reload();
  }
  // keep the reading position when switching
  if (root.addEventListener) root.addEventListener('load', () => {
    let y = null;
    try { y = sessionStorage.getItem('errantry-scroll'); sessionStorage.removeItem('errantry-scroll'); } catch (e) { /* ignore */ }
    if (y !== null) root.scrollTo(0, +y);
  });
  root.ErrI18n = { lang, T, set };
  root.T = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
