const mongoose = require('mongoose');

const PaystationCheckoutAttemptSchema = new mongoose.Schema({
    payment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
        required: true,
        index: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    stage: {
        type: String,
        enum: ['initial', 'final'],
        required: true,
        index: true
    },
    invoiceNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
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
    paymentUrl: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: ['initiated', 'processing', 'success', 'failed', 'cancelled', 'refund', 'unknown'],
        default: 'initiated',
        index: true
    },
    transactionId: {
        type: String,
        trim: true,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true
    },
    supersededAt: {
        type: Date,
        default: null,
        index: true
    },
    lastCheckedAt: Date,
    settledAt: Date,
    duplicateSuccess: {
        type: Boolean,
        default: false,
        index: true
    },
    reviewRequired: {
        type: Boolean,
        default: false,
        index: true
    },
    reviewReason: {
        type: String,
        trim: true,
        default: ''
    },
    rawCreateResponse: mongoose.Schema.Types.Mixed,
    rawStatusResponse: mongoose.Schema.Types.Mixed,
    rawCallbackResponse: mongoose.Schema.Types.Mixed
}, { timestamps: true });

PaystationCheckoutAttemptSchema.index({ payment: 1, stage: 1, createdAt: -1 });
PaystationCheckoutAttemptSchema.index({ transactionId: 1, stage: 1 });

module.exports = mongoose.model('PaystationCheckoutAttempt', PaystationCheckoutAttemptSchema);
