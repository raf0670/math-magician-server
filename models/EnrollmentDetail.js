const mongoose = require('mongoose');
const { PREPARATION_METHODS, MATH_WEAKNESSES } = require('../config/programs');

const BACKUP_CHOICES = ['IBA JU', 'BUP BBA Gen', 'BUP FBS', 'DU B/C unit', 'Engineering', 'Medical', 'DU A unit', 'Private Uni', 'Abroad'];

const EnrollmentDetailSchema = new mongoose.Schema({
    preparationMethods: [{ type: String, enum: PREPARATION_METHODS }],
    mathFear: { type: String, trim: true, maxlength: 5000 },
    mathWeaknesses: [{ type: String, enum: MATH_WEAKNESSES }],
    mathWeaknessOther: { type: String, trim: true, maxlength: 2000 },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    payment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
        required: true,
        unique: true,
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
    bkashTrxID: {
        type: String,
        default: '',
        trim: true
    },
    paymentMethod: {
        type: String,
        enum: ['bkash', 'bank', 'paystation'],
        default: 'bkash'
    },
    referenceName: {
        type: String,
        trim: true,
        default: ''
    },
    referenceEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: ''
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    yourName: {
        type: String,
        required: true,
        trim: true
    },
    address: {
        type: String,
        required: true,
        trim: true
    },
    phoneNumber: {
        type: String,
        required: true,
        trim: true
    },
    facebookProfile: {
        type: String,
        trim: true,
        default: ''
    },
    emailAddress: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    college: {
        type: String,
        required: true,
        trim: true
    },
    group: {
        type: String,
        enum: ['Science', 'Arts', 'Commerce', 'Others', ''],
        default: ''
    },
    hscBatch: {
        type: String,
        enum: ['2025 or equivalent', '2026 or equivalent', '2027 or equivalent', 'Others', ''],
        default: ''
    },
    backupChoice: {
        type: [{
            type: String,
            enum: BACKUP_CHOICES
        }],
        default: []
    },
    admissionSystemIdea: {
        type: String,
        enum: ['Yes', 'No', 'Maybe', ''],
        default: ''
    },
    previousIbaPreparation: {
        type: String,
        enum: ['Yes', 'No', ''],
        default: ''
    },
    previousStudyDetails: {
        type: String,
        trim: true,
        default: ''
    },
    strongestSection: {
        type: String,
        enum: ['English', 'Math', 'Analytical', 'Writing', ''],
        default: ''
    },
    weakestSection: {
        type: String,
        enum: ['English', 'Math', 'Analytical', 'Writing', ''],
        default: ''
    },
    preferredBatch: {
        type: String,
        required: true,
        enum: ['Farmgate', 'Farmgate - Gryffindor 2.0', 'Bailey Road', 'Online', 'Math Course', 'Slytherin']
    }
}, { timestamps: true });

module.exports = mongoose.model('EnrollmentDetail', EnrollmentDetailSchema);
