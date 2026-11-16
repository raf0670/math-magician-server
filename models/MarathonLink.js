const mongoose = require('mongoose');

const MarathonLinkSchema = new mongoose.Schema({
    section: { type: String, enum: ['english', 'maths'], required: true, unique: true, index: true },
    url: { type: String, trim: true, default: '' },
    isPublished: { type: Boolean, default: false, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('MarathonLink', MarathonLinkSchema);
