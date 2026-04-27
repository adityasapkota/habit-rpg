// Render functions for each screen. Each one fully replaces the contents of
// the passed root element. Build via DOM API (not innerHTML) so user-supplied
// strings can never become HTML.
import {
  listHabits,
  getHabitsScheduledForDate,
  getCompletionForDate,
  todayString,
  localDateString,
} from './habits.js';
import { getUserState } from './db.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const ACTIONS = [
  { label: 'Done', status: 'completed', accent: 'emerald' },
  { label: 'Min', status: 'minimum', accent: 'sky' },
  { label: 'Skip', status: 'missed', accent: 'slate' },
];

export async function renderToday(root, callbacks) {
  root.replaceChildren();

  const userState = await getUserState();
  updateCoinPill(userState.coinBalance);

  const date = todayString();
  const allHabits = await listHabits();
  const scheduled = await getHabitsScheduledForDate(date);

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
      const completion = await getCompletionForDate(habit.id, date);
      list.appendChild(habitCard(habit, completion, callbacks));
    }
    wrap.appendChild(list);
  }

  root.appendChild(wrap);
}

export function renderAddHabit(root, callbacks) {
  root.replaceChildren();

  const form = el('form', 'space-y-5');

  const header = el('div', 'flex items-center justify-between');
  header.appendChild(el('h2', 'text-lg font-semibold', 'Add habit'));
  const cancel = el('button', 'text-slate-400 hover:text-slate-100 text-sm');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => callbacks.onCancel());
  header.appendChild(cancel);
  form.appendChild(header);

  form.appendChild(field('Name', textInput('name', { required: true, placeholder: 'e.g. push-ups', maxLength: 60 })));
  form.appendChild(field('Schedule', scheduleControl()));
  form.appendChild(field('Reminder time (optional)', timeInput('reminderTime')));
  form.appendChild(field('Minimum version', textInput('minimumVersion', { required: true, placeholder: 'e.g. 1 push-up', maxLength: 80 })));

  const errorBox = el('p', 'text-rose-400 text-sm hidden');
  errorBox.dataset.role = 'error';
  form.appendChild(errorBox);

  const save = el('button', 'w-full rounded-lg bg-emerald-500 text-slate-900 py-3 font-semibold disabled:opacity-40');
  save.type = 'submit';
  save.textContent = 'Save habit';
  form.appendChild(save);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = form.querySelector('input[name="name"]').value;
    const minimumVersion = form.querySelector('input[name="minimumVersion"]').value;
    const schedule = form.querySelector('input[name="schedule"]:checked')?.value;
    const customDays = Array.from(form.querySelectorAll('input[name="customDay"]:checked'))
      .map((i) => Number(i.value));
    const reminderTime = form.querySelector('input[name="reminderTime"]').value || null;
    save.disabled = true;
    try {
      await callbacks.onSave({ name, schedule, customDays, reminderTime, minimumVersion });
    } catch (err) {
      errorBox.textContent = err.message || String(err);
      errorBox.classList.remove('hidden');
      save.disabled = false;
    }
  });

  root.appendChild(form);
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

function emptyFirstHabit() {
  const card = el('div', 'rounded-xl bg-slate-800 border border-slate-700 p-6 text-center mt-4');
  card.appendChild(el('p', 'text-slate-200 text-lg font-medium', 'Add your first habit'));
  card.appendChild(el('p', 'text-slate-400 text-sm mt-2', 'Tap the green + button to start.'));
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

function habitCard(habit, completion, callbacks) {
  const card = el('div', 'rounded-xl bg-slate-800 border border-slate-700 p-4');

  const titleRow = el('div', 'flex items-baseline justify-between');
  titleRow.appendChild(el('span', 'text-base font-medium text-slate-100', habit.name));
  titleRow.appendChild(el('span', 'text-xs text-slate-500', scheduleSummary(habit)));
  card.appendChild(titleRow);

  card.appendChild(el('p', 'text-xs text-slate-400 mb-3', `min: ${habit.minimumVersion}`));

  const buttons = el('div', 'flex gap-2');
  for (const action of ACTIONS) {
    const isActive = completion && completion.status === action.status;
    const base = 'flex-1 rounded-lg py-2 text-sm font-medium border transition select-none';
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
    btn.addEventListener('click', () => callbacks.onCompletion(habit.id, action.status));
    buttons.appendChild(btn);
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
