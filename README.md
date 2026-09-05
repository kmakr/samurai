# ONISOLO — THE PAGE REMEMBERS

A browser-based 3D samurai hack-and-slash rendered as black-and-white film, where
every wound bleeds into the arena like ink soaking into paper.

No web build step or dependencies to install. Characters and weapons are authored
in Blender and exported as small, quantized mesh modules. Scenery, ink textures,
and animation are generated procedurally at load. The
exceptions are the score — a looping recorded track (`assets/score.mp3`, a
free Nujabes-type beat) played through the game's dynamic mix bus, with a
fully procedural engine as the loading cover and offline fallback — and two
recorded one-shots (`assets/sfx-slash.mp3`, `assets/sfx-clash.mp3`, generated
with ElevenLabs) for the sword swoosh and the parry clash, rate-jittered per
hit, with the synthesized versions as their fallback.

## Running it

ES modules need to be served over HTTP (opening `index.html` from disk will fail
CORS). Any static server works:

```bash
node dev-server.mjs
```

Then open <http://localhost:5173>.

For late-run QA, localhost alone accepts `?qa-wave=N` (for example,
<http://localhost:5173/?qa-wave=5>). It still uses the normal title, input,
spawning, boss, defeat, and retry paths; only the starting wave is advanced.
`?qa-scenario=upgrade` enters the real discipline-selection transition and
`?qa-scenario=defeat` exercises defeat followed by an in-place retry. Deployed
hosts ignore every QA parameter. QA runs calculate their normal defeat and
unlock results but do not change saved records, the ledger, the grudge, or an
automatically equipped reward. Add `?profile=1` (or join it with `&`) to publish
a rolling frame profile in `meta[name="samurai-profile"]`.

## Deployment

Hosted on Cloudflare Pages — project `samurai`, live at
<https://samurai.theoazriel.com> (also <https://samurai-exp.pages.dev>).

There is no build step; a deploy is one command:

```bash
node deploy.mjs
```

The script stages a clean copy of HEAD (keeping `.git` and editor state out of
the published site) and stamps every relative module import with the build
version from `index.html` — the same rewrite `dev-server.mjs` applies with its
boot timestamp. This matters: Pages serves `/src/*.js` with a four-hour browser
cache, so an unstamped deploy can pair a fresh `main.js?v=N` with a stale
cached sibling module and crash on import. `_headers` additionally marks
everything `no-cache` (revalidate via etag) so future deploys propagate
immediately once old cache entries age out.

Note this is **direct upload, not Git-connected** — pushing to GitHub does not
redeploy on its own. Cloudflare does not support converting an existing Direct
Upload project to Git integration, so production and preview deployments use
Wrangler explicitly.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Mouse | Aim the cut |
| Click | Slash. Katana uses a three-hit chain; nodachi uses two heavy cuts |
| `Shift` | Dash (invulnerable) |
| `Space` | Parry — time it against the enemy's white blade |
| `F` | Weapon signature, once focus is full |
| `1` / `2` / `3` | Choose a discipline between waves |

On a touch device the game switches to touch controls automatically: a dynamic
left-thumb stick for movement, and kanji buttons on the right — 斬 cut, 受
parry, 疾 dash, 抜 iai. Without a cursor the aim model changes: mid-cut the
blade seeks the nearest enemy, on the move the samurai faces his feet, and
standing idle he squares up to the closest threat. The duel plays in landscape;
portrait shows a rotate prompt.

Enemies telegraph by lighting their blade white. Parrying at that moment
deflects the blow and fills focus fast; focus also builds on kills. A full
focus charge makes one calm white ink aura breathe around the player and
briefly shows the signature key. The katana uses an iai draw that holds the battlefield still, flash-steps
forward, and releases a delayed lightning cut through a corridor. The player draw
uses a real-time clock while enemy clocks, rain, ink particles, and bodies stop. The nodachi uses a broad
tsunami cut that throws survivors away from the player.

Enemy steel starts dim during the wind-up, then blooms white only during the
real deflect input window. Hits add steel sparks and a short ground burst. Katana finishers branch into
lightning; thrusts write a narrow streak; nodachi strikes drag a heavier crescent.
Kills leave a suspended cut line before the ragdoll falls. Enemy yari and yumi
strikes use narrow ink lines; brutes and oni write broad shock rings. Perfect
parries retain their white blade timing signal.

Perfect parries and kills build **Flow**. Flow breaks when the player takes a
hit or goes too long without another success; higher Flow increases focus gain
and pushes the film contrast harder. After each cleared wave, three discipline
scrolls pause the fight and offer a run upgrade: parry timing, dash damage,
combo-finisher damage, focus retention, or iai reach. Each discipline has three
ranks; selecting a mastered discipline restores life and focus instead.

Waves escalate by silhouette: ronin under a straw kasa, bare-headed hunters
that close fast, then the lean **yari** spearman from wave three — a narrow,
taller figure whose long pole strikes from what feels like safe distance.
Brutes arrive at wave four, the **yumi** archer at wave six — it holds its
distance behind a tall stave and fires along a telegraphed ground line that
tracks, then locks, leaving a beat to move off it (a held parry still turns
the arrow) — and every fifth wave brings a named rival with a fast follow-up
cut.

Every five waves is a named act — MORNING PAPER, THE CROWS, NIGHTFALL, THE
LONG RAIN, THE BLACK PAGE — and the print travels with them: grain, vignette
and contrast harden act by act, and the late acts bring rain. The last act
holds; an endless run does not cycle back to morning. Stand still long enough
on a quiet field and the samurai sheathes the blade; the first input draws it
again. Defeating the rival restores focus and forces an execution
finish. A well-timed dash through an incoming strike holds Flow and grants focus.

Once per run a **last stand** catches the blow that would end it: the samurai
survives at a sliver of life inside a long beat of slow motion, turning a sudden
death into a near miss. Falling Leaf is an additional discipline that layers
extra escapes on top.

Defeat names the death — who struck and what the samurai was caught doing — and
measures the run against your best (how many waves short, or a new record). The
page remembers across runs: every past run leaves a dried ink stroke in a ledger
on the title and defeat screens, scaled to how far it reached. Bests, kills,
perfect parries, and best Flow persist in local browser storage, and a defeat
can be copied as a shareable result card.

A **Daily Trial** (button on the title screen) seeds the run from the date, so
everyone playing a given day meets the same wave structure, spawn layout, and
discipline scrolls — the enemy micro-timing still varies, so it plays live
rather than on rails.

The site installs as a PWA and plays offline: a service worker (`sw.js`)
caches the versioned assets cache-first and falls back to the cached page when
the network is gone. Its cache name carries the build version (stamped by
`deploy.mjs`), so each deploy installs a fresh worker and drops the old cache.

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
- **Characters** (`src/actors.js`, `assets/models/storm-court.js`) — Blender-authored
  faceted armor, folded cloth, sculpted helmets and masks, real spearheads, a strung
  yumi with quiver, and a studded kanabo. All four legends retain their palettes
  and costume features. The six enemy silhouettes remain distinct at game scale.
  Joint names match the procedural animation and Verlet ragdoll rig. Geometry is
  decoded once and shared across waves; every enemy is below 2,400 triangles.
- **Isometric scenery** (`src/world.js`, `src/voxel.js`) — the fixed diagonal
  orthographic camera looks down on voxel scenery. Instance batches compact to
  conservative camera bounds, with extra room for tall off-screen shadow casters.
  Moving through the world refreshes the bounds and the packed instance matrices.
- **Combat effects** (`src/combat-fx.js`) — one preallocated draw batch holds up to
  48 lightning/ink strokes and 192 sparks. Impact fans are prebuilt, corpse parts
  are instanced by shared geometry, and idle corpse physics sleep. No per-attack
  PointLights or extra bloom passes are introduced. The film uses an SDR target
  with 4× MSAA; the final fullscreen canvas avoids redundant MSAA.
- **Framing** — 2.39:1 letterbox, capped so a narrow window still has room to
  play in. External ink bars show health and signature charge. A white ink
  aura also marks signature readiness. Run statistics stay in the black bars.

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

## Architecture and verification

The runtime keeps Three.js as a rendering library rather than adopting a game
engine. The extracted systems are DOM- and renderer-independent: the player
controller owns action transitions, the combat system owns hitstop and Flow,
the enemy director owns AI and attack slots, the wave director owns seeded
progression, and the run modules own records, unlock rules, start, defeat, and
retry state. `main.js` connects those systems to scene presentation, audio, ink,
and the HUD.

Browser frames feed a capped 60 Hz accumulator (`src/simulation-clock.js`). A
slow frame may run at most three simulation ticks, then renders once; pausing
or beginning a run clears the accumulator. This makes action timing independent
of refresh rate without multiplying render cost during catch-up.

Run the deterministic suite with:

```bash
node --test tests/rules.test.mjs
```

It covers combat boundaries, seeded wave plans and lifecycle, the extracted
systems, record storage, unlock boundaries, run transitions, the fixed-step
clock, and bounded collection eviction. Ink, ragdolls, voxel gibs, and
short-lived combat effects all publish explicit pool limits to the opt-in
profiler. Dense wave-ten captures before and after the
milestone live in `tests/performance-baseline.json` and
`tests/performance-fixed-step.json`; the browser scheduler remains visible in
frame percentiles, while the simulation trace proves the three-tick ceiling and
reports any discarded time.

## Layout

```
index.html               shell, HUD, letterbox, import map
src/main.js              scene/HUD presentation and system wiring
src/player-controller.js movement, dash, attack and parry action state
src/combat-system.js     hitstop and Flow orchestration
src/enemy-director.js    enemy state machines, slots and crowd separation
src/combat.js            pure combat timing, attack, parry and dash rules
src/waves.js             pure enemy composition and difficulty scaling
src/wave-director.js     wave lifecycle, seeded plans, rivals and upgrades
src/simulation-clock.js  capped fixed-step accumulator
src/bounded-pool.js      shared pool limits and eviction contract
src/profiler.js          opt-in frame/simulation telemetry
src/run-records.js       safe record, ledger and grudge persistence
src/unlocks.js           pure skin and weapon progression rules
src/run-flow.js          start, defeat, retry and fresh-run state
src/render.js            renderer + monochrome film pass
src/paper.js             procedural washi, ink atlas, brush texture
src/ink.js               stains, airborne blood, screen ink
src/quads.js             one-draw-call dynamic quad batch
src/actors.js            cel-shaded figures, outlines, geometry cache
src/ragdoll.js           Verlet ragdolls and dismemberment
src/trail.js             sumi-e sword stroke
src/world.js             endless paper, voxel vegetation, wind, rain
src/voxel.js             voxel model builder + fixed gib pool
src/audio.js             recorded score/one-shots + procedural fallback
src/input.js             keyboard/mouse/touch input buffering
tests/                   deterministic rules and saved frame profiles
legacy/                  original single-file prototype, kept for reference
```

## Design notes

- **Attack slots.** Only two to four enemies may commit to an attack at once;
  the rest circle. Without this a crowd becomes a coin flip rather than a fight.
  The orbit distance sits *inside* the range at which an attack may be committed
  — if it doesn't, circling enemies can never satisfy the strike test and the
  whole fight deadlocks with everyone walking in circles.
- **Hitstop** scales the whole simulation, not just animation. The 60 Hz clock
  continues on real time while world time is scaled, so a 50 ms hit or 160 ms
  heavy kill lasts the same number of real milliseconds on every refresh rate.
- **Fixed camera yaw.** Aim drives the character, not the camera, with only a
  small look-ahead bias. A camera that chases the cursor while the cursor is
  measured against the camera feeds back on itself and spins.
- **Player ownership.** The samurai carries a bright war sash, white blade,
  kabuto crest, and broad shoulder armor. Enemies keep compact dark silhouettes
  and grey blades; their steel turns white only during an attack warning.
- **Combo grammar.** Each cut has its own readable stroke: a broad opening
  crescent, a fast reverse whip, and a heavy diagonal execution mark. Their
  swing pitch, contact weight, camera kick, and hit-stop rise with the combo.
- **Sharp film sampling.** The film target stays at full device resolution and
  uses resolved nearest sampling. Gate weave moves by complete pixels, so the
  print can move without smearing voxel edges; halation stays limited to hot
  highlights.
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

## Blender assets and combat verification

`assets/models/storm-court.blend` is the editable character source. The reproducible
`tools/build-actors.py` creates its own scene and exports `storm-court.js` plus a
triangle manifest. It can be executed through Blender MCP, or in a separate process:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/build-actors.py
```

The background process saves the source `.blend`. Interactive MCP generation only
adds its own scene and exports the runtime mesh module, preserving other scenes.
The game loads that module through the same versioned import graph as its code;
there is no runtime model decoder dependency or network model-loading race.

- [Model study](http://127.0.0.1:5173/tools/model-gallery.html): inspect the enemy
  roster, all four legends, and both weapons; rotate the models.
- [Combat lab](http://127.0.0.1:5173/?qa-scenario=combat&profile=1): play a mixed arena,
  inspect held iai frames and tsunami, run the combat audit, or run a 20-second
  stress scenario. This opt-in panel is limited to localhost and uses QA record
  isolation; it does not unlock rewards or change run records.
- `node --experimental-default-type=module --test tests/*.test.mjs` checks combat
  rules, mesh integrity/budgets, signature timing, and versioned module imports.

The normal controls and unlock rules are unchanged. The `F` signature still needs
full focus. Deployments use the committed source and versioned module graph described above.
