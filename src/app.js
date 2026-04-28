// Habit RPG bootstrap.
// Owns SW registration, screen routing, and top-level event handlers.
import { ensureUserState, resetAllData } from './db.js';
import { createHabit, setCompletion, rolloverMissed, todayString } from './habits.js';
import {
  renderToday,
  renderAddHabit,
  renderReminderBanner,
  renderConfirmTransfers,
  showToast,
} from './render.js';
import {
  getActiveJar,
  listPendingDeposits,
  createJar,
  setJarPaused,
  confirmDeposit,
} from './jar.js';
import {
  isNotificationSupported,
  currentPermission,
  requestPermission,
  scheduleForHabit,
  cancelForHabit,
  rescheduleAllReminders,
  dueRemindersToday,
  snoozeInApp,
  dismissForHabit,
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
        // Any explicit same-day action — Done, Min, or Skip — is a
        // terminal user decision. Cancel any pending OS reminder so the
        // user doesn't get nudged about a habit they just dispatched.
        await cancelForHabit(habitId, todayString());
        // Re-render first so the streak/coin/jar UI is current before toasts.
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
        if (result.jarDeposit) {
          const cur = result.jarCurrency || '';
          showToast(
            `🏦 Set aside ${cur}${result.jarDeposit.amount} for your jar`,
            { tone: 'emerald' }
          );
        }
        if (result.jarFunded) {
          // The persistent funded banner inside the jar card (rendered by
          // refreshToday above) is the durable signal; this toast is just
          // the moment-of-funding nudge.
          showToast('🎯 Jar funded! Your reward is fully saved.', { tone: 'emerald' });
        }
      } catch (err) {
        console.error('[app] completion failed:', err);
        showToast(err.message || 'Could not save', { tone: 'amber' });
      }
    },
    onOpenConfirm: (jar) => {
      showConfirmTransfers(jar).catch((err) => {
        console.error('[app] open confirm failed:', err);
        showToast('Could not open transfers: ' + err.message, { tone: 'amber' });
      });
    },
    onTogglePause: async (jar) => {
      try {
        await setJarPaused(jar.id, !jar.paused);
        await refreshToday();
        showToast(jar.paused ? 'Jar resumed' : 'Jar paused', { tone: 'amber' });
      } catch (err) {
        console.error('[app] toggle pause failed:', err);
        showToast('Could not toggle: ' + err.message, { tone: 'amber' });
      }
    },
  });
  await refreshReminderBanner();
}

async function showConfirmTransfers(jar) {
  showScreen('confirm');
  await renderConfirmModal(jar);
}

async function renderConfirmModal(jar) {
  const deposits = await listPendingDeposits(jar.id);
  renderConfirmTransfers(screens.confirm, jar, deposits, {
    onResolve: async (depositId, state, partialAmount) => {
      try {
        await confirmDeposit(depositId, state, partialAmount);
        const fresh = await getActiveJar();
        if (fresh) await renderConfirmModal(fresh);
        else {
          showScreen('today');
          await refreshToday();
        }
      } catch (err) {
        console.error('[app] confirm failed:', err);
        showToast('Could not confirm: ' + err.message, { tone: 'amber' });
      }
    },
    onClose: async () => {
      showScreen('today');
      await refreshToday();
    },
  });
}

async function refreshReminderBanner() {
  try {
    const due = await dueRemindersToday();
    renderReminderBanner(due, {
      onSnooze: (dueList) => {
        let anySnoozed = false;
        for (const d of dueList) {
          const { snoozed, remaining } = snoozeInApp(d.habitId);
          if (snoozed) {
            anySnoozed = true;
            if (remaining === 0) showToast(`Last snooze for ${d.name}`, { tone: 'amber' });
          } else {
            showToast(`Snooze cap reached for ${d.name}`, { tone: 'amber' });
          }
        }
        if (anySnoozed) refreshReminderBanner();
      },
      onDismiss: (dueList) => {
        for (const d of dueList) dismissForHabit(d.habitId);
        renderReminderBanner([], {});
      },
    });
  } catch (err) {
    console.error('[app] reminder banner failed:', err);
  }
}

let bannerTimer = null;
function startBannerPolling() {
  if (bannerTimer) clearInterval(bannerTimer);
  // Poll every 60s while the document is visible so a reminder time that
  // passes WITH the app already open still surfaces the banner.
  bannerTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      refreshReminderBanner().catch((err) => console.warn('[app] poll banner:', err));
    }
  }, 60000);
}

async function maybeRolloverAfterResume() {
  try {
    const today = todayString();
    const dateChanged = lastRenderedDate && today !== lastRenderedDate;
    if (dateChanged) {
      await rolloverMissed();
      await refreshToday();
    } else {
      // Same-day resume: refresh the banner so a passed reminder shows up
      // promptly without waiting for the polling tick.
      await refreshReminderBanner();
    }
    // Re-prime OS reminders on every resume, not just date-changing ones.
    // After a one-shot trigger fires today, the next-occurrence still
    // needs to be scheduled — `scheduleForHabit` handles "today already
    // dispatched" by walking forward to the next scheduled day.
    rescheduleAllReminders().catch((err) => console.warn('[app] resume reschedule:', err));
  } catch (err) {
    console.error('[app] resume rollover failed:', err);
  }
}

async function showAddHabit() {
  showScreen('addHabit');
  const existingJar = await getActiveJar();
  renderAddHabit(screens.addHabit, {
    onCancel: async () => {
      showScreen('today');
      await refreshToday();
    },
    onSave: async (data) => {
      // Phase 5: validate jar fields BEFORE creating the habit so a
      // bad jar doesn't leave a dangling habit and a closed form.
      // createJar validates everything except linkedHabitId, so we run
      // it after createHabit but rethrow on failure to keep the form open.
      const habit = await createHabit(data);
      if (data.jar && !existingJar) {
        try {
          await createJar({ ...data.jar, linkedHabitId: habit.id });
        } catch (err) {
          // Re-throw so renderAddHabit's submit handler shows the error
          // in the form and re-enables Save / Cancel. The habit is still
          // saved (best-effort), but the user can amend the jar inputs.
          throw err;
        }
      }
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
  }, { existingJar });
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
    // Re-prime OS-level reminders for every habit with a reminderTime so
    // they aren't one-shot at creation. No-op when permission isn't
    // granted or the Triggers API isn't available.
    rescheduleAllReminders().catch((err) => console.warn('[app] reschedule:', err));
    startBannerPolling();
  } catch (err) {
    console.error('[app] bootstrap failed:', err);
    screens.today.textContent = 'Failed to start: ' + err.message;
  }
})();
