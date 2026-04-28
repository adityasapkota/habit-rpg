// Render functions for each screen. Each one fully replaces the contents of
// the passed root element. Build via DOM API (not innerHTML) so user-supplied
// strings can never become HTML.
import {
  listHabits,
  getHabitsScheduledForDate,
  getAllCompletionsByHabit,
  todayString,
  localDateString,
} from './habits.js';
import { streakAsOf } from './streaks.js';
import { getActiveJar, listPendingDeposits, listJarDeposits } from './jar.js';
import { getUserState } from './db.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const ACTIONS = [
  { label: 'Done', status: 'completed', accent: 'emerald' },
  { label: 'Min', status: 'minimum', accent: 'sky' },
  { label: 'Skip', status: 'missed', accent: 'slate' },
];

export async function renderToday(root, callbacks) {
  // Fetch everything first, then swap the DOM atomically. This avoids the
  // empty-flash that happens if you replaceChildren() before awaiting.
  const userState = await getUserState();

  const date = todayString();
  const allHabits = await listHabits();
  const scheduled = await getHabitsScheduledForDate(date);
  const completionsByHabit = await getAllCompletionsByHabit();

  const wrap = el('div', 'space-y-5');
  wrap.appendChild(el('p', 'text-slate-400 text-sm', 'Showing up today.'));

  if (allHabits.length === 0) {
    wrap.appendChild(emptyFirstHabit());
  } else if (scheduled.length === 0) {
    wrap.appendChild(await scheduledTomorrow());
  } else {
    wrap.appendChild(el('h2', 'text-slate-100 text-base font-medium pt-2', "Today's habits"));
    const list = el('div', 'space-y-3');
    for (const habit of scheduled) {
      const habitMap = completionsByHabit.get(habit.id) || new Map();
      const todayCompletion = habitMap.get(date) || null;
      const streak = streakAsOf(habit, habitMap, date);
      list.appendChild(habitCard(habit, todayCompletion, streak, callbacks));
    }
    wrap.appendChild(list);
  }

  // Active jar card (Phase 5). Single jar in v1.
  const jar = await getActiveJar();
  if (jar) {
    const pending = await listPendingDeposits(jar.id);
    wrap.appendChild(jarCard(jar, pending, callbacks));
  }

  // One-shot swap: no flash of empty content during async work.
  root.replaceChildren(wrap);
  updateCoinPill(userState.coinBalance);
}

function jarCard(jar, pending, callbacks) {
  const card = el('div', 'rounded-xl bg-slate-800 border border-slate-700 p-4 space-y-2');

  if (jar.recordedBalance >= jar.targetAmount) {
    // Persistent funded banner inside the jar card. Survives reloads, so
    // the user keeps seeing the celebration until they confirm transfers
    // and the spec's "celebration banner" requirement is met.
    const cel = el('div',
      'rounded-lg bg-emerald-500 text-slate-900 text-sm font-semibold p-2 text-center',
      '🎯 Jar funded! Your reward is fully saved.');
    card.appendChild(cel);
  }

  const head = el('div', 'flex items-baseline justify-between');
  head.appendChild(el('span', 'text-base font-medium text-slate-100', jar.name));
  const status = jar.paused
    ? el('span', 'text-xs text-amber-400', 'paused')
    : jar.recordedBalance >= jar.targetAmount
      ? el('span', 'text-xs text-emerald-400', 'funded')
      : el('span', 'text-xs text-slate-500', 'active');
  head.appendChild(status);
  card.appendChild(head);

  const fmt = (n) => `${jar.currency}${Math.round(n)}`;
  const ratio = jar.targetAmount > 0 ? Math.min(1, jar.recordedBalance / jar.targetAmount) : 0;
  const bar = el('div', 'h-2 rounded-full bg-slate-900 overflow-hidden');
  const fill = el('div', 'h-full bg-emerald-500');
  fill.style.width = `${Math.round(ratio * 100)}%`;
  bar.appendChild(fill);
  card.appendChild(bar);

  card.appendChild(el('p', 'text-xs text-slate-400',
    `Recorded ${fmt(jar.recordedBalance)} / Target ${fmt(jar.targetAmount)} · Confirmed ${fmt(jar.confirmedBalance)}`));

  const actions = el('div', 'flex gap-2 pt-1');
  if (pending.length > 0) {
    const confirmBtn = el('button', 'flex-1 rounded bg-emerald-500 text-slate-900 text-xs font-semibold py-1.5');
    confirmBtn.type = 'button';
    confirmBtn.textContent = `Confirm transfers (${pending.length})`;
    confirmBtn.addEventListener('click', () => callbacks.onOpenConfirm(jar));
    actions.appendChild(confirmBtn);
  }
  const pauseBtn = el('button', 'flex-1 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs py-1.5');
  pauseBtn.type = 'button';
  pauseBtn.textContent = jar.paused ? 'Resume' : 'Pause';
  pauseBtn.addEventListener('click', () => callbacks.onTogglePause(jar));
  actions.appendChild(pauseBtn);
  card.appendChild(actions);

  return card;
}

// Confirm Transfers modal. `jar` + `deposits` array (pending only).
// callbacks.onResolve(depositId, state, partialAmount) per row,
// callbacks.onClose() for the close button.
export function renderConfirmTransfers(root, jar, deposits, callbacks) {
  const wrap = el('div', 'space-y-4');

  const head = el('div', 'flex items-center justify-between');
  head.appendChild(el('h2', 'text-lg font-semibold', `Confirm: ${jar.name}`));
  const close = el('button', 'text-slate-400 hover:text-slate-100 text-sm');
  close.type = 'button';
  close.textContent = 'Done';
  close.addEventListener('click', () => callbacks.onClose());
  head.appendChild(close);
  wrap.appendChild(head);

  if (deposits.length === 0) {
    wrap.appendChild(el('p', 'text-slate-400 text-sm', 'No pending transfers.'));
  } else {
    const list = el('div', 'space-y-3');
    for (const dep of deposits) {
      list.appendChild(confirmRow(jar, dep, callbacks));
    }
    wrap.appendChild(list);
  }

  root.replaceChildren(wrap);
}

function confirmRow(jar, dep, callbacks) {
  const card = el('div', 'rounded-xl bg-slate-800 border border-slate-700 p-3 space-y-2');
  const headLine = el('div', 'flex items-baseline justify-between');
  headLine.appendChild(el('span', 'text-sm font-medium text-slate-100',
    `${jar.currency}${Math.round(dep.amount)}`));
  headLine.appendChild(el('span', 'text-xs text-slate-500',
    `triggered by ${dep.triggeredByStreak}-day streak · ${dep.date}`));
  card.appendChild(headLine);

  const buttons = el('div', 'flex gap-2');
  const transferred = el('button', 'flex-1 rounded bg-emerald-500 text-slate-900 text-xs font-medium py-1.5');
  transferred.type = 'button';
  transferred.textContent = 'Transferred';
  transferred.addEventListener('click', () => callbacks.onResolve(dep.id, 'transferred'));
  buttons.appendChild(transferred);

  const partialBtn = el('button', 'flex-1 rounded bg-sky-500 text-slate-900 text-xs font-medium py-1.5');
  partialBtn.type = 'button';
  partialBtn.textContent = 'Partial';
  partialBtn.addEventListener('click', () => {
    const v = prompt(`Partial amount for ${jar.currency}${dep.amount}?`, '0');
    if (v == null) return;
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0 || num > dep.amount) {
      alert('Enter a number between 0 and ' + dep.amount);
      return;
    }
    callbacks.onResolve(dep.id, 'partial', num);
  });
  buttons.appendChild(partialBtn);

  const skip = el('button', 'flex-1 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs py-1.5');
  skip.type = 'button';
  skip.textContent = 'Skipped';
  skip.addEventListener('click', () => callbacks.onResolve(dep.id, 'skipped'));
  buttons.appendChild(skip);

  card.appendChild(buttons);
  return card;
}

// callbacks: onCancel, onSave({habit fields, jar fields or null})
// `existingJar` — if a jar already exists in v1, we hide the inline jar
// form (one jar per user) and don't allow re-linking.
export function renderAddHabit(root, callbacks, { existingJar = null } = {}) {
  const form = el('form', 'space-y-5');

  const header = el('div', 'flex items-center justify-between');
  header.appendChild(el('h2', 'text-lg font-semibold', 'Add habit'));
  const cancel = el('button', 'text-slate-400 hover:text-slate-100 text-sm disabled:opacity-40');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => callbacks.onCancel());
  header.appendChild(cancel);
  form.appendChild(header);

  form.appendChild(field('Name', textInput('name', { required: true, placeholder: 'e.g. push-ups', maxLength: 60 })));
  form.appendChild(field('Schedule', scheduleControl()));
  form.appendChild(field('Reminder time (optional)', timeInput('reminderTime')));
  form.appendChild(field('Minimum version', textInput('minimumVersion', { required: true, placeholder: 'e.g. 1 push-up', maxLength: 80 })));

  // Phase 5: optional savings jar. Only available when no jar exists yet
  // (v1 cap). When a jar exists, we show a small note pointing the user
  // at the jar that's already running.
  let jarSection = null;
  if (!existingJar) {
    jarSection = jarFormSection();
    form.appendChild(jarSection);
  } else {
    const note = el('div', 'rounded-lg border border-slate-700 bg-slate-800 p-3 text-xs text-slate-400');
    note.appendChild(el('span', '', `Savings jar "${existingJar.name}" is already linked to another habit. v1 supports one jar.`));
    form.appendChild(note);
  }

  const errorBox = el('p', 'text-rose-400 text-sm hidden');
  errorBox.dataset.role = 'error';
  form.appendChild(errorBox);

  const save = el('button', 'w-full rounded-lg bg-emerald-500 text-slate-900 py-3 font-semibold disabled:opacity-40');
  save.type = 'submit';
  save.textContent = 'Save habit';
  form.appendChild(save);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (save.disabled) return;
    const name = form.querySelector('input[name="name"]').value;
    const minimumVersion = form.querySelector('input[name="minimumVersion"]').value;
    const schedule = form.querySelector('input[name="schedule"]:checked')?.value;
    const customDays = Array.from(form.querySelectorAll('input[name="customDay"]:checked'))
      .map((i) => Number(i.value));
    const reminderTime = form.querySelector('input[name="reminderTime"]').value || null;

    let jar = null;
    if (jarSection) {
      const enabled = form.querySelector('input[name="jarEnabled"]')?.checked;
      if (enabled) {
        jar = {
          name: form.querySelector('input[name="jarName"]').value,
          targetAmount: form.querySelector('input[name="jarTarget"]').value,
          currency: form.querySelector('select[name="jarCurrency"]').value,
          streakLength: form.querySelector('input[name="jarStreakLength"]').value,
          amount: form.querySelector('input[name="jarAmount"]').value,
          monthlyCap: form.querySelector('input[name="jarMonthlyCap"]').value || null,
        };
      }
    }

    save.disabled = true;
    cancel.disabled = true;
    try {
      await callbacks.onSave({ name, schedule, customDays, reminderTime, minimumVersion, jar });
    } catch (err) {
      errorBox.textContent = err.message || String(err);
      errorBox.classList.remove('hidden');
      save.disabled = false;
      cancel.disabled = false;
    }
  });

  // One-shot swap.
  root.replaceChildren(form);
}

function jarFormSection() {
  const wrap = el('fieldset', 'space-y-3 rounded-lg border border-slate-700 bg-slate-800 p-3');
  const legend = el('legend', 'flex items-center gap-2 px-1 text-sm text-slate-300');
  const enableInput = document.createElement('input');
  enableInput.type = 'checkbox';
  enableInput.name = 'jarEnabled';
  enableInput.id = 'jar-enabled';
  enableInput.className = 'rounded';
  legend.appendChild(enableInput);
  const lbl = el('label', 'cursor-pointer', 'Link to a savings jar (optional)');
  lbl.htmlFor = 'jar-enabled';
  legend.appendChild(lbl);
  wrap.appendChild(legend);

  const inner = el('div', 'space-y-3 hidden');
  inner.dataset.role = 'jarFields';

  inner.appendChild(field('Jar name',
    textInput('jarName', { placeholder: 'e.g. Mac Studio', maxLength: 60, required: true })));

  const targetRow = el('div', 'grid grid-cols-3 gap-2');
  const currencySelect = document.createElement('select');
  currencySelect.name = 'jarCurrency';
  currencySelect.className = 'rounded-lg bg-slate-900 border border-slate-700 px-2 py-2 text-sm';
  for (const c of ['$', '₹', '€', '£']) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    currencySelect.appendChild(opt);
  }
  targetRow.appendChild(field('Currency', currencySelect));
  const targetInput = numberInput('jarTarget', { placeholder: '1000' });
  const targetCol = field('Target amount', targetInput);
  targetCol.classList.add('col-span-2');
  targetRow.appendChild(targetCol);
  inner.appendChild(targetRow);

  const ruleRow = el('div', 'grid grid-cols-2 gap-2');
  ruleRow.appendChild(field('Every N-day streak', numberInput('jarStreakLength', { placeholder: '7' })));
  ruleRow.appendChild(field('Deposit amount', numberInput('jarAmount', { placeholder: '500' })));
  inner.appendChild(ruleRow);

  inner.appendChild(field('Monthly cap (optional)', numberInput('jarMonthlyCap', { placeholder: 'leave blank for no cap' })));

  wrap.appendChild(inner);

  // Disabled fields are excluded from HTML5 validation, so toggling
  // `disabled` (rather than just `hidden`) keeps `required` from blocking
  // submit when the jar section is collapsed.
  function setJarFieldsEnabled(enabled) {
    for (const inp of inner.querySelectorAll('input, select')) {
      inp.disabled = !enabled;
    }
  }
  setJarFieldsEnabled(false);

  enableInput.addEventListener('change', () => {
    inner.classList.toggle('hidden', !enableInput.checked);
    setJarFieldsEnabled(enableInput.checked);
  });

  return wrap;
}

function numberInput(name, opts = {}) {
  const i = el('input', 'w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 focus:border-emerald-500 outline-none');
  i.type = 'number';
  i.name = name;
  i.min = '0';
  if (opts.placeholder) i.placeholder = opts.placeholder;
  return i;
}

// ---------- helpers ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function updateCoinPill(coins) {
  const pill = document.getElementById('coin-pill');
  if (pill) pill.textContent = `🪙 ${coins}`;
}

// Render or remove the in-app reminder banner. `due` is the array returned
// by dueRemindersToday() — each item carries `snoozesLeft`. Callbacks:
//   onSnooze(due) — snooze every habit in the list (cap-aware)
//   onDismiss(due) — dismiss every habit in the list for today
export function renderReminderBanner(due, callbacks) {
  const existing = document.getElementById('reminder-banner');
  if (existing) existing.remove();
  if (!due || due.length === 0) return;

  const banner = el('div',
    'fixed left-1/2 -translate-x-1/2 top-16 max-w-md w-[calc(100%-2rem)] z-40 ' +
    'rounded-lg bg-amber-500 text-slate-900 p-3 shadow-lg');
  banner.id = 'reminder-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  if (due.length === 1) {
    banner.appendChild(el('p', 'text-sm font-semibold', `Reminder: ${due[0].name}`));
    banner.appendChild(el('p', 'text-xs', `min: ${due[0].minimum} · was due ${due[0].reminderTime}`));
  } else {
    banner.appendChild(el('p', 'text-sm font-semibold', `${due.length} reminders due`));
    const list = due.map((d) => `${d.name} (${d.reminderTime})`).join(' · ');
    banner.appendChild(el('p', 'text-xs', list));
  }

  const actions = el('div', 'flex gap-2 mt-2');
  const allCapped = due.every((d) => (d.snoozesLeft || 0) <= 0);
  const snooze = el('button',
    'flex-1 rounded bg-amber-600 text-slate-100 text-xs font-medium py-1 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed');
  snooze.type = 'button';
  snooze.textContent = allCapped ? 'Snooze cap reached' : 'Snooze 10 min';
  snooze.disabled = allCapped;
  if (!allCapped) {
    snooze.addEventListener('click', () => callbacks.onSnooze(due));
  }
  actions.appendChild(snooze);

  const dismiss = el('button',
    'flex-1 rounded bg-slate-800 text-slate-100 text-xs font-medium py-1 hover:bg-slate-700');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss for today';
  dismiss.addEventListener('click', () => callbacks.onDismiss(due));
  actions.appendChild(dismiss);
  banner.appendChild(actions);

  document.body.appendChild(banner);
}

// Lightweight, self-removing toast. Stacks vertically if multiple are queued
// (one per call). aria-live polite so screen readers can read milestones.
let toastStackOffset = 0;
export function showToast(message, { tone = 'amber' } = {}) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-500 text-slate-900'
    : 'bg-amber-500 text-slate-900';
  const toast = el('div',
    `fixed left-1/2 -translate-x-1/2 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${toneClass}`);
  toast.style.top = `${72 + toastStackOffset}px`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  document.body.appendChild(toast);
  const offsetForThis = 48;
  toastStackOffset += offsetForThis;
  setTimeout(() => {
    toast.style.transition = 'opacity 200ms';
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
      toastStackOffset = Math.max(0, toastStackOffset - offsetForThis);
    }, 220);
  }, 2800);
}

function emptyFirstHabit() {
  const card = el('div', 'rounded-xl bg-slate-800 border border-slate-700 p-6 text-center mt-4');
  card.appendChild(el('p', 'text-slate-200 text-lg font-medium', 'Add your first habit'));
  card.appendChild(el('p', 'text-slate-400 text-sm mt-2', 'Tap the green + button to start.'));
  // Arrow pointing toward the FAB (bottom-right). aria-hidden — purely visual.
  const arrow = el('div', 'text-emerald-400 text-3xl mt-4 pr-2 text-right select-none', '↘');
  arrow.setAttribute('aria-hidden', 'true');
  card.appendChild(arrow);
  return card;
}

async function scheduledTomorrow() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDateString(tomorrow);
  const upcoming = await getHabitsScheduledForDate(tomorrowStr);
  const card = el('div', 'rounded-xl bg-slate-800 border border-slate-700 p-6 text-center mt-4');
  card.appendChild(el('p', 'text-slate-200 text-lg font-medium', 'Nothing scheduled today.'));
  if (upcoming.length === 0) {
    card.appendChild(el('p', 'text-slate-400 text-sm mt-2', 'Tomorrow is also clear.'));
  } else {
    card.appendChild(el('p', 'text-slate-400 text-sm mt-2',
      `Tomorrow: ${upcoming.map((h) => h.name).join(', ')}.`));
  }
  return card;
}

function habitCard(habit, completion, streak, callbacks) {
  const card = el('div', 'rounded-xl bg-slate-800 border border-slate-700 p-4');

  const titleRow = el('div', 'flex items-baseline justify-between');
  const titleLeft = el('div', 'flex items-baseline gap-2');
  titleLeft.appendChild(el('span', 'text-base font-medium text-slate-100', habit.name));
  // Always show the streak badge — the spec exit criteria explicitly tests
  // "streak resets to 0", and an invisible 0 hides the user's most
  // important feedback signal.
  const streakClass = streak > 0
    ? 'text-xs text-amber-300'
    : 'text-xs text-slate-500';
  titleLeft.appendChild(el('span', streakClass, `🔥 ${streak}`));
  titleRow.appendChild(titleLeft);
  titleRow.appendChild(el('span', 'text-xs text-slate-500', scheduleSummary(habit)));
  card.appendChild(titleRow);

  card.appendChild(el('p', 'text-xs text-slate-400 mb-3', `min: ${habit.minimumVersion}`));

  const buttons = el('div', 'flex gap-2');
  const allButtons = [];
  for (const action of ACTIONS) {
    const isActive = completion && completion.status === action.status;
    // Spec (02_DESIGN_DAY1.md L131): "Buttons disable after one is tapped;
    // tapping the active one again undoes it." So once a completion exists,
    // only the active button stays interactive. To switch, the user undoes
    // first.
    const isDisabledByCompletion = !!completion && !isActive;

    const base = 'flex-1 rounded-lg py-2 text-sm font-medium border transition select-none disabled:opacity-40 disabled:cursor-not-allowed';
    const activeStyle = action.accent === 'emerald'
      ? 'bg-emerald-500 text-slate-900 border-emerald-500'
      : action.accent === 'sky'
        ? 'bg-sky-500 text-slate-900 border-sky-500'
        : 'bg-slate-500 text-slate-900 border-slate-500';
    const idleStyle = action.accent === 'emerald'
      ? 'bg-slate-900 text-slate-200 border-slate-700 hover:border-emerald-500'
      : action.accent === 'sky'
        ? 'bg-slate-900 text-slate-200 border-slate-700 hover:border-sky-500'
        : 'bg-slate-900 text-slate-200 border-slate-700 hover:border-slate-400';
    const btn = el('button', `${base} ${isActive ? activeStyle : idleStyle}`);
    btn.type = 'button';
    btn.textContent = action.label;
    btn.disabled = isDisabledByCompletion;
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      // Single-flight: lock all 3 buttons in this card during the write so
      // rapid double-taps cannot race into a unique-index collision on
      // (habitId, date) or interleave switch + delete.
      for (const b of allButtons) b.disabled = true;
      try {
        await callbacks.onCompletion(habit.id, action.status);
        // refreshToday in the caller will rebuild this card.
      } catch (err) {
        console.error('[habit] completion write failed:', err);
        // Re-enable per the pre-click state so the user can retry.
        for (const b of allButtons) b.disabled = b.dataset.preDisabled === 'true';
        alert('Could not save: ' + (err.message || err));
      }
    });
    btn.dataset.preDisabled = String(isDisabledByCompletion);
    buttons.appendChild(btn);
    allButtons.push(btn);
  }
  card.appendChild(buttons);
  return card;
}

function scheduleSummary(habit) {
  if (habit.schedule === 'daily') return 'daily';
  if (habit.schedule === 'weekdays') return 'weekdays';
  if (habit.schedule === 'custom') {
    if (!Array.isArray(habit.customDays) || habit.customDays.length === 0) return 'custom';
    return habit.customDays.map((d) => DAY_LABELS[d].slice(0, 2)).join(' ');
  }
  return '';
}

function field(labelText, control) {
  const wrap = el('div');
  wrap.appendChild(el('div', 'block text-sm text-slate-400 mb-1', labelText));
  wrap.appendChild(control);
  return wrap;
}

function textInput(name, opts = {}) {
  const i = el('input', 'w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 focus:border-emerald-500 outline-none');
  i.type = 'text';
  i.name = name;
  if (opts.required) i.required = true;
  if (opts.placeholder) i.placeholder = opts.placeholder;
  if (opts.maxLength) i.maxLength = opts.maxLength;
  return i;
}

function timeInput(name) {
  const i = el('input', 'rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 focus:border-emerald-500 outline-none');
  i.type = 'time';
  i.name = name;
  return i;
}

function scheduleControl() {
  const wrap = el('div', 'space-y-2');

  const radios = el('div', 'flex gap-2');
  const options = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Weekdays' },
    { value: 'custom', label: 'Custom' },
  ];
  for (const opt of options) {
    const id = `sch-${opt.value}`;
    const cell = el('div', 'flex-1');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'schedule';
    input.value = opt.value;
    input.id = id;
    input.className = 'sr-only peer';
    if (opt.value === 'daily') input.checked = true;
    const lbl = el('label',
      'block text-center cursor-pointer rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm peer-checked:bg-emerald-500 peer-checked:text-slate-900 peer-checked:border-emerald-500',
      opt.label);
    lbl.htmlFor = id;
    cell.appendChild(input);
    cell.appendChild(lbl);
    radios.appendChild(cell);
  }
  wrap.appendChild(radios);

  const dayWrap = el('div', 'hidden grid-cols-7 gap-1');
  dayWrap.dataset.role = 'customDays';
  for (let i = 0; i < 7; i++) {
    const id = `cd-${i}`;
    const cell = el('div');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'customDay';
    input.value = String(i);
    input.id = id;
    input.className = 'sr-only peer';
    const lbl = el('label',
      'block text-center cursor-pointer rounded-md border border-slate-700 bg-slate-800 py-2 text-xs peer-checked:bg-emerald-500 peer-checked:text-slate-900 peer-checked:border-emerald-500',
      DAY_INITIAL[i]);
    lbl.htmlFor = id;
    cell.appendChild(input);
    cell.appendChild(lbl);
    dayWrap.appendChild(cell);
  }
  wrap.appendChild(dayWrap);

  wrap.addEventListener('change', (e) => {
    if (e.target.name === 'schedule') {
      const isCustom = e.target.value === 'custom';
      dayWrap.classList.toggle('hidden', !isCustom);
      dayWrap.classList.toggle('grid', isCustom);
    }
  });

  return wrap;
}
