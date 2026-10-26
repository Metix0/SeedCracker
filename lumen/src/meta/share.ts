import type { RunStats } from '../game/entities';
import { THEMES } from '../game/themes';
import { t } from './i18n';

const css = (c: number[], k = 1): string =>
  `rgb(${Math.min(255, Math.round(c[0] * 255 * k))},${Math.min(255, Math.round(c[1] * 255 * k))},${Math.min(255, Math.round(c[2] * 255 * k))})`;

/** Renders a share card (1080×1350) with Canvas 2D. */
export async function renderShareCard(run: RunStats, best: number, themeIdx: number): Promise<Blob | null> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  const th = THEMES[themeIdx % THEMES.length];
  // background nebula
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, css(th.bg0));
  bg.addColorStop(0.55, css(th.bg1, 0.9));
  bg.addColorStop(1, css(th.bg2));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 160 + Math.random() * 260;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, css(th.bg3, 0.35).replace('rgb', 'rgba').replace(')', ',0.45)'));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 180; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
    const s = Math.random() * 2.6 + 0.6;
    g.beginPath();
    g.arc(Math.random() * W, Math.random() * H, s, 0, Math.PI * 2);
    g.fill();
  }
  // core + orbit
  const cx = W / 2, cy = 470;
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, 190, 0, Math.PI * 2); g.stroke();
  g.shadowColor = css(th.bg3);
  g.shadowBlur = 60;
  g.fillStyle = '#05010a';
  g.beginPath();
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = i % 2 === 0 ? 92 : 72;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = css(th.bg3);
  g.lineWidth = 4;
  g.stroke();
  g.shadowColor = '#fff';
  g.shadowBlur = 50;
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(cx + 134, cy - 134, 24, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;

  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.font = '700 64px Fredoka, system-ui, sans-serif';
  g.fillText('×' + run.peakMult, cx, cy + 22);
  g.font = '700 132px Fredoka, system-ui, sans-serif';
  g.shadowColor = css(th.bg3);
  g.shadowBlur = 40;
  g.fillText('LUMEN', cx, 200);
  g.shadowBlur = 30;
  g.font = '700 168px Fredoka, system-ui, sans-serif';
  g.fillText(run.score.toLocaleString('pl-PL'), cx, 860);
  g.shadowBlur = 0;
  g.font = '600 44px Fredoka, system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText(`${t('best')}: ${best.toLocaleString('pl-PL')}${run.daily ? '  ·  ' + t('daily') : ''}`, cx, 940);
  const rows: [string, string][] = [
    [t('phase'), String(run.phase)],
    [t('chain'), String(run.maxChain)],
    [t('orbs'), String(run.orbs)],
    [t('smashes'), String(run.smashes)],
  ];
  g.font = '600 40px Fredoka, system-ui, sans-serif';
  rows.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? 300 : 780, y = 1060 + Math.floor(i / 2) * 110;
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText(k, x, y);
    g.fillStyle = '#fff';
    g.font = '700 56px Fredoka, system-ui, sans-serif';
    g.fillText(v, x, y + 58);
    g.font = '600 40px Fredoka, system-ui, sans-serif';
  });
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.font = '600 30px Fredoka, system-ui, sans-serif';
  g.fillText(new Date().toLocaleDateString(), cx, H - 40);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

export async function shareRun(run: RunStats, best: number, themeIdx: number): Promise<'shared' | 'downloaded' | 'failed'> {
  const blob = await renderShareCard(run, best, themeIdx);
  if (!blob) return 'failed';
  const file = new File([blob], 'lumen-score.png', { type: 'image/png' });
  const text = t('shareText').replace('{score}', run.score.toLocaleString()).replace('{mult}', String(run.peakMult)).replace('{phase}', String(run.phase));
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: t('shareTitle'), text });
      return 'shared';
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'shared';
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lumen-score.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
