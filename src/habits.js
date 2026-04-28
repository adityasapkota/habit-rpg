// Habit CRUD + completion logic.
//
// Phase 3: setCompletion now drives coin balance + milestone + comeback
// bonuses, computed inside one IDB transaction across habits / completions /
// userState so the row, its coinsEarned, and the userState delta land
// atomically. rolloverMissed() runs at app bootstrap to mark past scheduled
// days as `missed` so streak math sees a correct chain.
import { getDB, newId } from './db.js';
import { baseCoinsFor, COMEBACK_BONUS } from './coins.js';
import { streakAsOf, crossedMilestone, priorMissedComeback } from './streaks.js';
import {
  todayString,
  localDateString,
  parseLocalDateString,
  isHabitScheduledOn,
} from './dates.js';

// Re-export so existing call sites (render.js, app.js) don't have to change.
export { todayString, localDateString, parseLocalDateString, isHabitScheduledOn };

const LAST_OPEN_KEY = 'habit-rpg.lastOpenDate';

export async function listHabits({ includeArchived = false } = {}) {
  const db = await getDB();
  const all = await db.getAll('habits');
  return includeArchived ? all : all.filter((h) => !h.archived);
}

export async function getHabit(id) {
  const db = await getDB();
  return db.get('habits', id);
}

export async function createHabit({ name, schedule, customDays, reminderTime, minimumVersion }) {
  const cleanName = (name || '').trim();
  const cleanMin = (minimumVersion || '').trim();
  if (!cleanName) throw new Error('Name is required.');
  if (!cleanMin) throw new Error('Minimum version is required.');
  if (!['daily', 'weekdays', 'custom'].includes(schedule)) {
    throw new Error('Pick a schedule.');
  }
  let custom = null;
  if (schedule === 'custom') {
    if (!Array.isArray(customDays) || customDays.length === 0) {
      throw new Error('Pick at least one day for the custom schedule.');
    }
    custom = customDays.slice().sort((a, b) => a - b);
  }
  const habit = {
    id: newId(),
    name: cleanName,
    schedule,
    customDays: custom,
    reminderTime: reminderTime || null,
    minimumVersion: cleanMin,
    createdAt: Date.now(),
    archived: false,
  };
  const db = await getDB();
  await db.put('habits', habit);
  return habit;
}

export async function archiveHabit(id) {
  const db = await getDB();
  const habit = await db.get('habits', id);
  if (!habit) return;
  habit.archived = true;
  await db.put('habits', habit);
}

export async function getHabitsScheduledForDate(dateStr) {
  const habits = await listHabits();
  const date = parseLocalDateString(dateStr);
  return habits.filter((h) => isHabitScheduledOn(h, date));
}

export async function getCompletionForDate(habitId, dateStr) {
  const db = await getDB();
  return db.getFromIndex('completions', 'habitId-date', [habitId, dateStr]);
}

export async function getCompletionsForDate(dateStr) {
  const db = await getDB();
  return db.getAllFromIndex('completions', 'date', dateStr);
}

// Builds `Map<habitId, Map<dateStr, completionRow>>` in one pass.
// Used by renderToday to compute per-card streaks without N+1 queries.
export async function getAllCompletionsByHabit() {
  const db = await getDB();
  const all = await db.getAll('completions');
  const byHabit = new Map();
  for (const c of all) {
    let inner = byHabit.get(c.habitId);
    if (!inner) {
      inner = new Map();
      byHabit.set(c.habitId, inner);
    }
    inner.set(c.date, c);
  }
  return byHabit;
}

// Toggle/switch semantics with coin accounting + milestone + comeback bonus,
// all under one IDB readwrite transaction.
//
// Returns:
//   { row, coinDelta, milestone, comebackApplied, newStreak }
// where:
//   row              — the resulting completion row, or null if undone
//   coinDelta        — change applied to userState.coinBalance
//   milestone        — { length, bonus } or null (only on completed)
//   comebackApplied  — true iff +25 was added to this row
//   newStreak        — streak after the write (0 if undone)
export async function setCompletion(habitId, dateStr, status) {
  if (!['completed', 'minimum', 'missed'].includes(status)) {
    throw new Error('Invalid status: ' + status);
  }
  const db = await getDB();
  const tx = db.transaction(['habits', 'completions', 'userState'], 'readwrite');
  const habitsStore = tx.objectStore('habits');
  const completionsStore = tx.objectStore('completions');
  const userStateStore = tx.objectStore('userState');

  const habit = await habitsStore.get(habitId);
  if (!habit) {
    await tx.done.catch(() => {});
    throw new Error('Habit not found');
  }

  // Load full per-habit completion history. The habitId-date index gives us
  // a cheap range scan — Map keyed by date for streak math + comeback check.
  const habitCompletions = await completionsStore
    .index('habitId-date')
    .getAll(IDBKeyRange.bound([habitId, '0000-00-00'], [habitId, '9999-99-99']));
  const byDate = new Map(habitCompletions.map((c) => [c.date, c]));

  const existing = byDate.get(dateStr);
  let coinDelta = 0;
  let milestone = null;
  let comebackApplied = false;
  let resultRow = null;
  let newStreak = 0;

  if (existing && existing.status === status) {
    // Undo: delete the row, refund its coinsEarned.
    await completionsStore.delete(existing.id);
    coinDelta = -existing.coinsEarned;
    resultRow = null;
    byDate.delete(dateStr);
    newStreak = streakAsOf(habit, byDate, dateStr);
  } else {
    let coinsEarned = baseCoinsFor(status, habit.schedule);
    if (status === 'completed' && priorMissedComeback(habit, byDate, dateStr)) {
      coinsEarned += COMEBACK_BONUS;
      comebackApplied = true;
    }

    const newRow = existing
      ? { ...existing, status, coinsEarned, completedAt: Date.now() }
      : {
          id: newId(),
          habitId,
          date: dateStr,
          status,
          coinsEarned,
          completedAt: Date.now(),
        };

    const prevStreak = streakAsOf(habit, byDate, dateStr);
    byDate.set(dateStr, newRow);
    newStreak = streakAsOf(habit, byDate, dateStr);

    if (status === 'completed') {
      milestone = crossedMilestone(prevStreak, newStreak);
      if (milestone) {
        newRow.coinsEarned += milestone.bonus;
      }
    }

    await completionsStore.put(newRow);
    coinDelta = newRow.coinsEarned - (existing ? existing.coinsEarned : 0);
    resultRow = newRow;
  }

  if (coinDelta !== 0) {
    const us = await userStateStore.get('singleton');
    if (us) {
      us.coinBalance = (us.coinBalance || 0) + coinDelta;
      // Lifetime tally also tracks delta. Undoes decrease it so totals stay
      // consistent with what the user actually holds.
      us.totalCoinsEarned = (us.totalCoinsEarned || 0) + coinDelta;
      await userStateStore.put(us);
    }
  }

  await tx.done;

  return { row: resultRow, coinDelta, milestone, comebackApplied, newStreak };
}

// Mark scheduled days from the user's last visit (exclusive) up to today
// (exclusive) as `missed` for any habit that did not get a completion on
// that day. Stores the high-water-mark in localStorage so we don't re-run.
//
// Idempotent: if any day already has a completion row, leave it alone.
// Returns the count of rows inserted.
export async function rolloverMissed() {
  const today = todayString();
  const lastOpen = (typeof localStorage !== 'undefined') ? localStorage.getItem(LAST_OPEN_KEY) : null;

  if (!lastOpen) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_OPEN_KEY, today);
    return { marked: 0 };
  }
  if (lastOpen >= today) {
    // Same day or clock moved backwards — nothing to fill in.
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_OPEN_KEY, today);
    return { marked: 0 };
  }

  const habits = await listHabits();
  if (habits.length === 0) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_OPEN_KEY, today);
    return { marked: 0 };
  }

  const db = await getDB();
  const cursor = parseLocalDateString(lastOpen);
  const todayDate = parseLocalDateString(today);
  let marked = 0;

  while (cursor < todayDate) {
    const ds = localDateString(cursor);
    for (const habit of habits) {
      const created = new Date(habit.createdAt);
      const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
      if (cursor < createdDay) continue;
      if (!isHabitScheduledOn(habit, cursor)) continue;
      const existing = await db.getFromIndex('completions', 'habitId-date', [habit.id, ds]);
      if (existing) continue;
      await db.put('completions', {
        id: newId(),
        habitId: habit.id,
        date: ds,
        status: 'missed',
        coinsEarned: 0,
        completedAt: Date.now(),
      });
      marked += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_OPEN_KEY, today);
  return { marked };
}
