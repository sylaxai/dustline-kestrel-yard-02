// The DOM HUD: health and armour bars, ammo, money, the round timer, the round score,
// alive counts, the killfeed, the bomb status, the buy menu and the round banners. It
// never touches the simulation; game.js pushes numbers in and reads callbacks out.
const COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'Kestrel Yard. Five against five, first to 7 rounds. Plant the bomb on A or B — or stop the other team from doing it. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammo = $('ammo');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armorFill = $('armor-fill');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const aliveAllies = $('alive-allies');
  const aliveEnemies = $('alive-enemies');
  const killfeed = $('killfeed');
  const bombStatus = $('bomb-status');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageVignette = $('damage-vignette');
  const flashOverlay = $('flash-overlay');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyList = $('buy-list');
  const hint = $('hint');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let buyHandler = null;
  let flashTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'weapon', name);
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(health, armor) {
      setText(healthValue, 'hp', String(Math.ceil(health)));
      setText(armorValue, 'armor', String(Math.ceil(armor)));
      healthFill.style.width = `${Math.max(0, health)}%`;
      armorFill.style.width = `${Math.max(0, armor * 2)}%`;
      healthFill.classList.toggle('low', health <= 30);
    },
    setMoney(money) {
      setText(moneyValue, 'money', `$${money}`);
      setText(buyMoney, 'buyMoney', `$${money}`);
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerValue, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      timerValue.classList.toggle('urgent', seconds <= 10);
    },
    setScore(attackWins, defendWins) {
      setText(scoreValue, 'score', `${attackWins} — ${defendWins}`);
    },
    setAlive(allies, enemies) {
      setText(aliveAllies, 'allies', String(allies));
      setText(aliveEnemies, 'enemies', String(enemies));
    },
    setBomb(text, kind) {
      setText(bombStatus, 'bomb', text);
      bombStatus.className = kind ? `bomb-${kind}` : '';
      bombStatus.hidden = !text;
    },
    setCrosshairSpread(spreadPx) {
      const gap = 4 + Math.min(18, spreadPx * 500);
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      setTimeout(() => damageVignette.classList.remove('on'), 180);
    },
    flash(strength) {
      flashOverlay.style.opacity = String(Math.min(1, strength));
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashOverlay.style.opacity = '0'; }, 700);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const entry = document.createElement('div');
      entry.className = `feed-entry ${killerTeam}`;
      entry.textContent = `${killer} ${headshot ? '◉' : '✕'} ${victim}`;
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => entry.remove(), 6000);
    },
    banner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    hideBanner() {
      banner.hidden = true;
    },
    hint(text) {
      setText(hint, 'hint', text);
      hint.hidden = !text;
    },
    showOverlay(mode, detail = '') {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail || text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy(items, money, onBuy) {
      buyHandler = onBuy;
      buyMenu.hidden = false;
      setText(buyMoney, 'buyMoney', `$${money}`);
      buyList.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.dataset.id = item.id;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-label">${item.label}</span><span class="buy-price">$${item.price}</span>`;
        row.addEventListener('click', () => onBuy(item.id));
        buyList.appendChild(row);
      }
    },
    hideBuy() {
      buyMenu.hidden = true;
      buyHandler = null;
    },
    get buyOpen() {
      return !buyMenu.hidden;
    },
    buyKey(id) {
      if (buyHandler) buyHandler(id);
    },
  };
}
