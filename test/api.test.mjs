import assert from "node:assert/strict";
import { test } from "node:test";
import { createApi, resolveApiBase } from "../api.mjs";

test("local defaults and hosted API addresses are safe origins", () => {
  assert.equal(
    resolveApiBase("", { hostname: "localhost" }),
    "http://localhost:3000",
  );
  assert.equal(
    resolveApiBase("https://afterclass.onrender.com/", {
      hostname: "example.github.io",
    }),
    "https://afterclass.onrender.com",
  );
  for (const value of [
    "",
    "http://localhost:3000",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com/?token=secret",
  ]) {
    assert.throws(() =>
      resolveApiBase(value, { hostname: "example.github.io" }),
    );
  }
});

test("POST and PUT send JSON and HTTP errors retain their status", async () => {
  const calls = [];
  const api = createApi("https://api.example", async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ error: "Availability changed." }), {
      status: 409,
    });
  });
  await assert.rejects(
    api("/orders", { method: "POST", body: { name: "Ava" } }),
    (error) => error.status === 409,
  );
  await assert.rejects(
    api("/lessons", { method: "PUT", body: { updates: [] } }),
    (error) => error.status === 409,
  );
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(calls[0].body).name, "Ava");
  assert.equal(calls[1].method, "PUT");
});

test("network failures and malformed success responses produce readable errors", async () => {
  await assert.rejects(
    createApi("", async () => {
      throw new TypeError("network");
    })("/lessons"),
    /Unable to reach/,
  );
  await assert.rejects(
    createApi("", async () => new Response("not json"))("/lessons"),
    /unexpected response/,
  );
});

test("bearer credentials are added only when explicitly supplied for a request", async () => {
  const calls = [];
  const api = createApi("https://api.example", async (_url, options) => {
    calls.push(options);
    return new Response("{}");
  });
  await api("/admin/lessons", { token: "private-session" });
  await api("/lessons");
  assert.equal(calls[0].headers.Authorization, "Bearer private-session");
  assert.equal(calls[1].headers.Authorization, undefined);
});

test('a failed GET is retried once with a fresh URL and no cached response', async () => {
  const calls = [];
  const api = createApi('https://api.example', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError('stalled connection');
    return new Response('[{"space":3}]');
  });
  assert.deepEqual(await api('/lessons?q=art'), [{ space: 3 }]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /q=art&_retry=\d+$/);
  assert.ok(calls.every(({ options }) => options.cache === 'no-store'));
});

test('timeouts retry only reads and stay within the overall budget', async () => {
  let calls = 0;
  const api = createApi('', async (_url, { signal }) => {
    calls++;
    if (calls === 2) return new Response('{}');
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true }));
  }, 100);
  assert.deepEqual(await api('/lessons'), {});
  assert.equal(calls, 2);
});

test('mutations, HTTP errors and cancelled reads are never automatically replayed', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    let calls = 0;
    await assert.rejects(createApi('', async () => { calls++; throw new TypeError('lost response'); })('/orders', { method }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(createApi('', async () => { calls++; return new Response('{"error":"Denied"}', { status: 401 }); })('/admin/lessons'), error => error.status === 401);
  assert.equal(calls, 1);
  const controller = new AbortController();
  await assert.rejects(createApi('', async () => { calls++; controller.abort(); throw new DOMException('cancel', 'AbortError'); })('/lessons', { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(calls, 2);
});

test('admin form encoding preserves special characters and does not attach browser credentials', async () => {
  let sent;
  const api = createApi('https://api.example', async (_url, options) => { sent = options; return new Response('{}'); });
  await api('/admin/session', { method: 'POST', form: true, body: { username: 'operator', password: 'test+&%=value' } });
  assert.equal(sent.headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sent.body)), { username: 'operator', password: 'test+&%=value' });
  assert.equal(sent.credentials, 'omit');
  await api('/orders', { method: 'POST', body: { name: 'Ava' } });
  assert.equal(sent.headers['Content-Type'], 'application/json');
  assert.equal(sent.body, '{"name":"Ava"}');
});
