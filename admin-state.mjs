export const ADMIN_ATTEMPT_KEY = "afterclass.admin.attempt.v1";

export function emptyLesson() {
  return {
    topic: "",
    location: "",
    price: "",
    space: 5,
    image: "/images/art.svg",
    teacherIds: [],
    description: "",
    ageGroup: "",
    durationMinutes: 60,
    outcomesText: "",
  };
}

export function lessonErrors(draft) {
  const errors = {};
  for (const key of ["topic", "location"])
    if (
      typeof draft[key] !== "string" ||
      !draft[key].trim() ||
      draft[key].trim().length > 100
    )
      errors[key] =
        "Enter " +
        (key === "topic" ? "a subject" : "a location") +
        " (up to 100 characters).";
  const price = Number(draft.price);
  if (
    draft.price === "" ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isSafeInteger(Math.round(price * 100)) ||
    Math.abs(price * 100 - Math.round(price * 100)) > 0.00001
  )
    errors.price =
      "Enter a nonnegative GBP price with up to two decimal places.";
  if (
    draft.space === "" ||
    !Number.isSafeInteger(Number(draft.space)) ||
    Number(draft.space) < 0
  )
    errors.space = "Enter a nonnegative whole number of spaces.";
  if (!/^\/images\/[a-z0-9-]+\.svg$/.test(draft.image))
    errors.image = "Choose a lesson illustration.";
  if (
    draft.description !== undefined &&
    (typeof draft.description !== "string" ||
      draft.description.trim().length > 2000)
  )
    errors.description = "Use up to 2,000 characters.";
  if (
    draft.ageGroup !== undefined &&
    (typeof draft.ageGroup !== "string" || draft.ageGroup.trim().length > 60)
  )
    errors.ageGroup = "Use up to 60 characters.";
  if (
    draft.durationMinutes !== undefined &&
    draft.durationMinutes !== "" &&
    draft.durationMinutes !== null &&
    (!Number.isInteger(Number(draft.durationMinutes)) ||
      Number(draft.durationMinutes) < 1 ||
      Number(draft.durationMinutes) > 480)
  )
    errors.durationMinutes = "Use 1–480 whole minutes, or leave blank.";
  const outcomes = (draft.outcomesText || "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  if (outcomes.length > 8 || outcomes.some((value) => value.length > 160))
    errors.outcomesText =
      "Use up to eight outcomes, each up to 160 characters.";
  return errors;
}

export function mutationAttempt(
  action,
  lesson,
  draft,
  requestId = crypto.randomUUID(),
) {
  const body = { requestId };
  const id = lesson?._id;
  if (action !== "create") body.revision = lesson.revision || 0;
  if (["create", "update"].includes(action)) {
    if (Object.keys(lessonErrors(draft)).length)
      throw new Error("Check the highlighted lesson details.");
    body.lesson = {
      topic: draft.topic.trim(),
      location: draft.location.trim(),
      price: Number(draft.price),
      space: Number(draft.space),
      image: draft.image,
      description: (draft.description || "").trim(),
      ageGroup: (draft.ageGroup || "").trim(),
      durationMinutes:
        draft.durationMinutes === "" || draft.durationMinutes == null
          ? null
          : Number(draft.durationMinutes),
      learningOutcomes: (draft.outcomesText || "")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    };
    body.teacherIds = [...draft.teacherIds];
  }
  return {
    entity: "lesson",
    action,
    method:
      action === "update" ? "PUT" : action === "delete" ? "DELETE" : "POST",
    path:
      "/admin/lessons" +
      (id ? "/" + id : "") +
      (action === "restore" ? "/restore" : ""),
    body,
  };
}

export function restoreAdminAttempt(storage) {
  try {
    const value = JSON.parse(storage.getItem(ADMIN_ATTEMPT_KEY) || "null");
    if (!value) return null;
    const methods = {
      create: "POST",
      update: "PUT",
      delete: "DELETE",
      restore: "POST",
    };
    if (
      methods[value.action] !== value.method ||
      !/^\/admin\/(?:lessons|teachers)(?:\/[a-f0-9]{24}(?:\/restore)?)?$/.test(
        value.path,
      ) ||
      !value.path.startsWith(
        (value.entity || "lesson") === "teacher"
          ? "/admin/teachers"
          : "/admin/lessons",
      ) ||
      !/^[a-f0-9-]{36}$/.test(value.body?.requestId)
    )
      throw new Error();
    return value;
  } catch {
    try {
      storage.removeItem(ADMIN_ATTEMPT_KEY);
    } catch {
      /* No usable storage. */
    }
    return null;
  }
}

export function createAdminClient(api, onExpired = () => {}) {
  let token = "";
  return {
    async login(username, password) {
      const session = await api("/admin/session", {
        method: "POST",
        form: true,
        body: { username, password },
      });
      if (
        !/^[a-f0-9]{64}$/.test(session.token) ||
        !Number.isFinite(Date.parse(session.expiresAt))
      )
        throw new Error("Sign-in response could not be verified.");
      token = session.token;
      return { username: session.username, expiresAt: session.expiresAt };
    },
    clear() {
      token = "";
    },
    async request(path, options = {}) {
      if (!token) throw new Error("Sign in to manage lessons.");
      try {
        return await api(path, { ...options, token });
      } catch (error) {
        if (error.status === 401) {
          token = "";
          onExpired();
        }
        throw error;
      }
    },
  };
}

export function saveAdminAttempt(storage, attempt) {
  try {
    storage.setItem(ADMIN_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    throw new Error(
      "Allow session storage to safely save and retry management changes.",
    );
  }
}

export async function submitAdminAttempt(client, attempt) {
  const result = await client.request(attempt.path, {
    method: attempt.method,
    body: attempt.body,
  });
  const expectedId = attempt.path.split("/")[3];
  const entity = attempt.entity === "teacher" ? "teacher" : "lesson";
  const record = result?.[entity];
  if (
    !record ||
    !/^[a-f0-9]{24}$/i.test(record._id) ||
    (expectedId && record._id !== expectedId) ||
    record.revision !== (attempt.body.revision || 0) + 1 ||
    record.deleted !== (attempt.action === "delete")
  ) {
    throw new Error(
      "The management change could not be verified. Retry the saved request to check its status.",
    );
  }
  return result;
}

export function emptyTeacher() {
  return {
    firstName: "",
    lastName: "",
    specialism: "",
    bio: "",
    lessonIds: [],
  };
}
export function teacherErrors(draft) {
  const errors = {};
  for (const key of ["firstName", "lastName"])
    if (
      typeof draft[key] !== "string" ||
      !/^[\p{L}\p{M}][\p{L}\p{M}'’ -]{0,59}$/u.test(draft[key].trim())
    )
      errors[key] =
        "Use letters, spaces, apostrophes or hyphens (up to 60 characters).";
  for (const [key, max] of [
    ["specialism", 100],
    ["bio", 2000],
  ])
    if (typeof draft[key] !== "string" || draft[key].trim().length > max)
      errors[key] = "Use up to " + max + " characters.";
  if (
    !Array.isArray(draft.lessonIds) ||
    draft.lessonIds.length > 100 ||
    new Set(draft.lessonIds).size !== draft.lessonIds.length
  )
    errors.lessonIds = "Choose up to 100 different lessons.";
  return errors;
}
export function teacherMutationAttempt(
  action,
  teacher,
  draft,
  requestId = crypto.randomUUID(),
) {
  const body = { requestId };
  if (action !== "create") body.revision = teacher.revision || 0;
  if (["create", "update"].includes(action)) {
    if (Object.keys(teacherErrors(draft)).length)
      throw new Error("Check the highlighted teacher details.");
    body.teacher = Object.fromEntries(
      ["firstName", "lastName", "specialism", "bio"].map((key) => [
        key,
        draft[key].trim(),
      ]),
    );
    body.lessonIds = [...draft.lessonIds];
  }
  return {
    entity: "teacher",
    action,
    method:
      action === "update" ? "PUT" : action === "delete" ? "DELETE" : "POST",
    path:
      "/admin/teachers" +
      (teacher?._id ? "/" + teacher._id : "") +
      (action === "restore" ? "/restore" : ""),
    body,
  };
}
