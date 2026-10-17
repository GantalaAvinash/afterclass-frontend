import { createApp } from "./vendor/vue.esm-browser.prod.js";
import { createApi, resolveApiBase } from "./api.mjs?v=20261017-cart1";
import { formatPrice } from "./state.mjs";
import {
  emptyLesson,
  lessonErrors,
  mutationAttempt,
  restoreAdminAttempt,
  createAdminClient,
  saveAdminAttempt,
  submitAdminAttempt,
  ADMIN_ATTEMPT_KEY,
  emptyTeacher,
  teacherErrors,
  teacherMutationAttempt,
} from "./admin-state.mjs";

createApp({
  data: () => ({
    client: null,
    base: "",
    session: null,
    username: "",
    password: "",
    busy: false,
    error: "",
    notice: "",
    loading: false,
    lessons: [],
    teachers: [],
    images: [],
    overview: null,
    tab: "lessons",
    search: "",
    status: "active",
    editing: null,
    editorOpen: false,
    draft: emptyLesson(),
    touched: false,
    pending: null,
    storage: null,
    expiryTimer: null,
    deleteTarget: null,
    deleteEntity: "lesson",
    teacherEditing: null,
    teacherEditorOpen: false,
    teacherDraft: emptyTeacher(),
    teacherTouched: false,
    teacherSearch: "",
    teacherStatus: "active",
    testPreview: window.AFTERCLASS_CONFIG?.testPreview === true,
  }),
  computed: {
    tabLabel() {
      return {
        lessons: "Lesson library",
        teachers: "Teaching team",
        insights: "Booking insights",
      }[this.tab];
    },
    tabTitle() {
      return {
        lessons: "Your lesson library.",
        teachers: "The people behind the spark.",
        insights: "A clearer picture.",
      }[this.tab];
    },
    tabDescription() {
      return {
        lessons: "Create possibilities. Keep every detail in good shape.",
        teachers:
          "Create profiles and connect each teacher with their lessons.",
        insights:
          "Confirmed bookings, real quantities and a useful view of availability.",
      }[this.tab];
    },
    activeTeachers() {
      return this.teachers.filter((teacher) => !teacher.deleted);
    },
    teacherValidation() {
      return teacherErrors(this.teacherDraft);
    },
    deleteTargetName() {
      return this.deleteEntity === "teacher"
        ? (this.deleteTarget?.firstName || "") +
            " " +
            (this.deleteTarget?.lastName || "")
        : this.deleteTarget?.topic;
    },
    filteredTeachers() {
      const term = this.teacherSearch.trim().toLocaleLowerCase("en-GB");
      return this.teachers.filter(
        (teacher) =>
          (this.teacherStatus === "all" ||
            (teacher.deleted === true) ===
              (this.teacherStatus === "deleted")) &&
          [teacher.firstName, teacher.lastName, teacher.specialism || ""].some(
            (value) => value.toLocaleLowerCase("en-GB").includes(term),
          ),
      );
    },
    errors() {
      return lessonErrors(this.draft);
    },
    filteredLessons() {
      const term = this.search.trim().toLocaleLowerCase("en-GB");
      return this.lessons.filter(
        (lesson) =>
          (this.status === "all" ||
            (lesson.deleted === true) === (this.status === "deleted")) &&
          [lesson.topic, lesson.location].some((value) =>
            value.toLocaleLowerCase("en-GB").includes(term),
          ),
      );
    },
    lowStock() {
      return this.lessons.filter(
        (lesson) => !lesson.deleted && lesson.space <= 2,
      );
    },
    maxPurchased() {
      return Math.max(
        1,
        ...(this.overview?.lessons || []).map((lesson) => lesson.purchased),
      );
    },
  },
  methods: {
    formatPrice,
    date(value) {
      return new Date(value).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    },
    teacherNames(lesson) {
      return (
        this.teachers
          .filter(
            (teacher) =>
              !teacher.deleted && lesson.teacherIds.includes(teacher._id),
          )
          .map((teacher) => teacher.firstName + " " + teacher.lastName)
          .join(", ") || "No teacher assigned"
      );
    },
    expire() {
      this.client?.clear();
      this.session = null;
      clearTimeout(this.expiryTimer);
      this.lessons = [];
      this.overview = null;
      this.editorOpen = false;
      this.teacherEditorOpen = false;
      this.teachers = [];
      document.getElementById("delete-dialog")?.close();
      this.deleteTarget = null;
      this.error = "Your admin session has ended. Sign in again to continue.";
    },
    async login() {
      if (this.busy || !this.username || !this.password || !this.client) return;
      this.busy = true;
      this.error = "";
      try {
        this.session = await this.client.login(this.username, this.password);
        this.password = "";
        clearTimeout(this.expiryTimer);
        this.expiryTimer = setTimeout(
          () => this.expire(),
          Math.max(0, Date.parse(this.session.expiresAt) - Date.now()),
        );
        await this.load();
        this.$nextTick(() => document.getElementById("admin-main")?.focus());
      } catch (error) {
        this.error = error.message;
        this.password = "";
      } finally {
        this.busy = false;
      }
    },
    async logout() {
      this.busy = true;
      try {
        await this.client.request("/admin/session", { method: "DELETE" });
        this.expire();
        this.error = "";
      } catch (error) {
        this.error = "Sign-out could not be verified. " + error.message;
      } finally {
        this.busy = false;
      }
    },
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const [catalogue, teachers, overview] = await Promise.all([
          this.client.request("/admin/lessons"),
          this.client.request("/admin/teachers"),
          this.client.request("/admin/overview"),
        ]);
        if (!this.session) return;
        this.lessons = catalogue.lessons;
        this.images = catalogue.images;
        this.teachers = teachers;
        this.overview = overview;
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    },
    openEditor(lesson = null) {
      if (this.pending || this.busy) return;
      this.editing = lesson;
      this.draft = lesson
        ? {
            topic: lesson.topic,
            location: lesson.location,
            price: lesson.price,
            space: lesson.space,
            image: lesson.image,
            teacherIds: [...lesson.teacherIds],
            description: lesson.description || "",
            ageGroup: lesson.ageGroup || "",
            durationMinutes: lesson.durationMinutes ?? "",
            outcomesText: (lesson.learningOutcomes || []).join("\n"),
          }
        : emptyLesson();
      this.touched = false;
      this.error = "";
      this.notice = "";
      this.editorOpen = true;
      this.$nextTick(() => {
        document
          .getElementById("lesson-editor")
          ?.scrollIntoView({ block: "start" });
        document.getElementById("admin-topic")?.focus();
      });
    },
    closeEditor() {
      this.editorOpen = false;
      this.editing = null;
      this.$nextTick(() => document.getElementById("admin-main")?.focus());
    },
    async save() {
      this.touched = true;
      if (this.busy || this.pending || Object.keys(this.errors).length) return;
      await this.perform(
        mutationAttempt(
          this.editing ? "update" : "create",
          this.editing,
          this.draft,
        ),
      );
    },
    askDelete(lesson, entity = "lesson") {
      this.deleteEntity = entity;
      this.deleteTarget = lesson;
      this.$nextTick(() =>
        document.getElementById("delete-dialog")?.showModal(),
      );
    },
    cancelDelete() {
      document.getElementById("delete-dialog")?.close();
      this.deleteTarget = null;
    },
    async confirmDelete() {
      const lesson = this.deleteTarget;
      this.cancelDelete();
      if (lesson)
        await this.perform(
          this.deleteEntity === "teacher"
            ? teacherMutationAttempt("delete", lesson)
            : mutationAttempt("delete", lesson),
        );
    },
    restore(lesson) {
      return this.perform(mutationAttempt("restore", lesson));
    },
    openTeacherEditor(teacher = null) {
      if (this.pending || this.busy) return;
      this.teacherEditing = teacher;
      this.teacherDraft = teacher
        ? {
            firstName: teacher.firstName,
            lastName: teacher.lastName,
            specialism: teacher.specialism || "",
            bio: teacher.bio || "",
            lessonIds: [...teacher.lessonIds],
          }
        : emptyTeacher();
      this.teacherTouched = false;
      this.teacherEditorOpen = true;
      this.error = "";
      this.notice = "";
      this.$nextTick(() => {
        document
          .getElementById("teacher-editor")
          ?.scrollIntoView({ block: "start" });
        document.getElementById("teacher-firstName")?.focus();
      });
    },
    closeTeacherEditor() {
      this.teacherEditorOpen = false;
      this.teacherEditing = null;
      this.$nextTick(() => document.getElementById("admin-main")?.focus());
    },
    saveTeacher() {
      this.teacherTouched = true;
      if (this.busy || this.pending) return;
      const invalidField = Object.keys(this.teacherValidation)[0];
      if (invalidField) {
        // The submit button can be below the fold on phones. Bring the error
        // into view through the field's normal keyboard focus behaviour.
        this.$nextTick(() =>
          document
            .getElementById(
              invalidField === "lessonIds"
                ? "teacher-firstName"
                : "teacher-" + invalidField,
            )
            ?.focus(),
        );
        return;
      }
      return this.perform(
        teacherMutationAttempt(
          this.teacherEditing ? "update" : "create",
          this.teacherEditing,
          this.teacherDraft,
        ),
      );
    },
    restoreTeacher(teacher) {
      return this.perform(teacherMutationAttempt("restore", teacher));
    },
    assignedLessons(teacher) {
      return this.lessons.filter((lesson) =>
        teacher.lessonIds.includes(lesson._id),
      );
    },
    async perform(attempt = this.pending) {
      if (this.busy || !attempt) return;
      this.busy = true;
      this.error = "";
      this.notice = "";
      try {
        // Persist only management changes and a request ID. The session token and
        // password never enter browser storage. The token stays in a closure;
        // the password field is cleared immediately after every login attempt.
        if (!this.storage)
          throw new Error(
            "Allow session storage to safely save and retry management changes.",
          );
        saveAdminAttempt(this.storage, attempt);
        this.pending = attempt;
        await submitAdminAttempt(this.client, attempt);
        this.clearPending();
        this.closeEditor();
        this.closeTeacherEditor();
        this.notice = {
          create: "Lesson created.",
          update: "Lesson updated.",
          delete:
            "Lesson deleted from the public catalogue. Purchase history is preserved.",
          restore: "Lesson restored to the public catalogue.",
        }[attempt.action];
        if (attempt.entity === "teacher")
          this.notice = {
            create: "Teacher created and lessons assigned.",
            update: "Teacher profile and assignments updated.",
            delete:
              "Teacher removed from public profiles and filters. Lesson stock and purchase history are preserved.",
            restore: "Teacher restored with their lesson assignments.",
          }[attempt.action];
        await this.load();
      } catch (error) {
        this.error = error.message;
        if ([400, 404, 409].includes(error.status)) {
          this.clearPending();
          await this.load();
          this.error = error.message;
        }
      } finally {
        this.busy = false;
      }
    },
    clearPending() {
      this.pending = null;
      try {
        this.storage?.removeItem(ADMIN_ATTEMPT_KEY);
      } catch {
        /* No credential is stored here. */
      }
    },
  },
  mounted() {
    try {
      this.base = resolveApiBase(
        window.AFTERCLASS_CONFIG?.apiBaseUrl,
        window.location,
      );
      this.client = createAdminClient(createApi(this.base), () =>
        this.expire(),
      );
      try {
        this.storage = window.sessionStorage;
        this.pending = restoreAdminAttempt(this.storage);
      } catch {
        /* Mutations fail closed if storage is blocked. */
      }
    } catch (error) {
      this.error = error.message;
    }
  },
  beforeUnmount() {
    clearTimeout(this.expiryTimer);
    this.client?.clear();
  },
}).mount("#admin-app");
