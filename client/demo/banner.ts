/**
 * The demo banner: says loud and clear that nothing here is real, shows the demo
 * clock, and holds the two demo controls — time forward and start over.
 * Plain DOM on purpose: it sits outside the React tree, so the app itself does
 * not need to know the demo exists.
 */

interface BannerActions {
  onAdvance: (hours: number) => void;
  onReset: () => void;
}

const CSS = `
.demo-banner { position: relative; z-index: 2147483000; display: flex; flex-wrap: wrap; align-items: center;
  gap: 6px 10px; padding: 7px 16px; background: #fde68a; color: #422006; border-bottom: 2px solid #d97706;
  font: 600 13.5px/1.3 'Inter Variable', system-ui, sans-serif; }
.demo-banner .demo-title { flex: 1 1 220px; min-width: 0; }
.demo-banner .demo-clock { font-weight: 500; font-variant-numeric: tabular-nums; opacity: .85; }
.demo-banner .demo-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.demo-banner button { font: inherit; font-size: 12.5px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
  border: 1px solid #b45309; background: #fffbeb; color: #422006; }
.demo-banner button:hover { background: #fff; }
.demo-banner button.demo-reset { background: #422006; color: #fffbeb; border-color: #422006; }
`;

function clockLabel(): string {
  return new Date().toLocaleString('nl-BE', {
    timeZone: 'Europe/Brussels',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function mountBanner(actions: BannerActions): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'demo-banner';
  bar.setAttribute('role', 'note');
  bar.innerHTML = `
    <span class="demo-title">🧪 Demomodus — niets hiervan is echt
      <span class="demo-clock" title="Demotijd (Brussel)"></span></span>
    <span class="demo-actions">
      <button type="button" data-h="1">+1 uur</button>
      <button type="button" data-h="6">+6 uur</button>
      <button type="button" data-h="24">+1 dag</button>
      <button type="button" class="demo-reset">Demo opnieuw</button>
    </span>`;
  const clock = bar.querySelector('.demo-clock') as HTMLElement;
  const tick = () => (clock.textContent = `· ${clockLabel()}`);
  tick();
  setInterval(tick, 30_000);

  bar.querySelectorAll<HTMLButtonElement>('button[data-h]').forEach((b) =>
    b.addEventListener('click', () => {
      b.disabled = true;
      actions.onAdvance(Number(b.dataset.h));
    }),
  );
  bar.querySelector('.demo-reset')!.addEventListener('click', () => {
    if (confirm('De demo helemaal opnieuw beginnen? Je demohok gaat verloren.')) actions.onReset();
  });
  document.body.prepend(bar);
}
