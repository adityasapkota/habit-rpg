// Habit CRUD + completion logic.
// Phase 2 records completions with coinsEarned: 0; Phase 3 fills in real coin
// values and computes streaks from the same completion rows.
import { getDB, newId } from './db.js';

export function todayString() {
  return localDateString(new Date());
}

export function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseLocalDateString(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isHabitScheduledOn(habit, date) {
  if (habit.archived) return false;
  const dow = date.getDay();
  if (habit.schedule === 'daily') return true;
  if (habit.schedule === 'weekdays') return dow >= 1 && dow <= 5;
  if (habit.schedule === 'custom') {
    return Array.isArray(habit.customDays) && habit.customDays.includes(dow);
  }
  return false;
}

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

// Toggle/switch semantics (Phase 2):
//   - No existing row + setCompletion(status) → insert.
//   - Existing row.status === status → delete (undo).
//   - Existing row.status !== status → switch status in place.
// Returns the resulting row, or null if it was deleted.
export async function setCompletion(habitId, dateStr, status) {
  if (!['completed', 'minimum', 'missed'].includes(status)) {
    throw new Error('Invalid status: ' + status);
  }
  const db = await getDB();
  const existing = await db.getFromIndex('completions', 'habitId-date', [habitId, dateStr]);
  if (existing) {
    if (existing.status === status) {
      await db.delete('completions', existing.id);
      return null;
    }
    existing.status = status;
    existing.coinsEarned = 0;
    existing.completedAt = Date.now();
    await db.put('completions', existing);
    return existing;
  }
  const row = {
    id: newId(),
    habitId,
    date: dateStr,
    status,
    coinsEarned: 0,
    completedAt: Date.now(),
  };
  await db.put('completions', row);
  return row;
}
