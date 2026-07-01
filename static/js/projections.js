/** What-if projections — scoped increase/decrease sliders + effect banner. */



import { formatCurrency, debounce, $, $$ } from './utils.js';

import * as api from './api.js';



const PERIOD_LABELS = {

  monthly: 'monthly',

  quarterly: 'quarterly',

  yearly: 'yearly',

  total: 'total',

};



let state = {

  increasePercent: 0,

  decreasePercent: 0,

  increaseDollars: 0,

  decreaseDollars: 0,

  scope: { type: 'total' },

  scopeDisplayName: null,

  sliderPeriod: 'monthly',

  statsPeriod: 'monthly',

  baseline: null,

};



let accountId = null;

let onUpdate = null;

let onStatsPeriodChange = null;

let onSliderPeriodChange = null;



export function initProjections(container, options = {}) {

  onUpdate = options.onUpdate || null;

  onStatsPeriodChange = options.onStatsPeriodChange || null;

  onSliderPeriodChange = options.onSliderPeriodChange || null;

  state.scope = options.scope || { type: 'total' };

  state.sliderPeriod = options.sliderPeriod || options.period || 'monthly';

  state.statsPeriod = options.statsPeriod || options.period || 'monthly';

  state.baseline = options.baseline || null;

  bindPeriodToggles();

  renderControls(container);

  updateBannerLabels(state.statsPeriod);

  updateSliderLabels();

  updateBannerEffects(null);

}



function bindPeriodToggles() {

  bindPeriodToggle('#whatif-stats-period-toggle', (period) => {
    state.statsPeriod = period;
    updateBannerLabels(period);
    if (onStatsPeriodChange) onStatsPeriodChange(period);
    runProjection();
  });

  bindPeriodToggle('#whatif-slider-period-toggle', (period) => {
    state.sliderPeriod = period;
    updateSliderLabels();
    if (onSliderPeriodChange) onSliderPeriodChange(period);
    syncDollarsFromSlider();
    runProjection();
  });

}



function bindPeriodToggle(selector, handler) {

  const group = $(selector);

  if (!group || group.dataset.bound) return;

  group.dataset.bound = '1';

  group.addEventListener('click', (e) => {

    const btn = e.target.closest('[data-period]');

    if (!btn) return;

    $$(`${selector} .btn-toggle`).forEach((b) => b.classList.remove('active'));

    btn.classList.add('active');

    handler(btn.dataset.period);

  });

}



export function syncPeriodToggleUI(statsPeriod, sliderPeriod) {

  syncToggleGroup('#whatif-stats-period-toggle', statsPeriod);

  syncToggleGroup('#whatif-slider-period-toggle', sliderPeriod);

  state.statsPeriod = statsPeriod;

  state.sliderPeriod = sliderPeriod;

  updateBannerLabels(statsPeriod);

  updateSliderLabels();
}



function syncToggleGroup(selector, period) {

  $$(`${selector} .btn-toggle`).forEach((b) => {

    b.classList.toggle('active', b.dataset.period === period);

  });

}



function sliderPeriodLabel() {

  return PERIOD_LABELS[state.sliderPeriod] || PERIOD_LABELS.monthly;

}



function scopeLabelPrefix() {

  if (state.scope.type === 'category' && state.scopeDisplayName) {

    return `${state.scopeDisplayName} `;

  }

  return '';

}



function updateSliderLabels() {

  const period = sliderPeriodLabel();

  const prefix = scopeLabelPrefix();

  const incLabel = $('#increase-slider-label');

  const decLabel = $('#decrease-slider-label');

  if (incLabel) incLabel.textContent = `${prefix}Increase (${period})`;

  if (decLabel) decLabel.textContent = `${prefix}Decrease (${period})`;

}



function renderControls(container) {

  container.innerHTML = `

    <div class="slider-field slider-increase">

      <label for="increase-slider" id="increase-slider-label" class="slider-label">Increase (monthly)</label>

      <div class="slider-row">

        <input type="range" id="increase-slider" class="slider-increase-input" min="0" max="100" step="1" value="0">

        <div class="slider-values">

          <span class="dollar-input-wrap">

            <span class="dollar-prefix" aria-hidden="true">$</span>

            <input type="number" id="increase-dollars" class="input input-sm dollar-input" min="0" step="0.01" value="0" aria-label="Increase dollar amount">

          </span>

          <span class="slider-pct" id="increase-value">0%</span>

        </div>

      </div>

    </div>

    <div class="slider-field slider-decrease">

      <label for="decrease-slider" id="decrease-slider-label" class="slider-label">Decrease (monthly)</label>

      <div class="slider-row">

        <input type="range" id="decrease-slider" class="slider-decrease-input" min="0" max="100" step="1" value="0">

        <div class="slider-values">

          <span class="dollar-input-wrap">

            <span class="dollar-prefix" aria-hidden="true">$</span>

            <input type="number" id="decrease-dollars" class="input input-sm dollar-input" min="0" step="0.01" value="0" aria-label="Decrease dollar amount">

          </span>

          <span class="slider-pct" id="decrease-value">0%</span>

        </div>

      </div>

    </div>

    <p class="whatif-net-hint muted" id="whatif-net-hint"></p>

  `;



  const incSlider = $('#increase-slider', container);

  const decSlider = $('#decrease-slider', container);

  const incDollars = $('#increase-dollars', container);

  const decDollars = $('#decrease-dollars', container);

  const netHint = $('#whatif-net-hint', container);



  incSlider.addEventListener('input', () => {

    state.increasePercent = Number(incSlider.value);

    syncDollarsFromSlider('increase');

    updateSliderDisplays('increase');

    updateNetHint(netHint);

    scheduleProjection();

  });



  decSlider.addEventListener('input', () => {

    state.decreasePercent = Number(decSlider.value);

    syncDollarsFromSlider('decrease');

    updateSliderDisplays('decrease');

    updateNetHint(netHint);

    scheduleProjection();

  });



  incDollars.addEventListener('input', () => {

    state.increaseDollars = Number(incDollars.value) || 0;

    syncSliderFromDollars('increase');

    updateSliderDisplays('increase');

    updateNetHint(netHint);

    scheduleProjection();

  });



  decDollars.addEventListener('input', () => {

    state.decreaseDollars = Number(decDollars.value) || 0;

    syncSliderFromDollars('decrease');

    updateSliderDisplays('decrease');

    updateNetHint(netHint);

    scheduleProjection();

  });



  updateSliderLabels();

}



function getBaselineMetric() {

  if (!state.baseline) return 0;

  if (state.scope.type === 'total') {

    return state.baseline.income || state.baseline.burn || state.baseline.net || 0;

  }

  return Math.abs(state.baseline.net) || state.baseline.burn || state.baseline.income || 0;

}



function syncDollarsFromSlider(which) {

  const baseline = getBaselineMetric();

  const syncOne = (key, pct) => {

    const dollars = baseline ? (baseline * pct) / 100 : 0;

    state[`${key}Dollars`] = Math.round(dollars * 100) / 100;

  };



  if (which === 'increase' || !which) {

    syncOne('increase', state.increasePercent);

  }

  if (which === 'decrease' || !which) {

    syncOne('decrease', state.decreasePercent);

  }

}



function updateSliderDisplays(which) {

  if (which === 'increase' || !which) {

    const pctEl = $('#increase-value');

    const dollarEl = $('#increase-dollars');

    if (pctEl) pctEl.textContent = `${state.increasePercent}%`;

    if (dollarEl) dollarEl.value = state.increaseDollars.toFixed(2);

  }

  if (which === 'decrease' || !which) {

    const pctEl = $('#decrease-value');

    const dollarEl = $('#decrease-dollars');

    if (pctEl) pctEl.textContent = `${state.decreasePercent}%`;

    if (dollarEl) dollarEl.value = state.decreaseDollars.toFixed(2);

  }

}



function syncSliderFromDollars(which) {

  const baseline = getBaselineMetric();

  const clamp = (v) => Math.min(100, Math.max(0, v));



  if (which === 'increase' || !which) {

    const pct = baseline ? clamp((state.increaseDollars / baseline) * 100) : 0;

    state.increasePercent = Math.round(pct);

    const slider = $('#increase-slider');

    if (slider) slider.value = state.increasePercent;

  }

  if (which === 'decrease' || !which) {

    const pct = baseline ? clamp((state.decreaseDollars / baseline) * 100) : 0;

    state.decreasePercent = Math.round(pct);

    const slider = $('#decrease-slider');

    if (slider) slider.value = state.decreasePercent;

  }

}



function updateNetHint(el) {

  if (!el) return;

  const hasBoth = (state.increasePercent > 0 || state.increaseDollars > 0)

    && (state.decreasePercent > 0 || state.decreaseDollars > 0);

  if (!hasBoth) {

    el.textContent = '';

    return;

  }

  const net = state.increaseDollars - state.decreaseDollars;

  const sign = net >= 0 ? '+' : '';

  el.textContent = `Net adjustment: ${sign}${formatCurrency(net)}`;

}



function updateBannerLabels(period) {

  const prefix = PERIOD_LABELS[period] || PERIOD_LABELS.monthly;

  const incomeLbl = $('#whatif-label-income');

  const burnLbl = $('#whatif-label-burn');

  const netLbl = $('#whatif-label-net');

  const balLbl = $('#whatif-label-balance');

  if (incomeLbl) incomeLbl.textContent = `Effect on ${prefix} income`;

  if (burnLbl) burnLbl.textContent = `Effect on ${prefix} burn`;

  if (netLbl) netLbl.textContent = `Effect on ${prefix} net flow`;

  if (balLbl) balLbl.textContent = `Effect on ${prefix} balance`;

}



function setEffectStat(el, value, positiveClass, negativeClass) {

  if (!el) return;

  if (value == null || Number.isNaN(value)) {

    el.textContent = '—';

    el.className = 'stat-value';

    return;

  }

  const num = Number(value);

  if (num === 0) {

    el.textContent = formatCurrency(0);

    el.className = 'stat-value';

    return;

  }

  el.textContent = formatCurrency(num, { signed: true });

  if (num > 0) {

    el.className = `stat-value ${positiveClass}`;

  } else {

    el.className = `stat-value ${negativeClass}`;

  }

}



function updateBannerEffects(effects) {

  if (!effects) {

    setEffectStat($('#whatif-income'), 0, 'positive', 'negative');

    setEffectStat($('#whatif-burn'), 0, 'positive', 'negative');

    setEffectStat($('#whatif-net'), 0, 'positive', 'negative');

    setEffectStat($('#whatif-balance'), 0, 'positive', 'negative');

    return;

  }



  setEffectStat($('#whatif-income'), effects.income, 'positive', 'negative');

  setEffectStat($('#whatif-burn'), effects.burn, 'positive', 'negative');

  setEffectStat($('#whatif-net'), effects.net, 'positive', 'negative');

  setEffectStat($('#whatif-balance'), effects.balance, 'positive', 'negative');

}



const scheduleProjection = debounce(() => runProjection(), 400);



export function setProjectionContext({

  scope, scopeDisplayName, sliderPeriod, statsPeriod, period, baseline, acctId,

}) {

  if (scope) state.scope = scope;

  if (scopeDisplayName !== undefined) state.scopeDisplayName = scopeDisplayName;

  if (sliderPeriod) state.sliderPeriod = sliderPeriod;

  if (statsPeriod) state.statsPeriod = statsPeriod;

  if (period && !sliderPeriod && !statsPeriod) {

    state.sliderPeriod = period;

    state.statsPeriod = period;

  }

  if (baseline) {

    state.baseline = baseline;

    syncDollarsFromSlider();

    updateSliderDisplays();

  }

  if (acctId !== undefined) accountId = acctId;

  updateBannerLabels(state.statsPeriod);

  updateSliderLabels();

  runProjection();

}



export async function runProjection(acctId) {

  if (acctId !== undefined) accountId = acctId;



  const body = {

    account_id: accountId ? Number(accountId) : null,

    slider_period: state.sliderPeriod,

    stats_period: state.statsPeriod,

    scope: state.scope,

    increase_percent: state.increasePercent,

    decrease_percent: state.decreasePercent,

  };



  try {

    const result = await api.postProjections(body);

    if (result.baseline) {

      state.baseline = result.baseline;

      syncDollarsFromSlider();

      updateSliderDisplays();

    }
    if (result.effects) {

      updateBannerEffects(result.effects);

    } else if (result.baseline && result.projected) {

      updateBannerEffects({

        income: result.projected.income - result.baseline.income,

        burn: result.projected.burn - result.baseline.burn,

        net: result.projected.net - result.baseline.net,

        balance: result.projected.balance - result.baseline.balance,

      });

    } else {

      updateBannerEffects(null);

    }

    if (onUpdate) onUpdate(result);

  } catch {

    updateBannerEffects(null);

  }

}



export function getProjectionState() {

  return { ...state };

}



export function resetProjections(container, options = {}) {

  state.increasePercent = 0;

  state.decreasePercent = 0;

  state.increaseDollars = 0;

  state.decreaseDollars = 0;

  initProjections(container, options);

  runProjection(options.acctId);

}

