import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAttempt, restoreAttempt, saveAttempt, submitAttempt, STORAGE_KEY } from '../checkout.mjs';

const id = '100000000000000000000001';
const orderId = '300000000000000000000001';
const attempt = () => createAttempt('Ava', '007123', [{ _id: id, quantity: 2 }], '00000000-0000-4000-8000-000000000001');
const response = { orderId, status: 'pending', updates: [{ lessonId: id, changes: { space: 3 } }] };
function storage() {
  const map = new Map();
  return { getItem: (key) => map.get(key), setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}

test('reload recovers the same request ID and contact data, but rechecks server status', () => {
  const store = storage(), draft = attempt();
  draft.order = response;
  saveAttempt(store, draft);
  const restored = restoreAttempt(store);
  assert.equal(restored.payload.requestId, draft.payload.requestId);
  assert.equal(restored.payload.phone, '007123');
  assert.equal(restored.order, null);
  store.setItem(STORAGE_KEY, '{invalid');
  assert.equal(restoreAttempt(store), null);
});

test('a lost POST response retries the same payload without a new checkout ID', async () => {
  const draft = attempt(), posts = [];
  const api = async (_path, { method, body }) => {
    if (method === 'POST') { posts.push(body.requestId); if (posts.length === 1) throw new Error('Lost response'); return response; }
    return { orderId, status: 'confirmed' };
  };
  await assert.rejects(submitAttempt(api, draft, () => {}), /Lost response/);
  assert.equal((await submitAttempt(api, draft, () => {})).status, 'confirmed');
  assert.equal(posts.length, 2);
  assert.equal(posts[0], posts[1]);
});

test('a lost PUT response retries the existing order and sends absolute spaces', async () => {
  const draft = attempt(); let posts = 0, puts = 0;
  const api = async (_path, { method, body }) => {
    if (method === 'POST') { posts++; return response; }
    puts++; assert.equal(body.updates[0].changes.space, 3);
    if (puts === 1) throw new Error('Lost response');
    return { orderId, status: 'confirmed' };
  };
  await assert.rejects(submitAttempt(api, draft, () => {}));
  await submitAttempt(api, draft, () => {});
  assert.equal(posts, 1);
  assert.equal(puts, 2);
});

test('already confirmed POST replay skips PUT and invalid confirmation is not success', async () => {
  const draft = attempt(); let calls = 0;
  const result = await submitAttempt(async () => { calls++; return { ...response, status: 'confirmed' }; }, draft, () => {});
  assert.equal(result.status, 'confirmed'); assert.equal(calls, 1);
  await assert.rejects(submitAttempt(async (_path, { method }) => method === 'POST' ? response : { status: 'pending' }, attempt(), () => {}), /could not be verified/);
});

test('blocked session storage prevents the submission from proceeding', () => {
  assert.throws(() => saveAttempt({ setItem: () => { throw new Error('Quota'); } }, attempt()), /could not save/);
});

test('optional email survives reload and retries while legacy attempts remain unchanged', () => {
  const store = storage();
  const draft = createAttempt('Ava', '007123', [{ _id: id, quantity: 3 }], attempt().payload.requestId, ' Ava@example.test ');
  saveAttempt(store, draft);
  assert.deepEqual(restoreAttempt(store).payload, draft.payload);
  assert.equal(draft.payload.email, 'Ava@example.test');
  assert.equal(draft.payload.phone, '007123');
  assert.equal(draft.payload.items[0].quantity, 3);
  saveAttempt(store, attempt());
  assert.equal(Object.hasOwn(restoreAttempt(store).payload, 'email'), false);
  for (const email of ['broken', 'a@@example.test', 'a b@example.test', 123, 'a'.repeat(255)]) {
    assert.throws(() => createAttempt('Ava', '007123', [{ _id: id, quantity: 1 }], attempt().payload.requestId, email));
  }
  store.setItem(STORAGE_KEY, JSON.stringify({ ...draft, payload: { ...draft.payload, email: 'broken' } }));
  assert.equal(restoreAttempt(store), null);
});
