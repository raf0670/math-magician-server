const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    provider: {
        type: String,
        enum: ['bkash'],
        default: 'bkash'
    },
    planId: {
        type: String,
        required: true,
        trim: true
    },
    planTitle: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    currency: {
        type: String,
        default: 'BDT'
    },
    status: {
        type: String,
        enum: ['initiated', 'paid', 'failed', 'cancelled'],
        default: 'initiated',
        index: true
    },
    merchantInvoiceNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    bkashPaymentId: {
        type: String,
        trim: true,
        index: true
    },
    trxID: {
        type: String,
        trim: true
    },
    failureReason: {
        type: String,
        trim: true
    },
    rawCreateResponse: {
        type: mongoose.Schema.Types.Mixed
    },
    rawExecuteResponse: {
        type: mongoose.Schema.Types.Mixed
    },
    paidAt: {
        type: Date
    }
}, { timestamps: true });

module.exports = mongoose.model('Payment', PaymentSchema);
