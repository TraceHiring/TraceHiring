// Storage wrapper: localStorage when it works, an in-memory map when it does not
// (private windows, blocked site data). Every access is wrapped in try/catch.
const memory = new Map();

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
  } catch {
    // fall through to memory
  }
  if (memory.has(key)) return structuredClone(memory.get(key));
  return fallback;
}

export function save(key, value) {
  memory.set(key, structuredClone(value));
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function storageAvailable() {
  try {
    const probe = '__trace_demo_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

// ---- device store: what stays on the candidate's device (stills, camera choice) ----
const DEVICE_KEY = 'trace-demo:device:v1';

export function getStill(id) {
  const device = load(DEVICE_KEY, { stills: {} });
  return device.stills?.[id] ?? null;
}

export function putStill(id, dataUrl) {
  const device = load(DEVICE_KEY, { stills: {} });
  device.stills = device.stills ?? {};
  device.stills[id] = dataUrl;
  // Keep the device store small: at most 60 stills.
  const ids = Object.keys(device.stills);
  if (ids.length > 60) for (const old of ids.slice(0, ids.length - 60)) delete device.stills[old];
  return save(DEVICE_KEY, device);
}

export function clearDevice() {
  remove(DEVICE_KEY);
}

// ---- UI preferences ----
const UI_KEY = 'trace-demo:ui:v1';

export function getUi() {
  return load(UI_KEY, { role: 'recruiter', reviewer: 'R1', tourStep: 0, tourOpen: false });
}

export function setUi(patch) {
  const next = { ...getUi(), ...patch };
  save(UI_KEY, next);
  return next;
}
