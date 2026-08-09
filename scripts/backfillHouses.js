const dotenv = require('dotenv');
const mongoose = require('mongoose');
const User = require('../models/User');
const Payment = require('../models/Payment');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const SeatBooking = require('../models/SeatBooking');
const { resolveHouse } = require('../config/competition');

dotenv.config();

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    const users = await User.find({ role: { $ne: 'admin' } }).select('_id house bookedPlanId').lean();
    let updatedCount = 0;

    for (const user of users) {
        const [booking, payment] = await Promise.all([
            SeatBooking.findOne({ user: user._id }).select('planId preferredBatch').sort({ createdAt: -1 }).lean(),
            Payment.findOne({ user: user._id, status: { $in: ['approved', 'paid', 'pending'] } })
                .select('planId')
                .sort({ createdAt: -1 })
                .lean()
        ]);
        const detail = payment
            ? await EnrollmentDetail.findOne({ user: user._id, payment: payment._id })
                .select('planId preferredBatch')
                .lean()
            : null;
        const house = resolveHouse({
            planId: detail?.planId || payment?.planId || booking?.planId || user.bookedPlanId,
            preferredBatch: detail?.preferredBatch || booking?.preferredBatch,
            fallbackHouse: user.house
        });

        if (house && house !== user.house) {
            await User.findByIdAndUpdate(user._id, { house });
            updatedCount += 1;
        }
    }

    console.log(`House backfill complete. Updated ${updatedCount} student account${updatedCount === 1 ? '' : 's'}.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
