// Minimal DOM helpers. No innerHTML anywhere: text always goes in through textContent.
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'style') continue; // CSP: no inline styles
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (PROPS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(el, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Null-safe replaceChildren. */
export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let idCounter = 0;
export function uid(prefix = 'f') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** A labelled form field. `control` is an input/select/textarea element. */
export function field(label, control, hint) {
  const id = control.id || uid('field');
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id, class: 'field-label' }, label),
    control,
    hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null,
  );
}

/** Sets a bar's width through CSSOM (allowed by CSP, unlike inline style attributes). */
export function bar(value, max, tone = '') {
  const fill = h('span', { class: 'bar-fill' });
  fill.style.width = `${Math.max(0, Math.min(100, (100 * value) / (max || 1)))}%`;
  return h('span', { class: `bar ${tone}`, 'aria-hidden': 'true' }, fill);
}

export function pill(text, tone = 'neutral', extra = {}) {
  return h('span', { class: `pill pill-${tone}`, ...extra }, text);
}

export function toast(message, tone = 'info') {
  const region = document.getElementById('toasts');
  if (!region) return;
  const node = h('div', { class: `toast toast-${tone}`, role: 'status' }, message);
  region.append(node);
  setTimeout(() => node.classList.add('toast-out'), 3200);
  setTimeout(() => node.remove(), 3700);
}

/** Opens a native <dialog>. Returns the dialog; it removes itself on close. */
export function openDialog(title, body, { actions = [], wide = false, onClose } = {}) {
  const headingId = uid('dlg');
  const closeBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Close');
  const dialog = h(
    'dialog',
    { class: `dialog${wide ? ' dialog-wide' : ''}`, 'aria-labelledby': headingId },
    h('div', { class: 'dialog-head' }, h('h2', { id: headingId, class: 'h3' }, title), closeBtn),
    h('div', { class: 'dialog-body' }, body),
    actions.length ? h('div', { class: 'dialog-actions' }, actions) : null,
  );
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    onClose?.();
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

export function confirmDialog(title, message, confirmLabel = 'Confirm', tone = 'primary') {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: `btn btn-${tone}`, type: 'button' }, confirmLabel);
    const cancel = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Cancel');
    const dlg = openDialog(title, h('p', {}, message), {
      actions: [cancel, ok],
      onClose: () => resolve(result),
    });
    ok.addEventListener('click', () => {
      result = true;
      dlg.close();
    });
    cancel.addEventListener('click', () => dlg.close());
  });
}
