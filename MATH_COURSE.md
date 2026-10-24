# Math Course implementation

The Math Course is independent of general website membership. `math` grants math access, `mathSlytherin` grants both programs and the Slytherin house, and `slytherinUpgrade` adds general access to an existing math membership. Approved original-house students purchase `math` and retain their house and any outstanding general-program balance.

## Enrollment and payment

- Public course page: `/math-course`. Enrollment: `/payment/details?plan=math`, `mathSlytherin`, or `slytherinUpgrade`.
- Authenticated `POST /api/payments/quote` accepts `planId` and returns the flat plan amount with zero discount.
- Authenticated `GET /api/payments/math-context` supplies eligibility and previous enrollment details for prefill/upgrades.
- `POST /api/payments/manual-enrollment` accepts these plans with full payment, name, college, contact number, address, and `expectedAmount`. The server derives email from the authenticated account and recalculates eligibility and pricing; stale/tampered prices are rejected before checkout.
- Math costs BDT 4,500; the bundle costs BDT 9,000; and a later Slytherin upgrade costs BDT 4,500. The price is the same for existing house students. Discount codes are rejected for all Math plans.
- Existing payment records and already-issued checkout amounts retain their original terms, including historical discount metadata.
- Access is derived from all approved/paid payment records. Initiated/processing payments and seat bookings grant no math access. Review changes and verified callbacks synchronize permissions and invalidate cached authentication.
- Checkout retries reuse matching pending payments. A short per-user checkout lock prevents concurrent duplicate initiation. Verified gateway amounts must match the stored fractional BDT amount before math access is granted.

## Programs and content

`Exam.program` and `LiveClass.program` accept `general` or `math`. Missing values remain general. Student exam lists, classes, analytics, and competition endpoints accept `?program=math`; direct exam reads, submissions, retakes, and rankings check the exam's actual program. General resources and practice tools require general access.

`hasClassAccess` remains general website access. `hasMathAccess`, `mathAccessStartsAt`, and `generalAccessStartsAt` are separate profile/access fields. General house members retain legacy penalty behavior; new math membership and Slytherin upgrades only receive missed-exam penalties for exams starting after their access begins.

Math students use `/dashboard/math`, including classes, archived classes, live exams/results, and leaderboard. Students with both memberships see both navigation sets. Math-only students can upgrade from their overview or navigation.

Configure the 12 Basic and 12 Archive links in `config/contentCatalog.js` under `mathRecordings`. Empty links deliberately display **Coming soon**. General paid recording and resource links also live in this server catalog, served through protected `/api/classes/catalog` responses with private/no-store caching.

## Administration and competition

- Math Exam Admin: `/dashboard/admin/math/live-exams`. Uses the existing JSON authoring, preview, scheduling, submissions, retakes, and moderation interfaces. Every math exam question must have a math subject. Daily Mock uses the existing daily category and 15-minute timer; Full-Length Math uses weekly scoring and the scheduled duration.
- Class scheduling: `/dashboard/admin/classes`, with a program selector and the existing Zoom workflow.
- Enrollment review: `/dashboard/admin/enrollments`, with math/package filters, enrollment details, payment breakdowns, and upgrade records.
- Math authoring uses the existing live-exam question source, excluded from generated practice pools.
- Math competition includes math enrollees across all houses and math-only students. Math scores, RP, badges, and missed-exam penalties stay separate. Math leaderboards expose no house positions. Positive general-program RP rewards earned by current Slytherin members receive a 2x multiplier; penalties, Math RP, exam scores, badges, and house points remain unchanged. General exams taken by Slytherin members contribute to Slytherin; original-house students retain their original house contribution.

## Validation and release notes

Backend: `npm test` covers access matrices, direct route guards, pricing, checkout/callback retries, four-field enrollment validation, cache invalidation, scoring isolation, and access-date penalties.

Frontend: run `npm run lint` and `npm run build`. After a build, `node scripts/mathBrowserSmoke.cjs` in the frontend repository runs installed headless Edge against a local server with mocked API responses. It checks desktop/mobile layouts, signup/login continuation, four-field checkout, later upgrades, math navigation, and math administration. Screenshots are saved in ignored `.math-browser/`. Set `MATH_TEST_BROWSER` if Edge is installed elsewhere.

The real PayStation sandbox request previously returned `1001: Invalid Credential` with the configured sandbox credentials. With valid sandbox credentials, run `node scripts/verifyMathSandbox.js` to verify a BDT 4,500 checkout amount, then complete a sandbox transaction to verify the callback.

Deploy the backend before the frontend so the new protected catalog and program endpoints are available. No migration or historical scoring rewrite is required. Recording URLs, authored questions, and schedules still need to be supplied and configured. No production data migration or deployment was performed during implementation.
