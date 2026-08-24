const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const { calculateAssignmentDurationMinutes, getBangladeshAssignmentWindow } = require('../utils/assignmentWindow');

dotenv.config();

const isDryRun = process.argv.includes('--dry-run');

function sameTime(left, right) {
    if (!left || !right) return false;
    return new Date(left).getTime() === new Date(right).getTime();
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    const assignments = await Exam.find({
        examType: 'assignment',
        isLiveExam: true
    }).select('_id title assignmentDate startTime endTime duration');

    let updatedCount = 0;
    const skipped = [];

    for (const assignment of assignments) {
        const window = getBangladeshAssignmentWindow(assignment.assignmentDate);
        const duration = calculateAssignmentDurationMinutes(window);

        if (!window.startTime || !window.endTime) {
            skipped.push({
                id: assignment._id.toString(),
                title: assignment.title,
                assignmentDate: assignment.assignmentDate || ''
            });
            continue;
        }

        const alreadyCurrent = (
            sameTime(assignment.startTime, window.startTime)
            && sameTime(assignment.endTime, window.endTime)
            && Number(assignment.duration) === duration
        );

        if (alreadyCurrent) continue;

        updatedCount += 1;
        console.log(`${isDryRun ? 'Would update' : 'Updating'} assignment ${assignment._id}: ${assignment.title}`);
        console.log(`  ${assignment.startTime?.toISOString?.() || 'not set'} -> ${window.startTime.toISOString()}`);
        console.log(`  ${assignment.endTime?.toISOString?.() || 'not set'} -> ${window.endTime.toISOString()}`);

        if (!isDryRun) {
            assignment.startTime = window.startTime;
            assignment.endTime = window.endTime;
            assignment.duration = duration;
            await assignment.save();
        }
    }

    console.log(`${isDryRun ? 'Assignment window dry run' : 'Assignment window backfill'} complete. ${updatedCount} assignment${updatedCount === 1 ? '' : 's'} ${isDryRun ? 'would be updated' : 'updated'}.`);

    if (skipped.length) {
        console.log(`Skipped ${skipped.length} assignment${skipped.length === 1 ? '' : 's'} with missing or invalid assignmentDate:`);
        skipped.forEach((item) => {
            console.log(`  ${item.id} (${item.title || 'Untitled'}): ${item.assignmentDate || 'not set'}`);
        });
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
