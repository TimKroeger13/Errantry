// Progress reporting for the visible run windows (cli/visible.js): lines starting with
// "##P " are turned into a PowerShell progress bar there. Only active when the window
// sets ERRANTRY_PROGRESS=1, so plain console runs stay clean.
'use strict';

const enabled = process.env.ERRANTRY_PROGRESS === '1';

const fmtTime = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'min ' : '') + sec + 's';
};

// Creates a tracker; call update(fraction, status) with fraction in [0, 1].
function tracker(label) {
  const t0 = Date.now();
  let last = 0;
  return {
    update(fraction, status) {
      const now = Date.now();
      if (!enabled || (now - last < 400 && fraction < 1)) return;
      last = now;
      const el = (now - t0) / 1000;
      const rest = fraction > 0.002 ? (el / fraction) * (1 - fraction) : -1;
      const pct = Math.max(0, Math.min(100, fraction * 100));
      process.stdout.write('##P ' + pct.toFixed(1) + '|' + Math.round(rest) + '|' + label + '|' + (status || '') +
        ' · vergangen ' + fmtTime(el) + (rest >= 0 ? ' · Rest ~' + fmtTime(rest) : '') + '\n');
    },
  };
}

module.exports = { tracker, fmtTime, enabled };
