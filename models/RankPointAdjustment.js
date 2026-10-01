const mongoose = require('mongoose');
const { HOUSES } = require('../config/competition');

const RankPointAdjustmentSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    program: {
        type: String,
        enum: ['general', 'math'],
        default: 'general',
        index: true
    },
    points: {
        type: Number,
        required: true
    },
    effectiveDate: {
        type: Date,
        required: true,
        index: true
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        maxlength: 240
    },
    houseSnapshot: {
        type: String,
        enum: HOUSES,
        required: true
    },
    emailSnapshot: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    sourceRow: {
        type: Number,
        required: true,
        min: 2
    },
    batch: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RankPointAdjustmentBatch',
        required: true,
        index: true
    },
    kind: {
        type: String,
        enum: ['import', 'reversal'],
        default: 'import',
        index: true
    },
    reversesAdjustment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RankPointAdjustment'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
});

RankPointAdjustmentSchema.index(
    { batch: 1, student: 1 },
    { unique: true, name: 'unique_student_per_adjustment_batch' }
);
RankPointAdjustmentSchema.index({ student: 1, program: 1, effectiveDate: -1, createdAt: -1 });

module.exports = mongoose.model('RankPointAdjustment', RankPointAdjustmentSchema);
