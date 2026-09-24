require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const PaystationCheckoutAttempt = require('../models/PaystationCheckoutAttempt');

const APPLY = process.argv.includes('--apply');
const VALID_STATUSES = new Set(['initiated', 'processing', 'success', 'failed', 'cancelled', 'refund']);

function normalizedStatus(value, fallback = 'initiated') {
    const status = value?.toString().trim().toLowerCase();
    if (['paid', 'approved', 'successful', 'completed'].includes(status)) return 'success';
    if (status === 'canceled') return 'cancelled';
    if (status === 'refunded') return 'refund';
    return VALID_STATUSES.has(status) ? status : fallback;
}

function attemptFromPayment(payment, stage) {
    const isFinal = stage === 'final';
    const invoiceNumber = isFinal ? payment.finalMerchantInvoiceNumber : payment.merchantInvoiceNumber;
    const amount = isFinal ? payment.finalPaidAmount : (payment.paidAmount || payment.amount);
    if (!invoiceNumber || !Number(amount)) return null;

    return {
        payment: payment._id,
        user: payment.user,
        stage,
        invoiceNumber,
        amount,
        currency: payment.currency || 'BDT',
        paymentUrl: isFinal ? (payment.finalPaystationPaymentUrl || '') : (payment.paystationPaymentUrl || ''),
        status: normalizedStatus(
            isFinal ? payment.finalPaystationStatus : (payment.paystationStatus || payment.status),
            (isFinal && payment.fullyPaidAt) || (!isFinal && (payment.status === 'paid' || payment.status === 'approved'))
                ? 'success'
                : 'initiated'
        ),
        transactionId: isFinal
            ? (payment.finalPaystationTransactionId || payment.finalTrxID)
            : (payment.paystationTransactionId || payment.trxID),
        // Backfilled URLs are deliberately expired so the API verifies them before any reuse.
        expiresAt: new Date(Date.now() - 1),
        rawCreateResponse: isFinal ? payment.finalRawCreateResponse : payment.rawCreateResponse,
        rawStatusResponse: isFinal ? payment.finalRawExecuteResponse : payment.rawExecuteResponse,
        rawCallbackResponse: isFinal ? payment.finalRawCallbackResponse : payment.rawCallbackResponse,
        ...(isFinal && payment.fullyPaidAt ? { settledAt: payment.fullyPaidAt } : {}),
        ...(!isFinal && (payment.status === 'paid' || payment.status === 'approved') ? { settledAt: payment.paidAt || payment.updatedAt } : {})
    };
}

async function main() {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');
    await mongoose.connect(process.env.MONGO_URI);

    const payments = await Payment.find({
        $or: [
            {
                paymentMethod: 'paystation',
                merchantInvoiceNumber: { $exists: true, $ne: '' }
            },
            { finalMerchantInvoiceNumber: { $exists: true, $ne: '' } }
        ]
    }).lean();

    const candidates = payments.flatMap((payment) => [
        payment.paymentMethod === 'paystation' ? attemptFromPayment(payment, 'initial') : null,
        attemptFromPayment(payment, 'final')
    ]).filter(Boolean);
    const invoices = candidates.map((attempt) => attempt.invoiceNumber);
    const existing = await PaystationCheckoutAttempt.find({ invoiceNumber: { $in: invoices } })
        .select('invoiceNumber')
        .lean();
    const existingInvoices = new Set(existing.map((attempt) => attempt.invoiceNumber));
    const missing = candidates.filter((attempt) => !existingInvoices.has(attempt.invoiceNumber));

    console.log(JSON.stringify({
        mode: APPLY ? 'apply' : 'dry-run',
        paymentsReviewed: payments.length,
        candidateAttempts: candidates.length,
        alreadyPresent: existing.length,
        toCreate: missing.length,
        byStage: missing.reduce((counts, attempt) => ({ ...counts, [attempt.stage]: (counts[attempt.stage] || 0) + 1 }), {}),
        sampleInvoices: missing.slice(0, 10).map((attempt) => attempt.invoiceNumber)
    }, null, 2));

    if (!APPLY || !missing.length) return;
    const result = await PaystationCheckoutAttempt.bulkWrite(missing.map((attempt) => ({
        updateOne: {
            filter: { invoiceNumber: attempt.invoiceNumber },
            update: { $setOnInsert: attempt },
            upsert: true
        }
    })), { ordered: false });
    console.log(JSON.stringify({ inserted: result.upsertedCount, matched: result.matchedCount }, null, 2));
}

main()
    .catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
