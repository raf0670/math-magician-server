require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { HOUSE_PLAN_IDS, APPROVED_STATUSES } = require('../config/programs');
const { deriveProgramAccess } = require('../services/programAccessService');

function paymentSummary(payment) {
    return {
        paymentId: payment._id.toString(),
        planId: payment.planId,
        status: payment.status,
        totalAmount: payment.amount,
        paidAmount: payment.paidAmount,
        storedRemainingAmount: payment.remainingAmount,
        calculatedRemainingAmount: Math.round((Number(payment.amount) - Number(payment.paidAmount)) * 100) / 100,
        initialTrxID: payment.trxID || payment.paystationTransactionId || '',
        finalTrxID: payment.finalTrxID || payment.finalPaystationTransactionId || '',
        createdAt: payment.createdAt
    };
}

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const payments = await Payment.find({
        planId: { $in: HOUSE_PLAN_IDS },
        status: { $in: APPROVED_STATUSES }
    }).sort({ createdAt: 1 }).lean();
    const userIds = [...new Set(payments.map((payment) => payment.user.toString()))];
    const users = await User.find({
        $or: [
            { _id: { $in: userIds } },
            { hasClassAccess: true, paymentStatus: 'partiallyPaid' }
        ]
    }).select('name email house hasClassAccess paymentStatus bookedPlanId').lean();
    const paymentsByUser = new Map();
    payments.forEach((payment) => {
        const key = payment.user.toString();
        paymentsByUser.set(key, [...(paymentsByUser.get(key) || []), payment]);
    });

    const payable = [];
    const needsReview = [];
    users.forEach((user) => {
        const userPayments = paymentsByUser.get(user._id.toString()) || [];
        const access = deriveProgramAccess(user, userPayments);
        const outstanding = userPayments.filter((payment) => (
            payment.paymentChoice === 'partial'
            && !payment.fullyPaidAt
            && Number(payment.remainingAmount) > 0
        ));
        const consistent = outstanding.filter((payment) => {
            const calculated = Math.round((Number(payment.amount) - Number(payment.paidAmount)) * 100) / 100;
            return calculated > 0 && Math.abs(calculated - Number(payment.remainingAmount)) < 0.01;
        });
        const student = {
            userId: user._id.toString(),
            name: user.name,
            email: user.email,
            house: user.house,
            bookedPlanId: user.bookedPlanId || '',
            storedPaymentStatus: user.paymentStatus,
            derivedPaymentStatus: access.paymentStatus
        };

        if (access.hasClassAccess && access.paymentStatus === 'partiallyPaid' && outstanding.length === 1 && consistent.length === 1) {
            payable.push({ ...student, payment: paymentSummary(consistent[0]) });
        } else if (outstanding.length || user.paymentStatus === 'partiallyPaid') {
            needsReview.push({
                ...student,
                reason: outstanding.length > 1
                    ? 'multiple-outstanding-payments'
                    : !outstanding.length
                        ? 'partial-status-without-outstanding-payment'
                        : 'status-or-balance-mismatch',
                payments: userPayments.map(paymentSummary)
            });
        }
    });

    const payableByPlan = payable.reduce((summary, row) => {
        const key = `${row.payment.planId}:${row.payment.calculatedRemainingAmount}`;
        summary[key] = (summary[key] || 0) + 1;
        return summary;
    }, {});
    const report = {
        generatedAt: new Date().toISOString(),
        summary: {
            payableStudents: payable.length,
            needsReview: needsReview.length,
            payableByPlan
        },
        needsReview,
        payable
    };
    console.log(JSON.stringify(process.argv.includes('--summary')
        ? { generatedAt: report.generatedAt, summary: report.summary }
        : report, null, 2));
}

run()
    .catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
