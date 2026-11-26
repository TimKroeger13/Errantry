// Cards with weight – ported from CardCrafter (cardPhysics.ts + cardWeight.ts).
// spring: a card hangs on a damped spring towards where it should be, overshoots a little and settles.
//         The same spring carries it behind the pointer while dragging and back into place when let go.
// flight: a card flies to a goal at top speed, brakes in time and leans into the way it goes.
(function (root) {
  'use strict';

  const STIFFNESS = 380;
  const DAMPING_RATIO = 0.66; // below 1 the spring swings over once – that gives the card weight
  const TILT_PER_SPEED = 0.012;
  const MAX_TILT = 16;
  const MAX_TILT_3D = 12;
  const TILT_FOLLOW = 14;
  const MAX_STEP_S = 1 / 30;

  const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));

  function bodyAt(x, y, scale) {
    return { x, y, vx: 0, vy: 0, scale: scale || 1, vScale: 0, tilt: 0, tiltX: 0, tiltY: 0 };
  }

  // One step of time along the spring (mutates the body).
  function springStep(b, target, seconds, stiffness) {
    const k = stiffness || STIFFNESS;
    const dt = Math.min(seconds, MAX_STEP_S);
    const damping = 2 * Math.sqrt(k) * DAMPING_RATIO;
    b.vx += (k * (target.x - b.x) - damping * b.vx) * dt;
    b.vy += (k * (target.y - b.y) - damping * b.vy) * dt;
    b.vScale += (k * (target.scale - b.scale) - damping * b.vScale) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.scale += b.vScale * dt;
    const follow = Math.min(1, TILT_FOLLOW * dt);
    b.tilt += (clamp(b.vx * TILT_PER_SPEED, MAX_TILT) - b.tilt) * follow;
    b.tiltX += (clamp(-b.vy * TILT_PER_SPEED, MAX_TILT_3D) - b.tiltX) * follow;
    b.tiltY += (clamp(b.vx * TILT_PER_SPEED, MAX_TILT_3D) - b.tiltY) * follow;
  }

  function isSettled(b, target) {
    return Math.hypot(b.x - target.x, b.y - target.y) < 0.6 &&
      Math.hypot(b.vx, b.vy) < 25 &&
      Math.abs(b.scale - target.scale) < 0.004 &&
      Math.abs(b.vScale) < 0.05 &&
      Math.abs(b.tilt) < 0.3 && Math.abs(b.tiltX) < 0.3 && Math.abs(b.tiltY) < 0.3;
  }

  // ---- flights (cardWeight.ts)
  const MAX_ACCELERATION = 9000;
  const ARRIVED_PX = 0.6;
  const ARRIVED_SPEED = 40;
  const FLIGHT_TILT_PER_SPEED = 0.008;
  const FLIGHT_MAX_TILT = 12;
  const LIFT_AT_TOP_SPEED = 0.07;
  const STEP_S = 1 / 120;

  // Returns true once arrived.
  function weightStep(b, goal, seconds, topSpeed) {
    const dx = goal.x - b.x, dy = goal.y - b.y;
    const distance = Math.hypot(dx, dy), speed = Math.hypot(b.vx, b.vy);
    if (distance < ARRIVED_PX && speed < ARRIVED_SPEED) {
      b.x = goal.x; b.y = goal.y; b.vx = 0; b.vy = 0;
      return true;
    }
    const wanted = Math.min(topSpeed, Math.sqrt(2 * MAX_ACCELERATION * distance) * 0.92);
    const wantX = distance > 0 ? (dx / distance) * wanted : 0;
    const wantY = distance > 0 ? (dy / distance) * wanted : 0;
    const cx = wantX - b.vx, cy = wantY - b.vy, change = Math.hypot(cx, cy);
    const possible = MAX_ACCELERATION * seconds;
    const part = change > possible ? possible / change : 1;
    b.vx += cx * part; b.vy += cy * part;
    b.x += b.vx * seconds; b.y += b.vy * seconds;
    b.tilt += (clamp(b.vx * FLIGHT_TILT_PER_SPEED, FLIGHT_MAX_TILT) - b.tilt) * Math.min(1, TILT_FOLLOW * seconds);
    b.scale = 1 + LIFT_AT_TOP_SPEED * Math.min(1, Math.hypot(b.vx, b.vy) / topSpeed);
    return false;
  }

  function transformOf(b, turn) {
    return 'translate3d(' + b.x.toFixed(2) + 'px,' + b.y.toFixed(2) + 'px,0) perspective(700px) rotateX(' + b.tiltX.toFixed(2) +
      'deg) rotateY(' + b.tiltY.toFixed(2) + 'deg) rotate(' + ((turn || 0) + b.tilt).toFixed(2) + 'deg) scale(' + b.scale.toFixed(4) + ')';
  }

  root.ErrPhysics = { STIFFNESS, STEP_S, bodyAt, springStep, isSettled, weightStep, transformOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
