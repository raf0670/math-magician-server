const mongoose = require('mongoose');

const LectureSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    videoUrl: { type: String, trim: true }, // Links to hosted videos (YouTube/Vimeo)
    pdfUrl: { type: String, trim: true }    // Links to lecture notes/sheets
});

const ModuleSchema = new mongoose.Schema({
    moduleName: { type: String, required: true, trim: true },
    lectures: [LectureSchema] // Array of lectures inside this module
});

const CourseSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Please add a course title'],
        trim: true
    },
    description: {
        type: String,
        required: [true, 'Please add a course description']
    },
    modules: [ModuleSchema], // Embedded modules and lectures array
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Course', CourseSchema);