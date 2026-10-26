import type { RunStats } from '../game/entities';
import { CATEGORIES, ITEMS, type Category } from '../meta/cosmetics';
import { BOOSTER_KEYS, lang, setLang, t, type StrKey } from '../meta/i18n';
import { ACHIEVEMENTS, missionText } from '../meta/progress';
import type { Store } from '../meta/save';
import { CAN_VIBRATE } from '../platform/platform';

export interface UIHandlers {
  play(daily: boolean): void;
  resume(): void;
  restart(): void;
  menu(): void;
  share(): void;
  install(): void;
  settingsChanged(): void;
  equipChanged(): void;
  uiSound(): void;
  dailyBest(): number;
}

const ICONS = {
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1.6"/><rect x="14" y="4.5" width="4" height="15" rx="1.6"/></svg>',
  daily: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.6 6.1 6.6.5-5 4.3 1.6 6.4L12 16.4l-5.8 3.4 1.6-6.4-5-4.3 6.6-.5z"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M12 2l3.2 5.2L21 8.5l-4 4.6.6 6.1L12 16.8 6.4 19.2 7 13.1 3 8.5l5.8-1.3z" opacity=".0"/><path d="M6 7h12l-1.2 12.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  missions: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="1.8"/></svg>',
  stats: '<svg viewBox="0 0 24 24"><rect x="4" y="12" width="4" height="8" rx="1.2"/><rect x="10" y="7" width="4" height="13" rx="1.2"/><rect x="16" y="3.5" width="4" height="16.5" rx="1.2"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm8.6 4.6l1.9 1.5-2 3.4-2.3-.8a7.6 7.6 0 0 1-2 1.2l-.4 2.4h-3.9l-.4-2.4a7.6 7.6 0 0 1-2-1.2l-2.3.8-2-3.4 1.9-1.5a7.7 7.7 0 0 1 0-2.4L1.5 9.3l2-3.4 2.3.8a7.6 7.6 0 0 1 2-1.2L8.2 3h3.9l.4 2.5a7.6 7.6 0 0 1 2 1.2l2.3-.8 2 3.4-1.9 1.5a7.7 7.7 0 0 1 0 2.4z"/></svg>',
  install: '<svg viewBox="0 0 24 24"><path d="M12 3v11m0 0l-4.5-4.5M12 14l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M12 3L7.5 7.5M12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11H5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5 21h14a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 19 11h-1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  crumb: '<svg viewBox="0 0 24 24" class="crumb"><path d="M12 2.5l6 9.5-6 9.5-6-9.5z"/></svg>',
  iosShare: '<svg viewBox="0 0 24 24" class="inline-ico"><path d="M12 3v11M12 3L8 7M12 3l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
};

const h = (html: string): HTMLElement => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
};

const fmt = (n: number): string => Math.floor(n).toLocaleString(lang() === 'pl' ? 'pl-PL' : 'en-US');
const fmtTime = (s: number): string => {
  s = Math.floor(s);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh > 0 ? `${hh} h ${mm} min` : mm > 0 ? `${mm}:${ss < 10 ? '0' : ''}${ss}` : `${ss} s`;
};

export class UI {
  private menu!: HTMLElement;
  private pause!: HTMLElement;
  private over!: HTMLElement;
  private panel!: HTMLElement;
  private toasts!: HTMLElement;
  pauseBtn!: HTMLButtonElement;
  fpsEl!: HTMLElement;
  private installBtn!: HTMLElement;
  private shopCat: Category = 'spark';
  private openPanelName: string | null = null;
  private countUpRaf = 0;
  overShownAt = 0;

  constructor(private root: HTMLElement, private store: Store, private hd: UIHandlers) {
    this.build();
  }

  private build(): void {
    this.root.innerHTML = '';
    this.pauseBtn = h(`<button class="icon-btn pause-btn hidden" aria-label="pause">${ICONS.pause}</button>`) as HTMLButtonElement;
    this.pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onPauseBtn(); });
    this.pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(this.pauseBtn);
    this.fpsEl = h('<div class="fps hidden"></div>');
    this.root.appendChild(this.fpsEl);

    this.menu = h('<section class="screen menu"></section>');
    this.pause = h('<section class="screen pause hidden"></section>');
    this.over = h('<section class="screen over hidden"></section>');
    this.panel = h('<section class="screen panel-wrap hidden"></section>');
    this.toasts = h('<div class="toasts" aria-live="polite"></div>');
    this.root.append(this.menu, this.pause, this.over, this.panel, this.toasts);
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.renderMenu();
  }

  pauseHandler: (() => void) | null = null;
  private onPauseBtn(): void {
    this.hd.uiSound();
    this.pauseHandler?.();
  }

  rebuild(): void {
    setLang(this.store.data.settings.lang);
    this.renderMenu();
    if (this.openPanelName) this.openPanel(this.openPanelName);
  }

  // ---------------------------------------------------------------- menu

  renderMenu(): void {
    const d = this.store.data;
    const dailyBest = this.hd.dailyBest();
    this.menu.innerHTML = `
      <div class="menu-top">
        <h1 class="logo" aria-label="LUMEN"><span>L</span><span>U</span><span>M</span><span>E</span><span>N</span></h1>
        <p class="tagline">${t('tagline')}</p>
      </div>
      <div class="menu-bottom">
        <div class="tap-hint"><span class="tap-dot"></span>${t('tapToPlay')}</div>
        <div class="best-row">
          <span>${t('best')} <b>${fmt(d.best)}</b></span>
          <span class="crumbs">${ICONS.crumb}<b>${fmt(d.crumbs)}</b></span>
        </div>
        <div class="menu-buttons">
          <button class="pill daily" data-act="daily">${ICONS.daily}<span>${t('daily')}${dailyBest > 0 ? ` · ${fmt(dailyBest)}` : ''}</span></button>
          <div class="pill-row">
            <button class="round" data-act="missions" aria-label="${t('missions')}">${ICONS.missions}<span>${t('missions')}</span></button>
            <button class="round" data-act="shop" aria-label="${t('shop')}">${ICONS.shop}<span>${t('shop')}</span></button>
            <button class="round" data-act="stats" aria-label="${t('stats')}">${ICONS.stats}<span>${t('stats')}</span></button>
            <button class="round" data-act="settings" aria-label="${t('settings')}">${ICONS.settings}<span>${t('settings')}</span></button>
          </div>
          <button class="pill install hidden" data-act="install">${ICONS.install}<span>${t('install')}</span></button>
        </div>
      </div>`;
    this.installBtn = this.menu.querySelector('.install')!;
    this.menu.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hd.uiSound();
        const act = b.dataset.act!;
        if (act === 'daily') this.hd.play(true);
        else if (act === 'install') this.hd.install();
        else this.openPanel(act);
      }),
    );
    this.setInstallVisible(this.installVisible);
  }

  private installVisible = false;
  setInstallVisible(v: boolean): void {
    this.installVisible = v;
    this.installBtn?.classList.toggle('hidden', !v);
  }

  showMenu(): void {
    this.renderMenu();
    this.show(this.menu);
    this.hide(this.pause);
    this.hide(this.over);
    this.closePanel();
    this.pauseBtn.classList.add('hidden');
  }

  showGame(): void {
    this.hide(this.menu);
    this.hide(this.pause);
    this.hide(this.over);
    this.closePanel();
    this.pauseBtn.classList.remove('hidden');
  }

  get menuVisible(): boolean {
    return !this.menu.classList.contains('hidden') && !this.openPanelName;
  }

  // ---------------------------------------------------------------- pause

  showPause(): void {
    this.pause.innerHTML = `
      <div class="card pause-card">
        <h2>${t('paused')}</h2>
        <button class="btn primary" data-act="resume">${t('resume')}</button>
        <button class="btn" data-act="restart">${t('restart')}</button>
        <button class="btn ghost" data-act="settings">${t('settings')}</button>
        <button class="btn ghost" data-act="menu">${t('menu')}</button>
      </div>`;
    this.pause.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hd.uiSound();
        const a = b.dataset.act;
        if (a === 'resume') this.hd.resume();
        else if (a === 'restart') this.hd.restart();
        else if (a === 'menu') this.hd.menu();
        else this.openPanel('settings');
      }),
    );
    this.show(this.pause);
    this.pauseBtn.classList.add('hidden');
  }

  hidePause(): void {
    this.hide(this.pause);
    this.pauseBtn.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- game over

  showOver(run: RunStats, best: number, newBest: boolean, dailyBest: number, achievements: string[] = []): void {
    const rows: [StrKey, string][] = [
      ['orbs', fmt(run.orbs)],
      ['smashes', fmt(run.smashes)],
      ['chain', String(run.maxChain)],
      ['maxMult', '×' + run.peakMult],
      ['nearMisses', String(run.nearMisses)],
      ['phase', String(run.phase)],
      ['time', fmtTime(run.time)],
    ];
    this.over.innerHTML = `
      <div class="card over-card">
        <div class="over-label">${run.daily ? t('daily') : t('gameOver')}</div>
        <div class="over-score" data-v="${run.score}">0</div>
        <div class="over-best ${newBest ? 'new' : ''}">${newBest ? t('newBest') : `${run.daily ? t('dailyBest') : t('best')} ${fmt(run.daily ? dailyBest : best)}`}</div>
        <div class="over-crumbs">${ICONS.crumb}<b>+${fmt(run.crumbs)}</b> <span>${t('crumbs')}</span></div>
        ${achievements.length ? `<div class="over-ach">★ ${t('achUnlocked')}: <b>${achievements.join(', ')}</b></div>` : ''}
        <dl class="over-stats">${rows.map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <button class="btn primary big" data-act="again">${t('again')}</button>
        <div class="over-row">
          <button class="btn ghost" data-act="menu">${t('menu')}</button>
          <button class="btn ghost" data-act="share">${ICONS.share}<span>${t('share')}</span></button>
        </div>
      </div>`;
    this.over.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = b.dataset.act;
        this.hd.uiSound();
        if (a === 'again') this.hd.restart();
        else if (a === 'menu') this.hd.menu();
        else this.hd.share();
      }),
    );
    this.show(this.over);
    this.pauseBtn.classList.add('hidden');
    this.overShownAt = performance.now();
    // animated count-up
    const el = this.over.querySelector<HTMLElement>('.over-score')!;
    const target = run.score;
    const t0 = performance.now();
    const dur = Math.min(1400, 500 + Math.log10(target + 10) * 220);
    cancelAnimationFrame(this.countUpRaf);
    const tick = (now: number): void => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(target * e);
      if (k < 1) this.countUpRaf = requestAnimationFrame(tick);
      else el.classList.add('done');
    };
    this.countUpRaf = requestAnimationFrame(tick);
  }

  hideOver(): void {
    this.hide(this.over);
  }

  // ---------------------------------------------------------------- panels

  openPanel(name: string): void {
    this.openPanelName = name;
    let body = '';
    let title = '';
    if (name === 'shop') { title = t('shop'); body = this.shopHtml(); }
    else if (name === 'missions') { title = t('missions'); body = this.missionsHtml(); }
    else if (name === 'stats') { title = t('stats'); body = this.statsHtml(); }
    else { title = t('settings'); body = this.settingsHtml(); }
    this.panel.innerHTML = `
      <div class="card panel">
        <header>
          <h2>${title}</h2>
          ${name === 'shop' ? `<span class="crumbs">${ICONS.crumb}<b>${fmt(this.store.data.crumbs)}</b></span>` : ''}
          <button class="icon-btn close" aria-label="${t('close')}">${ICONS.close}</button>
        </header>
        <div class="panel-body">${body}</div>
      </div>`;
    this.panel.querySelector('.close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hd.uiSound();
      this.closePanel();
    });
    if (name === 'shop') this.bindShop();
    if (name === 'settings') this.bindSettings();
    if (name === 'missions') {
      this.panel.querySelector('[data-daily]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hd.uiSound();
        this.closePanel();
        this.hd.play(true);
      });
    }
    this.show(this.panel);
  }

  closePanel(): void {
    this.openPanelName = null;
    this.hide(this.panel);
    if (!this.menu.classList.contains('hidden')) this.renderMenu();
  }

  private shopHtml(): string {
    const d = this.store.data;
    const tabs = CATEGORIES.map((c) => `<button class="tab ${c === this.shopCat ? 'on' : ''}" data-cat="${c}">${t(('cat_' + c) as StrKey)}</button>`).join('');
    const items = ITEMS.filter((i) => i.cat === this.shopCat)
      .map((i) => {
        const owned = d.owned.includes(i.id);
        const eq = d.equip[i.cat] === i.id;
        const state = eq ? `<span class="tag on">${t('equipped')}</span>` : owned ? `<button class="btn small" data-equip="${i.id}">${t('equip')}</button>`
          : `<button class="btn small buy ${d.crumbs < i.price ? 'dim' : ''}" data-buy="${i.id}">${ICONS.crumb}${fmt(i.price)}</button>`;
        return `<div class="item ${eq ? 'eq' : ''}"><div class="swatch s-${i.cat}" style="background:${i.swatch}"></div><div class="item-name">${i.name[lang()]}</div>${state}</div>`;
      })
      .join('');
    return `<div class="tabs">${tabs}</div><div class="grid">${items}</div>`;
  }

  private bindShop(): void {
    const d = this.store.data;
    this.panel.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        this.hd.uiSound();
        this.shopCat = b.dataset.cat as Category;
        this.openPanel('shop');
      }),
    );
    this.panel.querySelectorAll<HTMLElement>('[data-equip]').forEach((b) =>
      b.addEventListener('click', () => {
        const it = ITEMS.find((i) => i.id === b.dataset.equip)!;
        d.equip[it.cat] = it.id;
        this.store.save();
        this.hd.uiSound();
        this.hd.equipChanged();
        this.openPanel('shop');
      }),
    );
    this.panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const it = ITEMS.find((i) => i.id === b.dataset.buy)!;
        if (d.crumbs < it.price) {
          this.toast(t('notEnough'));
          return;
        }
        d.crumbs -= it.price;
        d.owned.push(it.id);
        d.equip[it.cat] = it.id;
        this.store.save();
        this.hd.uiSound();
        this.hd.equipChanged();
        this.openPanel('shop');
      }),
    );
  }

  private missionsHtml(): string {
    const d = this.store.data;
    const ms = d.missions
      .map((m) => {
        const p = Math.min(1, m.progress / m.target);
        return `<div class="mission ${m.done ? 'done' : ''}"><div class="m-text">${missionText(m, lang())}</div>
          <div class="m-bar"><i style="width:${(p * 100).toFixed(0)}%"></i></div>
          <div class="m-reward">${ICONS.crumb}${m.reward}</div></div>`;
      })
      .join('');
    const db = this.hd.dailyBest();
    return `${ms}
      <div class="daily-card">
        <div><b>${t('daily')}</b><br><span class="muted">${t('dailyBest')}: ${db > 0 ? fmt(db) : t('none')}</span>
        ${this.store.data.dailyGhost ? `<br><span class="muted">${t('ghost')} ✓</span>` : ''}</div>
        <button class="btn primary small" data-daily>${t('play')}</button>
      </div>`;
  }

  private statsHtml(): string {
    const s = this.store.data.stats;
    let fav = -1, favN = 0;
    s.boosters.forEach((n, i) => { if (n > favN) { favN = n; fav = i; } });
    const rows: [StrKey, string][] = [
      ['bestScore', fmt(this.store.data.best)],
      ['totalTime', fmtTime(s.time)],
      ['gamesPlayed', fmt(s.games)],
      ['maxMult', '×' + s.bestMult],
      ['chain', String(s.bestChain)],
      ['bestPhase', String(s.bestPhase)],
      ['favBooster', fav >= 0 ? t(BOOSTER_KEYS[fav]) : t('none')],
      ['totalOrbs', fmt(s.orbs)],
      ['totalSmashes', fmt(s.smashes)],
      ['nearMisses', fmt(s.nearMisses)],
      ['dailyPlays', fmt(s.dailyPlays)],
    ];
    const ach = ACHIEVEMENTS.map((a) => {
      const on = this.store.data.achievements.includes(a.id);
      const [n, desc] = lang() === 'pl' ? a.pl : a.en;
      return `<div class="ach ${on ? 'on' : ''}"><div class="ach-ico">${on ? '★' : '☆'}</div><div><b>${n}</b><br><span>${desc}</span></div></div>`;
    }).join('');
    return `<dl class="stat-list">${rows.map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <h3>${t('achievements')} <span class="muted">${this.store.data.achievements.length}/${ACHIEVEMENTS.length}</span></h3>
      <div class="ach-grid">${ach}</div>`;
  }

  private settingsHtml(): string {
    const s = this.store.data.settings;
    const tog = (id: string, label: StrKey, on: boolean, hint?: StrKey): string =>
      `<label class="row toggle"><span>${t(label)}${hint ? `<small>${t(hint)}</small>` : ''}</span><input type="checkbox" data-set="${id}" ${on ? 'checked' : ''}><i></i></label>`;
    return `
      <label class="row"><span>${t('music')}</span><input type="range" min="0" max="100" value="${Math.round(s.music * 100)}" data-set="music"></label>
      <label class="row"><span>${t('sfx')}</span><input type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}" data-set="sfx"></label>
      ${CAN_VIBRATE ? tog('vibration', 'vibration', s.vibration) : ''}
      ${tog('battery', 'battery', s.battery, 'batteryHint')}
      ${tog('reduced', 'reduced', s.reduced, 'reducedHint')}
      ${tog('highContrast', 'contrast', s.highContrast)}
      ${tog('showFps', 'fps', s.showFps)}
      <div class="row"><span>${t('language')}</span><div class="seg"><button data-lang="pl" class="${s.lang === 'pl' ? 'on' : ''}">PL</button><button data-lang="en" class="${s.lang === 'en' ? 'on' : ''}">EN</button></div></div>
      <h3>${t('transfer')}</h3>
      <div class="transfer">
        <div class="btn-row"><button class="btn small" data-x="copy">${t('exportCode')}</button><button class="btn small" data-x="file">${t('exportFile')}</button></div>
        <textarea rows="3" placeholder="${t('importPlaceholder')}" spellcheck="false"></textarea>
        <div class="btn-row"><button class="btn small" data-x="load">${t('importCode')}</button><label class="btn small file">${t('importFile')}<input type="file" accept=".json,.txt,application/json,text/plain" hidden></label></div>
      </div>
      <p class="version muted">LUMEN v${__APP_VERSION__}</p>`;
  }

  private bindSettings(): void {
    const s = this.store.data.settings;
    this.panel.querySelectorAll<HTMLInputElement>('input[data-set]').forEach((inp) => {
      const key = inp.dataset.set as keyof typeof s;
      inp.addEventListener('input', () => {
        if (inp.type === 'range') (s as unknown as Record<string, number>)[key] = Number(inp.value) / 100;
        else (s as unknown as Record<string, boolean>)[key] = inp.checked;
        this.store.save();
        this.hd.settingsChanged();
      });
    });
    this.panel.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        s.lang = b.dataset.lang as 'pl' | 'en';
        this.store.save();
        this.hd.uiSound();
        this.hd.settingsChanged();
        this.rebuild();
      }),
    );
    const ta = this.panel.querySelector('textarea')!;
    this.panel.querySelector('[data-x="copy"]')!.addEventListener('click', async () => {
      const code = this.store.exportCode();
      ta.value = code;
      try {
        await navigator.clipboard.writeText(code);
        this.toast(t('copied'));
      } catch {
        ta.select();
      }
    });
    this.panel.querySelector('[data-x="file"]')!.addEventListener('click', () => {
      const blob = new Blob([this.store.exportCode()], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lumen-save.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    });
    const load = (code: string): void => {
      if (this.store.importCode(code)) {
        this.toast(t('importOk'));
        this.hd.settingsChanged();
        this.hd.equipChanged();
        this.rebuild();
      } else this.toast(t('importFail'));
    };
    this.panel.querySelector('[data-x="load"]')!.addEventListener('click', () => load(ta.value));
    const file = this.panel.querySelector<HTMLInputElement>('input[type=file]')!;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) load(await f.text());
    });
  }

  // ---------------------------------------------------------------- toasts & hints

  private toastQueue: HTMLElement[] = [];
  private toastVisible = 0;

  /** Toasts are queued: at most two transient ones on screen at once (sticky ones always show). */
  toast(text: string, opts: { sticky?: boolean; onClick?: () => void; icon?: string } = {}): HTMLElement {
    const el = h(`<div class="toast ${opts.onClick ? 'action' : ''}">${opts.icon ?? ''}<span>${text}</span></div>`);
    if (opts.onClick) el.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick!(); });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (opts.sticky) {
      this.toasts.prepend(el);
      requestAnimationFrame(() => el.classList.add('in'));
    } else {
      this.toastQueue.push(el);
      this.pumpToasts();
    }
    return el;
  }

  private pumpToasts(): void {
    while (this.toastVisible < 2 && this.toastQueue.length) {
      const el = this.toastQueue.shift()!;
      this.toastVisible++;
      this.toasts.appendChild(el);
      requestAnimationFrame(() => el.classList.add('in'));
      setTimeout(() => {
        el.classList.remove('in');
        setTimeout(() => {
          el.remove();
          this.toastVisible--;
          this.pumpToasts();
        }, 350);
      }, 2400);
    }
  }

  showIosHint(onClose: () => void): void {
    const el = h(`<div class="ios-hint"><div class="card"><h3>${t('iosHintTitle')}</h3><p>${t('iosHint').replace('{share}', ICONS.iosShare)}</p><button class="btn primary small">${t('ok')}</button></div><div class="ios-arrow"></div></div>`);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.querySelector('button')!.addEventListener('click', (e) => {
      e.stopPropagation();
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
      onClose();
    });
    this.root.appendChild(el);
  }

  setFps(v: number | null): void {
    if (v === null) { this.fpsEl.classList.add('hidden'); return; }
    this.fpsEl.classList.remove('hidden');
    this.fpsEl.textContent = Math.round(v) + ' FPS';
  }

  private show(el: HTMLElement): void {
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('in'));
  }
  private hide(el: HTMLElement): void {
    el.classList.remove('in');
    el.classList.add('hidden');
  }
}

declare global {
  const __APP_VERSION__: string;
}
