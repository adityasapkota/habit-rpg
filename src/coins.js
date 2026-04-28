// Coin earning rules. Pure functions — no IO. The actual coin balance
// updates live in setCompletion (habits.js), which calls these to compute
// per-row coinsEarned values.
//
// Rules from 02_DESIGN_DAY1.md:
//   Done on daily    = 10
//   Done on weekdays = 12
//   Done on custom   = 15
//   Min              = 5  (any schedule)
//   Skip / missed    = 0
//   Comeback bonus   = +25 on the first Done after a missed scheduled day
//   Milestone bonus  = +15 / +50 / +300 / +1500 at streaks of 3 / 7 / 30 / 90.

export const COMEBACK_BONUS = 25;

const DONE_BY_SCHEDULE = {
  daily: 10,
  weekdays: 12,
  custom: 15,
};

export function baseCoinsFor(status, schedule) {
  if (status === 'completed') return DONE_BY_SCHEDULE[schedule] ?? 0;
  if (status === 'minimum') return 5;
  return 0;
}
