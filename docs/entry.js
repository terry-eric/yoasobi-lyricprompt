(function () {
  'use strict';
  const intro = document.getElementById('siteIntro');
  const home = document.getElementById('musicHome');
  if (!intro || !home) return;
  intro.hidden = false;
  home.inert = true;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let ending = false;
  function enter() {
    if (ending) return;
    ending = true;
    intro.classList.add('is-collapsing');
    setTimeout(() => {
      intro.hidden = true;
      home.inert = false;
      home.setAttribute('tabindex', '-1');
      home.focus({preventScroll: true});
    }, reduced.matches ? 0 : 850);
  }
  document.addEventListener('keydown', event => { if (event.key === 'Escape') enter(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) enter(); });
  setTimeout(enter, reduced.matches ? 0 : 1500);
})();
