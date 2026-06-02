// ---------------------------------------------------------------------------
// In-display hamburger menu — a compact quick-control overlay on the art
// window itself (handy when presenting from a single screen). The full DJ booth
// lives in the separate control panel; this mirrors the most-used controls and
// links out to it.
// ---------------------------------------------------------------------------

import { CommandTypes, makeCommand } from '../core/events.js';
import { listArts } from '../art/registry.js';

const VIEWS = [['head-on', 'Head-on'], ['store', 'Store'], ['angled', 'Angled']];
const TARGETS = [['flat', 'Flat'], ['prism', 'Prism']];

export function initHamburger({ state, dispatch }) {
  const root = document.createElement('div');
  root.className = 'pda-ham';
  root.innerHTML = `
    <button class="pda-ham__toggle" aria-label="Quick controls">☰</button>
    <div class="pda-ham__panel" hidden>
      <div class="pda-ham__group"><span>Art</span><div class="pda-ham__row" data-row="art"></div></div>
      <div class="pda-ham__group"><span>View</span><div class="pda-ham__row" data-row="view"></div></div>
      <div class="pda-ham__group"><span>Display</span><div class="pda-ham__row" data-row="target"></div></div>
      <div class="pda-ham__group"><span>Data</span><div class="pda-ham__row"><button data-sim></button></div></div>
      <a class="pda-ham__link" href="./control.html" target="_blank" rel="noopener">Open full control panel ↗</a>
    </div>`;
  document.body.appendChild(root);

  const panel = root.querySelector('.pda-ham__panel');
  root.querySelector('.pda-ham__toggle').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });

  const rows = {
    art: root.querySelector('[data-row="art"]'),
    view: root.querySelector('[data-row="view"]'),
    target: root.querySelector('[data-row="target"]'),
  };
  const simBtn = root.querySelector('[data-sim]');
  simBtn.addEventListener('click', () =>
    dispatch(makeCommand(CommandTypes.SET_SIM, { running: !state.sim.running })),
  );

  const button = (label, active, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (active) b.classList.add('active');
    b.addEventListener('click', onClick);
    return b;
  };

  function render() {
    rows.art.replaceChildren(
      ...listArts().map((a) =>
        button(a.label, state.artId === a.id, () =>
          dispatch(makeCommand(CommandTypes.SET_ART, { artId: a.id })),
        ),
      ),
    );
    rows.view.replaceChildren(
      ...VIEWS.map(([id, label]) =>
        button(label, state.viewId === id, () =>
          dispatch(makeCommand(CommandTypes.SET_VIEW, { viewId: id })),
        ),
      ),
    );
    rows.target.replaceChildren(
      ...TARGETS.map(([id, label]) =>
        button(label, state.targetId === id, () =>
          dispatch(makeCommand(CommandTypes.SET_TARGET, { targetId: id })),
        ),
      ),
    );
    simBtn.textContent = state.sim.running ? 'Pause data' : 'Resume data';
    simBtn.classList.toggle('active', state.sim.running);
  }

  render();
  return { render };
}
