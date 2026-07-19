const mongoose = require('mongoose');

const BACKUP_CHOICES = ['IBA JU', 'BUP BBA Gen', 'BUP FBS', 'DU B/C unit', 'Engineering', 'Medical', 'DU A unit', 'Private Uni', 'Abroad'];

const EnrollmentDetailSchema = new mongoose.Schema({
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
        required: true,
        trim: true
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
        required: true,
        trim: true
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
        required: true,
        enum: ['Science', 'Arts', 'Commerce', 'Others']
    },
    hscBatch: {
        type: String,
        required: true,
        enum: ['2025 or equivalent', '2026 or equivalent', '2027 or equivalent', 'Others']
    },
    backupChoice: {
        type: [{
            type: String,
            enum: BACKUP_CHOICES
        }],
        required: true,
        validate: {
            validator: (choices) => Array.isArray(choices) && choices.length > 0,
            message: 'Please select at least one backup option'
        }
    },
    admissionSystemIdea: {
        type: String,
        required: true,
        enum: ['Yes', 'No', 'Maybe']
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
        enum: ['Farmgate', 'Bailey Road', 'Online', ''],
        default: ''
    }
}, { timestamps: true });

module.exports = mongoose.model('EnrollmentDetail', EnrollmentDetailSchema);
