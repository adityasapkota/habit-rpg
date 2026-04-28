// Savings jar logic. Pure functions over jar/deposit rows + a list of
// existing deposits. The IDB plumbing lives in habits.js setCompletion
// (deposit firing) and a small set of CRUD helpers in this file for jar
// state changes the user controls (create / pause / confirm).
//
// Rules from 02_DESIGN_DAY1.md:
//   - One jar per user in v1 (linked to one habit).
//   - depositRule.trigger = 'streak', .streakLength = N, .amount = X.
//     A Done that pushes the streak across an integer multiple of N
//     records a deposit of X to recordedBalance.
//   - monthlyCap (optional) caps total recorded amount per calendar month.
//   - Paused jar does not trigger deposits.
//   - At target: stop triggering further deposits, fire a celebration banner.

import { getDB, newId, setUserState as _setUserState } from './db.js';

// Compute how much a streak transition should record into the jar. The
// caller supplies the deposits already recorded so monthly cap math is
// honest. Returns 0 when nothing should fire.
//
//   habit:    the habit row
//   prev:     streak value BEFORE the new completion
//   next:     streak value AFTER the new completion
//   jar:      the jar (or null if no jar linked)
//   deposits: every existing jarDeposit (filter is cheap; the v1 store is
//             single-jar so this is small)
//   triggerDate: 'YYYY-MM-DD' of the completion that caused the trigger.
//             The monthly cap is keyed off this date so backfills land in
//             the right calendar month, not whatever month it is right now.
export function computeJarTrigger(habit, prev, next, jar, deposits, triggerDate) {
  if (!jar) return 0;
  if (jar.paused) return 0;
  if (jar.linkedHabitId !== habit.id) return 0;
  if (!jar.depositRule || jar.depositRule.trigger !== 'streak') return 0;
  const N = Number(jar.depositRule.streakLength);
  const amount = Number(jar.depositRule.amount);
  if (!Number.isFinite(N) || N <= 0) return 0;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (jar.recordedBalance >= jar.targetAmount) return 0;

  const oldMultiples = Math.floor(prev / N);
  const newMultiples = Math.floor(next / N);
  const crossed = newMultiples - oldMultiples;
  if (crossed <= 0) return 0;

  let owed = amount * crossed;

  if (Number.isFinite(jar.monthlyCap) && jar.monthlyCap > 0) {
    const ym = triggerDate ? triggerDate.slice(0, 7) : monthKey(new Date());
    const monthTotal = deposits
      .filter((d) => {
        if (d.jarId !== jar.id) return false;
        const depYm = d.date
          ? d.date.slice(0, 7)
          : monthKey(new Date(d.recordedAt));
        return depYm === ym;
      })
      .reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const remaining = jar.monthlyCap - monthTotal;
    if (remaining <= 0) return 0;
    owed = Math.min(owed, remaining);
  }

  // Don't overshoot the target.
  const toTarget = jar.targetAmount - jar.recordedBalance;
  if (toTarget <= 0) return 0;
  owed = Math.min(owed, toTarget);

  return owed;
}

function monthKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// CRUD helpers (single-jar v1).

export async function getActiveJar() {
  const db = await getDB();
  const all = await db.getAll('jars');
  return all[0] || null;
}

export async function listJarDeposits(jarId) {
  const db = await getDB();
  return db.getAllFromIndex('jarDeposits', 'jarId', jarId);
}

export async function listPendingDeposits(jarId) {
  const db = await getDB();
  const pending = await db.getAllFromIndex('jarDeposits', 'confirmedState', 'pending');
  return pending.filter((d) => d.jarId === jarId);
}

// Validates jar fields. Schema (02_DESIGN_DAY1.md) treats amounts as
// integers; we round-down rather than reject decimals so a user typing
// 100.5 doesn't get confused, but we reject zero/negative/NaN.
function toPositiveInt(value, label) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be a positive whole number.`);
  return n;
}

export async function createJar({
  name,
  targetAmount,
  currency,
  monthlyCap,
  linkedHabitId,
  streakLength,
  amount,
}) {
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Jar name is required.');
  if (!linkedHabitId) throw new Error('Jar must be linked to a habit.');
  const target = toPositiveInt(targetAmount, 'Target amount');
  const N = toPositiveInt(streakLength, 'Streak length');
  const amt = toPositiveInt(amount, 'Deposit amount');
  let cap = null;
  if (monthlyCap != null && monthlyCap !== '') {
    cap = toPositiveInt(monthlyCap, 'Monthly cap');
  }
  const cleanCurrency = (currency || '$').trim() || '$';

  const db = await getDB();
  // Single-jar v1 invariant: enforce inside a tx so a concurrent tab
  // can't slip in a second jar between the existence check and the put.
  const tx = db.transaction('jars', 'readwrite');
  const existing = await tx.objectStore('jars').getAll();
  if (existing.length > 0) {
    await tx.done.catch(() => {});
    throw new Error('Only one savings jar is supported in v1.');
  }
  const jar = {
    id: newId(),
    name: cleanName,
    targetAmount: target,
    currency: cleanCurrency,
    recordedBalance: 0,
    confirmedBalance: 0,
    monthlyCap: cap,
    linkedHabitId,
    depositRule: { trigger: 'streak', streakLength: N, amount: amt },
    paused: false,
    createdAt: Date.now(),
  };
  await tx.objectStore('jars').put(jar);
  await tx.done;
  return jar;
}

export async function setJarPaused(jarId, paused) {
  const db = await getDB();
  const jar = await db.get('jars', jarId);
  if (!jar) return null;
  jar.paused = !!paused;
  await db.put('jars', jar);
  return jar;
}

// Confirm a single deposit. `state` is one of 'transferred' | 'partial' |
// 'skipped'. For 'partial', `partialAmount` must be supplied.
export async function confirmDeposit(depositId, state, partialAmount = null) {
  if (!['transferred', 'partial', 'skipped'].includes(state)) {
    throw new Error('Invalid confirmation state: ' + state);
  }
  const db = await getDB();
  const tx = db.transaction(['jarDeposits', 'jars'], 'readwrite');
  const dep = await tx.objectStore('jarDeposits').get(depositId);
  if (!dep) {
    await tx.done.catch(() => {});
    throw new Error('Deposit not found.');
  }
  if (dep.confirmedState !== 'pending') {
    await tx.done.catch(() => {});
    throw new Error('Deposit already resolved.');
  }
  let confirmedAmount = null;
  if (state === 'transferred') confirmedAmount = dep.amount;
  else if (state === 'partial') {
    const v = Number(partialAmount);
    if (!Number.isFinite(v) || v < 0 || v > dep.amount) {
      await tx.done.catch(() => {});
      throw new Error('Partial amount must be between 0 and the deposit amount.');
    }
    confirmedAmount = v;
  } else {
    confirmedAmount = 0;
  }
  dep.confirmedState = state;
  dep.confirmedAmount = confirmedAmount;
  dep.confirmedAt = Date.now();
  await tx.objectStore('jarDeposits').put(dep);

  if (confirmedAmount > 0) {
    const jar = await tx.objectStore('jars').get(dep.jarId);
    if (jar) {
      jar.confirmedBalance = (jar.confirmedBalance || 0) + confirmedAmount;
      await tx.objectStore('jars').put(jar);
    }
  }
  await tx.done;
  return dep;
}
