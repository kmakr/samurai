// Keyboard and mouse. Edge-triggered actions are buffered for a few frames so
// an input landing during hitstop or recovery still counts.

const BUFFER = 0.16;

export class Input {
  constructor(domElement) {
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.buffers = { attack: 0, dash: 0, parry: 0, focus: 0 };
    this.enabled = true;

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
  moveVector(out) {
    let x = 0, z = 0;
    if (this.has('KeyW') || this.has('ArrowUp')) z -= 1;
    if (this.has('KeyS') || this.has('ArrowDown')) z += 1;
    if (this.has('KeyA') || this.has('ArrowLeft')) x -= 1;
    if (this.has('KeyD') || this.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 0) { x /= len; z /= len; }
    out.set(x, 0, z);
    return len > 0;
  }
}
