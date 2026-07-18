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
        enum: ['pending', 'approved', 'rejected', 'initiated', 'paid', 'failed', 'cancelled'],
        default: 'pending',
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
    trxIDNormalized: {
        type: String,
        trim: true,
        uppercase: true,
        unique: true,
        sparse: true,
        index: true
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: {
        type: Date
    },
    reviewNote: {
        type: String,
        trim: true,
        default: ''
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

PaymentSchema.pre('validate', function normalizeTransactionId(next) {
    if (this.trxID) {
        this.trxID = this.trxID.trim();
        this.trxIDNormalized = this.trxID.toUpperCase();
    }

    next();
});

module.exports = mongoose.model('Payment', PaymentSchema);
