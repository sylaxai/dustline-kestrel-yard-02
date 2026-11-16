// The bots: nine of them, four on the player's team and five against, each a small state
// machine over the waypoint graph. They follow routes through the map, hold positions,
// react to what they see (a throttled vision scan with a real line-of-sight raycast) and
// to what they hear (gunshot noise events), and they play the objective: the carrier
// plants the bomb, defenders retake and defuse. Shooting is burst fire with a reaction
// time and a hit chance that falls with distance and target speed, so a bot is dangerous
// at close range and beatable at long range.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';
import { SITE_A } from './world.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const BOT_EYE = 1.55;
const WALK_SPEED = 4.3;
const VISION_RANGE = 55;
const VISION_HALF_FOV = 1.05; // ~60 degrees each side
const HEAR_RADIUS = 26;

const NAMES_ATTACK = ['Vex', 'Rook', 'Ivo', 'Mara'];
const NAMES_DEFEND = ['Kade', 'Sable', 'Onyx', 'Pike', 'Rune'];
const LOADOUTS = ['rifle', 'rifle', 'smg', 'rifle', 'marksman'];

const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toNode = new THREE.Vector3();

export function createBots(scene, world, ctx) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = VISION_RANGE;
  const bots = [];
  const hitMeshes = [];
  const routeScratch = [];

  function buildMesh(team, name) {
    const group = new THREE.Group();
    const teamColor = team === 'attack' ? PALETTE.danger : PALETTE.ally;
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.78, 0.3),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.65, metalness: 0.05 }),
    );
    torso.position.y = 1.0;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a37e'), roughness: 0.7 }),
    );
    head.position.y = 1.53;
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.175, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6 }),
    );
    helmet.position.y = 1.56;
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.55, 0.26),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#22262d'), roughness: 0.9 }),
    );
    legs.position.y = 0.32;
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.09, 0.55),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#101216'), roughness: 0.5, metalness: 0.4 }),
    );
    gun.position.set(0.22, 1.15, -0.2);
    group.add(torso, head, helmet, legs, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    // A small floating name tag, readable at a glance in a fight.
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const g = canvas.getContext('2d');
    g.fillStyle = teamColor;
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, 128, 34);
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.28),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
    );
    tag.position.y = 1.95;
    group.add(tag);
    return { group, torso, head, gun, tag };
  }

  function makeBot(team, index, spawn) {
    const name = team === 'attack' ? NAMES_ATTACK[index] : NAMES_DEFEND[index];
    const parts = buildMesh(team, name);
    parts.group.position.set(spawn[0], 0, spawn[1]);
    scene.add(parts.group);
    const weapon = WEAPONS[LOADOUTS[(index + (team === 'defend' ? 2 : 0)) % LOADOUTS.length]];
    const bot = {
      name,
      team,
      index,
      parts,
      weapon,
      position: parts.group.position,
      yaw: team === 'attack' ? 0 : Math.PI,
      pitch: 0,
      health: 100,
      armor: index % 2 === 0 ? 50 : 0,
      alive: true,
      role: 'push',
      carrier: false,
      holdNode: -1,
      holdUntil: 0,
      route: [],
      routeIndex: 0,
      targetSite: null,
      visibleEnemy: null,
      visibleAt: 0,
      reactAt: 0,
      burstLeft: 0,
      fireAt: 0,
      scanAt: 0,
      strafeDir: 1,
      strafeAt: 0,
      hearAt: 0,
      heard: null,
      planting: false,
      defusing: false,
      skill: team === 'attack' ? 0.95 + Math.random() * 0.25 : 0.75 + Math.random() * 0.20,
      stepPhase: Math.random() * 0.4,
      stuckCheckAt: 0,
      lastX: spawn[0],
      lastZ: spawn[1],
    };
    parts.torso.userData.bot = bot;
    parts.torso.userData.part = 'torso';
    parts.head.userData.bot = bot;
    parts.head.userData.part = 'head';
    hitMeshes.push(parts.torso, parts.head);
    bots.push(bot);
    return bot;
  }

  function overlaps(x, y, z) {
    const probe = new THREE.Box3(
      new THREE.Vector3(x - BOT_RADIUS, y + 0.04, z - BOT_RADIUS),
      new THREE.Vector3(x + BOT_RADIUS, y + BOT_HEIGHT - 0.04, z + BOT_RADIUS),
    );
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  // Straight-line check: is the ground between two points free of colliders? A
  // bot-sized probe is swept along the segment. Used before walking straight at
  // a dropped bomb or a planted one, so a container between bot and target never
  // strands the bot walking into a wall — routing goes around it instead.
  function clearPath(x0, z0, x1, z1) {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(dist / 0.25));
    for (let i = 1; i <= steps; i += 1) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const z = z0 + ((z1 - z0) * i) / steps;
      if (overlaps(x, 0, z)) return false;
    }
    return true;
  }

  function moveBot(bot, dt, tx, tz) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const step = Math.min(dist, WALK_SPEED * dt);
    const nx = bot.position.x + (dx / dist) * step;
    const nz = bot.position.z + (dz / dist) * step;
    if (!overlaps(nx, bot.position.y, bot.position.z)) bot.position.x = nx;
    if (!overlaps(bot.position.x, bot.position.y, nz)) bot.position.z = nz;
    bot.yaw = Math.atan2(-dx, -dz);
    return dist < 0.4;
  }

  function setRoute(bot, nodeIndex) {
    const from = world.nav.nearest(bot.position.x, bot.position.z);
    world.nav.route(from, nodeIndex, routeScratch);
    bot.route = routeScratch.slice();
    bot.routeIndex = 0;
  }

  function followRoute(bot, dt) {
    if (bot.routeIndex >= bot.route.length) return true;
    const node = world.nav.nodes[bot.route[bot.routeIndex]];
    if (moveBot(bot, dt, node[0], node[1])) bot.routeIndex += 1;
    return bot.routeIndex >= bot.route.length;
  }

  // Vision: distance, field of view, a real raycast for line of sight, and smoke.
  function canSee(bot, targetPos) {
    _eye.set(bot.position.x, bot.position.y + BOT_EYE, bot.position.z);
    _target.copy(targetPos);
    const dist = _eye.distanceTo(_target);
    if (dist > VISION_RANGE) return false;
    _dir.subVectors(_target, _eye).normalize();
    const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (_dir.dot(forward) < Math.cos(VISION_HALF_FOV) && dist > 3) return false;
    raycaster.set(_eye, _dir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    if (hit) return false;
    return !ctx.blockedBySmoke(_eye, _target);
  }

  function scan(bot, now) {
    if (now < bot.scanAt) return;
    bot.scanAt = now + 0.12 + bot.stepPhase * 0.05;
    let best = null;
    let bestDist = Infinity;
    const enemies = ctx.enemiesOf(bot);
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const pos = enemy.eyePos(_target);
      const dist = bot.position.distanceTo(pos);
      if (dist < bestDist && canSee(bot, pos)) {
        best = enemy;
        bestDist = dist;
      }
    }
    if (best) {
      if (!bot.visibleEnemy) {
        // Attackers snap onto a target faster; holders take a beat longer to react.
        const base = bot.team === 'attack' ? 0.35 : 0.45;
        bot.reactAt = now + (base + Math.random() * 0.3) / bot.skill;
        bot.burstLeft = 0;
      }
      bot.visibleEnemy = best;
      bot.visibleAt = now;
      bot.lastSeen = best.eyePos(new THREE.Vector3());
    } else if (bot.visibleEnemy && now - bot.visibleAt > 0.8) {
      bot.visibleEnemy = null;
    }
  }

  function shootAt(bot, enemy, now, dt) {
    if (now < bot.reactAt || now < bot.fireAt) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.fireAt = now + 0.25 + Math.random() * 0.3;
      return;
    }
    bot.burstLeft -= 1;
    bot.fireAt = now + bot.weapon.fireGap * 1.6;
    const targetPos = enemy.eyePos(_target);
    const dist = bot.position.distanceTo(targetPos);
    // Hit chance: close and still is deadly, far and fast is a lottery.
    let chance = 0.46 * bot.skill;
    chance *= Math.max(0.25, 1 - dist / 70);
    chance *= Math.max(0.5, 1 - enemy.speed * 0.06);
    if (enemy.crouching) chance *= 0.8;
    const muzzle = new THREE.Vector3(bot.position.x, bot.position.y + 1.35, bot.position.z);
    if (Math.random() < chance) {
      const head = Math.random() < 0.14;
      const damage = bot.weapon.damage * (head ? bot.weapon.headMult : 1) * Math.max(bot.weapon.falloff, 1 - dist / bot.weapon.range * (1 - bot.weapon.falloff));
      ctx.damageEnemy(bot, enemy, Math.round(damage), head ? 'head' : 'torso', muzzle, targetPos.clone());
    } else {
      const miss = targetPos.clone();
      miss.x += (Math.random() - 0.5) * 2.4;
      miss.y += (Math.random() - 0.5) * 1.2;
      miss.z += (Math.random() - 0.5) * 2.4;
      ctx.missShot(bot, muzzle, miss);
    }
    ctx.noise(bot.position, 26);
  }

  function decide(bot, now) {
    const bomb = ctx.bomb;
    if (bot.team === 'attack') {
      if (ctx.bombCarrier === 'dropped') {
        // The bomb is on the ground: the nearest living attacker goes and gets
        // it, or the round stalls out with nobody able to plant. Near the drop,
        // walk straight at it — the nearest waypoint can sit more than a pickup
        // radius away from where the carrier fell, and routing there would strand
        // the bot staring at the bomb from 3 m away. But only when the straight
        // line is clear: a container between bot and drop used to pin the
        // retriever against a wall for the rest of the round, so a blocked line
        // routes around it on the waypoint graph instead.
        const dx = ctx.bombDropPos.x - bot.position.x;
        const dz = ctx.bombDropPos.z - bot.position.z;
        if (Math.hypot(dx, dz) < 6
          && clearPath(bot.position.x, bot.position.z, ctx.bombDropPos.x, ctx.bombDropPos.z)) {
          bot.directTarget = { x: ctx.bombDropPos.x, z: ctx.bombDropPos.z };
          bot.directKind = 'drop';
          bot.route = [];
          bot.routeIndex = 0;
        } else if (bot.routeIndex >= bot.route.length) {
          setRoute(bot, world.nav.nearest(ctx.bombDropPos.x, ctx.bombDropPos.z));
        }
        return;
      }
      if (bomb.status === 'planted') {
        // Guard the planted bomb: hold near its site.
        if (bot.holdNode < 0 || now > bot.holdUntil) {
          const node = world.nav.nearest(bomb.position.x + (Math.random() - 0.5) * 4, bomb.position.z + (Math.random() - 0.5) * 4);
          bot.holdNode = node;
          bot.holdUntil = now + 6 + Math.random() * 4;
          setRoute(bot, node);
        }
        return;
      }
      if (bot.carrier) {
        // The carrier pushes to the chosen site and plants when inside it.
        if (bot.targetSite) {
          const site = bot.targetSite;
          const inside = bot.position.x >= site.minX && bot.position.x <= site.maxX
            && bot.position.z >= site.minZ && bot.position.z <= site.maxZ;
          if (inside) {
            bot.planting = true;
            return;
          }
          const node = world.nav.nearest((site.minX + site.maxX) / 2, (site.minZ + site.maxZ) / 2);
          if (bot.routeIndex >= bot.route.length) setRoute(bot, node);
        }
        return;
      }
      // Escorts: push with the carrier toward the same site, then hold a corner near it.
      if (bot.routeIndex >= bot.route.length) {
        if (bot.holdNode < 0 || now > bot.holdUntil) {
          const nearSite = bot.targetSite === SITE_A ? [14, 16, 18, 27] : [15, 17, 19, 28];
          const node = nearSite[Math.floor(Math.random() * nearSite.length)];
          bot.holdNode = node;
          bot.holdUntil = now + 5 + Math.random() * 5;
          setRoute(bot, node);
        }
      }
    } else {
      // Defenders.
      if (bomb.status === 'planted') {
        // Retake: the closest living defender goes for the defuse; the rest
        // take cover near the site and fight the guards. Everyone converging
        // on the bomb used to cluster there, and one guard mowed them down in
        // turn while the defuse kept restarting.
        const dist = Math.hypot(bot.position.x - bomb.position.x, bot.position.z - bomb.position.z);
        let closest = null;
        let closestDist = Infinity;
        for (const other of bots) {
          if (other.team !== 'defend' || !other.alive) continue;
          const d = Math.hypot(other.position.x - bomb.position.x, other.position.z - bomb.position.z);
          if (d < closestDist) {
            closestDist = d;
            closest = other;
          }
        }
        if (closest !== bot) {
          bot.defusing = false;
          bot.directTarget = null; // stop walking an old straight line at the bomb
          // Pick a fresh cover spot only when the old one expires; while
          // walking there or holding it, stay the course instead of wandering.
          if (bot.coverNode == null || now > bot.coverUntil) {
            const near = [];
            for (let i = 0; i < world.nav.nodes.length; i += 1) {
              const d = Math.hypot(world.nav.nodes[i][0] - bomb.position.x, world.nav.nodes[i][1] - bomb.position.z);
              if (d > 2.5 && d < 11) near.push(i);
            }
            if (near.length) {
              bot.coverNode = near[bot.index % near.length];
              bot.coverUntil = now + 8 + Math.random() * 4;
              setRoute(bot, bot.coverNode);
            }
          }
          return;
        }
        // This bot is the defuser: close in on the bomb. If it was covering,
        // drop the cover route and head for the bomb instead.
        if (bot.coverNode != null) {
          bot.coverNode = null;
          bot.coverUntil = 0;
          bot.route = [];
          bot.routeIndex = 0;
        }
        const node = world.nav.nearest(bomb.position.x, bomb.position.z);
        if (dist < 1.6) {
          bot.defusing = true;
          return;
        }
        // The bomb can sit metres from the nearest waypoint: walk the last
        // stretch straight at it on a clear line, route around cover if blocked.
        if (dist < 6 && clearPath(bot.position.x, bot.position.z, bomb.position.x, bomb.position.z)) {
          bot.directTarget = { x: bomb.position.x, z: bomb.position.z };
          bot.directKind = 'bomb';
          bot.route = [];
          bot.routeIndex = 0;
          return;
        }
        if (bot.routeIndex >= bot.route.length) setRoute(bot, node);
        return;
      }
      if (bot.role === 'roam') {
        if (bot.routeIndex >= bot.route.length) {
          const nodes = [7, 12, 20, 21];
          setRoute(bot, nodes[Math.floor(Math.random() * nodes.length)]);
        }
        return;
      }
      // Holders stay near their site until they hear something.
      if (bot.heard && now - bot.hearAt < 4) {
        const node = world.nav.nearest(bot.heard.x, bot.heard.z);
        if (bot.routeIndex >= bot.route.length) setRoute(bot, node);
        return;
      }
      if (bot.routeIndex >= bot.route.length && bot.holdNode >= 0) {
        // Sit still and watch: face the lane.
        bot.yaw += Math.sin(now * 0.5 + bot.index) * 0.001;
      }
    }
  }

  function stepBot(bot, dt, now) {
    if (!bot.alive) return;
    scan(bot, now);
    // Hearing: a recent noise pulls a defender's attention — but only nearby
    // noise for a site holder. With a 26 m ear a holder would abandon the site
    // for every shot fired in mid, and the carrier would walk into an empty site.
    if (bot.team === 'defend' && ctx.lastNoise && now - ctx.lastNoise.at < 1.2) {
      const d = Math.hypot(bot.position.x - ctx.lastNoise.x, bot.position.z - ctx.lastNoise.z);
      const hearDist = bot.role === 'roam' ? HEAR_RADIUS : 12;
      if (d < hearDist && (!bot.heard || now - bot.hearAt > 3)) {
        bot.heard = { x: ctx.lastNoise.x, z: ctx.lastNoise.z };
        bot.hearAt = now;
      }
    }
    // The objective comes first: a defender standing on the bomb defuses, and a
    // carrier standing on a site plants, even with an enemy in sight — the
    // teammates are the cover. Without this, a bot in a firefight never plays
    // the objective at all. The defuser stays on the job while the defuse is
    // running: once the bomb is 'defusing', the combat branch below would
    // otherwise clear defusing every time the defuser glimpsed an enemy, and
    // the defuse would restart forever.
    if (bot.team === 'defend' && (ctx.bomb.status === 'planted'
      || (ctx.bomb.status === 'defusing' && ctx.bomb.defuser === bot))) {
      const d = Math.hypot(bot.position.x - ctx.bomb.position.x, bot.position.z - ctx.bomb.position.z);
      if (d < 2.5) {
        bot.defusing = true;
        return;
      }
    }
    if (bot.carrier && bot.targetSite) {
      const site = bot.targetSite;
      if (bot.position.x >= site.minX && bot.position.x <= site.maxX
        && bot.position.z >= site.minZ && bot.position.z <= site.maxZ) {
        bot.planting = true;
        return;
      }
    }
    if (bot.visibleEnemy) {
      // Fight: face the enemy, strafe, fire in bursts. Combat interrupts the objective.
      bot.planting = false;
      bot.defusing = false;
      const enemy = bot.visibleEnemy;
      const pos = enemy.eyePos(_target);
      bot.yaw = Math.atan2(-(pos.x - bot.position.x), -(pos.z - bot.position.z));
      if (now > bot.strafeAt) {
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
        bot.strafeAt = now + 0.5 + Math.random() * 0.7;
      }
      const strafeX = Math.cos(bot.yaw) * bot.strafeDir;
      const strafeZ = -Math.sin(bot.yaw) * bot.strafeDir;
      const nx = bot.position.x + strafeX * WALK_SPEED * 0.55 * dt;
      const nz = bot.position.z + strafeZ * WALK_SPEED * 0.55 * dt;
      if (!overlaps(nx, bot.position.y, bot.position.z)) bot.position.x = nx;
      if (!overlaps(bot.position.x, bot.position.y, nz)) bot.position.z = nz;
      shootAt(bot, enemy, now, dt);
      return;
    }
    if (bot.planting || bot.defusing) return; // stand still while the objective runs
    decide(bot, now);
    // decide() can start a plant or a defuse: stand still for it, do not walk on.
    if (bot.planting || bot.defusing) return;
    // A bot sent to fetch a dropped bomb walks the last stretch straight at it —
    // and a retaker walks the last stretch straight at the planted bomb. Each
    // walk ends when its own job ends: a pickup walk when the bomb is no longer
    // dropped, a retake walk when the bomb is no longer planted or being defused.
    if (bot.directTarget) {
      const stale = bot.directKind === 'bomb'
        ? (ctx.bomb.status !== 'planted' && ctx.bomb.status !== 'defusing')
        : ctx.bombCarrier !== 'dropped';
      if (stale) {
        bot.directTarget = null;
      } else if (moveBot(bot, dt, bot.directTarget.x, bot.directTarget.z)) {
        bot.directTarget = null;
      }
      return;
    }
    if (bot.routeIndex < bot.route.length) {
      followRoute(bot, dt);
      // Unstuck: a bot that has not moved for 2.5 s while holding a route skips
      // the waypoint it is fighting — and sidesteps to a neighbouring node.
      // Re-routing alone does not free it: every new route restarts at the
      // nearest waypoint, and that waypoint itself can be the trap (a barrel
      // between bot and node pins the bot 1 cm from the barrel while the bomb
      // lies 2 m past it). Walking straight at a neighbouring node instead
      // slides the bot around the obstacle on axis-separated movement, and the
      // next decision re-routes to the real objective from there.
      if (now >= bot.stuckCheckAt) {
        bot.stuckCheckAt = now + 0.5;
        const moved = Math.hypot(bot.position.x - bot.lastX, bot.position.z - bot.lastZ);
        if (moved < 0.05) {
          bot.stuckTime = (bot.stuckTime || 0) + 0.5;
          if (bot.stuckTime >= 2.5) {
            bot.stuckTime = 0;
            bot.routeIndex += 1;
            const neighbours = world.nav.adjacency[world.nav.nearest(bot.position.x, bot.position.z)];
            if (neighbours.length) {
              bot.route = [neighbours[Math.floor(Math.random() * neighbours.length)]];
              bot.routeIndex = 0;
            }
          }
        } else {
          bot.stuckTime = 0;
        }
        bot.lastX = bot.position.x;
        bot.lastZ = bot.position.z;
      }
    }
    // Face the tag toward the player so names stay readable.
    bot.parts.tag.lookAt(ctx.playerCamera.position);
  }

  function reset(round, attackSite) {
    for (const bot of bots) {
      // Spawn positions are assigned by the caller through placeBot.
      bot.health = 100;
      bot.armor = bot.index % 2 === 0 ? 50 : 0;
      bot.alive = true;
      bot.route = [];
      bot.routeIndex = 0;
      bot.holdNode = -1;
      bot.visibleEnemy = null;
      bot.planting = false;
      bot.defusing = false;
      bot.directTarget = null;
      bot.directKind = null;
      bot.coverNode = null;
      bot.coverUntil = 0;
      bot.heard = null;
      bot.carrier = false;
      bot.role = 'push';
      bot.parts.group.visible = true;
      bot.parts.group.rotation.set(0, 0, 0);
    }
    // The bomb starts with the player, so no bot is the carrier yet: the carrier
    // flag is only set when a bot picks the bomb up after a drop. Every attacker
    // still pushes the same site, so the team attacks together.
    const attackers = bots.filter((b) => b.team === 'attack');
    for (const a of attackers) a.targetSite = attackSite;
    // Defenders: two hold A, two hold B, one roams mid.
    const defenders = bots.filter((b) => b.team === 'defend');
    defenders[0].role = 'holdA';
    defenders[0].holdNode = 16;
    defenders[1].role = 'holdB';
    defenders[1].holdNode = 17;
    defenders[2].role = 'holdA';
    defenders[2].holdNode = 23;
    defenders[3].role = 'holdB';
    defenders[3].holdNode = 24;
    defenders[4].role = 'roam';
    for (const d of defenders) {
      if (d.role !== 'roam') setRoute(d, d.holdNode);
    }
    void round;
  }

  function placeBot(bot, x, z, yaw) {
    bot.position.set(x, 0, z);
    bot.yaw = yaw;
    bot.parts.group.position.set(x, 0, z);
  }

  function step(dt, now) {
    for (const bot of bots) stepBot(bot, dt, now);
    // Cheap separation so bots do not stand inside each other. Each push is
    // checked against the colliders first: an unchecked push used to shove a
    // bot into a wall or onto a platform edge, and a bot whose probe overlaps
    // a collider can never walk out again — every step's destination still
    // overlaps — so it froze for the rest of the round.
    for (let i = 0; i < bots.length; i += 1) {
      const a = bots[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bots.length; j += 1) {
        const b = bots[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.55 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (0.75 - d) / 2;
          const ux = dx / d;
          const uz = dz / d;
          const ax = a.position.x - ux * push;
          const az = a.position.z - uz * push;
          if (!overlaps(ax, a.position.y, az)) {
            a.position.x = ax;
            a.position.z = az;
          }
          const bx = b.position.x + ux * push;
          const bz = b.position.z + uz * push;
          if (!overlaps(bx, b.position.y, bz)) {
            b.position.x = bx;
            b.position.z = bz;
          }
        }
      }
    }
    for (const bot of bots) {
      bot.parts.group.position.copy(bot.position);
      bot.parts.group.rotation.y = bot.yaw;
    }
  }

  // Build the two teams: four attackers beside the player, five defenders.
  // Spawn placement is the caller's job (placeBot), so the same module works for
  // either side of the map.
  for (let i = 0; i < 4; i += 1) makeBot('attack', i, [0, 15.5]);
  for (let i = 0; i < 5; i += 1) makeBot('defend', i, [0, -14.5]);
  return { bots, hitMeshes, step, reset, placeBot, setRoute };
}
