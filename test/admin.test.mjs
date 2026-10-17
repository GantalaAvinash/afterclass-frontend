import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyLesson,
  lessonErrors,
  mutationAttempt,
  restoreAdminAttempt,
  createAdminClient,
  saveAdminAttempt,
  submitAdminAttempt,
} from "../admin-state.mjs";

const draft = {
  ...emptyLesson(),
  topic: "Robotics",
  location: "Hendon",
  price: "9.50",
  space: "5",
};

test("a lost admin response survives reload and retries exactly the saved mutation", async () => {
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key),
    removeItem: (key) => values.delete(key),
  };
  const attempt = mutationAttempt("create", null, draft);
  saveAdminAttempt(storage, attempt);
  const saved = new Map();
  let first = true;
  const client = {
    request: async (_path, { body }) => {
      if (!saved.has(body.requestId))
        saved.set(body.requestId, {
          lesson: {
            _id: "10000000000000000000000f",
            revision: 1,
            deleted: false,
          },
        });
      if (first) {
        first = false;
        throw new Error("Response lost after commit");
      }
      return saved.get(body.requestId);
    },
  };
  await assert.rejects(submitAdminAttempt(client, attempt), /Response lost/);
  const restored = restoreAdminAttempt(storage);
  assert.equal((await submitAdminAttempt(client, restored)).lesson.revision, 1);
  assert.equal(saved.size, 1);
  assert.equal(restored.body.requestId, attempt.body.requestId);
});

test("blocked storage and unverifiable admin success responses do not become confirmed changes", async () => {
  const attempt = mutationAttempt("create", null, draft);
  assert.throws(
    () =>
      saveAdminAttempt(
        {
          setItem() {
            throw new Error("blocked");
          },
        },
        attempt,
      ),
    /Allow session storage/,
  );
  for (const result of [
    {},
    {
      lesson: { _id: "10000000000000000000000f", revision: 9, deleted: false },
    },
  ]) {
    await assert.rejects(
      submitAdminAttempt({ request: async () => result }, attempt),
      /could not be verified/,
    );
  }
});
test("admin forms normalise numeric fields and require strict valid lesson values", () => {
  assert.deepEqual(lessonErrors(draft), {});
  for (const fields of [
    { topic: "" },
    { price: "-1" },
    { price: "9.111" },
    { price: "" },
    { space: "1.5" },
    { space: "" },
    { image: "https://example.com/a.svg" },
  ])
    assert.ok(Object.keys(lessonErrors({ ...draft, ...fields })).length);
  const attempt = mutationAttempt("create", null, draft);
  assert.equal(attempt.body.lesson.price, 9.5);
  assert.equal(attempt.body.lesson.space, 5);
  assert.equal(attempt.path, "/admin/lessons");
});
test("admin edits retain revision and retry IDs without serialising credentials", () => {
  const attempt = mutationAttempt(
    "update",
    { _id: "100000000000000000000001", revision: 7 },
    draft,
  );
  const restored = restoreAdminAttempt({
    getItem: () => JSON.stringify(attempt),
  });
  assert.deepEqual(restored, attempt);
  assert.equal(restored.body.revision, 7);
  assert.ok(!JSON.stringify(attempt).includes("token"));
  assert.equal(
    restoreAdminAttempt({
      getItem: () => JSON.stringify({ ...attempt, path: "/orders" }),
      removeItem() {},
    }),
    null,
  );
});
test("admin tokens stay in the client closure and clear on expiry or sign-out", async () => {
  const calls = [];
  let expired = false;
  const client = createAdminClient(
    async (path, options) => {
      calls.push({ path, options });
      if (path === "/health") return { status: "ok", database: "connected" };
      if (path === "/admin/session")
        return {
          token: "a".repeat(64),
          username: "operator",
          expiresAt: "2026-10-16T20:00:00Z",
        };
      if (path === "/admin/expired")
        throw Object.assign(new Error("expired"), { status: 401 });
      return {};
    },
    () => {
      expired = true;
    },
  );
  await assert.rejects(client.request("/admin/lessons"), /Sign in/);
  const session = await client.login("operator", "private-password");
  assert.equal(session.token, undefined);
  await client.request("/admin/lessons");
  assert.equal(calls[2].options.token, "a".repeat(64));
  await assert.rejects(client.request("/admin/expired"));
  assert.equal(expired, true);
  await assert.rejects(client.request("/admin/lessons"), /Sign in/);
  await client.login("operator", "private-password");
  client.clear();
  await assert.rejects(client.request("/admin/lessons"), /Sign in/);
});

test("admin sign-in verifies the browser connection before sending a password and does not replay login", async () => {
  const calls = [], stages = [];
  const client = createAdminClient(async (path, options) => {
    calls.push({ path, options });
    if (path === "/health") return { status: "ok", database: "connected" };
    throw new Error("connection failed");
  });
  await assert.rejects(client.login("operator", "private-password", stage => stages.push(stage)), /connection failed/);
  assert.deepEqual(calls.map(call => call.path), ["/health", "/admin/session"]);
  assert.equal(calls[0].options, undefined);
  assert.equal(calls[1].options.form, true);
  assert.deepEqual(stages, ["Connecting to Studio…", "Checking your credentials…"]);
  const unavailableCalls = [];
  const unavailable = createAdminClient(async path => { unavailableCalls.push(path); return { status: "unavailable" }; });
  await assert.rejects(unavailable.login("operator", "private-password"), /temporarily unavailable/);
  assert.deepEqual(unavailableCalls, ["/health"]);
});
