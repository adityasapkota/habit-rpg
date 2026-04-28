// Pure date helpers + per-habit scheduling. No IO, no db.js imports — kept
// dependency-free so streaks.js / coins.js / tests can use them without
// pulling in the IndexedDB layer.

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
