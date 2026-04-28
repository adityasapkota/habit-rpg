// Notification permission + scheduling.
//
// Two paths:
//   1. Notification Triggers API (Chrome behind a flag, very limited). When
//      available, scheduleForHabit() registers a TimestampTrigger so the
//      OS fires the reminder even if the PWA is closed. Best-case path.
//   2. In-app banner fallback (every browser). dueRemindersToday() returns
//      scheduled habits whose reminder time has passed and that haven't
//      been completed. The Today screen shows a banner and offers a
//      "Snooze 10 min" button (cap 3 per habit per day).
//
// 02_DESIGN_DAY1.md: "Reminders are best-effort on web."

import { todayString, parseLocalDateString, localDateString, isHabitScheduledOn } from './dates.js';
import { listHabits, getCompletionForDate } from './habits.js';
import { setUserState } from './db.js';

const MAX_SNOOZES_PER_DAY = 3;

const snoozeCountKey = (habitId, date) => `habit-rpg.snooze.${habitId}.${date}.count`;
const snoozeUntilKey = (habitId, date) => `habit-rpg.snooze.${habitId}.${date}.until`;
const dismissedKey = (date) => `habit-rpg.dismissed.${date}`;

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function hasTriggersApi() {
  if (!isNotificationSupported()) return false;
  return typeof window.TimestampTrigger !== 'undefined';
}

export function currentPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  const current = Notification.permission;
  if (current === 'granted' || current === 'denied') {
    await setUserState({ notificationsEnabled: current === 'granted' });
    return current;
  }
  const result = await Notification.requestPermission();
  await setUserState({ notificationsEnabled: result === 'granted' });
  return result;
}

function notifTag(habitId, date) {
  return `habit-rpg-${habitId}-${date}`;
}

// Compute the next firing time for a habit's reminder, walking forward up
// to two weeks until we hit a future moment AND a scheduled day. Returns
// Date or null.
function nextReminderTime(habit, fromDate = new Date()) {
  if (!habit.reminderTime) return null;
  const [hh, mm] = habit.reminderTime.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const target = new Date(fromDate);
  target.setHours(hh, mm, 0, 0);
  for (let i = 0; i < 14; i++) {
    if (target > fromDate && isHabitScheduledOn(habit, target)) return target;
    target.setDate(target.getDate() + 1);
    target.setHours(hh, mm, 0, 0);
  }
  return null;
}

// Best-effort schedule via Triggers API. Cancels any prior notification
// for the same habit/day first. Returns true iff a trigger was registered.
export async function scheduleForHabit(habit) {
  if (!isNotificationSupported()) return false;
  if (currentPermission() !== 'granted') return false;
  if (!habit.reminderTime) return false;
  if (!('serviceWorker' in navigator)) return false;

  const next = nextReminderTime(habit);
  if (!next) return false;

  const date = localDateString(next);
  await cancelForHabit(habit.id, date);

  if (!hasTriggersApi()) return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(habit.name, {
      body: `Time to: ${habit.minimumVersion}`,
      tag: notifTag(habit.id, date),
      data: {
        habitId: habit.id,
        date,
        name: habit.name,
        minimum: habit.minimumVersion,
      },
      actions: [{ action: 'snooze', title: 'Snooze 10 min' }],
      // eslint-disable-next-line no-undef
      showTrigger: new window.TimestampTrigger(next.getTime()),
    });
    return true;
  } catch (err) {
    console.warn('[notif] schedule failed:', err);
    return false;
  }
}

export async function cancelForHabit(habitId, date) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const tag = notifTag(habitId, date);
    const notifs = await reg.getNotifications({ tag, includeTriggered: true });
    for (const n of notifs) n.close();
  } catch (err) {
    console.warn('[notif] cancel failed:', err);
  }
}

// Build the list of in-app reminders that are currently due. A reminder is
// due when: the habit is scheduled today, has a reminderTime, the clock is
// past that time, the user hasn't already taken any non-missed action on
// it today, and it isn't currently snoozed.
export async function dueRemindersToday() {
  if (typeof localStorage === 'undefined') return [];
  const date = todayString();
  if (localStorage.getItem(dismissedKey(date)) === '1') return [];

  const habits = await listHabits();
  const now = new Date();
  const todayDate = parseLocalDateString(date);

  const due = [];
  for (const habit of habits) {
    if (!habit.reminderTime) continue;
    if (!isHabitScheduledOn(habit, todayDate)) continue;
    const [hh, mm] = habit.reminderTime.split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
    const target = new Date();
    target.setHours(hh, mm, 0, 0);
    if (now < target) continue;

    const snoozeUntil = Number(localStorage.getItem(snoozeUntilKey(habit.id, date)) || 0);
    if (snoozeUntil > now.getTime()) continue;

    const completion = await getCompletionForDate(habit.id, date);
    // A 'missed' row means the user hasn't actually engaged yet — keep nudging.
    if (completion && completion.status !== 'missed') continue;

    due.push({
      habitId: habit.id,
      name: habit.name,
      minimum: habit.minimumVersion,
      reminderTime: habit.reminderTime,
    });
  }
  return due;
}

// Push the in-app banner ten minutes into the future. Returns the new
// remaining-snoozes count (0 means cap reached and we did nothing).
export function snoozeInApp(habitId) {
  if (typeof localStorage === 'undefined') return 0;
  const date = todayString();
  const cKey = snoozeCountKey(habitId, date);
  const uKey = snoozeUntilKey(habitId, date);
  const count = Number(localStorage.getItem(cKey) || 0);
  if (count >= MAX_SNOOZES_PER_DAY) return 0;
  const until = Date.now() + 10 * 60 * 1000;
  localStorage.setItem(cKey, String(count + 1));
  localStorage.setItem(uKey, String(until));
  return MAX_SNOOZES_PER_DAY - (count + 1);
}

export function dismissBannerForToday() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(dismissedKey(todayString()), '1');
}
