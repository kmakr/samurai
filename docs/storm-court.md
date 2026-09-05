# Storm Court combat and character revision

Built locally from `origin/master` at `8a06a62`, on `codex/blender-combat-upgrade`.
The repository calls its default branch `master`. This report records the local
validation completed before the build 97 release.

All four player legends and all six enemy archetypes use Blender-authored faceted
geometry. Armor plates, waist belts, folded hems, hair, helmets, curved crests,
oni masks, spearheads, bowstrings, quivers, blade edges, wrapped grips, and kanabo
studs replace the previous primitive/voxel actor parts. Weapon timing, damage,
unlock rules, and the animation/ragdoll joint interface remain intact.

The katana's third cut branches into lightning. Every ordinary hit emits steel
sparks; kills retain a luminous cut line while the body separates. Iai uses a
0.22-second held draw, 0.14-second travel, delayed strike at 0.36 seconds, world
time release at 0.51 seconds, and recovery by 0.70 seconds. The nodachi signature
adds nested shock rings and thunder. Enemy cuts, arrows, spears, and heavy impacts
have their own dark ink strokes without obscuring the white/red timing signal.

Optimization retains the existing corpse and debris caps. Corpses batch by
geometry, settled physics sleep, scenery instances compact into conservative
camera bounds including off-screen shadows, impact meshes are reused, and all
new combat strokes/sparks share a fixed buffer. The film renders to a four-sample
SDR target; no new dynamic lights or postprocessing passes are used.

The local stress sample at 1280×720 averaged 12.36 ms per frame, with 17.0 ms P95
and 18.6 ms P99 over 1,496 samples. The run replenished up to 24 mixed enemies and
repeated attacks and iai for 20 seconds. These are local, hardware-dependent
measurements. Full data is in `tests/performance-storm-court.json`.

Validation passed 22 Node tests and 27 browser assertions: asset integrity,
versioned imports, all seven ordinary attack variants, parry, genuine enemy-clock
freeze, corridor exclusion, both signatures, every legend, bounded effects,
retry geometry reuse, one instance per corpse part, complete retirement, and
scenery wrapping. Normal controls and rendering were also inspected at 1280×720
and 844×390. Browser logs contained no errors. Physical touch-device testing was
not performed.

Run `node dev-server.mjs`, then open:

- `/` for the normal game.
- `/tools/model-gallery.html` for the enemy roster and four legends.
- `/?qa-scenario=combat&profile=1` for the opt-in localhost combat lab.

Blender MCP was connected and used to author, inspect, import, and render the
models. Blender crashed during the first attempt to write a scene library. The
pre-existing five scenes were restored from its autosave (a recovery copy remains
at `/tmp/onisolo-preexisting-scene-recovery.blend`). Subsequent source-file saves
used a separate factory-startup background process. The final `.blend` contains
only the new asset scene and Blender's default scene; unrelated project content
is not included in the game asset.
