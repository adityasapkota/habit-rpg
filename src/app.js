// Habit RPG bootstrap.
// Owns SW registration, screen routing, and top-level event handlers.
// Phase 2: Today + Add Habit. Phase 3+ extends without changing this shell.
import { ensureUserState, resetAllData } from './db.js';
import { createHabit, setCompletion, todayString } from './habits.js';
import { renderToday, renderAddHabit } from './render.js';

const screens = {
  today: document.getElementById('screen-today'),
  addHabit: document.getElementById('screen-add-habit'),
  confirm: document.getElementById('screen-confirm'),
};
const fab = document.getElementById('fab');
const settingsBtn = document.getElementById('settings-btn');

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('hidden', key !== name);
  }
  fab.classList.toggle('hidden', name !== 'today');
}

async function refreshToday() {
  await renderToday(screens.today, {
    onCompletion: async (habitId, status) => {
      await setCompletion(habitId, todayString(), status);
      await refreshToday();
    },
  });
}

async function showAddHabit() {
  showScreen('addHabit');
  renderAddHabit(screens.addHabit, {
    onCancel: async () => {
      showScreen('today');
      await refreshToday();
    },
    onSave: async (data) => {
      await createHabit(data);
      showScreen('today');
      await refreshToday();
    },
  });
}

fab.addEventListener('click', () => {
  showAddHabit().catch((err) => {
    console.error('[app] showAddHabit failed:', err);
    alert('Could not open Add Habit: ' + err.message);
  });
});

settingsBtn.addEventListener('click', async () => {
  if (!confirm('Reset all data? This cannot be undone.')) return;
  try {
    await resetAllData();
    location.reload();
  } catch (err) {
    console.error('[app] reset failed:', err);
    alert('Reset failed: ' + err.message);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => console.info('[habit-rpg] sw scope:', reg.scope))
      .catch((err) => console.error('[habit-rpg] sw error:', err));
  });
}

(async function bootstrap() {
  try {
    await ensureUserState();
    showScreen('today');
    await refreshToday();
  } catch (err) {
    console.error('[app] bootstrap failed:', err);
    screens.today.textContent = 'Failed to start: ' + err.message;
  }
})();
