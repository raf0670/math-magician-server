# Magician's School - Backend

Magician's School is a full-stack IBA admission-preparation platform for students in Bangladesh. This repository contains the Express API, MongoDB data models, access-control rules, exam engine, analytics, competition logic, enrollment workflows, and payment processing used by the [Magician's School frontend](https://github.com/raf0670/math-magician-client).

## Product capabilities

- JWT authentication, password recovery, and student profiles
- Role-based administrator authorization
- Independent general-program and Math Course memberships
- Live class scheduling and protected recording/resource catalogs
- Reusable question bank with topic and difficulty metadata
- Generated practice exams and area-balanced quizzes
- Scheduled live exams, assignments, assessments, retakes, and answer review
- Server-side scoring with negative marking and delayed result release
- Student analytics, rank progression, badges, individual leaderboards, and house competition
- Submission moderation and disqualification audit fields
- General program seat booking, full or partial enrollment, and final-installment settlement
- Math-only, Math + Slytherin, and later Slytherin upgrade purchases
- Server-authoritative quotes, discounts, PayStation checkout, callbacks, refunds, and access synchronization
- Profile-image validation and ImgBB uploads
- Resend or SMTP transactional email

## Technology

- Node.js 20+
- Express 5
- MongoDB and Mongoose 9
- JSON Web Tokens and bcrypt
- Axios for external payment and image services
- Multer with in-memory upload validation
- Resend and Nodemailer
- Node's built-in test runner

## Architecture

```text
config/       Database, programs, plans, competition rules, and content catalogs
controllers/  Request validation and application workflows
middleware/   Authentication, authorization, and image-upload guards
models/       Mongoose schemas and indexes
routes/       REST endpoint definitions
services/     Access, ranking, payment, email, and image-provider integrations
scripts/      Seeding, backfills, audits, and gateway verification
test/         Automated business-rule and route tests
utils/        Quiz balancing and assignment-window helpers
server.js     Express application entry point
```

The API follows a route -> middleware -> controller -> model/service flow. MongoDB remains the source of truth for access, submissions, payment state, and rankings.

## Programs and access

The application recognizes two programs:

- `general`: the full IBA website, regular exams, resources, and house competition
- `math`: the dedicated Math Course, Math classes, exams, and leaderboard

Administrators can access both programs. Student access is derived from approved or paid enrollment records and synchronized onto the user profile. Direct exam reads and submissions authorize against the exam's stored program, preventing query-string bypasses.

The Math Course implementation, plan behavior, competition isolation, and release notes are documented in [MATH_COURSE.md](./MATH_COURSE.md).

## API overview

The server mounts the following route groups under `/api`:

| Base path | Responsibilities |
| --- | --- |
| `/api/auth` | Registration, login, profile, password reset, and password changes |
| `/api/courses` | Course listing, authoring, updates, and enrollment |
| `/api/classes` | Protected content catalog, current class, and class administration |
| `/api/exams` | Practice, quizzes, live exams, assignments, exam reads, and submissions |
| `/api/assessment-test` | Assessment summary, paper delivery, and submission |
| `/api/analytics` | Student statistics, competition, leaderboards, and moderation |
| `/api/payments` | Quotes, enrollment, seat booking, checkout, callbacks, access, and review |

Public endpoints are limited to account entry points, the API health response, and PayStation callbacks. Student endpoints require a bearer token and, where appropriate, active program access. Authoring, enrollment review, and moderation require the `admin` role.

## Data model

The main collections are:

| Model | Purpose |
| --- | --- |
| `User` | Identity, role, profile, house, membership, and payment summary |
| `QuestionBank` | Reusable and authored multiple-choice questions |
| `Exam` | Practice, quiz, live exam, assessment, and assignment configuration |
| `Submission` | Answers, scores, attempt metadata, and moderation state |
| `AssessmentTest` | Source questions for the official assessment |
| `LiveClass` | General or Math Zoom class schedules |
| `Course` | Course modules and lectures |
| `Payment` | Enrollment price snapshot, gateway state, installments, and review |
| `EnrollmentDetail` | Student questionnaire and enrollment information |
| `SeatBooking` | Pre-enrollment seat reservations |
| `PaystationCheckoutAttempt` | Retry-safe checkout-attempt history |

Indexes enforce one official submission per student and exam, unique retake client identifiers, unique transaction references, and efficient leaderboard and access queries.

## Local development

### Prerequisites

- Node.js 20 or newer
- npm
- A MongoDB database

### Installation

```bash
git clone https://github.com/raf0670/math-magician-server.git
cd math-magician-server
npm install
```

Create a `.env` file with the required core values:

```env
MONGO_URI=mongodb://127.0.0.1:27017/magicians-school
JWT_SECRET=replace-with-a-long-random-secret
FRONTEND_URL=http://localhost:3000
PORT=5000
```

Start the API:

```bash
npm run dev
```

The health endpoint is available at [http://localhost:5000](http://localhost:5000).

## Environment variables

### Core

| Variable | Required | Default or purpose |
| --- | --- | --- |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | JWT signing and verification secret |
| `FRONTEND_URL` | Recommended | `http://localhost:3000`; used for redirects and reset links |
| `PORT` | No | `5000` |
| `MONGO_MAX_POOL_SIZE` | No | `25` |
| `MONGO_MIN_POOL_SIZE` | No | `2` |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | No | `10000` |
| `AUTH_USER_CACHE_TTL_MS` | No | `30000` |

### PayStation

Set `PAYSTATION_ENV=sandbox` or `live`, then configure the matching credentials.

| Variable | Purpose |
| --- | --- |
| `PAYSTATION_ENV` | Select sandbox or live; defaults to sandbox |
| `PAYSTATION_SANDBOX_BASE_URL` | Sandbox API origin |
| `PAYSTATION_SANDBOX_STORE_ID` | Sandbox merchant ID |
| `PAYSTATION_SANDBOX_PASSWORD` | Sandbox merchant password |
| `PAYSTATION_LIVE_BASE_URL` | Live API origin |
| `PAYSTATION_LIVE_STORE_ID` | Live merchant ID |
| `PAYSTATION_LIVE_PASSWORD` | Live merchant password |
| `PAYSTATION_CALLBACK_URL` | Public `/api/payments/paystation/callback` URL |
| `PAYSTATION_PAY_WITH_CHARGE` | Optional boolean gateway flag |
| `PAYSTATION_EMI` | Optional boolean gateway flag |

### Email

Use either Resend or SMTP:

```env
EMAIL_PROVIDER=resend
EMAIL_FROM=Magician's School <noreply@example.com>
RESEND_API_KEY=replace-with-resend-key
```

For SMTP, set `EMAIL_PROVIDER=smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `SMTP_FROM`, `SMTP_SECURE`, and the SMTP timeout variables.

### Profile images and exam tuning

| Variable | Purpose |
| --- | --- |
| `IMGBB_API_KEY` | Enables profile-image uploads |
| `IMGBB_UPLOAD_URL` | Optional ImgBB endpoint override |
| `PROFILE_IMAGE_MAX_BYTES` | Server upload-size limit |
| `PROFILE_IMAGE_ALLOWED_MIME_TYPES` | Comma-separated allowed image MIME types |
| `LIVE_EXAM_CACHE_TTL_MS` | Live-exam cache lifetime |
| `LIVE_EXAM_CACHE_GRACE_MS` | Cache grace period after expiry |
| `LIVE_EXAM_TIMER_SUBMISSION_GRACE_MS` | Technical grace for timer-expired submissions |

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the API with `node server.js` |
| `npm run dev` | Start the same local API entry point |
| `npm test` | Run the complete automated test suite |
| `npm run backfill:houses` | Populate legacy house assignments |
| `npm run backfill:assignment-windows` | Normalize assignment schedules |
| `npm run backfill:paystation-attempts` | Populate checkout-attempt history |
| `npm run audit:remaining-payments` | Audit remaining-installment records |
| `npm run enable:retakes` | Enable supported exam retakes |

Additional scripts seed questions and launch data or verify a Math checkout against the PayStation sandbox. Review a script and back up production data before running a migration or backfill.

## Scoring and competition

Questions are graded on the server. Correct answers receive an equal share of the exam's total marks, unanswered questions receive zero, and wrong answers use the configured negative mark, normally `0.25`.

Official daily and weekly exams, the assessment, and completed assignments contribute to rank progression. Retakes never change official rank or competition totals. Missed required daily exams and assignments can apply penalties only when the exam falls within the student's membership period. General and Math rank totals remain isolated.

House points are calculated per exam from the average effective score of participating house members. Disqualified submissions contribute zero, while their original score and moderation audit data remain stored. Math leaderboards intentionally omit house positions.

## Reliability and security

- Passwords use bcrypt and are never returned by default.
- Password-reset tokens are random, hashed in storage, and time-limited.
- JWT middleware reloads and briefly caches only request-scoped user fields.
- Server middleware enforces role, program, and exam-specific access.
- Exam answers are redacted until the applicable result-release time.
- Official submissions and retry identifiers are protected by unique indexes.
- Payment prices and discounts are recalculated on the server.
- Exact gateway amounts must match the stored payment snapshot.
- Checkout locks and attempt records prevent duplicate concurrent initiation.
- Repeated callbacks are processed idempotently and refunds resynchronize access.
- Uploaded profile images are size-limited and verified by file signature.

## Validation

```bash
npm test
```

The current suite contains **175 passing tests** covering access matrices, scoring, result timing, retakes, moderation, ranking, penalties, quiz balancing, payment quotes, checkout retries, callbacks, installments, refunds, profile uploads, and Math/general program isolation.

## Known external dependencies

- Real PayStation completion requires valid sandbox or production credentials. The previously supplied sandbox credentials returned `1001: Invalid Credential`, so a full external callback still needs verification with working credentials.
- Math recording URLs, authored questions, and schedules must be populated for a production launch.
- Empty Math recording URLs intentionally produce **Coming soon** responses in the client.
- Email and ImgBB features remain unavailable until their provider credentials are configured.

## Related repository

- Frontend: [raf0670/math-magician-client](https://github.com/raf0670/math-magician-client)
