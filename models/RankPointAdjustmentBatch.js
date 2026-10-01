const mongoose = require('mongoose');
const { HOUSES } = require('../config/competition');

const RankPointAdjustmentBatchSchema = new mongoose.Schema({
    label: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        maxlength: 240
    },
    program: {
        type: String,
        enum: ['general', 'math'],
        default: 'general',
        index: true
    },
    expectedHouse: {
        type: String,
        enum: HOUSES,
        required: true,
        index: true
    },
    effectiveDate: {
        type: Date,
        required: true,
        index: true
    },
    originalFilename: {
        type: String,
        required: true,
        trim: true,
        maxlength: 255
    },
    contentHash: {
        type: String,
        required: true,
        trim: true
    },
    idempotencyKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    kind: {
        type: String,
        enum: ['import', 'reversal'],
        default: 'import',
        index: true
    },
    status: {
        type: String,
        enum: ['applied', 'reversed'],
        default: 'applied',
        index: true
    },
    reversesBatch: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RankPointAdjustmentBatch'
    },
    reversalBatch: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RankPointAdjustmentBatch'
    },
    rowCount: {
        type: Number,
        required: true,
        min: 1
    },
    positiveCount: {
        type: Number,
        required: true,
        min: 0
    },
    zeroCount: {
        type: Number,
        required: true,
        min: 0
    },
    negativeCount: {
        type: Number,
        required: true,
        min: 0
    },
    totalPoints: {
        type: Number,
        required: true
    },
    importedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reversedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reversedAt: Date,
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
});

RankPointAdjustmentBatchSchema.index(
    { reversesBatch: 1 },
    {
        unique: true,
        partialFilterExpression: { reversesBatch: { $type: 'objectId' } },
        name: 'unique_batch_reversal'
    }
);
RankPointAdjustmentBatchSchema.index({ program: 1, createdAt: -1 });

module.exports = mongoose.model('RankPointAdjustmentBatch', RankPointAdjustmentBatchSchema);
