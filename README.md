# 侍 — INK AND STEEL

A browser-based 3D samurai hack-and-slash rendered as black-and-white film, where
every wound bleeds into the arena like ink soaking into paper.

No build step, no dependencies to install, no art assets — every texture, sound
and animation is generated procedurally at load.

## Running it

ES modules need to be served over HTTP (opening `index.html` from disk will fail
CORS). Any static server works:

```bash
python3 -m http.server 5173
```

Then open <http://localhost:5173>.

## Deployment

Hosted on Cloudflare Pages — project `samurai`, live at
<https://samurai.theoazriel.com> (also <https://samurai-exp.pages.dev>).

There is no build step, so deploys are a direct upload of the repo contents:

```bash
git archive HEAD | tar -x -C /tmp/samurai-deploy
rm -rf /tmp/samurai-deploy/.claude
npx wrangler pages deploy /tmp/samurai-deploy --project-name=samurai --branch=master
```

Staging from `git archive` rather than uploading the working directory keeps
`.git` and local editor state out of the published site.

Note this is **direct upload, not Git-connected** — pushing to GitHub does not
redeploy on its own. Connecting the repo in the Cloudflare dashboard (Workers &
Pages → the project → Settings → Builds) enables push-to-deploy and PR previews;
build command stays empty and output directory is `/`.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Mouse | Aim the cut |
| Click | Slash — a three-hit chain; the third cut cleaves a man in two |
| `Shift` | Dash (invulnerable) |
| `Space` | Parry — time it against the enemy's white blade |
| `F` | Iai draw, once focus is full |

Enemies telegraph by lighting their blade white. Parrying at that moment
deflects the blow and fills focus fast; focus also builds on kills. A full
meter buys one iai draw, which flash-steps forward and cuts down everything in
a corridor ahead.

## The look

The whole art direction rests on one idea: **the duel happens on a sheet of
paper.** The arena is washi — the only bright surface in the scene — so black
ink reads at any distance and the frame gets its Kurosawa contrast for free.

- **Film pass** (`src/render.js`) — the scene renders to an offscreen target,
  then one fullscreen shader turns it into a monochrome print: orthochromatic
  channel weighting (reds sink toward black, which is why blood and skin go
  dark in period black-and-white), a crushed-toe tone curve, halation around
  highlights, grain that peaks in the midtones, gate weave, exposure flicker,
  hairline scratches and dust on a 16 fps step. Grain and vignette intensify as
  the samurai's health drops — the print degrades with him.
- **Cel shading** (`src/actors.js`) — three-step toon ramp plus inverted-hull
  outlines. In monochrome the silhouette carries everything, so enemy types
  differ by outline (straw kasa, horned mask, height) rather than by colour.
  The player is deliberately the lightest figure on the field.
- **Isometric & blocky** — a fixed 45° orthographic camera, and every figure
  and plant cut from square stock: box limbs, tapered square columns (4-sided
  cylinders turned 45°), pyramid hats, slab pine boughs, pixel-art grass
  tufts. The organic ink on rigid blocks is the contrast the look leans on.
  The key light hangs off the camera's left shoulder — lit from behind the
  camera, every shadow hides behind its caster and the frame goes flat.
- **Framing** — 2.39:1 letterbox, capped so a narrow window still has room to
  play in. The HUD lives inside the black bars, which keeps it legible no
  matter how bright the paper gets.

## The ink

Blood is ink, and it behaves like ink (`src/ink.js`, `src/paper.js`):

- Marks are baked once into a texture atlas — irregular blobs, capillary
  tendrils that wick outward, thrown droplets, and directional flicks — then
  blurred into a soak halo and re-composited sharp on top. That two-pass order
  is what makes them look absorbed rather than stamped on.
- Every mark **grows after it lands**, easing out over 0.5–4 s. Nothing appears
  at full size; the wicking is the point.
- Ink **dries lighter** toward a floor of about a third of its original value.
  It never disappears — the page keeps its history — but without this the
  arena saturates to solid black within two waves.
- Airborne blood arcs as camera-facing quads stretched along their own velocity,
  and becomes a stain wherever it hits the paper.
- Kills also flick ink at the *page itself* — a 2D overlay above the render that
  soaks outward and fades.
- The sword trail is a tapered sumi-e brush stroke with dry-brush streaks, not a
  glow.

All of it draws in **two draw calls**. `src/quads.js` packs every mark into one
dynamic buffer rebuilt each frame, which is why hundreds of permanent stains
cost nothing. (The original prototype re-rasterised every stain into a canvas
every frame; that does not scale past a few dozen.)

## Ragdolls and dismemberment

A slain enemy stops being an animated actor and becomes nine Verlet particles
joined by distance constraints (`src/ragdoll.js`). Its existing limb meshes are
re-parented to the scene and posed from those particles, so the body keeps
whatever pose it died in and collapses from there in about three-quarters of a
second.

Severed parts leave the constraint network and tumble as independent rigid
bodies, trailing ink until the wound runs dry. What comes off depends on the
blow: light cuts may take a head or an arm, the third hit of the chain and the
iai draw cleave at the waist, and big enemies hold together unless hit heavy.
Dropped swords clatter down alongside.

Two things matter for stability, and both bit during development:

- Ground contact collapses the vertical *gap* between `pos` and `prev`, not just
  the position. In Verlet the gap **is** the velocity, so lifting a particle out
  of the floor without this reinterprets penetration depth as upward speed and
  the body bounces higher on every landing.
- Positional constraint corrections are read back as velocity at `1/h`, so at a
  1/120 s substep a single large correction can launch a body. Per-particle
  speed is capped as a safety net.

## Layout

```
index.html        shell, HUD, letterbox, import map
src/main.js       game loop, player controller, enemy AI, waves, camera
src/render.js     renderer + monochrome film pass
src/paper.js      procedural washi, ink atlas, brush texture
src/ink.js        stains, airborne blood, screen ink
src/quads.js      one-draw-call dynamic quad batch
src/actors.js     cel-shaded figures, outlines, geometry cache
src/ragdoll.js    Verlet ragdolls and dismemberment
src/trail.js      sumi-e sword stroke
src/world.js      arena, bamboo, torii, wind, rain
src/audio.js      procedural WebAudio (no samples)
src/input.js      keyboard/mouse with input buffering
legacy/           the original single-file prototype, kept for reference
```

## Design notes

- **Attack slots.** Only two to four enemies may commit to an attack at once;
  the rest circle. Without this a crowd becomes a coin flip rather than a fight.
  The orbit distance sits *inside* the range at which an attack may be committed
  — if it doesn't, circling enemies can never satisfy the strike test and the
  whole fight deadlocks with everyone walking in circles.
- **Hitstop** scales the whole simulation, not just animation: 50 ms on a hit,
  160 ms on a heavy kill.
- **Fixed camera yaw.** Aim drives the character, not the camera, with only a
  small look-ahead bias. A camera that chases the cursor while the cursor is
  measured against the camera feeds back on itself and spins.
- **Rain** is held back for boss waves, where white streaks over a dark field
  are the single most recognisable image in the genre.

## Debugging

`window.__samurai` exposes `state`, `ink`, `ragdolls`, `enemies`, `player`,
`camera`, and `film.uniforms` for live tuning, plus `step(dt)` to advance the
simulation a fixed tick at a time — useful for driving the game deterministically
without depending on how the browser schedules frames.

```js
__samurai.film.uniforms.uGrain.value = 0.3;   // heavier grain
__samurai.state.focus = 100;                  // charge the iai
for (let i = 0; i < 600; i++) __samurai.step(1/60);
```
