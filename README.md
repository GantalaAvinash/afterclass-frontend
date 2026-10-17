# AfterClass frontend

## Development provenance

The requesting user is a developer providing paid assistance to a separate student. OpenAI Codex generated or edited implementation, tests and documentation under that developer's direction. Direct student contributions and independent review are not verified here. See the combined repository's [student handover](https://github.com/GantalaAvinash/after_class_simple_brainstrome/blob/main/STUDENT_HANDOVER.md) and [assistance record](https://github.com/GantalaAvinash/after_class_simple_brainstrome/blob/main/AI_ACKNOWLEDGEMENT.md). The student should confirm permitted assessment use and required disclosure with the module team.

Vue 3.5.44 standalone browser ESM, Options API, plain JavaScript and CSS. There is no build step and no frontend JavaScript library beyond Vue.

## Local use

The real application requires the configured Express/Atlas backend. Serve this folder:

~~~sh
python3 -m http.server 8080 --bind 127.0.0.1
~~~

Open http://127.0.0.1:8080. The committed config.js points to the live Render API. To integrate with a local API, set apiBaseUrl to http://localhost:3000 in your local copy; a blank value also selects localhost during local development. The explicit fixture preview supplies its own configuration.

For a separate, explicitly labelled fixture preview, run npm run preview:test from the sibling backend folder and open http://127.0.0.1:8081. This is test data, not an assessment deployment or MongoDB substitute.

## Tests

~~~sh
node --test test/*.test.mjs
~~~

Tests cover eight sort combinations, numeric comparisons, cart capacity/removal, contact validation, request errors, persistence and lost-response retries. Manual Chrome checks cover a complete fixture purchase, numeric search plus teacher filtering, enrolment, empty-cart behaviour, and layouts at 375/768/1024/1440 pixels. See the workspace verification log for limits.

## Behaviour

- state.mjs derives sorted lessons and displayed availability without mutating server stock. Cart quantities are independent of the currently filtered results.
- api.mjs uses promise-based fetch, checks HTTP success, retains error status for recovery, and supports cancellation and a 90-second timeout for cold starts.
- checkout.mjs saves a checkout request ID before submission and retries the same order. Only an unfinished checkout is saved in session storage; ordinary browsing carts are in memory.
- app.js connects these functions with Vue computed state, methods, watchers and lifecycle hooks. Version checks and cancellation prevent an old search response overwriting a newer one.
- Search uses stored server availability. Unsaved basket selections do not reserve database places.
- Names contain A–Z letters only; phones contain digits only, preserving leading zeros. The form follows the brief's literal rule.
- Uncertain submissions lock basket/contact edits until retried. Confirmed orders clear the cart; definitive input or stock conflicts preserve the basket for correction.

## Protected Studio and design extension

Open admin.html from the footer. admin-app.js is a separate Vue Options API entry point using the same API origin. The backend must have ADMIN_USERNAME and ADMIN_PASSWORD_HASH configured; see its admin guide. Every management request is checked by the server.

admin-state.mjs holds the token in a closure, never in browser storage. The password is cleared after login attempts. Reload requires signing in again; expiry/401 clears access and logout revokes the server session. Only management mutation payloads and UUIDs persist in sessionStorage for retry recovery.

The lesson editor creates or updates core fields, programme overview, age guidance, duration, learning outcomes and teacher membership together. Revision checks stop stale forms overwriting purchases. A native confirmation dialog protects deletion; the Deleted lessons view supports restore. Insights display confirmed quantities, available places, saved-price booking value and audit events, with no customer contact details or payment processing.

experience.css supplies the richer landing composition, activity cards, teacher credits and responsive layouts. discovery.mjs derives topic categories with a More to discover fallback. These client filters intersect after the required backend search. Saved IDs alone are held in localStorage. Cart quantities remain separate.

Extension tests cover admin validation, revisions, memory-only access, session expiry, saved shortlists, combined discovery filters and bearer headers. The completed responsive pass covers full lesson booking and teacher CRUD/assignments at 375px and 768px, with long-content overflow checks at 320/375/768/1024px and desktop detail checks at 1440px. Fixed narrow-screen wrapping, 16px reading/input text, tap targets, dialog content and invalid teacher-form focus. These are Chromium viewport checks, not physical-device tests; see the workspace verification log and screenshots.

## Lesson details and teaching team

Select a lesson title or Explore this lesson to open its shareable #/lessons/:id page. It displays programme content, learning outcomes, age guidance, duration, location, teacher profiles, availability and basket controls. Details and catalogue share the same cart owner. Direct reload retrieves the lesson again; ordinary browsing carts remain in memory. lesson-route.mjs validates IDs and cancels superseded requests; missing/deleted lessons show an explicit error. lesson-detail.css supplies the responsive layout.

In Studio choose Teaching team, then Create teacher. Enter a first/last name, optional specialism and biography, and tick every lesson they teach. Edit profile & assignments changes that relationship from the teacher side; the lesson editor also supports teacher selection. Search profiles, filter deleted teachers, and restore them. Deleted profiles disappear publicly while their saved associations remain available for restoration. Changes use the existing protected session, revision checks, transaction and UUID retry mechanism.

Names accept Unicode letters, spaces, apostrophes and hyphens. Profile content remains plain text rendered through Vue; no HTML is executed. Example seed profiles are explicitly fictitious. Assignment edits advance revisions on both sides so a stale editor cannot silently undo another change.

## GitHub Pages setup

Set config.js apiBaseUrl to the actual HTTPS Render origin. Publish this repository's main branch and root folder. Relative paths and .nojekyll support project Pages URLs. The production configuration must not enable testPreview.

Configure the backend's FRONTEND_ORIGINS as the GitHub Pages origin without a repository path, for example https://ACCOUNT.github.io. Do not store database credentials in this frontend.

## Attribution

- Vue 3.5.44: official npm browser runtime, locally vendored. Source/integrity: vendor/VERSION.md; MIT licence: vendor/LICENSE.vue.
- Lesson SVGs are served by the backend and attributed there.
- favicon.svg is the unmodified Lucide palette SVG from version 0.468.0, under the ISC licence in vendor/LICENSE.lucide.
- No remote font service, CSS framework, icon JavaScript library, or generated raster image is required.

The workspace AI_ACKNOWLEDGEMENT.md records actual assistance. Hosted phone/tablet/catalogue/checkout/teacher verification passed on 17 October 2026. Student explanation review remains pending.

## Current combined-repository deployment

- Source: https://github.com/GantalaAvinash/after_class_simple_brainstrome
- Frontend: https://gantalaavinash.github.io/after_class_simple_brainstrome/
- API lessons: https://afterclass-21j41a62f1.onrender.com/lessons

The service is configured from this combined repository. Hosted verification and restricted-network restart passed on 17 October 2026; see the root VERIFICATION.md. The original frontend/backend repositories remain available separately for coursework history.
