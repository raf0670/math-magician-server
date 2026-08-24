const BANGLADESH_UTC_OFFSET_MINUTES = 6 * 60;
const ASSIGNMENT_START_HOUR_BD = 16;
const ASSIGNMENT_END_HOUR_BD = 15;
const DAILY_LIVE_EXAM_START_HOUR_BD = 22;
const DAILY_LIVE_EXAM_START_MINUTE_BD = 40;
const DAILY_LIVE_EXAM_END_HOUR_BD = 23;
const DAILY_LIVE_EXAM_END_MINUTE_BD = 20;
const DAILY_LIVE_EXAM_DURATION_MINUTES = 15;

function clean(value) {
    return value?.toString().trim() || '';
}

function getBangladeshAssignmentWindow(assignmentDate) {
    const rawDate = clean(assignmentDate);
    const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return { startTime: null, endTime: null, assignmentDate: rawDate };
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const dateCheck = new Date(Date.UTC(year, monthIndex, day));

    if (
        dateCheck.getUTCFullYear() !== year
        || dateCheck.getUTCMonth() !== monthIndex
        || dateCheck.getUTCDate() !== day
    ) {
        return { startTime: null, endTime: null, assignmentDate: rawDate };
    }

    const offsetMs = BANGLADESH_UTC_OFFSET_MINUTES * 60000;
    const utcStartMs = Date.UTC(year, monthIndex, day, ASSIGNMENT_START_HOUR_BD, 0, 0, 0) - offsetMs;
    const utcEndMs = Date.UTC(year, monthIndex, day + 1, ASSIGNMENT_END_HOUR_BD, 59, 59, 999) - offsetMs;

    return {
        startTime: new Date(utcStartMs),
        endTime: new Date(utcEndMs),
        assignmentDate: rawDate
    };
}

function getBangladeshDailyLiveExamWindow(examDate) {
    const rawDate = clean(examDate);
    const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return { startTime: null, endTime: null, examDate: rawDate };
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const dateCheck = new Date(Date.UTC(year, monthIndex, day));

    if (
        dateCheck.getUTCFullYear() !== year
        || dateCheck.getUTCMonth() !== monthIndex
        || dateCheck.getUTCDate() !== day
    ) {
        return { startTime: null, endTime: null, examDate: rawDate };
    }

    const offsetMs = BANGLADESH_UTC_OFFSET_MINUTES * 60000;
    const utcStartMs = Date.UTC(
        year,
        monthIndex,
        day,
        DAILY_LIVE_EXAM_START_HOUR_BD,
        DAILY_LIVE_EXAM_START_MINUTE_BD,
        0,
        0
    ) - offsetMs;
    const utcEndMs = Date.UTC(
        year,
        monthIndex,
        day,
        DAILY_LIVE_EXAM_END_HOUR_BD,
        DAILY_LIVE_EXAM_END_MINUTE_BD,
        0,
        0
    ) - offsetMs;

    return {
        startTime: new Date(utcStartMs),
        endTime: new Date(utcEndMs),
        examDate: rawDate
    };
}

function calculateAssignmentDurationMinutes(window) {
    const startTime = window?.startTime ? new Date(window.startTime) : null;
    const endTime = window?.endTime ? new Date(window.endTime) : null;

    if (!startTime || !endTime || Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        return 1;
    }

    return Math.max(1, Math.ceil((endTime.getTime() - startTime.getTime()) / 60000));
}

module.exports = {
    calculateAssignmentDurationMinutes,
    DAILY_LIVE_EXAM_DURATION_MINUTES,
    getBangladeshAssignmentWindow,
    getBangladeshDailyLiveExamWindow
};
