// Transient combat effects, all pooled: tracers, impact sparks, smoke clouds and the
// bomb's explosion flash. Nothing is allocated in the hot loop — every effect is a mesh
// taken from a fixed pool and returned when its life runs out. Smoke clouds are also
// vision blockers: bots.js asks this module whether a line of sight crosses one.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 14;
const SPARK_POOL = 24;
const TRACER_LIFE = 0.09;
const SPARK_LIFE = 0.35;

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();

export function createEffects(scene) {
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false });
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a'), transparent: true, opacity: 0.95, depthWrite: false });
  const smokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#9aa2ad'), transparent: true, opacity: 0.55, roughness: 1, depthWrite: false });
  const tracers = [];
  const sparks = [];
  const smokes = [];
  const explosionLight = new THREE.PointLight(new THREE.Color('#ff9a3c'), 0, 26, 1.6);
  scene.add(explosionLight);

  for (let i = 0; i < TRACER_POOL; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  for (let i = 0; i < SPARK_POOL; i += 1) {
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09), sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vel: new THREE.Vector3() });
  }

  function tracer(from, to) {
    const slot = tracers.find((t) => t.life <= 0);
    if (!slot) return;
    _dir.subVectors(to, from);
    const len = _dir.length() || 0.01;
    _mid.addVectors(from, to).multiplyScalar(0.5);
    slot.mesh.position.copy(_mid);
    slot.mesh.lookAt(to);
    slot.mesh.scale.set(1, 1, len);
    slot.mesh.visible = true;
    slot.life = TRACER_LIFE;
  }

  function impact(point, normal) {
    let spawned = 0;
    for (const spark of sparks) {
      if (spark.life > 0) continue;
      spark.mesh.position.copy(point);
      spark.vel.set(
        (Math.random() - 0.5) * 3 + normal.x * 2,
        Math.random() * 2.5 + 0.5,
        (Math.random() - 0.5) * 3 + normal.z * 2,
      );
      spark.mesh.visible = true;
      spark.life = SPARK_LIFE * (0.6 + Math.random() * 0.4);
      spawned += 1;
      if (spawned >= 4) break;
    }
  }

  function smoke(point, radius, duration) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), smokeMat.clone());
    mesh.position.copy(point);
    mesh.position.y = Math.max(1.1, point.y);
    mesh.scale.set(1, 0.75, 1);
    scene.add(mesh);
    smokes.push({ mesh, until: performance.now() / 1000 + duration, radius, born: performance.now() / 1000 });
    return smokes[smokes.length - 1];
  }

  // Does the segment a->b cross any live smoke cloud? Used for bot vision.
  function blockedBySmoke(a, b) {
    for (const cloud of smokes) {
      _dir.subVectors(b, a);
      const lenSq = _dir.lengthSq();
      if (lenSq === 0) continue;
      const t = Math.max(0, Math.min(1, _mid.subVectors(cloud.mesh.position, a).dot(_dir) / lenSq));
      _to.copy(a).addScaledVector(_dir, t);
      if (_to.distanceToSquared(cloud.mesh.position) < cloud.radius * cloud.radius) return true;
    }
    return false;
  }

  function explosion(point) {
    explosionLight.position.copy(point);
    explosionLight.position.y = 1.6;
    explosionLight.intensity = 900;
    impact(point, new THREE.Vector3(0, 1, 0));
    impact(point, new THREE.Vector3(0, 1, 0));
  }

  function step(dt, nowSeconds) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.y -= 9 * dt;
      s.mesh.rotation.x += dt * 9;
      s.mesh.rotation.y += dt * 7;
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      const cloud = smokes[i];
      const age = nowSeconds - cloud.born;
      const lifeLeft = cloud.until - nowSeconds;
      if (lifeLeft <= 0) {
        scene.remove(cloud.mesh);
        cloud.mesh.material.dispose();
        smokes.splice(i, 1);
        continue;
      }
      const grow = Math.min(1, age / 1.5);
      cloud.mesh.scale.set(grow, grow * 0.75, grow);
      cloud.mesh.material.opacity = 0.55 * Math.min(1, lifeLeft / 3);
      cloud.mesh.rotation.y += dt * 0.2;
    }
    explosionLight.intensity = Math.max(0, explosionLight.intensity - dt * 2600);
  }

  function clear() {
    for (const t of tracers) { t.life = 0; t.mesh.visible = false; }
    for (const s of sparks) { s.life = 0; s.mesh.visible = false; }
    for (const cloud of smokes) {
      scene.remove(cloud.mesh);
      cloud.mesh.material.dispose();
    }
    smokes.length = 0;
    explosionLight.intensity = 0;
  }

  return { tracer, impact, smoke, blockedBySmoke, explosion, step, clear };
}
