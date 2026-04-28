// Habit RPG bootstrap.
// Owns SW registration, screen routing, and top-level event handlers.
import { ensureUserState, resetAllData } from './db.js';
import { createHabit, setCompletion, rolloverMissed, todayString } from './habits.js';
import { renderToday, renderAddHabit, renderReminderBanner, showToast } from './render.js';
import {
  isNotificationSupported,
  currentPermission,
  requestPermission,
  scheduleForHabit,
  cancelForHabit,
  dueRemindersToday,
  snoozeInApp,
  dismissBannerForToday,
} from './notifications.js';

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

// Tracks the date the Today screen was last rendered for. If the device
// crosses midnight while the PWA is suspended (mobile lock screen, app
// switcher), we re-run rollover and re-render on resume so streak math
// catches up without a full reload.
let lastRenderedDate = null;

async function refreshToday() {
  lastRenderedDate = todayString();
  await renderToday(screens.today, {
    onCompletion: async (habitId, status) => {
      try {
        const result = await setCompletion(habitId, todayString(), status);
        // Cancel any pending OS notification when the user takes a real
        // action (Done or Min). Skip cancel for 'missed' since that's just
        // a reset — the user may still want the next reminder.
        if (status === 'completed' || status === 'minimum') {
          await cancelForHabit(habitId, todayString());
        }
        // Re-render first so the streak/coin UI is current before the toast.
        await refreshToday();
        if (result.comebackApplied) {
          showToast('💪 Welcome back! +25 coins comeback bonus', { tone: 'emerald' });
        }
        if (result.milestone) {
          showToast(
            `🎉 ${result.milestone.length}-day streak! +${result.milestone.bonus} coins`,
            { tone: 'emerald' }
          );
        }
      } catch (err) {
        console.error('[app] completion failed:', err);
        showToast(err.message || 'Could not save', { tone: 'amber' });
      }
    },
  });
  await refreshReminderBanner();
}

async function refreshReminderBanner() {
  try {
    const due = await dueRemindersToday();
    renderReminderBanner(due, {
      onSnooze: (dueList) => {
        let any = false;
        for (const d of dueList) {
          const remaining = snoozeInApp(d.habitId);
          if (remaining >= 0) any = true;
          if (remaining === 0) {
            showToast(`Snooze cap reached for ${d.name}`, { tone: 'amber' });
          }
        }
        if (any) refreshReminderBanner();
      },
      onDismiss: () => {
        dismissBannerForToday();
        renderReminderBanner([], {});
      },
    });
  } catch (err) {
    console.error('[app] reminder banner failed:', err);
  }
}

async function maybeRolloverAfterResume() {
  try {
    const today = todayString();
    if (lastRenderedDate && today !== lastRenderedDate) {
      await rolloverMissed();
      await refreshToday();
    }
  } catch (err) {
    console.error('[app] resume rollover failed:', err);
  }
}

async function showAddHabit() {
  showScreen('addHabit');
  renderAddHabit(screens.addHabit, {
    onCancel: async () => {
      showScreen('today');
      await refreshToday();
    },
    onSave: async (data) => {
      const habit = await createHabit(data);
      // First habit created with a reminder time triggers the permission
      // prompt. We don't block save on the answer — the in-app banner
      // fallback works either way.
      if (data.reminderTime && isNotificationSupported() && currentPermission() === 'default') {
        try {
          const result = await requestPermission();
          if (result === 'granted') {
            await scheduleForHabit(habit);
          }
        } catch (err) {
          console.warn('[app] permission flow failed:', err);
        }
      } else if (data.reminderTime && currentPermission() === 'granted') {
        await scheduleForHabit(habit).catch((err) =>
          console.warn('[app] schedule failed:', err)
        );
      }
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

// Mobile PWAs commonly stay alive across midnight when the OS suspends and
// resumes them rather than reloading. Re-run rollover whenever the page
// becomes visible again or restores from the bfcache, so the streak and
// "today's habits" view reflect the new local date.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeRolloverAfterResume();
});
window.addEventListener('pageshow', maybeRolloverAfterResume);

(async function bootstrap() {
  try {
    await ensureUserState();
    // Mark any past scheduled days that ended without a completion as
    // `missed` before we render. This keeps streak math honest even if the
    // user has been away for several days.
    await rolloverMissed();
    showScreen('today');
    await refreshToday();
  } catch (err) {
    console.error('[app] bootstrap failed:', err);
    screens.today.textContent = 'Failed to start: ' + err.message;
  }
})();
