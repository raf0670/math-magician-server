# Marathon implementation

Marathon is an independent live-class product with `english` and `maths` entitlements. It does not grant general website, Math Course, resource, recording, or exam access.

## Enrollment and pricing

- Public page: `/marathon`; enrollment continues through `/payment/details`.
- Plans: `marathonEnglish` and `marathonMaths` cost BDT 1,200; `marathonBoth` costs BDT 2,000.
- A student with one section can add the other through `marathonAddEnglish` or `marathonAddMaths` for the BDT 800 bundle difference.
- An approved/paid non-Marathon payment in the 2026 Asia/Dhaka calendar year grants a 25% returning-student discount. A settled discounted Marathon payment preserves that eligibility snapshot for a later add-section purchase.
- `MAGNUSBEST200`, `MAGNUS200`, and `ZEHADVYBEST` each give BDT 200 off. An account can use only one of these codes once across all Marathon checkouts; the discount can apply to an initial plan or add-section upgrade, never stacks with the returning discount, and remains consumed after a settled payment is refunded.
- Enrollment uses full PayStation payment and the five Math-style fields: name, college, phone, address, and Facebook profile link. Upgrade checkouts reuse the first Marathon enrollment details.
- Access is derived from approved/paid payments. Pending checkouts grant no access, and refunds/revocations remove the affected entitlement.

## Classes

- Student route: `/dashboard/marathon`.
- Admins publish English and Maths links from `/dashboard/admin/classes`.
- Any HTTPS classroom link is accepted. Unpublishing hides the saved link immediately.
- `GET /api/marathon` returns a join URL only when that section is both entitled and published.

## Verification

Run `npm test` in the backend, then `npm run lint` and `npm run build` in the frontend.
