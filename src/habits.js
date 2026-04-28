// Habit CRUD + completion logic.
//
// Phase 3: setCompletion now drives coin balance + milestone + comeback
// bonuses, computed inside one IDB transaction across habits / completions /
// userState so the row, its coinsEarned, and the userState delta land
// atomically. rolloverMissed() runs at app bootstrap to mark past scheduled
// days as `missed` so streak math sees a correct chain.
import { getDB, newId } from './db.js';
import { baseCoinsFor, COMEBACK_BONUS } from './coins.js';
import {
  streakAsOf,
  crossedMilestone,
  priorMissedComeback,
  SAFETY_DAYS,
} from './streaks.js';
import { computeJarTrigger } from './jar.js';
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

// Builds `Map<habitId, Map<dateStr, completionRow>>` in one pass, bounded
// to the last SAFETY_DAYS days — that's the maximum window streakAsOf can
// walk, and unbounded scans get expensive once the user has accumulated
// thousands of rows.
export async function getAllCompletionsByHabit() {
  const db = await getDB();
  const earliest = parseLocalDateString(todayString());
  earliest.setDate(earliest.getDate() - SAFETY_DAYS);
  const earliestStr = localDateString(earliest);
  const all = await db.getAllFromIndex('completions', 'date',
    IDBKeyRange.lowerBound(earliestStr));
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
  const tx = db.transaction(
    ['habits', 'completions', 'userState', 'jars', 'jarDeposits'],
    'readwrite',
  );
  const habitsStore = tx.objectStore('habits');
  const completionsStore = tx.objectStore('completions');
  const userStateStore = tx.objectStore('userState');
  const jarsStore = tx.objectStore('jars');
  const depositsStore = tx.objectStore('jarDeposits');

  const habit = await habitsStore.get(habitId);
  if (!habit) {
    await tx.done.catch(() => {});
    throw new Error('Habit not found');
  }

  // Phase 3 guard: never award a completion for a day a habit isn't
  // scheduled. Prevents stale UI or direct calls from minting coins on
  // weekday/custom off-days while streakAsOf would ignore the row anyway.
  if (!isHabitScheduledOn(habit, parseLocalDateString(dateStr))) {
    await tx.done.catch(() => {});
    throw new Error('Habit is not scheduled on this date.');
  }

  // Load only the last SAFETY_DAYS days of this habit's completions —
  // that's the full window streakAsOf and priorMissedComeback can walk.
  // Unbounded scans here would slow down every toggle as data accrues.
  const earliest = parseLocalDateString(dateStr);
  earliest.setDate(earliest.getDate() - SAFETY_DAYS);
  const earliestStr = localDateString(earliest);
  const habitCompletions = await completionsStore
    .index('habitId-date')
    .getAll(IDBKeyRange.bound([habitId, earliestStr], [habitId, '9999-99-99']));
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

  // Phase 5: jar trigger. Only fires on insert/switch where the resulting
  // streak is higher than before (positive crossings of the rule's
  // multiple). Forward-only — undo does not refund a jar deposit, since
  // the deposit represents money the user committed to set aside.
  let jarDeposit = null;
  let jarFunded = false;
  if (resultRow && resultRow.status !== 'missed') {
    const jars = await jarsStore.getAll();
    const jar = jars.find((j) => j.linkedHabitId === habitId);
    if (jar) {
      // Dedup: if a deposit already exists for (jarId, dateStr), skip.
      const existingDep = await depositsStore.index('jarId-date').get([jar.id, dateStr]);
      if (!existingDep) {
        const allDeposits = await depositsStore.getAll();
        // We need a "previous" streak — the streak BEFORE this completion
        // landed. We computed prevStreak above only in the insert/switch
        // branch; recompute defensively.
        const tempByDate = new Map(habitCompletions.map((c) => [c.date, c]));
        if (existing) tempByDate.set(dateStr, existing);
        else tempByDate.delete(dateStr);
        const beforeStreak = streakAsOf(habit, tempByDate, dateStr);
        const owed = computeJarTrigger(habit, beforeStreak, newStreak, jar, allDeposits);
        if (owed > 0) {
          const dep = {
            id: newId(),
            jarId: jar.id,
            amount: owed,
            triggeredByStreak: newStreak,
            date: dateStr,
            recordedAt: Date.now(),
            confirmedState: 'pending',
            confirmedAmount: null,
            confirmedAt: null,
          };
          await depositsStore.put(dep);
          jar.recordedBalance = (jar.recordedBalance || 0) + owed;
          if (jar.recordedBalance >= jar.targetAmount) {
            jar.recordedBalance = jar.targetAmount;
            jarFunded = true;
          }
          await jarsStore.put(jar);
          jarDeposit = dep;
        }
      }
    }
  }

  await tx.done;

  return {
    row: resultRow,
    coinDelta,
    milestone,
    comebackApplied,
    newStreak,
    jarDeposit,
    jarFunded,
  };
}

// Cap how far back the very-first rollover will reach for an existing
// install. Older missed days are written off rather than spammed.
const ROLLOVER_BACKFILL_DAYS = 30;

function setLastOpen(value) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_OPEN_KEY, value);
}

// Mark scheduled days from the user's last visit (inclusive) up to today
// (exclusive) as `missed` for any habit that did not get a completion on
// that day. Stores the high-water-mark in localStorage so we don't re-run.
//
// Idempotent: if any day already has a completion row, leave it alone.
// All writes go through one IDB transaction so a closed-mid-rollover state
// can never be partial. Returns the count of rows inserted.
export async function rolloverMissed() {
  const today = todayString();
  const habits = await listHabits();

  let lastOpen = (typeof localStorage !== 'undefined') ? localStorage.getItem(LAST_OPEN_KEY) : null;

  // First-ever open: nothing to backfill.
  if (!lastOpen && habits.length === 0) {
    setLastOpen(today);
    return { marked: 0 };
  }

  // First open that has habits but no high-water-mark: this is what
  // happens when an existing user upgrades to a build that introduced
  // rolloverMissed. Backfill from the oldest habit's creation day, capped
  // at ROLLOVER_BACKFILL_DAYS so we don't punish someone who let the app
  // sit unused for months.
  if (!lastOpen) {
    const oldestEpoch = Math.min(...habits.map((h) => Number(h.createdAt) || Date.now()));
    const oldest = new Date(oldestEpoch);
    const oldestDay = new Date(oldest.getFullYear(), oldest.getMonth(), oldest.getDate());
    const cap = parseLocalDateString(today);
    cap.setDate(cap.getDate() - ROLLOVER_BACKFILL_DAYS);
    lastOpen = localDateString(oldestDay > cap ? oldestDay : cap);
  }

  if (lastOpen >= today) {
    // Same day or clock moved backwards — nothing to fill in.
    setLastOpen(today);
    return { marked: 0 };
  }

  if (habits.length === 0) {
    setLastOpen(today);
    return { marked: 0 };
  }

  const db = await getDB();
  const tx = db.transaction('completions', 'readwrite');
  const store = tx.objectStore('completions');

  // Pre-fetch every completion in the backfill window in one indexed
  // range call, then check membership via Set. Avoids days*habits
  // sequential getFromIndex calls inside the loop.
  const existingInRange = await store
    .index('date')
    .getAll(IDBKeyRange.bound(lastOpen, today, false, true)); // [lastOpen, today)
  const existingKeys = new Set(existingInRange.map((c) => `${c.habitId}|${c.date}`));

  const cursor = parseLocalDateString(lastOpen);
  const todayDate = parseLocalDateString(today);
  let marked = 0;

  while (cursor < todayDate) {
    const ds = localDateString(cursor);
    for (const habit of habits) {
      const created = new Date(Number(habit.createdAt) || 0);
      const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
      if (cursor < createdDay) continue;
      if (!isHabitScheduledOn(habit, cursor)) continue;
      if (existingKeys.has(`${habit.id}|${ds}`)) continue;
      await store.put({
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

  await tx.done;
  setLastOpen(today);
  return { marked };
}
