# Math Course implementation

The Math Course is independent of general website membership. `math` grants math access, `mathSlytherin` grants both programs and the Slytherin house, and `slytherinUpgrade` adds general access to an existing math membership. Approved original-house students purchase `math` and retain their house and any outstanding general-program balance.

## Enrollment and payment

- Public course page: `/math-course`. Enrollment: `/payment/details?plan=math`, `mathSlytherin`, or `slytherinUpgrade`.
- Authenticated `POST /api/payments/quote` accepts `planId` and optional `couponCode`. It returns the original amount, best single discount, and final amount.
- Authenticated `GET /api/payments/math-context` supplies eligibility and previous enrollment details for prefill/upgrades.
- `POST /api/payments/manual-enrollment` accepts these plans with full payment, the questionnaire, coupon, and `expectedAmount`. The server recalculates eligibility and pricing; stale/tampered prices are rejected before checkout.
- Math costs BDT 5,999; the bundle costs BDT 11,998; upgrades cost BDT 5,999 without coupons. Original-house eligibility gives 25% off math. MAGNUS500 subtracts BDT 500; 7a597883 gives 99% off. Only the largest single discount applies to the initial package.
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
- Enrollment review: `/dashboard/admin/enrollments`, with math/package filters, survey answers, price/discount breakdowns, and upgrade records.
- Math authoring uses the existing live-exam question source, excluded from generated practice pools.
- Math competition includes math enrollees across all houses and math-only students. Math scores, RP, badges, and missed-exam penalties stay separate. Math leaderboards expose no house positions. General exams taken by Slytherin members contribute to Slytherin; original-house students retain their original house contribution.

## Validation and release notes

Backend: `npm test` — 125 passing tests, including access matrices, direct route guards, pricing, checkout/callback retries, questionnaire validation, cache invalidation, scoring isolation, and access-date penalties.

Frontend: `npm run lint` and `npm run build` pass. After a build, `node scripts/mathBrowserSmoke.cjs` in the frontend repository runs installed headless Edge against a local server with mocked API responses. It checks desktop/mobile layouts, signup/login continuation, coupon and questionnaire checkout, later upgrades, math navigation, and math administration. Screenshots are saved in ignored `.math-browser/`. Set `MATH_TEST_BROWSER` if Edge is installed elsewhere.

The real PayStation sandbox request returned `1001: Invalid Credential` with the configured sandbox credentials. Consequently, real gateway acceptance of fractional prices and a completed external payment callback remain unverified. With valid sandbox credentials, run `node scripts/verifyMathSandbox.js` to verify a BDT 59.99 checkout amount, then complete a sandbox transaction to verify the callback. Do not round discounted prices to whole taka to bypass the amount check.

Deploy the backend before the frontend so the new protected catalog and program endpoints are available. No migration or historical scoring rewrite is required. Recording URLs, authored questions, and schedules still need to be supplied and configured. No production data migration or deployment was performed during implementation.
