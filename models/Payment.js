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
        enum: ['bkash', 'bank', 'paystation'],
        default: 'bkash'
    },
    paymentMethod: {
        type: String,
        enum: ['bkash', 'bank', 'paystation'],
        default: 'bkash',
        index: true
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
    paymentChoice: {
        type: String,
        enum: ['full', 'partial'],
        default: 'full',
        index: true
    },
    paidAmount: {
        type: Number,
        min: 1
    },
    remainingAmount: {
        type: Number,
        min: 0,
        default: 0
    },
    deliveryMode: {
        type: String,
        enum: ['online', 'offline'],
        index: true
    },
    currency: {
        type: String,
        default: 'BDT'
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'initiated', 'processing', 'paid', 'failed', 'cancelled', 'refund'],
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
    paystationTransactionId: {
        type: String,
        trim: true,
        index: true
    },
    paystationStatus: {
        type: String,
        trim: true,
        index: true
    },
    paystationPaymentUrl: {
        type: String,
        trim: true
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
    finalTrxID: {
        type: String,
        trim: true
    },
    finalTrxIDNormalized: {
        type: String,
        trim: true,
        uppercase: true,
        unique: true,
        sparse: true,
        index: true
    },
    fullyPaidAt: {
        type: Date
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
    rawCallbackResponse: {
        type: mongoose.Schema.Types.Mixed
    },
    paidAt: {
        type: Date
    }
}, { timestamps: true });

PaymentSchema.pre('validate', function normalizeTransactionId() {
    if (this.trxID) {
        this.trxID = this.trxID.trim();
        this.trxIDNormalized = this.trxID.toUpperCase();
    }

    if (this.finalTrxID) {
        this.finalTrxID = this.finalTrxID.trim();
        this.finalTrxIDNormalized = this.finalTrxID.toUpperCase();
    }

    if (!this.paidAmount) {
        this.paidAmount = this.amount;
    }
});

module.exports = mongoose.model('Payment', PaymentSchema);
