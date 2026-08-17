// Keyboard, mouse, and touch. Edge-triggered actions are buffered for a few
// frames so an input landing during hitstop or recovery still counts.

const BUFFER = 0.16;

export class Input {
  constructor(domElement) {
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.buffers = { attack: 0, dash: 0, parry: 0, focus: 0 };
    this.enabled = true;
    // Touch: a dynamic left-thumb stick plus action buttons that feed the same
    // buffers as keys. `touchActive` flips the aim model from cursor to auto.
    this.touchActive = false;
    this.stick = { id: -1, active: false, x: 0, z: 0, ox: 0, oy: 0 };

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Space') this.buffers.parry = BUFFER;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.buffers.dash = BUFFER;
      if (e.code === 'KeyF') this.buffers.focus = BUFFER;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    domElement.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.button === 0) this.buffers.attack = BUFFER;
      if (e.button === 2) this.buffers.focus = BUFFER;
    });
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // The stick has no fixed home: it is born where the thumb lands on the left
  // half of the screen and dies when the thumb lifts. `ring`/`nub` are the
  // visual; the zone owns the pointer so buttons never steal a moving thumb.
  bindStick(zone, ring, nub) {
    const RADIUS = 52;
    const DEAD = 10;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1 || !this.enabled) return;
      this.touchActive = true;
      this.stick.id = e.pointerId;
      this.stick.active = true;
      this.stick.ox = e.clientX;
      this.stick.oy = e.clientY;
      try { zone.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      ring.classList.add('on');
      nub.style.transform = 'translate(-50%, -50%)';
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
      nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      if (len < DEAD) { this.stick.x = 0; this.stick.z = 0; }
      else { this.stick.x = dx / RADIUS; this.stick.z = dy / RADIUS; }
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = -1;
      this.stick.active = false;
      this.stick.x = 0;
      this.stick.z = 0;
      ring.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  // Action buttons press on pointerdown, not click — parry timing cannot
  // afford the synthetic-click delay.
  bindButton(el, name) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touchActive = true;
      el.classList.add('pressed');
      if (this.enabled) this.buffers[name] = BUFFER;
    });
    const up = () => el.classList.remove('pressed');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  has(code) { return this.keys.has(code); }

  // Consume a buffered action; returns true at most once per press.
  take(name) {
    if (this.buffers[name] > 0) { this.buffers[name] = 0; return true; }
    return false;
  }

  update(dt) {
    for (const k in this.buffers) {
      if (this.buffers[k] > 0) this.buffers[k] = Math.max(0, this.buffers[k] - dt);
    }
  }

  // Movement intent in world axes, camera-relative (the camera yaw is fixed).
  // Keyboard wins when both are held; the stick is analog up to full speed.
  moveVector(out) {
    let x = 0, z = 0;
    if (this.has('KeyW') || this.has('ArrowUp')) z -= 1;
    if (this.has('KeyS') || this.has('ArrowDown')) z += 1;
    if (this.has('KeyA') || this.has('ArrowLeft')) x -= 1;
    if (this.has('KeyD') || this.has('ArrowRight')) x += 1;
    let len = Math.hypot(x, z);
    if (len > 0) {
      x /= len; z /= len;
    } else if (this.stick.active) {
      x = this.stick.x; z = this.stick.z;
      len = Math.hypot(x, z);
      if (len > 1) { x /= len; z /= len; }
    }
    out.set(x, 0, z);
    return len > 0;
  }
}
