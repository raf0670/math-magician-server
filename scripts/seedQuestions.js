const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const QuestionBank = require('../models/QuestionBank');
const LIVE_EXAM_SOURCE = 'liveExam';

// Load environment variables by looking backwards out of the scripts folder
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// 1. Mock Data: A clean array of questions matching your Mongoose Schema exactly
const mockQuestions = [
    {
        questionText: "What is the dimensional formula for vector torque?",
        options: ["[ML^2T^-2]", "[MLT^-2]", "[ML^2T^-1]", "[ML^-1T^-2]"],
        correctOptionIndex: 0, // Options index 0 is correct
        subject: "Physics",
        chapter: "Vector"
    },
    {
        questionText: "If the dot product of two non-zero vectors is zero, what is the angle between them?",
        options: ["0°", "45°", "90°", "180°"],
        correctOptionIndex: 2, // 90° is correct
        subject: "Physics",
        chapter: "Vector"
    },
    {
        questionText: "Which of the following is a vector quantity?",
        options: ["Electric Current", "Linear Momentum", "Kinetic Energy", "Pressure"],
        correctOptionIndex: 1, // Linear Momentum is correct
        subject: "Physics",
        chapter: "Vector"
    },
    {
        questionText: "What is the hybridisation of carbon in an ethyne (acetylene) molecule?",
        options: ["sp", "sp^2", "sp^3", "dsp^2"],
        correctOptionIndex: 0, // sp is correct
        subject: "Chemistry",
        chapter: "Organic Chemistry"
    },
    {
        questionText: "Which functional group has the highest priority in IUPAC nomenclature?",
        options: ["-CHO", "-OH", "-COOH", "-COOR"],
        correctOptionIndex: 2, // -COOH is correct
        subject: "Chemistry",
        chapter: "Organic Chemistry"
    }
];

// 2. Database Insertion Function
const seedDatabase = async () => {
    try {
        // Connect directly to MongoDB Atlas using the URI in your .env
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🍃 Connected cleanly to MongoDB Atlas for seeding...');

        // Clear only reusable bank questions so seeded test data does not delete published live exams.
        await QuestionBank.deleteMany({ source: { $ne: LIVE_EXAM_SOURCE } });
        console.log('🧹 Cleared old non-live questions from QuestionBank collection.');

        // Insert the mock array in a single execution command
        await QuestionBank.insertMany(mockQuestions);
        console.log('🚀 Success: 5 high-quality questions successfully injected into your database!');

    } catch (error) {
        console.error(`❌ Seeding operation failed: ${error.message}`);
    } finally {
        // Disconnect safely
        mongoose.connection.close();
        console.log('🔌 Database connection closed smoothly.');
    }
};

// Run the script
seedDatabase();
