const mongoose = require('mongoose');

const LiveClassSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Please add a class title'],
        trim: true,
        maxlength: [120, 'Class title must be 120 characters or fewer']
    },
    zoomUrl: {
        type: String,
        required: [true, 'Please add a Zoom link'],
        trim: true
    },
    startsAt: {
        type: Date,
        required: [true, 'Please add a class start time'],
        index: true
    },
    endsAt: {
        type: Date,
        required: [true, 'Please add a class end time'],
        index: true
    },
    note: {
        type: String,
        trim: true,
        maxlength: [500, 'Class note must be 500 characters or fewer'],
        default: ''
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

LiveClassSchema.index({ endsAt: 1, startsAt: 1 });

module.exports = mongoose.model('LiveClass', LiveClassSchema);
