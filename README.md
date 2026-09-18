# Slime Movement — Specimen laboratory

A standalone, playable **3D soft-body movement experiment**. The green surface is the physical body: 42 material points collide, pull against each other, preserve volume, and attach to surfaces. There is no hidden rigid capsule or cosmetic squash animation.

This is an original movement prototype, not a Gish source port or an integration into Specimen. Character art, production physics, and Level 1 remain separate.

## Run

Use Node.js 22 or newer and a WebGL 2-capable browser.

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. The development command builds once, then serves the result. After editing source, run `npm run build` and refresh; there is no hot-reload dependency.

```sh
npm run build        # TypeScript checking + static build
npm run type-check   # Check without emitting
npm test             # 17 deterministic physics regression tests
npm run preview      # Serve an existing build
```

**Double-clickable build:** `npm run build` also produces `dist/demo.html`. Open that file directly in a browser; everything is embedded. The normal `dist/index.html` uses ES modules and should be served over HTTP. Nothing is downloaded at runtime: no CDN, fonts, models, analytics, or engine package.

The single-file build is generated from the same source as the normal application, not maintained separately. `dist/` is intentionally not committed.

## Controls

| Input | Behaviour |
| --- | --- |
| WASD / arrow keys | Camera-relative movement; distributed forces pull the material around the contact patch |
| Hold Space, then release | Compress the body, then launch; a tap is a small hop |
| Hold Shift | Attach individual contacting particles; W/S climb/descend on walls, A/D traverse |
| Release Shift | Release adhesion without erasing momentum |
| Hold Q | Flatten, soften, and reduce friction for squeezing/sliding |
| R | Reset the current station, input state, and moving-platform phase |
| 1–5 | Reset directly into a test station |
| F | Toggle actual particles, surface edges, contacts, and grip anchors |
| P | Pause/resume |
| Drag / scroll / C | Orbit / zoom / reset camera |

Touch controls appear on coarse-pointer devices. Keyboard control is the primary way to judge movement. Controls are cleared on focus loss; tabbing away cannot leave an anchor or charged jump stuck on. Sliders retain normal keyboard accessibility while focused; click the play area to return to movement.

## Try this route

1. **Free movement:** accelerate, let go, and reverse. Look for material rotation, front/rear lag, and momentum rather than an instantaneous direction change.
2. **Compression:** compare a tap with a full charge. Jump up the steps. The charge changes physical link targets before the launch.
3. **Adhesion:** approach the violet wall holding Shift; W climbs. Stop to hang, then release Shift. Try charging and jumping away from the wall. A canopy and a separate low ceiling allow hanging practice.
4. **Squeeze:** hold Q before the low passage. Its ceiling is 1.05 m high, below the normal body's height. The body widens while retaining its volume. Try releasing Q while still inside.
5. **Momentum:** roll down the amber slope, compare normal traction with Q, then jump onto the translating violet platform and hold Shift to ride it.

Small rings mark optional targets. They are exploration prompts, not a progression gate. All stations are available immediately. **Balanced**, **Goo**, and **Spring** change live material settings; stiffness and traction can also be tuned individually.

## What is actually simulated?

`src/physics.ts` owns particle positions and velocities. It has no DOM or renderer dependency. `src/world.ts` defines the same oriented boxes used by both collision and rendering. `src/renderer.ts` is a small WebGL 2 view; replacing it with a Three.js adapter does not require replacing the simulation.

The external simulation tick is **60 Hz**, with **4 substeps** and **8 constraint iterations** per substep. Rendering interpolates the previous and current physical state. A capped accumulator avoids an unbounded catch-up loop after a stall; hidden tabs do not accumulate simulation debt.

The body is a closed 42-vertex, 80-triangle geodesic shell. Distance constraints connect surface edges, neighbouring-face braces, and sparse diametric braces. XPBD distance and global-volume constraints give the body elasticity without a rigid central controller. A short-range particle separation pass discourages collapse.

Compression changes link rest targets along the support normal, with transverse expansion, while the volume constraint remains active. Contacts are solved on the actual particles against skin-expanded oriented boxes. Predicted particle motion is swept through those boxes before positional iterations. The conservative box expansion intentionally rounds contact less accurately at corners than an exact sphere/box query.

Grip anchors store **material-point positions in the contacted box's local frame**. They follow translating surfaces, carry tension, and release when stretched too far. During locomotion, rear/old anchors peel and reacquire rather than welding every point permanently. Violet objects highlight useful grip surfaces; ordinary stone/floor surfaces also support adhesion, while amber surfaces do not.

Camera-occluding boxes become **wireframe cutaways in rendering only**. Their collision geometry is never removed. This keeps the slime visible under the passage and canopy.

## The intentional assists

This is a playable hybrid, not an energy-conserving continuum simulation.

- **Traction motor:** speed feedback distributes forces asymmetrically across physical particles. Contact friction and constraints turn that forcing into travel, rolling, and deformation. It never writes a center transform or substitutes a rigid collider.
- **Jump:** support-gated compression/release adds an explicit particle impulse, with a short coyote window and reattachment cooldown. Elastic recovery contributes motion, but charge is not a measurement of stored spring energy.
- **Air control:** a small explicit translational acceleration plus rotational torque. Shape manipulation alone cannot change a body's ballistic center-of-mass trajectory without an external force.
- **Stability:** internal-velocity damping, a generous emergency particle-speed cap, and recovery from invalid/out-of-bounds states. The tests check that recovery was *not* used to conceal a failure.

## Validation

The regression suite covers topology, settling, volume preservation, movement/reversal, compression, charged versus tap jumping, no airborne jump farming, focus cancellation, wall climbing/release, ceiling hanging, passage traversal and expansion, translating-platform anchors, thin-wall sweeping, deterministic reset, render-rate independence, invalid time steps, and mixed-input runs across all three material presets.

The optional real-browser smoke suite checks WebGL rendering, actual keyboard movement and jumping, pause, station selection, squeeze/debug view, presets, all spawn points, a 390 px layout, touch controls, and startup without the test hook.

```sh
# Optional; these are test-only Python dependencies, not application dependencies.
python3 -m pip install playwright
# Use your system Chromium, or install Playwright's browser:
python3 -m playwright install chromium
npm run test:browser
```

`CHROME_BIN` selects a particular installed browser. The browser test loads the generated single-file build in memory, so it needs no server or internet. Screenshots and a JSON report go to ignored `test-results/`. Linux software rendering may require an X server (for example, `xvfb-run -a npm run test:browser`). Only trusted containers that require it should set `CHROME_NO_SANDBOX=1`.

## Prototype limits / integration boundary

This is a **coarse surface-shell solver**, not a volumetric finite-element simulation. It does not implement robust triangle/triangle self-collision, arbitrary concave level meshes, rotating platforms, two-way rigid-object coupling, tearing, fluid splitting, hazards, audio, persistence, or multiplayer determinism. Sparse particle collision can miss geometry that fits between surface points. High-speed or highly concave production levels need more collision work; the included box laboratory is not proof of universal robustness.

There is no Three.js, Vite, or third-party runtime dependency in this first version. TypeScript is the only npm development dependency. That keeps the demonstration runnable offline and the physics portable; it is not a recommendation to replace Specimen's existing rendering stack. Keep this sandbox separate while judging the feel, then adapt its simulation and controls behind an appropriate production collision interface.
