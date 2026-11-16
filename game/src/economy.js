// The economy: money between rounds, spent in the buy menu. Kill $300, round win $3250,
// round loss $1900 (loss bonus grows by $500 per consecutive loss, capped at $3400),
// plant $300, defuse $300. The player starts each match with $800; a rifle costs $2700,
// so the first round is a pistol round and the economy is a real decision.
import { WEAPONS, GRENADES } from './weapons.js';

export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_BONUS_STEP = 500;
export const LOSS_BONUS_CAP = 3400;
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;

export function createEconomy() {
  const state = {
    money: START_MONEY,
    lossStreak: 0,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
  };

  function canAfford(price) {
    return state.money >= price;
  }

  function buy(item) {
    if (item.id === 'armor') {
      if (!canAfford(item.price)) return { ok: false, reason: 'Not enough money' };
      state.money -= item.price;
      return { ok: true, armor: 50 };
    }
    const weapon = WEAPONS[item.id];
    if (weapon) {
      if (!canAfford(weapon.price)) return { ok: false, reason: 'Not enough money' };
      state.money -= weapon.price;
      return { ok: true, weapon: weapon.id };
    }
    const grenade = GRENADES[item.id];
    if (grenade) {
      if (!canAfford(grenade.price)) return { ok: false, reason: 'Not enough money' };
      state.money -= grenade.price;
      return { ok: true, grenade: grenade.id };
    }
    return { ok: false, reason: 'Unknown item' };
  }

  function roundEnd(won, reason) {
    if (won) {
      state.money += WIN_REWARD;
      state.lossStreak = 0;
    } else {
      state.lossStreak += 1;
      state.money += Math.min(LOSS_BONUS_CAP, LOSS_REWARD + (state.lossStreak - 1) * LOSS_BONUS_STEP);
    }
    if (reason === 'plant' && won) state.money += 0; // plant reward is paid at plant time
  }

  return {
    state,
    canAfford,
    buy,
    roundEnd,
    addKill() {
      state.kills += 1;
      state.money += KILL_REWARD;
    },
    addDeath() {
      state.deaths += 1;
    },
    addPlant() {
      state.plants += 1;
      state.money += PLANT_REWARD;
    },
    addDefuse() {
      state.defuses += 1;
      state.money += DEFUSE_REWARD;
    },
    reset() {
      state.money = START_MONEY;
      state.lossStreak = 0;
      state.kills = 0;
      state.deaths = 0;
      state.plants = 0;
      state.defuses = 0;
    },
  };
}
