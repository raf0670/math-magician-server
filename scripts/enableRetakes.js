const dotenv = require('dotenv');
const mongoose = require('mongoose');

mongoose.set('autoIndex', false);

const Exam = require('../models/Exam');
const Submission = require('../models/Submission');

dotenv.config();

const ASSESSMENT_EXAM_CODE = 'assessment-test-2026-08-16';
const isDryRun = process.argv.includes('--dry-run');

async function dropIndexIfExists(collection, indexName) {
    const indexes = await collection.indexes();
    if (!indexes.some((index) => index.name === indexName)) return false;

    if (!isDryRun) {
        await collection.dropIndex(indexName);
    }

    return true;
}

async function createIndex(collection, keys, options) {
    if (!isDryRun) {
        await collection.createIndex(keys, options);
    }
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    const submissionCollection = Submission.collection;
    const missingRetakeFilter = {
        $or: [
            { isRetake: { $exists: false } },
            { attemptNumber: { $exists: false } }
        ]
    };
    const submissionsToBackfill = await Submission.countDocuments(missingRetakeFilter);
    const examsToEnable = await Exam.countDocuments({
        $or: [
            {
                isLiveExam: true,
                $or: [
                    { examType: 'official' },
                    { examType: { $exists: false } }
                ]
            },
            {
                examType: 'assessment',
                examCode: ASSESSMENT_EXAM_CODE
            }
        ],
        allowRetakes: { $ne: true }
    });

    console.log(`${isDryRun ? 'Would backfill' : 'Backfilling'} ${submissionsToBackfill} submission${submissionsToBackfill === 1 ? '' : 's'} as official attempts.`);
    console.log(`${isDryRun ? 'Would enable' : 'Enabling'} retakes on ${examsToEnable} live/assessment exam${examsToEnable === 1 ? '' : 's'}.`);

    if (!isDryRun) {
        await Submission.updateMany(missingRetakeFilter, {
            $set: {
                isRetake: false,
                attemptNumber: 1
            }
        });

        await Exam.updateMany(
            {
                isLiveExam: true,
                $or: [
                    { examType: 'official' },
                    { examType: { $exists: false } }
                ]
            },
            { $set: { allowRetakes: true } }
        );

        await Exam.updateMany(
            {
                examType: 'assessment',
                examCode: ASSESSMENT_EXAM_CODE
            },
            { $set: { allowRetakes: true } }
        );
    }

    const droppedLegacyIndex = await dropIndexIfExists(submissionCollection, 'student_1_exam_1');
    console.log(`${isDryRun ? 'Would drop' : 'Dropped'} legacy student/exam unique index: ${droppedLegacyIndex ? 'yes' : 'not found'}.`);

    await createIndex(
        submissionCollection,
        { student: 1, exam: 1 },
        {
            unique: true,
            partialFilterExpression: { isRetake: false },
            name: 'unique_official_submission_per_student_exam'
        }
    );
    await createIndex(
        submissionCollection,
        { student: 1, exam: 1, clientAttemptId: 1 },
        {
            unique: true,
            partialFilterExpression: { clientAttemptId: { $type: 'string' } },
            name: 'unique_client_attempt_submission'
        }
    );

    console.log(`${isDryRun ? 'Retake migration dry run' : 'Retake migration'} complete.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
