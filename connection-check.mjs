import { resolveApiBase } from './api.mjs?v=20261017-transport1';

const base = resolveApiBase(window.AFTERCLASS_CONFIG?.apiBaseUrl, window.location);
const status = document.getElementById('status');
const results = document.getElementById('results');
const input = id => document.getElementById(id);
let running = false;
const number = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : null;
function render(row) {
  const tr = document.createElement('tr');
  for (const value of [row.run, row.method + ' ' + row.path, row.status, row.protocol || 'unavailable', row.totalMs, row.beforeRequestMs, row.responseWaitMs, row.appMs, row.passwordMs, row.result]) {
    const td = document.createElement('td'); td.textContent = value ?? '—'; tr.append(td);
  }
  // Allowlisted diagnostic fields only: no request bodies or response payloads.
  tr.dataset.requestId = row.requestId || '';
  results.append(tr);
}
async function measured(path, { run, method = 'GET', body, token, encoding = 'form', credentials = 'omit' }) {
  const url = base + path;
  const start = performance.now();
  try {
    const response = await fetch(url, {
      method, credentials, cache: 'no-store', signal: AbortSignal.timeout(90000),
      headers: {
        ...(body ? { 'Content-Type': encoding === 'form' ? 'application/x-www-form-urlencoded;charset=UTF-8' : 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: encoding === 'form' ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    const entry = performance.getEntriesByName(url).at(-1);
    const timing = Object.fromEntries([...response.headers.get('server-timing')?.matchAll(/([a-z_]+);dur=([\d.]+)/g) || []].map(match => [match[1], Number(match[2])]));
    const row = {
      run, method, path: new URL(url).pathname, status: response.status,
      protocol: entry?.nextHopProtocol, totalMs: number(performance.now() - start),
      beforeRequestMs: entry?.requestStart > 0 ? number(entry.requestStart - entry.startTime) : null,
      responseWaitMs: entry?.requestStart > 0 ? number(entry.responseStart - entry.requestStart) : null,
      appMs: timing.app, passwordMs: timing.password, requestId: response.headers.get('x-request-id'),
      result: !response.ok ? 'HTTP error' : Array.isArray(data) ? data.length + ' records' : data.lessons ? data.lessons.length + ' lessons' : data.signedOut ? 'Signed out' : data.stats ? 'Overview loaded' : 'Success',
    };
    render(row);
    if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + new URL(url).pathname);
    return data;
  } catch (error) {
    if (!/^HTTP /.test(error.message)) render({ run, method, path: new URL(url).pathname, status: 'Failed', totalMs: number(performance.now() - start), result: error.name === 'TimeoutError' ? 'Timeout' : 'Connection failed' });
    throw error;
  }
}
async function task(operation) {
  if (running) return;
  running = true;
  for (const el of document.querySelectorAll('button,input,select')) el.disabled = true;
  try { await operation(); status.textContent = 'Checks completed. No business data changed.'; }
  catch (error) { status.textContent = 'Check stopped: ' + error.message + '. No automatic retry was made.'; }
  finally { running = false; for (const el of document.querySelectorAll('button,input,select')) el.disabled = false; }
}
input('public-check').addEventListener('click', () => {
  const credentials = input('credentials-mode').value;
  task(async () => {
    for (let run = 1; run <= 5; run++) {
      status.textContent = 'Public check ' + run + ' of 5…';
      const lessons = await measured('/lessons', { run, credentials });
      const teachers = await measured('/teachers', { run, credentials });
      if (!Array.isArray(lessons) || lessons.length < 12 || !Array.isArray(teachers) || teachers.length < 4) throw new Error('The seeded catalogue or teaching team is incomplete');
    }
  });
});
input('login-check').addEventListener('click', () => {
  const username = input('username').value;
  let password = input('password').value;
  if (!username || !password) { status.textContent = 'Enter your existing admin credentials.'; return; }
  const count = Math.min(3, Math.max(1, Number(input('repetitions').value)));
  const encoding = input('encoding').value, credentials = input('credentials-mode').value;
  input('password').value = '';
  task(async () => {
    try {
      for (let run = 1; run <= count; run++) {
        status.textContent = 'Sign-in check ' + run + ' of ' + count + '…';
        // A unique non-secret URL prevents a previous preflight permission from
        // hiding the JSON/form comparison. Tokens are never in a URL or result.
        const session = await measured('/admin/session?probe=' + crypto.randomUUID(), { run, method: 'POST', body: { username, password }, encoding, credentials });
        if (!/^[a-f0-9]{64}$/.test(session.token)) throw new Error('Invalid session response');
        try {
          const checks = await Promise.allSettled(['/admin/lessons','/admin/teachers','/admin/overview'].map(path => measured(path, { run, token: session.token, credentials })));
          const failed = checks.find(check => check.status === 'rejected');
          if (failed) throw failed.reason;
        } finally { await measured('/admin/session', { run, method: 'DELETE', token: session.token, credentials }); }
      }
    } finally { password = ''; }
  });
});
