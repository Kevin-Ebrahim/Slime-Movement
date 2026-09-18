import test from 'node:test';
import assert from 'node:assert/strict';
import { V3, makeCage } from '../dist/js/math.js';
import { FIXED_DT, Slime, idleInput } from '../dist/js/physics.js';
import { World } from '../dist/js/world.js';

function flat(spawn = new V3(0, 2, 0)) {
  const world = new World(false);
  world.add('floor', new V3(0, -1, 0), new V3(60, 1, 60));
  return { world, slime: new Slime(spawn) };
}
function run(slime, world, frames, input = {}) {
  for (let i = 0; i < frames; i++) slime.step(world, { ...idleInput(), ...input });
}
function healthy(slime, tolerance = 0.04) {
  assert.equal(slime.recoveries, 0, 'a reset must not hide a physics failure');
  assert.ok(slime.particles.every(n => n.p.finite() && n.v.finite()));
  assert.ok(Math.abs(slime.volume() / slime.restVolume - 1) < tolerance, 'volume drift');
}

test('cage is closed, outward-wound, and genuinely three-dimensional', () => {
  const cage = makeCage(0.84), edges = new Map();
  assert.equal(cage.vertices.length, 42); assert.equal(cage.faces.length, 80);
  for (const face of cage.faces) for (let i = 0; i < 3; i++) {
    const key = [face[i], face[(i + 1) % 3]].sort((a, b) => a - b).join(':');
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  assert.equal(edges.size, 120); assert.ok([...edges.values()].every(count => count === 2));
  assert.ok(new Slime().restVolume > 2);
});

test('falling body settles on actual particle collisions without losing volume', () => {
  const { world, slime } = flat(new V3(0, 7, 0));
  run(slime, world, 360);
  assert.ok(slime.center.y > 0.65 && slime.center.y < 1.0);
  assert.ok(slime.bounds().min.y >= 0.0649);
  assert.ok(slime.contacts.length > 0); healthy(slime);
});

test('traction propels the body; releasing and reversing preserve momentum', () => {
  const { world, slime } = flat(); run(slime, world, 120);
  const x = slime.center.x; run(slime, world, 90, { x: 1 });
  assert.ok(slime.center.x > x + 5); assert.ok(slime.velocity.x > 3);
  const speed = slime.velocity.x; run(slime, world, 1, { x: -1 });
  assert.ok(slime.velocity.x > 0, 'reversal cannot teleport or instantly erase velocity');
  assert.ok(slime.velocity.x < speed);
  const before = slime.center.x; run(slime, world, 15);
  assert.ok(slime.center.x > before + 0.4); healthy(slime);
});

test('compression changes the physical body while preserving volume', () => {
  const { world, slime } = flat(); run(slime, world, 120);
  const bounds = slime.bounds(); run(slime, world, 48, { jump: true });
  assert.ok(slime.charge > 0.95);
  assert.ok(slime.bounds().height < bounds.height * 0.75);
  assert.ok(slime.bounds().width > bounds.width * 1.15); healthy(slime);
});

function jumpApex(hold) {
  const { world, slime } = flat(); run(slime, world, 120); run(slime, world, hold, { jump: true });
  let apex = 0;
  for (let i = 0; i < 120; i++) { run(slime, world, 1); apex = Math.max(apex, slime.center.y); }
  healthy(slime); return apex;
}
test('a held-and-released jump launches higher than a tap', () => {
  const tap = jumpApex(2), charged = jumpApex(46);
  assert.ok(tap > 1.2); assert.ok(charged > tap + 1.3, `${tap} versus ${charged}`);
});

test('airborne charge cycling cannot generate unlimited jumps', () => {
  const world = new World(false), slime = new Slime(new V3(0, 10, 0));
  run(slime, world, 15, { jump: true }); run(slime, world, 1);
  assert.equal(slime.charge, 0); assert.ok(slime.velocity.y < -3); healthy(slime);
});

test('focus cancellation does not accidentally release a charged jump', () => {
  const { world, slime } = flat(); run(slime, world, 120); run(slime, world, 40, { jump: true });
  slime.cancelInput(); run(slime, world, 1);
  assert.equal(slime.charge, 0); assert.ok(slime.velocity.y < 2); healthy(slime);
});

test('adhesion grips, climbs, turns over anchors, and releases', () => {
  const { world, slime } = flat(new V3(0, 1, 0));
  world.add('wall', new V3(0, 3, -2), new V3(3, 3, 0.2));
  let maxAnchors = 0;
  for (let i = 0; i < 240; i++) { run(slime, world, 1, { z: -1, climb: 1, grip: true }); maxAnchors = Math.max(maxAnchors, slime.anchors.length); }
  assert.ok(slime.center.y > 3.3); assert.ok(maxAnchors > 0);
  const y = slime.center.y; run(slime, world, 70);
  assert.equal(slime.anchors.length, 0); assert.ok(slime.center.y < y - 0.5); healthy(slime);
});

test('ceiling attachment can hold tension instead of relying on ground support', () => {
  const world = new World(false), slime = new Slime(new V3(0, 2.0, 0));
  world.add('ceiling', new V3(0, 3.0, 0), new V3(4, 0.2, 4));
  run(slime, world, 180, { grip: true });
  assert.ok(slime.anchors.length > 0); assert.ok(slime.center.y > 1.3); healthy(slime);
  run(slime, world, 25); assert.equal(slime.anchors.length, 0); assert.ok(slime.velocity.y < -3);
});

test('squeeze traverses the real low passage, then recovers height', () => {
  const world = new World(), slime = new Slime(world.stations[3].spawn);
  run(slime, world, 100); const height = slime.bounds().height;
  run(slime, world, 60, { relax: true }); run(slime, world, 250, { relax: true, z: -1 });
  assert.ok(slime.center.z < -5); assert.ok(slime.bounds().height < height * 0.6); healthy(slime);
  run(slime, world, 100); assert.ok(slime.bounds().height > height * 0.85); healthy(slime);
});

test('expanding inside the passage does not disable its roof collision', () => {
  const world = new World(), slime = new Slime(world.stations[3].spawn);
  run(slime, world, 60, { relax: true }); run(slime, world, 115, { relax: true, z: -1 });
  run(slime, world, 35);
  const roof = world.boxes.find(b => b.id === 'tunnel-roof');
  for (const n of slime.particles) {
    const p = roof.local(n.p);
    assert.ok(!(Math.abs(p.x) < roof.half.x && Math.abs(p.z) < roof.half.z && Math.abs(p.y) < roof.half.y), 'particle inside roof');
  }
  healthy(slime, 0.08);
});

test('persistent anchors follow a translating platform in its local frame', () => {
  const world = new World(false);
  const platform = world.add('platform', new V3(0, 0, 0), new V3(3, 0.3, 3), undefined, true, 0, 1.8);
  const slime = new Slime(new V3(0, 1.2, 0)); run(slime, world, 200, { grip: true });
  assert.ok(slime.anchors.length > 0);
  const local = slime.center.clone().sub(platform.position); run(slime, world, 150, { grip: true });
  assert.ok(slime.center.clone().sub(platform.position).distance(local) < 0.7); healthy(slime);
});

test('swept particle collisions do not tunnel through a thin wall', () => {
  const world = new World(false); world.add('thin-wall', new V3(0, 2, -1), new V3(5, 5, 0.012));
  const slime = new Slime(new V3(0, 2, 0.5));
  for (const n of slime.particles) n.v.z = -90;
  run(slime, world, 12);
  assert.ok(slime.bounds().min.z > -0.924); healthy(slime, 0.08);
});

test('reset restores deterministic particle state and moving-world phase', () => {
  const world = new World(), slime = new Slime(world.stations[0].spawn);
  const sequence = () => { run(slime, world, 120, { x: 0.5, z: -0.5 }); run(slime, world, 36, { jump: true }); run(slime, world, 50); };
  sequence(); const first = slime.snapshot(); world.reset(); slime.reset(); sequence();
  assert.deepEqual(slime.snapshot(), first); healthy(slime);
});

test('fixed-step results do not depend on a 30, 60, or 144 Hz render schedule', () => {
  function replay(fps) {
    const { world, slime } = flat(); let acc = 0, steps = 0;
    for (let frame = 0; frame < fps * 2; frame++) {
      acc += 1 / fps;
      while (acc >= FIXED_DT - 1e-9) { run(slime, world, 1, { x: 1 }); acc -= FIXED_DT; steps++; }
    }
    assert.equal(steps, 120); return slime.snapshot();
  }
  assert.deepEqual(replay(30), replay(60)); assert.deepEqual(replay(144), replay(60));
});

test('long deterministic mixed-input runs stay finite across all material presets', () => {
  for (const stiffness of [0.45, 1, 1.8]) {
    const { world, slime } = flat(); slime.settings.stiffness = stiffness;
    for (let i = 0; i < 2400; i++) {
      const cycle = Math.floor(i / 120) % 4;
      run(slime, world, 1, { x: cycle === 0 ? 1 : cycle === 2 ? -1 : 0, z: cycle === 1 ? 1 : cycle === 3 ? -1 : 0,
        grip: i % 240 < 60, jump: i % 180 > 120, relax: i % 360 > 280 });
    }
    healthy(slime, 0.08);
  }
});

test('invalid step sizes are rejected instead of destabilising physics', () => {
  const { world, slime } = flat();
  for (const dt of [0, -1, 0.1, NaN, Infinity]) assert.throws(() => slime.step(world, idleInput(), dt), RangeError);
});
