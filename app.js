import { createApp } from "./vendor/vue.esm-browser.prod.js";
import { createApi, resolveApiBase } from "./api.mjs?v=20261017-transport2";
import {
  sortLessons,
  formatPrice,
  changeCart,
  cartLines,
  contactErrors,
  emailError,
  availableSpace,
} from "./state.mjs?v=20261017-cart1";
import {
  createAttempt,
  restoreAttempt,
  saveAttempt,
  submitAttempt,
  STORAGE_KEY,
} from "./checkout.mjs?v=20261017-cart1";
import {
  category,
  artTone,
  discoveryFilter,
  restoreSaved,
  SAVED_KEY,
} from "./discovery.mjs";
import {
  lessonHash,
  lessonRoute,
  createLessonLoader,
} from "./lesson-route.mjs";

createApp({
  data() {
    return {
      lessons: {},
      resultIds: [],
      cart: {},
      loading: true,
      error: "",
      api: null,
      apiBase: "",
      sortField: "topic",
      sortDirection: "asc",
      announcement: "",
      toast: "",
      toastTimer: null,
      view: "catalogue",
      busy: false,
      name: "",
      phone: "",
      email: "",
      touched: false,
      checkoutError: "",
      confirmation: "",
      attempt: null,
      storage: null,
      searchTerm: "",
      teacherId: "",
      teachers: [],
      teacherError: "",
      searchTimer: null,
      searchController: null,
      requestVersion: 0,
      enrolments: {},
      enrolmentErrors: {},
      enrolmentBusy: {},
      imageFailures: {},
      testPreview: window.AFTERCLASS_CONFIG?.testPreview === true,
      savedIds: [],
      savedOnly: false,
      availableOnly: false,
      selectedCategory: "",
      detailId: null,
      detailData: null,
      detailLoading: false,
      detailError: "",
      detailLoader: null,
      routeListener: null,
    };
  },
  computed: {
    detailLesson() {
      if (!this.detailData) return null;
      const lesson = this.lessons[this.detailId] || this.detailData.lesson;
      return { ...lesson, available: availableSpace(lesson, this.cart) };
    },
    visibleLessons() {
      return discoveryFilter(
        sortLessons(
          this.resultIds.map((id) => this.lessons[id]).filter(Boolean),
          this.cart,
          this.sortField,
          this.sortDirection,
        ),
        this,
      );
    },
    totalActivities() {
      return Object.values(this.lessons).filter((lesson) => !lesson.deleted)
        .length;
    },
    categories() {
      return [
        "STEM & strategy",
        "Arts & expression",
        "Move & play",
        "Language & discovery",
        ...(Object.values(this.lessons).some(
          (lesson) => category(lesson.topic) === "More to discover",
        )
          ? ["More to discover"]
          : []),
      ];
    },
    spotlight() {
      return Object.values(this.lessons)
        .filter((lesson) =>
          ["Art Workshop", "Coding Club", "Guitar Basics"].includes(
            lesson.topic,
          ),
        )
        .slice(0, 3);
    },
    cartItems() {
      return cartLines(this.lessons, this.cart);
    },
    cartCount() {
      return this.cartItems.reduce((sum, item) => sum + item.quantity, 0);
    },
    cartTotal() {
      return this.cartItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );
    },
    cartConflict() {
      return this.cartItems.some(
        (item) => item.missing || item.quantity > item.space,
      );
    },
    contactError() {
      return contactErrors(this.name, this.phone);
    },
    emailError() { return emailError(this.email); },
    cartLocked() {
      return this.busy || Boolean(this.attempt);
    },
    canCheckout() {
      return (
        this.cartCount > 0 &&
        Boolean(this.api) &&
        !this.busy &&
        !this.contactError.name &&
        !this.contactError.phone &&
        !this.emailError &&
        (Boolean(this.attempt) || !this.cartConflict)
      );
    },
  },
  watch: {
    searchTerm() {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.loadLessons(), 300);
    },
    teacherId() {
      this.loadLessons();
    },
  },
  methods: {
    formatPrice,
    category,
    artTone,
    lessonHash,
    async syncRoute() {
      const route = lessonRoute(window.location.hash);
      if (route.view !== "detail") {
        this.detailLoader?.cancel();
        // In-page catalogue anchors preserve all basket and filter state.
        this.view = "catalogue";
        if (window.location.hash === "#catalogue") this.focusView();
        return;
      }
      this.view = "detail";
      this.detailId = route.id;
      this.detailData = null;
      this.detailError = "";
      this.detailLoading = true;
      this.focusView();
      if (!route.id || !this.detailLoader) {
        this.detailLoading = false;
        this.detailError = route.id
          ? "The lesson service is unavailable. Please try again."
          : "This lesson link is invalid.";
        return;
      }
      try {
        const result = await this.detailLoader.load(route.id);
        if (!result) return;
        this.detailData = result;
        this.mergeLessons([result.lesson]);
        this.detailLoading = false;
        if (this.view === "detail") this.focusView();
      } catch (error) {
        this.detailError = error.message;
        this.detailLoading = false;
        if (error.status === 404) {
          delete this.lessons[route.id];
          this.resultIds = this.resultIds.filter((id) => id !== route.id);
        }
      }
    },
    browseTeacher(id) {
      this.clearFilters();
      this.teacherId = id;
    },
    teacherNames(id) {
      return this.teachers
        .filter((teacher) => teacher.lessonIds.includes(id))
        .map((teacher) => teacher.firstName + " " + teacher.lastName)
        .join(" & ");
    },
    toggleSaved(id) {
      this.savedIds = this.savedIds.includes(id)
        ? this.savedIds.filter((value) => value !== id)
        : [...this.savedIds, id];
      try {
        window.localStorage.setItem(SAVED_KEY, JSON.stringify(this.savedIds));
        this.announcement = this.savedIds.includes(id)
          ? "Activity saved to your shortlist."
          : "Activity removed from your shortlist.";
      } catch {
        this.announcement =
          "Your shortlist works for this visit, but could not be saved on this device.";
      }
    },
    imageUrl(path) {
      return this.apiBase + path;
    },
    async showEnrolment(id) {
      if (this.enrolmentBusy[id]) return;
      this.enrolmentBusy[id] = true;
      delete this.enrolmentErrors[id];
      try {
        const result = await this.api("/enrolment/" + encodeURIComponent(id));
        if (!Number.isSafeInteger(result.enrolment) || result.enrolment < 0)
          throw new Error("Enrolment could not be verified.");
        this.enrolments[id] = result.enrolment;
        this.announcement =
          result.enrolment +
          " places already purchased for " +
          this.lessons[id].topic +
          ".";
      } catch (error) {
        this.enrolmentErrors[id] = error.message;
      } finally {
        this.enrolmentBusy[id] = false;
      }
    },
    showToast(message) {
      clearTimeout(this.toastTimer);
      this.toast = message;
      // The persistent View cart button remains after the brief visual feedback.
      this.toastTimer = setTimeout(() => { this.toast = ""; }, 6000);
    },
    dismissToast() { clearTimeout(this.toastTimer); this.toast = ""; },
    viewCart() {
      if (!this.cartCount) return;
      this.view = "cart";
      this.dismissToast();
      if (window.location.hash.startsWith("#/lessons")) {
        this.detailLoader?.cancel();
        window.history.replaceState(null, "", "#catalogue");
      }
      this.focusView();
    },
    addPlace(id) {
      if (this.cartLocked) return;
      const before = this.cart[id] || 0;
      this.cart = changeCart(this.lessons, this.cart, id, 1);
      if (this.cart[id] !== before) {
        this.confirmation = "";
        this.announcement =
          "One place for " + this.lessons[id].topic + " added to your basket.";
        this.showToast(this.announcement);
      }
    },
    removePlace(id) {
      if (this.cartLocked) return;
      this.cart = changeCart(this.lessons, this.cart, id, -1);
      this.dismissToast();
      this.announcement = "One place removed from your basket.";
      if (!this.cartCount && this.view === "cart") {
        this.view = "catalogue";
        this.focusView();
      }
    },
    focusView() {
      this.$nextTick(() =>
        document
          .getElementById(
            this.view === "detail"
              ? "lesson-detail"
              : this.view === "cart"
                ? "cart"
                : "catalogue",
          )
          ?.focus(),
      );
    },
    toggleCart() {
      if (!this.cartCount && this.view !== "cart") return;
      this.view = this.view === "cart" ? "catalogue" : "cart";
      if (window.location.hash.startsWith("#/lessons")) {
        this.detailLoader?.cancel();
        window.history.replaceState(null, "", "#catalogue");
      }
      this.focusView();
    },
    mergeLessons(lessons) {
      if (!Array.isArray(lessons))
        throw new Error("The lesson service returned an unexpected response.");
      for (const lesson of lessons) this.lessons[lesson._id] = lesson;
    },
    async refreshAll() {
      const lessons = await this.api("/lessons");
      this.lessons = {};
      this.mergeLessons(lessons);
    },
    async loadTeachers() {
      try {
        const teachers = await this.api("/teachers");
        if (!Array.isArray(teachers)) throw new Error();
        this.teachers = teachers;
        this.teacherError = "";
      } catch {
        this.teacherError =
          "Teachers could not be loaded. You can still browse all activities.";
      }
    },
    clearFilters() {
      this.searchTerm = "";
      this.teacherId = "";
      this.selectedCategory = "";
      this.savedOnly = false;
      this.availableOnly = false;
    },
    forgetAttempt() {
      this.attempt = null;
      try {
        this.storage?.removeItem(STORAGE_KEY);
      } catch {
        this.announcement = "Your browser could not clear the saved checkout.";
      }
    },
    async checkout() {
      this.touched = true;
      if (!this.canCheckout) return;
      this.busy = true;
      this.checkoutError = "";
      try {
        if (!this.attempt) {
          const attempt = createAttempt(this.name, this.phone, this.cartItems, undefined, this.email);
          saveAttempt(this.storage, attempt);
          this.attempt = attempt;
        }
        const result = await submitAttempt(this.api, this.attempt, (attempt) =>
          saveAttempt(this.storage, attempt),
        );
        if (result.lessons) this.mergeLessons(result.lessons);
        this.forgetAttempt();
        this.cart = {};
        this.enrolments = {};
        this.name = "";
        this.phone = "";
        this.email = "";
        this.dismissToast();
        this.touched = false;
        this.confirmation =
          "Your order has been submitted. Reference: " + result.orderId;
        this.announcement = this.confirmation;
        this.view = "catalogue";
        this.focusView();
        try {
          await this.refreshAll();
          await this.loadLessons();
        } catch {
          this.error =
            "Your order is confirmed, but activities could not be refreshed. Please try again.";
        }
      } catch (error) {
        this.checkoutError = error.message;
        if ([400, 404, 409].includes(error.status)) {
          this.forgetAttempt();
          try {
            await this.refreshAll();
          } catch {
            /* Preserve the checkout error and basket. */
          }
        }
      } finally {
        this.busy = false;
      }
    },
    async loadLessons() {
      clearTimeout(this.searchTimer);
      this.searchController?.abort();
      const controller = new AbortController();
      this.searchController = controller;
      const version = ++this.requestVersion;
      this.loading = true;
      this.error = "";
      try {
        this.apiBase = resolveApiBase(
          window.AFTERCLASS_CONFIG?.apiBaseUrl,
          window.location,
        );
        this.api ||= createApi(this.apiBase);
        const params = new URLSearchParams();
        if (this.searchTerm.trim()) params.set("q", this.searchTerm.trim());
        if (this.teacherId) params.set("teacherId", this.teacherId);
        const lessons = await this.api(
          "/lessons" + (params.size ? "?" + params : ""),
          { signal: controller.signal },
        );
        if (version !== this.requestVersion) return;
        if (!params.size) this.lessons = {};
        this.mergeLessons(lessons);
        this.resultIds = lessons.map((lesson) => lesson._id);
      } catch (error) {
        if (!controller.signal.aborted && version === this.requestVersion)
          this.error = error.message;
      } finally {
        if (version === this.requestVersion) this.loading = false;
      }
    },
  },
  mounted() {
    try {
      this.savedIds = restoreSaved(window.localStorage);
    } catch {
      /* Shortlisting remains usable without persistent storage. */
    }
    try {
      this.storage = window.sessionStorage;
    } catch {
      /* Checkout reports unavailable storage on submit. */
    }
    if (this.storage) this.attempt = restoreAttempt(this.storage);
    if (this.attempt) {
      this.name = this.attempt.payload.name;
      this.phone = this.attempt.payload.phone;
      this.email = this.attempt.payload.email || "";
      this.cart = Object.fromEntries(
        this.attempt.payload.items.map((item) => [
          item.lessonId,
          item.quantity,
        ]),
      );
      this.view = "cart";
    }
    this.loadLessons();
    if (this.api) {
      this.loadTeachers();
      this.detailLoader = createLessonLoader(this.api);
    }
    this.routeListener = () => this.syncRoute();
    window.addEventListener("hashchange", this.routeListener);
    if (!this.attempt) this.syncRoute();
    else if (window.location.hash.startsWith("#/lessons"))
      window.history.replaceState(null, "", "#catalogue");
  },
  beforeUnmount() {
    clearTimeout(this.searchTimer);
    clearTimeout(this.toastTimer);
    this.searchController?.abort();
    this.detailLoader?.cancel();
    window.removeEventListener("hashchange", this.routeListener);
  },
}).mount("#app");
