// DUSTLINE: the match itself. One object owns the whole state — phase, round, score,
// money, the bomb, grenades and every kill — and advances it on a fixed 60 Hz step, so
// rendering never changes the simulation. Phases: menu, buy (15 s), round (100 s),
// roundEnd (4 s), matchEnd. First to 7 rounds wins the match, at most 13 rounds.
// The player attacks every round with four friendly bots against five defenders:
// win by eliminating the defenders, or by planting the bomb and letting it explode;
// the defenders win by eliminating the attackers, defusing, or running the clock out
// with no plant.
import * as THREE from 'three';
import { SITE_A, SITE_B, ATTACKER_SPAWNS, DEFENDER_SPAWNS } from './world.js';
import { WEAPONS, GRENADES, BUY_MENU } from './weapons.js';
import { PLANT_TIME, DEFUSE_TIME } from './bomb.js';

const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const ROUND_END_SECONDS = 4;
const WIN_ROUNDS = 7;
const MAX_ROUNDS = 13;
const GRENADE_GRAVITY = 14;

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _jitter = new THREE.Vector3();
const _pelletDir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _faceNormal = new THREE.Vector3(0, 1, 0);

export function createGame(deps) {
  const { scene, camera, world, player, weapon, bots, bomb, economy, effects, audio, hud, input } = deps;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const shootables = world.shootables.concat(bots.hitMeshes);

  const state = {
    phase: 'menu',
    round: 0,
    attackWins: 0,
    defendWins: 0,
    phaseTime: 0,
    roundTime: 0,
    targetSite: null,
    money: economy.state.money,
    grenades: { frag: 0, smoke: 0, flash: 0 },
    selectedGrenade: 'frag',
    owned: { pistol: true },
    bombCarrier: 'player', // 'player' | bot | 'dropped' | null (planted)
    bombDropPos: new THREE.Vector3(),
    matchWinner: null,
    roundWinner: null,
    roundReason: '',
    kills: 0,
    deaths: 0,
    spectating: null,
    lastNoise: null,
    now: 0,
    stats: { botDeaths: 0, plants: 0, defuses: 0, rounds: [] },
  };
  const grenades = [];
  let siteTarget = SITE_A;
  let plantProgress = 0;
  let defuseProgress = 0;
  let spectateIndex = 0;

  // Enemy wrappers: the shape bots.js senses and shoots at. One per actor, reused.
  const playerEnemy = {
    kind: 'player',
    get alive() { return player.state.alive; },
    eyePos(out) {
      out.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
      return out;
    },
    get speed() { return player.groundSpeed(); },
    get crouching() { return player.state.crouching; },
  };
  const botEnemies = new Map();
  function botEnemy(bot) {
    if (!botEnemies.has(bot)) {
      botEnemies.set(bot, {
        kind: 'bot',
        bot,
        get alive() { return bot.alive; },
        eyePos(out) {
          out.set(bot.position.x, bot.position.y + 1.55, bot.position.z);
          return out;
        },
        get speed() { return bot.routeIndex < bot.route.length ? 4.3 : 0; },
        get crouching() { return false; },
      });
    }
    return botEnemies.get(bot);
  }

  const botCtx = {
    get bomb() { return bomb.state; },
    get bombCarrier() { return state.bombCarrier; },
    get bombDropPos() { return state.bombDropPos; },
    get lastNoise() { return state.lastNoise; },
    get playerCamera() { return camera; },
    blockedBySmoke(a, b) { return effects.blockedBySmoke(a, b); },
    enemiesOf(bot) {
      const list = [];
      if (bot.team === 'defend') {
        list.push(playerEnemy);
        for (const other of bots.bots) if (other.team === 'attack') list.push(botEnemy(other));
      } else {
        for (const other of bots.bots) if (other.team === 'defend') list.push(botEnemy(other));
      }
      return list;
    },
    damageEnemy(shooter, enemy, amount, part, muzzle, targetPos) {
      effects.tracer(muzzle, targetPos);
      audio.shot(shooter.weapon.kind, true);
      if (enemy.kind === 'player') {
        const dealt = player.damage(amount);
        if (dealt > 0) {
          hud.damageFlash();
          audio.hurt();
          if (!player.state.alive) onPlayerDeath(shooter);
        }
      } else {
        damageBot(enemy.bot, amount, part, shooter);
      }
    },
    missShot(shooter, muzzle, missPoint) {
      effects.tracer(muzzle, missPoint);
      effects.impact(missPoint, new THREE.Vector3(0, 1, 0));
      audio.shot(shooter.weapon.kind, true);
    },
    noise(position, radius) {
      state.lastNoise = { x: position.x, z: position.z, at: state.now, radius };
    },
  };

  function aliveCount(team) {
    let count = team === 'attack' ? (player.state.alive ? 1 : 0) : 0;
    for (const bot of bots.bots) if (bot.team === team && bot.alive) count += 1;
    return count;
  }

  function dropBombAt(position) {
    // Only a bomb still in hand can be dropped. A planted (or being defused)
    // bomb stays on the site even when its planter dies — resetting it to
    // 'carried' here used to void every plant the moment the planter died.
    if (bomb.state.status !== 'carried' && bomb.state.status !== 'planting') {
      state.bombCarrier = null;
      return;
    }
    state.bombCarrier = 'dropped';
    state.bombDropPos.copy(position);
    state.bombDropPos.y = 0.1;
    bomb.state.status = 'carried';
    hud.setBomb('Bomb dropped — pick it up', 'warn');
  }

  function damageBot(bot, amount, part, killer) {
    if (!bot.alive) return;
    let remaining = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, remaining * 0.6);
      bot.armor -= absorbed;
      remaining -= absorbed;
    }
    bot.health -= remaining;
    if (bot.health > 0) return;
    bot.health = 0;
    bot.alive = false;
    bot.planting = false;
    bot.defusing = false;
    bot.parts.group.visible = false;
    state.stats.botDeaths += 1;
    const killerName = killer === 'player' ? 'You' : killer.name;
    const killerTeam = killer === 'player' ? 'ally' : killer.team;
    hud.killfeed(killerName, bot.name, part === 'head', killerTeam);
    if (killer === 'player') {
      economy.addKill();
      state.kills += 1;
      audio.kill();
      hud.setMoney(economy.state.money);
    }
    if (bot.carrier && state.bombCarrier === bot) {
      bot.carrier = false;
      dropBombAt(bot.position);
    }
    if (bomb.state.status === 'planting' && bomb.state.planter === bot) bomb.cancel();
    if (bomb.state.status === 'defusing' && bomb.state.defuser === bot) bomb.cancel();
    checkRoundEnd();
  }

  function onPlayerDeath(killer) {
    state.deaths += 1;
    economy.addDeath();
    hud.killfeed(killer.name, 'You', false, killer.team);
    audio.roundLose();
    if (state.bombCarrier === 'player') dropBombAt(player.state.position);
    // Spectate the next alive friendly bot.
    const alive = bots.bots.filter((b) => b.team === 'attack' && b.alive);
    state.spectating = alive.length ? alive[spectateIndex % alive.length] : null;
    spectateIndex += 1;
    if (document.pointerLockElement) document.exitPointerLock();
    checkRoundEnd();
  }

  function checkRoundEnd() {
    if (state.phase !== 'round') return;
    const bombPlanted = bomb.state.status === 'planted' || bomb.state.status === 'defusing';
    if (!bombPlanted) {
      if (aliveCount('defend') === 0) return endRound('attack', 'Team eliminated');
      if (aliveCount('attack') === 0) return endRound('defend', 'Team eliminated');
    } else {
      if (aliveCount('attack') === 0 && bomb.state.status !== 'defusing') {
        // No attackers left and nobody defusing: the bomb still decides it.
      }
    }
  }

  function endRound(winner, reason) {
    if (state.phase !== 'round') return;
    state.phase = 'roundEnd';
    state.phaseTime = 0;
    state.roundWinner = winner;
    state.roundReason = reason;
    if (winner === 'attack') state.attackWins += 1;
    else state.defendWins += 1;
    state.stats.rounds.push({
      round: state.round, winner, reason,
      attackAlive: aliveCount('attack'), defendAlive: aliveCount('defend'),
    });
    if (typeof window !== 'undefined' && window.__testLog) {
      window.__testLog.push(`round ${state.round}: ${winner} wins (${reason}) — alive A${aliveCount('attack')}/D${aliveCount('defend')}`);
    }
    economy.roundEnd(winner === 'attack');
    hud.setMoney(economy.state.money);
    hud.setScore(state.attackWins, state.defendWins);
    hud.setBomb('', '');
    const won = winner === 'attack';
    hud.banner(
      won ? 'ROUND WON' : 'ROUND LOST',
      `${reason} — ${state.attackWins} : ${state.defendWins}`,
      3400,
    );
    if (won) audio.roundWin();
    else audio.roundLose();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.phaseTime = 0;
    state.roundTime = ROUND_SECONDS;
    state.spectating = null;
    state.lastNoise = null;
    grenades.length = 0;
    effects.clear();
    bomb.reset();
    plantProgress = 0;
    defuseProgress = 0;
    siteTarget = Math.random() < 0.5 ? SITE_A : SITE_B;
    state.targetSite = siteTarget;
    // Spawn the player and the bots, then reset the bots' plans for this round.
    player.reset(0, 15.5);
    player.state.armor = 0;
    bots.reset(state.round, siteTarget);
    bots.bots.forEach((bot, i) => {
      if (bot.team === 'attack') {
        // Friendly bots take the spawn points around the player (index 2 is the player's).
        const spawn = ATTACKER_SPAWNS[[0, 1, 3, 4][i]];
        bots.placeBot(bot, spawn[0], spawn[1], 0);
      } else {
        const spawn = DEFENDER_SPAWNS[(i - 4) % DEFENDER_SPAWNS.length];
        bots.placeBot(bot, spawn[0], spawn[1], Math.PI);
      }
    });
    // The bomb starts with the player.
    state.bombCarrier = 'player';
    weapon.refillAmmo();
    hud.setHealth(100, 0);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.current.name);
    hud.setMoney(economy.state.money);
    hud.setScore(state.attackWins, state.defendWins);
    hud.setTimer(BUY_SECONDS);
    hud.setBomb(`Plant the bomb on site ${siteTarget.name}`, 'info');
    hud.setAlive(aliveCount('attack'), aliveCount('defend'));
    hud.showBuy(BUY_MENU, economy.state.money, buy);
    hud.hint('Buy phase — press B to close the shop, E plants the bomb on site');
    hud.banner(`ROUND ${state.round}`, `Plant the bomb on site ${siteTarget.name}`, 2600);
  }

  function startMatch() {
    state.round = 0;
    state.attackWins = 0;
    state.defendWins = 0;
    state.matchWinner = null;
    economy.reset();
    state.grenades = { frag: 0, smoke: 0, flash: 0 };
    state.selectedGrenade = 'frag';
    state.owned = { pistol: true };
    weapon.equip('pistol');
    player.state.speedFactor = weapon.current.moveSpeed;
    startRound();
  }

  function equipWeapon(id) {
    if (!state.owned[id]) return false;
    if (!weapon.equip(id)) return false;
    player.state.speedFactor = weapon.current.moveSpeed;
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.current.name);
    return true;
  }

  function buy(id) {
    const item = BUY_MENU.find((entry) => entry.id === id);
    if (!item) return;
    const result = economy.buy(item);
    if (!result.ok) {
      audio.denied();
      hud.hint(result.reason);
      return;
    }
    audio.buy();
    if (result.weapon) {
      state.owned[result.weapon] = true;
      equipWeapon(result.weapon);
    } else if (result.armor) {
      player.state.armor = result.armor;
      hud.setHealth(player.state.health, player.state.armor);
    } else if (result.grenade) {
      state.grenades[result.grenade] += 1;
    }
    hud.setMoney(economy.state.money);
    hud.showBuy(BUY_MENU, economy.state.money, buy);
    hud.hint(`${item.label} bought — $${item.price}`);
  }

  function throwGrenade() {
    const kind = state.selectedGrenade;
    if (state.grenades[kind] <= 0) {
      audio.denied();
      hud.hint(`No ${GRENADES[kind].name} left — buy one in the buy phase (B)`);
      return;
    }
    state.grenades[kind] -= 1;
    camera.getWorldDirection(_dir);
    _origin.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
    grenades.push({
      kind,
      position: _origin.clone().addScaledVector(_dir, 0.6),
      velocity: _dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 3.5, 0)),
      fuse: 2.2,
      bounced: false,
    });
    audio.step();
  }

  function grenadeEffect(g) {
    if (g.kind === 'frag') {
      effects.explosion(g.position);
      audio.explosion();
      const victims = [playerEnemy, ...bots.bots.map(botEnemy)];
      for (const victim of victims) {
        if (!victim.alive) continue;
        const pos = victim.eyePos(_eye);
        const dist = pos.distanceTo(g.position);
        if (dist > GRENADES.frag.radius) continue;
        raycaster.set(g.position, _dir.subVectors(pos, g.position).normalize());
        raycaster.far = dist;
        if (raycaster.intersectObjects(world.shootables, false)[0]) continue;
        const damage = Math.round(GRENADES.frag.damage * (1 - dist / (GRENADES.frag.radius * 1.4)));
        if (victim.kind === 'player') {
          const dealt = player.damage(damage);
          if (dealt > 0) {
            hud.damageFlash();
            if (!player.state.alive) onPlayerDeath({ name: 'Frag' });
          }
        } else {
          damageBot(victim.bot, damage, 'torso', 'player');
        }
      }
    } else if (g.kind === 'smoke') {
      effects.smoke(g.position, GRENADES.smoke.radius, GRENADES.smoke.duration);
    } else if (g.kind === 'flash') {
      const victims = [playerEnemy, ...bots.bots.map(botEnemy)];
      for (const victim of victims) {
        if (!victim.alive) continue;
        const pos = victim.eyePos(_eye);
        const dist = pos.distanceTo(g.position);
        if (dist > GRENADES.flash.radius) continue;
        raycaster.set(g.position, _dir.subVectors(pos, g.position).normalize());
        raycaster.far = dist;
        if (raycaster.intersectObjects(world.shootables, false)[0]) continue;
        if (victim.kind === 'player') {
          camera.getWorldDirection(_dir);
          const facing = _dir.dot(new THREE.Vector3().subVectors(g.position, pos).normalize());
          hud.flash(facing > 0 ? 1 : 0.4);
        } else {
          victim.bot.visibleEnemy = null;
          victim.bot.scanAt = state.now + GRENADES.flash.duration;
        }
      }
    }
  }

  function stepGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.velocity.y -= GRENADE_GRAVITY * dt;
      const next = g.position.clone().addScaledVector(g.velocity, dt);
      // Cheap bounce: test the next position against the world boxes, reflect per axis.
      let hit = false;
      for (const axis of ['x', 'y', 'z']) {
        const probe = g.position.clone();
        probe[axis] = next[axis];
        const box = new THREE.Box3(
          new THREE.Vector3(probe.x - 0.1, probe.y - 0.1, probe.z - 0.1),
          new THREE.Vector3(probe.x + 0.1, probe.y + 0.1, probe.z + 0.1),
        );
        for (const collider of world.colliders) {
          if (box.intersectsBox(collider)) {
            g.velocity[axis] *= -0.45;
            hit = true;
            break;
          }
        }
      }
      if (hit) g.bounced = true;
      g.position.addScaledVector(g.velocity, dt);
      if (g.position.y < 0.1) {
        g.position.y = 0.1;
        g.velocity.y = Math.abs(g.velocity.y) * 0.45;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
        g.bounced = true;
      }
      if (g.fuse <= 0 || (g.bounced && g.fuse < 1.2)) {
        grenadeEffect(g);
        grenades.splice(i, 1);
      }
    }
  }

  function stepBomb(dt, keys) {
    const bombState = bomb.state;
    if (bombState.status === 'planted') {
      const beep = bomb.step(dt, state.now);
      if (beep) audio.plantBeep();
      bombState.timer -= 0; // timer already advanced inside bomb.step
      hud.setBomb(`BOMB PLANTED — ${Math.ceil(bombState.timer)}s`, 'danger');
      if (bombState.timer <= 0) {
        bomb.explode();
        if (typeof window !== 'undefined' && window.__testLog) window.__testLog.push(`round ${state.round}: bomb detonated`);
        effects.explosion(bombState.position);
        audio.explosion();
        // Decide the round first: the blast's kills must not flip the winner.
        endRound('attack', 'Bomb detonated');
        // The blast kills everyone still on the site.
        for (const bot of bots.bots) {
          if (!bot.alive) continue;
          if (bot.position.distanceTo(bombState.position) < 9) damageBot(bot, 200, 'torso', 'player');
        }
        if (player.state.alive && player.state.position.distanceTo(bombState.position) < 9) {
          player.damage(200);
          if (!player.state.alive) onPlayerDeath({ name: 'Bomb' });
        }
      }
      return;
    }
    if (bombState.status === 'planting') {
      const planter = bombState.planter;
      const inSite = planter === 'player'
        ? bomb.siteAt(player.state.position.x, player.state.position.z, world.sites)
        : planter && bomb.siteAt(planter.position.x, planter.position.z, world.sites);
      const stillThere = planter === 'player'
        ? player.state.alive && keys.has('KeyE') && inSite
        : planter && planter.alive && planter.planting && inSite;
      if (!stillThere) {
        bomb.cancel();
        plantProgress = 0;
        hud.setBomb(`Plant the bomb on site ${siteTarget.name}`, 'info');
        return;
      }
      plantProgress += dt;
      hud.setBomb(`PLANTING… ${Math.ceil((PLANT_TIME - plantProgress) * 10) / 10}s`, 'warn');
      if (plantProgress >= PLANT_TIME) {
        bomb.plantDone();
        state.stats.plants += 1;
        // The bomb is on the ground now: nobody carries it, so a later death
        // of the planter must not drop it back to 'carried'.
        state.bombCarrier = null;
        if (typeof window !== 'undefined' && window.__testLog) window.__testLog.push(`round ${state.round}: bomb planted on ${bomb.state.site ? bomb.state.site.name : '?'}`);
        economy.addPlant();
        hud.setMoney(economy.state.money);
        audio.plantDone();
        hud.banner('BOMB PLANTED', 'Defend it until it detonates', 2600);
      }
      return;
    }
    if (bombState.status === 'defusing') {
      const defuser = bombState.defuser;
      if (!defuser || !defuser.alive || !defuser.defusing) {
        bomb.cancel();
        defuseProgress = 0;
        return;
      }
      defuseProgress += dt;
      if (Math.floor(defuseProgress * 4) !== Math.floor((defuseProgress - dt) * 4)) audio.defuse();
      hud.setBomb(`DEFUSING… ${Math.ceil((DEFUSE_TIME - defuseProgress) * 10) / 10}s`, 'danger');
      if (defuseProgress >= DEFUSE_TIME) {
        bomb.defuseDone();
        state.stats.defuses += 1;
        if (typeof window !== 'undefined' && window.__testLog) window.__testLog.push(`round ${state.round}: bomb defused`);
        endRound('defend', 'Bomb defused');
      }
      return;
    }
    // Carried: the player plants with E, a carrier bot plants on its own.
    if (state.bombCarrier === 'player' && player.state.alive) {
      const site = bomb.siteAt(player.state.position.x, player.state.position.z, world.sites);
      if (site && keys.has('KeyE')) {
        bomb.startPlant(site, 'player', player.state.position);
        plantProgress = 0;
        audio.plantBeep();
      } else if (site) {
        hud.hint('Hold E to plant the bomb');
      }
    } else if (state.bombCarrier && state.bombCarrier !== 'player' && state.bombCarrier !== 'dropped') {
      const carrier = state.bombCarrier;
      if (carrier.planting) {
        const site = bomb.siteAt(carrier.position.x, carrier.position.z, world.sites);
        if (site) {
          bomb.startPlant(site, carrier, carrier.position);
          plantProgress = 0;
        } else {
          carrier.planting = false;
        }
      }
    }
    // A dropped bomb is picked up by the nearest living attacker. The radius is
    // generous on purpose: the drop can sit a step off the nearest waypoint.
    if (state.bombCarrier === 'dropped') {
      const carrier = bots.bots.find((b) => b.team === 'attack' && b.alive
        && Math.hypot(b.position.x - state.bombDropPos.x, b.position.z - state.bombDropPos.z) < 2.2);
      if (carrier) {
        carrier.carrier = true;
        carrier.targetSite = siteTarget;
        state.bombCarrier = carrier;
        hud.setBomb(`Plant the bomb on site ${siteTarget.name}`, 'info');
      } else if (player.state.alive
        && Math.hypot(player.state.position.x - state.bombDropPos.x, player.state.position.z - state.bombDropPos.z) < 2.2) {
        state.bombCarrier = 'player';
        hud.setBomb(`Plant the bomb on site ${siteTarget.name}`, 'info');
      }
    }
  }

  function step(dt, keys, now) {
    state.now = now;
    if (state.phase === 'menu' || state.phase === 'matchEnd') return;
    if (state.phase === 'roundEnd') {
      state.phaseTime += dt;
      if (state.phaseTime >= ROUND_END_SECONDS) {
        if (state.attackWins >= WIN_ROUNDS || state.defendWins >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
          state.phase = 'matchEnd';
          state.matchWinner = state.attackWins > state.defendWins ? 'attack' : 'defend';
          const won = state.matchWinner === 'attack';
          hud.showOverlay('matchEnd', won
            ? `You win the match ${state.attackWins} — ${state.defendWins}. Kestrel Yard is yours.`
            : `You lose the match ${state.attackWins} — ${state.defendWins}. The yard holds.`);
          if (won) audio.roundWin();
          return;
        }
        startRound();
      }
      return;
    }
    if (state.phase === 'buy') {
      state.phaseTime += dt;
      hud.setTimer(BUY_SECONDS - state.phaseTime);
      if (state.phaseTime >= BUY_SECONDS) {
        state.phase = 'round';
        state.roundTime = ROUND_SECONDS;
        hud.hideBuy();
        hud.hint('');
        hud.banner(`ROUND ${state.round} — GO`, `Site ${siteTarget.name} is the target`, 2000);
      }
      return;
    }
    // Round in progress.
    state.roundTime -= dt;
    hud.setTimer(state.roundTime);
    if (state.roundTime <= 10 && Math.floor(state.roundTime) !== Math.floor(state.roundTime + dt)) audio.tick();
    stepGrenades(dt);
    stepBomb(dt, keys);
    if (state.phase !== 'round') return; // stepBomb may have ended the round
    bots.step(dt, now);
    // A defender that reached the bomb starts the defuse.
    if (bomb.state.status === 'planted') {
      const defuser = bots.bots.find((b) => b.team === 'defend' && b.alive && b.defusing);
      if (defuser) {
        bomb.startDefuse(defuser);
        defuseProgress = 0;
      }
    }
    hud.setAlive(aliveCount('attack'), aliveCount('defend'));
    hud.setHealth(player.state.health, player.state.armor);
    if (state.roundTime <= 0 && bomb.state.status !== 'planted' && bomb.state.status !== 'defusing') {
      endRound('defend', 'Time expired — no plant');
    }
  }

  // The player's shot: one hitscan ray per pellet, spread from movement and bloom,
  // damage falling off with range, headshots multiplied. Returns true when a round left.
  function shoot(spread) {
    if (!weapon.takeRound()) {
      audio.dryFire();
      return false;
    }
    const def = weapon.current;
    camera.getWorldDirection(_dir);
    _muzzle.set(player.state.position.x, player.state.position.y + player.state.eye - 0.12, player.state.position.z);
    _muzzle.addScaledVector(_dir, 0.5);
    _muzzle.x += Math.cos(player.state.yaw) * 0.18;
    _muzzle.z -= Math.sin(player.state.yaw) * 0.18;
    let hitSomething = false;
    for (let pellet = 0; pellet < def.pellets; pellet += 1) {
      _jitter.set(
        (Math.random() * 2 - 1) * spread,
        (Math.random() * 2 - 1) * spread,
        (Math.random() * 2 - 1) * spread,
      );
      _pelletDir.copy(_dir).add(_jitter).normalize();
      raycaster.set(camera.position, _pelletDir);
      raycaster.far = def.range;
      const hit = raycaster.intersectObjects(shootables, false)[0];
      if (!hit) {
        _end.copy(camera.position).addScaledVector(_pelletDir, def.range);
        effects.tracer(_muzzle, _end);
        continue;
      }
      hitSomething = true;
      _hitPoint.copy(hit.point);
      effects.tracer(_muzzle, _hitPoint);
      const bot = hit.object.userData.bot;
      if (bot) {
        const part = hit.object.userData.part;
        const dist = hit.distance;
        const falloff = Math.max(def.falloff, 1 - (dist / def.range) * (1 - def.falloff));
        const damage = Math.round(def.damage * (part === 'head' ? def.headMult : 1) * falloff);
        audio.hit();
        hud.hitMarker(bot.health - damage <= 0, 90);
        damageBot(bot, damage, part, 'player');
      } else {
        effects.impact(_hitPoint, hit.face ? _faceNormal.copy(hit.face.normal) : _faceNormal.set(0, 1, 0));
      }
    }
    weapon.pullTrigger();
    player.recoil(0.004 + def.recoil * 0.6, (Math.random() * 2 - 1) * def.recoil * 0.35);
    audio.shot(def.kind, false);
    botCtx.noise(player.state.position, 26);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
    return hitSomething;
  }

  // Line of sight between two points, for the autopilot and for tests.
  function los(from, to) {
    _dir.subVectors(to, from);
    const dist = _dir.length();
    if (dist === 0) return true;
    _dir.divideScalar(dist);
    raycaster.set(from, _dir);
    raycaster.far = dist;
    return !raycaster.intersectObjects(world.shootables, false)[0];
  }

  // Test hook: eliminate a whole team through the real damage path, so the round
  // ends exactly as it would in play (score, economy and banners included).
  function eliminateTeam(team) {
    for (const bot of bots.bots) {
      if (bot.team === team && bot.alive) damageBot(bot, 1000, 'torso', 'player');
    }
  }

  return {
    state,
    botCtx,
    startMatch,
    startRound,
    buy,
    equipWeapon,
    throwGrenade,
    shoot,
    step,
    aliveCount,
    eliminateTeam,
    los,
    get grenadesLeft() { return state.grenades; },
    cycleGrenade() {
      const kinds = ['frag', 'smoke', 'flash'];
      const index = kinds.indexOf(state.selectedGrenade);
      state.selectedGrenade = kinds[(index + 1) % kinds.length];
      hud.hint(`${GRENADES[state.selectedGrenade].name} selected — G to throw (${state.grenades[state.selectedGrenade]} left)`);
    },
  };
}
