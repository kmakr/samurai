# ONISOLO — THE RAIN COURT

A cinematic isometric samurai hack-and-slash set in a rain-soaked shrine courtyard.
Warm lanterns, wet stone, layered teal roofs, and weathered timber frame the fight.

The default **chapter, The Iron Demon**, is a finite journey through three
courts: the outer watch, a planted lantern garden, and the inner shrine.
Nine authored encounters lead to Kurogane. Clear each court, follow the gate
marker, and cross to the next precinct; a crossing restores life and strengthens
your chosen technique. Kurogane survives individual signatures and changes his
attack rhythm at half life. Ordinary cuts cannot interrupt him; parry the white
blade to create an opening, and dash the red blade. Defeat him, approach the shrine, and leave your
blade on the offering stone to complete the chapter. Clears and best completion
time are saved locally. **Endless Vigil** and **Daily Trial** retain the wave game.

After the first encounter, choose one technique for the entire journey:

- **Storm Reprisal:** perfect parries store lightning; the next successful cut
  chains it through nearby enemies. Crossing a gate adds a lightning target.
- **Hollow Step:** a dash leaves a visible swordsman who performs a delayed cut.
  Gate crossings increase the echo's damage and reach.
- **Heaven's Thread:** ordinary cuts mark up to three foes for twelve seconds.
  A signature also strikes marked foes outside its normal reach, without hitting
  the same foe twice. Gate crossings strengthen these remote strikes.

Paper lanterns break under player and enemy cuts, leaving bounded debris.
Garden bamboo bends under a cut or nearby movement. All scenery and technique
state resets on retry. The garden's solid planters have shared pathfinding
clearance for enemies and signature endpoints.

No web build step or dependencies to install. Characters and weapons are authored
in Blender and exported as small, quantized mesh modules. Scenery placement, ink
textures, and animation are generated procedurally at load. Wet masonry uses seam-free shader grain; concept and prompt provenance live in `docs/art-direction/`. The
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
and strengthens the character's outline. After each cleared wave, three discipline
scrolls pause the fight and offer a run upgrade: parry timing, dash damage,
combo-finisher damage, focus retention, or iai reach. Each discipline has three
ranks; selecting a mastered discipline restores life and focus instead.

In Endless Vigil and Daily Trial, waves escalate by silhouette: ronin under a straw kasa, bare-headed hunters
that close fast, then the lean **yari** spearman from wave three — a narrow,
taller figure whose long pole strikes from what feels like safe distance.
Brutes arrive at wave four, the **yumi** archer at wave six — it holds its
distance behind a tall stave and fires along a telegraphed ground line that
tracks, then locks, leaving a beat to move off it (a held parry still turns
the arrow) — and every fifth wave brings a named rival with a fast follow-up
cut.

In the endless modes, every five waves is a named act — THE RAIN COURT, THE CROWS, NIGHTFALL, THE
LONG RAIN, THE BLACK PAGE. Rain and wind intensify in later acts. The last act
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
game remembers across runs: every past run leaves a dried ink stroke in a ledger
on the defeat screen, scaled to how far it reached. Bests, kills,
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

The **Rain Court** is a bounded isometric courtyard within a shrine district inspired by
[the supplied reference](https://x.com/anshuc/status/2096008083826725132).

- **Materials and light** (`src/render.js`, `src/rain-court.js`, `src/surface-shaders.js`): linear HDR with a filmic output curve, depth-based contact shading,
  one shadowed directional key, cool ambient fill, two permanent lantern lights,
  a prefiltered HDR sky, seam-free stone relief, varying wetness,
  glazed roof highlights, wood grain and weathered plaster. Detail is shaded in
  world space without extra geometry or texture downloads.
- **Architecture**: nine reusable meshes authored through Blender MCP make the
  stone walls, tiled roofs, lattice windows, planting and courtyard props. More
  than 11,000 pieces use static instance batches. The independent editable source
  is `assets/models/rain-court-kit.blend`; regenerate with `tools/build-rain-kit.py`.
- **Wet surfaces**: irregular puddles share one 640×360 scene reflection target,
  refreshed every fourth frame. Ripple shading remains continuous. Reflection
  draws and triangles are included in the runtime profiler. Water reflections
  respond to the viewing angle; rain streaks are excluded from their buffer.
- **Characters**: all four legends and six enemy silhouettes use the existing
  Blender rigs with separate cloth, lacquer and steel shading. Instanced corpses
  retain their source colors and surface response. Steel still flashes white for parries and red for
  unblockable attacks.
- **Combat**: lightning cuts, time-stop iai, tsunami, sparks, hitstop and sound
  remain intact. Courtyard limits constrain movement, dash and signature travel;
  edge spawns preserve distance from the player.
- **Presentation**: no letterbox. A slim title panel and compact HUD expose the
  live environment. Portrait views follow the player more closely, while wide
  views retain the composed courtyard.

The source concept and exact built-in image-generation prompts are saved under
`docs/art-direction/`. The concept is a visual target, not an in-game screenshot.

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
src/render.js            renderer + full-color cinematic grade
src/paper.js             procedural washi, ink atlas, brush texture
src/ink.js               stains, airborne blood, screen ink
src/quads.js             one-draw-call dynamic quad batch
src/actors.js            cel-shaded figures, outlines, geometry cache
src/ragdoll.js           Verlet ragdolls and dismemberment
src/trail.js             sumi-e sword stroke
src/world.js             fixed rain buffers
src/rain-court.js        instanced shrine district + reflections
src/court-layout.js      courtyard movement and spawn boundaries
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
- **Rain** intensifies during rival fights and eases after the chapter is won.

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

## Chapter verification

`http://127.0.0.1:5173/?qa-scenario=chapter&profile=1` exposes a local-only
chapter lab: held views of all courts, technique demonstrations, a complete
progression/technique audit, normal-input automated play and a 20-second garden
stress scenario. The progression audit uses fixture kills and gate positioning
to verify the real transitions; automated play uses movement and combat inputs.
Neither QA mode writes saved progress. Press backquote to hide or show the lab.

`node --test tests/*.test.mjs` includes full finite progression, gate/victory
requirements, navigation around planted islands, technique charge/mark rules,
records, and the existing combat, asset, pool and import checks.

The chapter director and navigation are independent of the renderer. Scene
props, technique visuals and chapter UI live in their own modules. The existing
Blender kit supplies the architectural geometry; no new texture download or
dynamic light is required. See `docs/chapter-one.md` for the completion audit.
