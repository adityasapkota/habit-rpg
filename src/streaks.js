// Streak math + milestone detection. Pure functions over a per-habit
// completion map (date string → row). No IO.
//
// Rules from 02_DESIGN_DAY1.md:
//   - Streak counts consecutive scheduled days, walking back from an anchor
//     date, where each day's status is `completed` or `minimum`.
//   - `completed` increments the streak counter.
//   - `minimum` keeps the chain alive without incrementing.
//   - `missed` (or no row on a past scheduled day) breaks the chain.
//   - For weekday/custom schedules, only scheduled days affect the streak.
//   - For the anchor day itself, no row means "not yet acted on" — keep
//     walking back without breaking.

import { isHabitScheduledOn, parseLocalDateString, localDateString } from './dates.js';

// Cover 90×7 = 630 calendar days for a once-weekly custom habit reaching the
// 90-day milestone, with margin for missing weeks.
export const SAFETY_DAYS = 1200;

function createdDayOf(habit) {
  const epoch = Number(habit.createdAt) || 0;
  const d = new Date(epoch);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function streakAsOf(habit, completionsByDate, anchorDateStr) {
  const cursor = parseLocalDateString(anchorDateStr);
  const createdDay = createdDayOf(habit);
  let streak = 0;
  let walked = 0;
  while (walked++ < SAFETY_DAYS) {
    if (cursor < createdDay) break;
    if (isHabitScheduledOn(habit, cursor)) {
      const ds = localDateString(cursor);
      const c = completionsByDate.get(ds);
      if (!c) {
        if (ds === anchorDateStr) {
          // anchor day not yet acted on — count from prior days
        } else {
          break;
        }
      } else if (c.status === 'completed') {
        streak += 1;
      } else if (c.status === 'minimum') {
        // alive but no increment
      } else {
        // missed — chain broken
        break;
      }
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

const MILESTONES = [
  { length: 3,  bonus: 15 },
  { length: 7,  bonus: 50 },
  { length: 30, bonus: 300 },
  { length: 90, bonus: 1500 },
];

// Returns { length, bonus } if `newStreak` crossed a milestone that
// `prevStreak` had not, else null. If a single write crosses multiple
// (e.g. mocked jump from 6 to 30), award the highest crossed.
export function crossedMilestone(prevStreak, newStreak) {
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    const m = MILESTONES[i];
    if (prevStreak < m.length && newStreak >= m.length) return { ...m };
  }
  return null;
}

// True iff the most-recent scheduled day strictly before `dateStr` is
// effectively missed. Walks backwards over scheduled-only days, bounded by
// the habit's createdDay. A past scheduled day with no row counts as missed
// — rollover may not have run yet (mid-day app open, tests). Used by the
// comeback-bonus check.
export function priorMissedComeback(habit, completionsByDate, dateStr) {
  const cursor = parseLocalDateString(dateStr);
  cursor.setDate(cursor.getDate() - 1);
  const createdDay = createdDayOf(habit);
  let walked = 0;
  while (walked++ < SAFETY_DAYS) {
    if (cursor < createdDay) return false;
    if (isHabitScheduledOn(habit, cursor)) {
      const ds = localDateString(cursor);
      const c = completionsByDate.get(ds);
      if (!c) return true; // absence on a past scheduled day = missed
      return c.status === 'missed';
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return false;
}
