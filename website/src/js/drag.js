// A table of cards that live: pointer drag with spring physics, flights, hover tilt + shine.
// Positions are only ever set through transform; the container rect is measured on grab and on scroll,
// never per frame.
(function (root) {
  'use strict';
  const P = root.ErrPhysics;
  const canHover = () => root.matchMedia && root.matchMedia('(hover: hover)').matches;
  const reducedMotion = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class CardTable {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts || {};
      this.items = [];
      this.z = 10;
      this.running = false;
      this.last = 0;
      this.drag = null;
      this._tick = this._tick.bind(this);
      this._onDown = this._onDown.bind(this);
      this._onMove = this._onMove.bind(this);
      this._onUp = this._onUp.bind(this);
      el.addEventListener('pointerdown', this._onDown);
      el.addEventListener('pointermove', this._onMove);
      el.addEventListener('pointerup', this._onUp);
      el.addEventListener('pointercancel', this._onUp);
      el.addEventListener('pointerleave', (e) => { if (!this.drag) this._clearHover(); });
      root.addEventListener('scroll', () => { if (this.drag) this.rect = this.el.getBoundingClientRect(); }, { passive: true });
    }

    // Adds a card element at (x, y) in table coordinates.
    add(cardEl, x, y, data) {
      cardEl.classList.add('t-card');
      const item = { el: cardEl, body: P.bodyAt(x, y), home: { x, y, scale: 1 }, turn: 0, flight: null, data: data || {}, active: false, locked: false };
      cardEl._item = item;
      cardEl.style.zIndex = ++this.z;
      this.el.appendChild(cardEl);
      this.items.push(item);
      this._paint(item);
      return item;
    }

    remove(item) {
      this.items = this.items.filter((i) => i !== item);
      item.el.remove();
    }

    clear() { for (const i of this.items.slice()) this.remove(i); }

    raise(item) { item.el.style.zIndex = ++this.z; }

    // Sends a card home along its spring (short hops) or as a flight (long ways).
    moveTo(item, x, y, opt) {
      opt = opt || {};
      item.home = { x, y, scale: opt.scale || 1 };
      if (opt.turn !== undefined) item.turn = opt.turn;
      if (reducedMotion() && opt.instant !== false) { Object.assign(item.body, { x, y, vx: 0, vy: 0, tilt: 0, tiltX: 0, tiltY: 0, scale: item.home.scale }); item.flight = null; this._paint(item); return; }
      if (opt.fly) item.flight = { delay: opt.delay || 0, top: opt.speed || 2600 };
      else item.flight = null;
      if (opt.raise !== false) this.raise(item);
      this._wake(item);
    }

    // Puts a card somewhere without animation.
    place(item, x, y) {
      Object.assign(item.body, { x, y, vx: 0, vy: 0, tilt: 0, tiltX: 0, tiltY: 0 });
      item.home = { x, y, scale: 1 };
      item.flight = null;
      this._paint(item);
    }

    // A little nudge: the card shakes its head (wrong drop) or hops (attention).
    shake(item) { item.body.vx += 900; this._wake(item); }
    hop(item) { item.body.vy -= 700; item.body.vScale += 1.2; this._wake(item); }

    // ------------------------------------------------------------ loop
    _wake(item) {
      item.active = true;
      if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(this._tick); }
    }

    _tick(now) {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      let any = false;
      for (const it of this.items) {
        if (!it.active) continue;
        const b = it.body;
        if (this.drag && this.drag.item === it) {
          P.springStep(b, { x: this.drag.tx, y: this.drag.ty, scale: 1.06 }, dt);
        } else if (it.flight) {
          if (it.flight.delay > 0) { it.flight.delay -= dt; any = true; continue; }
          let t = dt, arrived = false;
          while (t > 0 && !arrived) { const s = Math.min(P.STEP_S, t); arrived = P.weightStep(b, it.home, s, it.flight.top); t -= s; }
          b.tiltX *= 0.8; b.tiltY *= 0.8;
          if (arrived) { it.flight = null; b.tilt *= 0.5; }
        } else {
          P.springStep(b, it.home, dt);
          if (P.isSettled(b, it.home)) {
            Object.assign(b, { x: it.home.x, y: it.home.y, vx: 0, vy: 0, scale: it.home.scale, vScale: 0, tilt: 0, tiltX: 0, tiltY: 0 });
            it.active = false;
            it.el.classList.remove('moving');
            if (it.onSettle) { const f = it.onSettle; it.onSettle = null; f(it); }
          }
        }
        if (it.active) { any = true; it.el.classList.add('moving'); }
        this._paint(it);
      }
      if (any) requestAnimationFrame(this._tick); else this.running = false;
    }

    _paint(it) { it.el.style.transform = P.transformOf(it.body, it.turn); }

    // ------------------------------------------------------------ pointer
    _local(e) { return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top }; }

    _onDown(e) {
      const cardEl = e.target.closest('.t-card');
      if (!cardEl || !cardEl._item || e.button > 0) return;
      const item = cardEl._item;
      if (item.locked || (this.opts.canDrag && !this.opts.canDrag(item))) {
        this.pending = { item, sx: e.clientX, sy: e.clientY, tapOnly: true };
        return;
      }
      this.rect = this.el.getBoundingClientRect();
      const p = this._local(e);
      this.pending = { item, sx: e.clientX, sy: e.clientY, ox: p.x - item.body.x, oy: p.y - item.body.y, id: e.pointerId };
      cardEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    _onMove(e) {
      if (this.pending && !this.pending.tapOnly && !this.drag && e.pointerId === this.pending.id) {
        if (Math.hypot(e.clientX - this.pending.sx, e.clientY - this.pending.sy) > 6) {
          const it = this.pending.item;
          it.flight = null;
          this.drag = { item: it, ox: this.pending.ox, oy: this.pending.oy, tx: it.body.x, ty: it.body.y };
          this.raise(it);
          it.el.classList.add('dragging');
          this.el.classList.add('is-dragging');
          this._clearHover();
          if (this.opts.onPick) this.opts.onPick(it);
          this._wake(it);
        }
      }
      if (this.drag) {
        const p = this._local(e);
        this.drag.tx = p.x - this.drag.ox;
        this.drag.ty = p.y - this.drag.oy;
        this.drag.cx = e.clientX; this.drag.cy = e.clientY;
        if (this.opts.onDragMove) this.opts.onDragMove(this.drag.item, e.clientX, e.clientY);
        return;
      }
      if (e.pointerType === 'mouse' && canHover()) this._hover(e);
    }

    _onUp(e) {
      const pend = this.pending;
      this.pending = null;
      if (this.drag) {
        const d = this.drag, it = d.item;
        this.drag = null;
        it.el.classList.remove('dragging');
        this.el.classList.remove('is-dragging');
        let res = null;
        if (this.opts.onDrop && e.type !== 'pointercancel') res = this.opts.onDrop(it, { x: d.tx, y: d.ty, clientX: e.clientX, clientY: e.clientY });
        if (res && res.x !== undefined) it.home = { x: res.x, y: res.y, scale: 1 };
        this._wake(it); // otherwise it springs back home
        return;
      }
      if (pend && Math.hypot(e.clientX - pend.sx, e.clientY - pend.sy) <= 6 && this.opts.onTap) this.opts.onTap(pend.item, e);
    }

    // hover tilt + shine (CardCrafter gallery): only for a resting card under a mouse
    _hover(e) {
      const cardEl = e.target.closest('.t-card');
      if (this.hovered && this.hovered !== cardEl) this._clearHover();
      if (!cardEl || cardEl.classList.contains('moving')) return;
      this.hovered = cardEl;
      const face = cardEl.querySelector('.face');
      const r = face.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      face.style.setProperty('--tilt-x', ((0.5 - y) * 12).toFixed(2) + 'deg');
      face.style.setProperty('--tilt-y', ((x - 0.5) * 14).toFixed(2) + 'deg');
      face.style.setProperty('--shine-x', (x * 100).toFixed(1) + '%');
      face.style.setProperty('--shine-y', (y * 100).toFixed(1) + '%');
      cardEl.classList.add('hover');
    }

    _clearHover() {
      if (!this.hovered) return;
      const face = this.hovered.querySelector('.face');
      if (face) { face.style.removeProperty('--tilt-x'); face.style.removeProperty('--tilt-y'); }
      this.hovered.classList.remove('hover');
      this.hovered = null;
    }
  }

  root.ErrTable = CardTable;
})(typeof globalThis !== 'undefined' ? globalThis : this);
