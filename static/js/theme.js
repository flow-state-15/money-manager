/** Theme persistence and toggle (light default). */

export const THEME_KEY = 'theme';

const VALID_THEMES = new Set(['light', 'dark']);

export function getStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  return VALID_THEMES.has(stored) ? stored : 'light';
}

export function applyTheme(theme) {
  const resolved = VALID_THEMES.has(theme) ? theme : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem(THEME_KEY, resolved);
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: resolved } }));
  return resolved;
}

export function toggleTheme() {
  const next = getStoredTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  updateToggleUi(next);
  return next;
}

function updateToggleUi(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const isDark = theme === 'dark';
  btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.setAttribute('title', isDark ? 'Light mode' : 'Dark mode');
  btn.dataset.theme = theme;

  const sun = btn.querySelector('.theme-icon-sun');
  const moon = btn.querySelector('.theme-icon-moon');
  sun?.classList.toggle('hidden', isDark);
  moon?.classList.toggle('hidden', !isDark);
}

export function initTheme() {
  const theme = applyTheme(getStoredTheme());
  updateToggleUi(theme);

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
  });
}
