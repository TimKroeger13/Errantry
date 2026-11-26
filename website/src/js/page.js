// Wires the page together: menu, chapter highlighting, round steps and all interactive pieces.
(function (root) {
  'use strict';
  const W = root.ErrWidgets, R = root.ErrRules, $ = (s) => document.querySelector(s), T = root.T;

  // language pill
  const ls = $('.lang-switch');
  if (ls) {
    ls.setAttribute('aria-label', T('Auf Deutsch lesen', 'Read in English'));
    ls.addEventListener('click', () => root.ErrI18n.set(root.ErrI18n.lang === 'de' ? 'en' : 'de'));
  }

  // ---------------------------------------------------------------- round steps light up one after the other
  const steps = [...document.querySelectorAll('.steps li')];
  const sio = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { const i = steps.indexOf(e.target); setTimeout(() => e.target.classList.add('lit'), 120 * (i % 3)); sio.unobserve(e.target); }
  }, { threshold: 0.6 });
  steps.forEach((s) => sio.observe(s));

  // ---------------------------------------------------------------- pictures and scenes
  W.cardRows();
  W.heroWall($('.hero .wall'));
  W.sorter($('.sorter'));
  W.tableSketch($('.sketchbox'));
  W.dealScene($('.deal-scene'));
  W.puzzles($('.puzzles'));

  const reach = (w) => (!w ? T('no weapon', 'keine Waffe') : R.weaponReach(w) >= 15 ? T('a fresh ' + w.v + ' weapon', 'einer frischen ' + w.v + 'er-Waffe') : T('a ' + w.v + ' weapon that still blocks up to ' + R.weaponReach(w), 'einer ' + w.v + 'er-Waffe, die noch bis ' + R.weaponReach(w) + ' blockt'));
  const scene = (sel, cfg) => { const el = $(sel); if (el) W.onVisible(el, () => new root.ErrResolver(el, cfg)); };

  scene('.scene-a', {
    title: T('The weapon wears out', 'Die Waffe nutzt sich ab'), player: { hp: 20, weapon: { v: 8, kills: [] } }, cards: ['QS', '9C', '7S', '7C'],
    goal: T('You hold a fresh <b>8 weapon</b>. Fight all four enemies. What happens with the second 7?', 'Du hast eine frische <b>8er-Waffe</b>. Besiege alle vier Gegner. Was passiert mit der zweiten 7?'),
    intro: T('Tip: drag an enemy onto your <b>Weapon</b> to block it, or onto <b>You</b> to fight bare-handed.', 'Tipp: Zieh einen Gegner auf deine <b>Waffe</b>, um ihn zu blocken, oder auf <b>Du</b>, um mit Fäusten zu kämpfen.'),
    explain: T('The second 7 had to be fought bare-handed. After beating a 7, the weapon only blocks 6 and less.', 'Die zweite 7 musste mit Fäusten bekämpft werden. Nach einer 7 blockt die Waffe nur noch 6 und weniger.'),
  });
  scene('.scene-b', {
    title: T('Old weapon first', 'Erst die alte Waffe'), player: { hp: 20, weapon: { v: 4, kills: [] } }, cards: ['9D', '4S', '2C', 'QS'],
    goal: T('Your <b>4 weapon</b> is still fresh, and a <b>9</b> is coming. Don’t waste either of them.', 'Deine <b>4er-Waffe</b> ist noch frisch, und eine <b>9</b> kommt dazu. Verschwende keine von beiden.'),
    finishText: (p, best) => (p.hp < best.hp ? null : R.weaponReach(p.weapon) >= R.weaponReach(best.weapon)
      ? T('<span class="big">Masterfully done!</span> ' + p.hp + ' life and ' + reach(p.weapon) + ': the 4 took the small ones, the 9 the Queen.', '<span class="big">Meisterhaft!</span> ' + p.hp + ' Leben und eine 9er-Waffe, die noch bis 11 blockt: Die 4 hat die Kleinen genommen, die 9 die Dame.')
      : T('Good: ' + p.hp + ' life is the best possible. But you end with ' + reach(p.weapon) + '. Let the old 4 take the 4 and the 2 first, then switch: your 9 will still block up to 11.', 'Gut: ' + p.hp + ' Leben sind das Beste. Aber du endest mit ' + reach(p.weapon) + '. Lass zuerst die alte 4 die 4 und die 2 nehmen, dann wechsle: Deine 9 blockt dann noch bis 11.')),
  });
  scene('.scene-thief', {
    title: T('The thief comes in handy', 'Der Dieb kommt gelegen'), badge: T('Try it · Expansion', 'Ausprobieren · Erweiterung'), player: { hp: 20, weapon: null }, cards: ['6S', '4C', 'AS', '2D', '8D', 'JK', '5H'],
    goal: T('No weapon, 20 life and seven cards, among them a thief. Hint: a thief can take away a weapon you don’t need anymore.', 'Keine Waffe, 20 Leben und sieben Karten, darunter ein Dieb. Tipp: Ein Dieb kann dir eine Waffe abnehmen, die du nicht mehr brauchst.'),
  });

  W.onVisible($('.hero .fan'), () => W.heroFan($('.hero .fan')));

  // the conversation pops up bubble by bubble when it scrolls into view
  const chat = $('.chat');
  if (chat) {
    const cio = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      cio.disconnect();
      chat.querySelectorAll('.msg').forEach((m, i) => setTimeout(() => m.classList.add('in'), 250 + i * 750));
    }, { threshold: 0.35 });
    cio.observe(chat);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
