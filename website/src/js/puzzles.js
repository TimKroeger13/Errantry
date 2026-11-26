// Order puzzles – like chess problems: resolve the cards in front of you in the best order.
// `best` is the best life total (checked by test/regeln.test.js against the solver and the engine).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ErrPuzzles = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return [
    { id: 'biggest', title: 'Biggest first', hp: 20, weapon: { v: 7, kills: [] }, cards: ['3C', '5S', '8C', '10S'], best: 16,
      text: 'A weapon only blocks enemies weaker than the last one it beat. Mind the order!',
      explain: 'Going from strong to weak lets one weapon block all four.',
      title_de: 'Die Großen zuerst', text_de: 'Eine Waffe blockt nur Gegner, die schwächer sind als der zuletzt besiegte. Achte auf die Reihenfolge!',
      explain_de: 'Von stark nach schwach blockt eine einzige Waffe alle vier.' },
    { id: 'heal-late', title: 'Hurt first, heal after', hp: 14, weapon: null, cards: ['8H', '5S', '6C', '3D'], best: 17,
      text: 'You can’t heal above 20. When is the right moment to drink?',
      explain: 'Take damage first, then drink, so nothing of the potion is wasted.',
      title_de: 'Erst verletzen, dann heilen', text_de: 'Über 20 kannst du nicht heilen. Wann ist der richtige Moment zum Trinken?',
      explain_de: 'Erst Schaden nehmen, dann trinken. So geht vom Trank nichts verloren.' },
    { id: 'margin', title: 'Thin margins', hp: 7, weapon: { v: 3, kills: [8] }, cards: ['6S', '9C', '10D', '5H', '7C', '7S'], best: 8,
      text: 'Only 7 life and a tired 3 weapon that already beat an 8. A fresh 10 is coming. But look: there are <b>two 7s</b>.',
      explain: 'The 10 can only take one of the 7s. So let the tired 3 take the other 7 first (4 damage), then equip the 10 for 9, 7 and 6.',
      title_de: 'Knapp bemessen', text_de: 'Nur 7 Leben und eine müde 3er-Waffe, die schon eine 8 besiegt hat. Eine frische 10 kommt dazu. Aber Achtung: Es gibt <b>zwei 7en</b>.',
      explain_de: 'Die 10 kann nur eine der 7en nehmen. Lass also zuerst die müde 3 die andere 7 nehmen (4 Schaden), dann lege die 10 an für 9, 7 und 6.' },
    { id: 'run', type: 'flee', title: 'Know when to retreat', hp: 8, weapon: { v: 5, kills: [6] }, hand: ['JC', 'QS', 'KC', 'AS'],
      partner: { hp: 20, weapon: 'no weapon', says: 'Either way.', word: 'Open', says_de: 'Ist mir egal.', word_de: 'Offen' },
      text: 'A new round. You have <b>8 life</b> and a worn 5 weapon that already beat a 6. Your partner has 20 life and no weapon, and says <b>Open</b>. Look at your hand: fight or flee?',
      fightPlan: [{ k: 2, to: 'partner' }, { k: 0, to: 'you' }, { k: 3, to: 'partner' }, { k: 1, to: 'keep' }],
      fightSay: 'Even the wisest split: King and Ace to your partner, the Jack to you, the Queen held back…',
      fightResult: '<b class="big">Neither of you survives.</b><br>Your weapon can’t block anything from 6 up, so the Jack hits you for <b>11</b> (you have 8). Your partner takes King + Ace: <b>27</b> damage with only 20 life. This hand could not be held.',
      fleeResult: '<b class="big">Wisely chosen: you flee.</b><br>Four strong foes, a worn weapon and 8 life: this round cannot be survived. Under the deck they go. They will return, when you are ready for them.',
      title_de: 'Wann man weichen muss',
      text_de: 'Eine neue Runde. Du hast <b>8 Leben</b> und eine abgenutzte 5er-Waffe, die schon eine 6 besiegt hat. Dein Partner hat 20 Leben und keine Waffe und sagt <b>Offen</b>. Schau auf deine Hand: kämpfen oder fliehen?',
      fightSay_de: 'Selbst die klügste Aufteilung: König und Ass zum Partner, der Bube zu dir, die Dame hältst du zurück …',
      fightResult_de: '<b class="big">Keiner von euch übersteht diese Runde.</b><br>Deine Waffe blockt nichts ab 6, also trifft dich der Bube mit <b>11</b> (du hast 8). Dein Partner nimmt König + Ass: <b>27</b> Schaden bei nur 20 Leben. Diese Hand war nicht zu halten.',
      fleeResult_de: '<b class="big">Weise gewählt: Ihr flieht.</b><br>Vier starke Feinde, eine abgenutzte Waffe und 8 Leben: Diese Runde ist nicht zu überstehen. Unter das Deck mit ihnen. Sie kehren wieder, wenn ihr bereit seid.' },
  ];
});
