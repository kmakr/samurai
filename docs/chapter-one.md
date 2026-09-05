# Chapter one: The Iron Demon

The first complete journey replaces the default endless opening. Endless Vigil
and Daily Trial remain available. Release target: build 100.

## Completion requirements

- A finite journey through the Rain Court, Lantern Garden and Inner Shrine,
  with distinct scenery and encounter compositions, traversable gate crossings,
  a Kurogane finale, a physical final offering, and a victory screen.
- A consequential choice between Storm Reprisal, Hollow Step and Heaven's
  Thread; each must change combat behavior and grow across the chapter.
- Enemy entrances, breakable lanterns, reactive bamboo and persistent damage
  must connect combat to the environment. Restore the world on retry.
- Closer framing and readable fighter silhouettes, with usable desktop,
  landscape touch and narrow layouts.
- Victory, defeat, retry, pause, saved progress, daily/endless compatibility,
  keyboard/touch input and versioned imports must work.
- Verify transitions and combat rules with meaningful tests, inspect the full
  chapter in the browser, capture the result, and measure a mixed combat load.

Target play length is 5–10 minutes for a first successful run; no idle timers
artificially extend an encounter once its reinforcements are present.

## Implemented journey

The default Begin Chapter action starts the outer watch. Nine encounters use
authored enemy groups and staggered reinforcements: three in each court, with
Kurogane alone in the ninth. Clearing a court opens an animated physical gate.
The player follows golden ground marks and a projected gate label, then walks
through the opening. A short fade introduces the next court, restores life,
and strengthens the selected technique.

The garden adds two planted islands, reactive bamboo, and side entrances. The
shrine adds timber flooring, red columns, prayer papers, a bronze bell, and an
offering stone. Kurogane has 880 life, survives a single iai, and enters his
existing faster second form at half life. Ordinary wounds do not interrupt
him; perfect parries create the full stagger opening, while red attacks must
be dodged. His death opens the final offering;
the player must approach the shrine to finish. The actual blade is placed on
the stone, the bell sounds, the rain eases, and the ending presents the run's
time, technique, kills, perfect parries, and any earned unlocks.

The first clear offers one of three techniques for the journey. Storm Reprisal
stores up to three perfect parries and chains the next successful cut through
nearby foes. Hollow Step uses three pooled copies of the player's current
appearance; each dash leaves an echo that cuts after 0.55 seconds. Heaven's
Thread marks up to three foes for twelve seconds and extends a signature to
marked targets, excluding foes already hit by that signature. Gate crossings
raise technique rank, up to III. Other between-encounter rewards use the
existing disciplines.

Six paper lanterns react to sword and signature hits. Their debris stays on
the floor within a 48-piece limit. Bamboo reacts to proximity and cuts. Retry
repairs scenery and clears the technique, gate, offering, and combat effects.
The camera is closer, with constrained tracking that keeps the fighter readable.

## Verification evidence

- `node --test tests/*.test.mjs`: 35 passing tests, including full chapter
  progression, records, input reset, technique rules, pathfinding at planter
  edges, asset budgets, combat rules, pooling, and versioned imports.
- `chapter/browser-audit.json`: 65 passing integration checks through the real
  director and gameplay ports. Covers all encounters and choices, closed and
  open gates, transitions, Kurogane's two forms and parry opening, final offering, retry, technique
  damage, scenery reactions, and saved-progress isolation. This audit uses
  fixture kills and positioning; it is not an unassisted playthrough.
- `chapter/performance-stress.json`: 20 seconds at 1280 × 720 on the development
  machine, with 16 foes, continuous attacks/echoes, six broken lanterns, and
  persistent combat debris. 2,221 measured frames after warm-up: mean 8.33 ms,
  p95 10.3 ms, p99 10.4 ms, zero frames over 25 ms, zero dropped simulation time.
  The scene retained two PointLights and bounded effect pools. This is a
  desktop measurement, not a claim about phone performance.
- Responsive browser inspection: 390 × 844 technique cards; 844 × 390 touch
  gameplay, movement, parry and pause; rotating portrait during touch play
  pauses the simulation and shows the landscape prompt.
- `chapter/combat-regression.json`: all 29 existing browser combat checks pass,
  including katana/nodachi attacks, iai time-stop, tsunami, parry, corpse
  rendering, retry geometry retention, cosmetics, and court boundaries.
- `chapter/playthrough.json`: the final normal-input automated run completes
  all nine encounters, both crossings, Kurogane, and the final offering in
  180.4 seconds with 54 kills. The controller uses enemy-state awareness and
  normal movement/combat buffers, with no added immunity or fixture kills.
  21,470 measured frames: mean 8.33 ms, p95 10.3 ms, p99 10.4 ms, zero over
  25 ms and zero dropped simulation time. This verifies the route and combat
  integration; it does not substitute for human difficulty testing.
- Browser mode checks: Endless Vigil and Daily Trial start at wave one with
  chapter progression disabled; Daily Trial shows the current local date.
  Keyboard pause, resume and quit-to-title work. The chapter ending supports
  Copy Result, retry and return-to-title. Ending controls fit both 844 × 390
  and 390 × 844 layouts.
- A fresh chapter was allowed to end in defeat through normal enemy attacks.
  The defeat screen reports the court, encounter, cause, and clear count;
  Draw Again restores 100 life and zero kills in the first court.
- `chapter/runtime-log.json`: no browser warnings or errors during the final
  audit and full playthrough. All twelve changed/new JavaScript modules parse
  cleanly, and `git diff --check` passes.
- Screenshots in `chapter/screenshots/` include held court and boss studies,
  technique choice, touch layout, and the ending. The mobile ending and blade
  offering use a fixture; its short time and single kill are test data.

Static scenery reuses the existing Blender kit and is instanced by material
and geometry. The base district has 10,962 instances. Chapter additions draw
only for the current court, and techniques add no dynamic lights or network
assets. The three-echo and 48-piece scenery pools have fixed bounds.

The local lab supports held court/technique/boss views, final offering and
ending fixtures, the full integration audit, normal-input automated play, and
the stress scenario. It is installed only for the localhost chapter QA URL.
QA runs leave chapter records, lifetime records, and unlock saves untouched.

The 5–10 minute target is a design target for a first successful human run;
human completion-time validation remains distinct from automated input tests.
