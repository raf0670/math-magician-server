const test = require('node:test');
const assert = require('node:assert/strict');
const Exam = require('../models/Exam');
const Submission = require('../models/Submission');
const User = require('../models/User');
const { getCompetitionData } = require('../controllers/analyticsController')._private;

function query(value) {
    return { select() { return this; }, sort() { return this; }, populate() { return this; }, lean: async () => value };
}

test('math scores, retakes and disqualifications stay isolated from general house competition', async (t) => {
    const date = new Date('2025-01-01');
    const general = { _id: 'general', title: 'Legacy daily', examType: 'official', isLiveExam: true, competitionCategory: 'daily', totalMarks: 20, startTime: date, endTime: date };
    const math = { ...general, _id: 'math', title: 'Math daily', program: 'math' };
    const users = [
        { _id: 'original', name: 'Original house', house: 'Gryffindor', hasClassAccess: true, hasMathAccess: true },
        { _id: 'bundle', name: 'Slytherin member', house: 'Slytherin', hasClassAccess: true, hasMathAccess: true },
        { _id: 'mathOnly', name: 'Math only', house: '', hasClassAccess: false, hasMathAccess: true },
        { _id: 'newStudent', name: 'New math student', house: '', hasClassAccess: false, hasMathAccess: true, mathAccessStartsAt: new Date('2026-01-01') }
    ];
    const row = (student, exam, score, extras = {}) => ({ student, exam, score, submittedAt: date, ...extras });
    const generalResults = [row(users[0], general, 10), row(users[1], general, 16)];
    let results = [...generalResults];
    t.mock.method(Exam, 'find', filter => query(
        filter.examType === 'assignment' ? [] : [general, math].filter(exam => filter.program === 'math' ? exam.program === 'math' : exam.program !== 'math')
    ));
    t.mock.method(Submission, 'find', filter => query(results.filter(result => (
        filter.exam ? filter.exam.$in.includes(result.exam._id) && !result.isRetake : filter.student.$in.includes(result.student._id)
    ))));
    t.mock.method(User, 'find', filter => query(users.filter(user => (!filter._id || filter._id.$in.includes(user._id)) && (filter.hasMathAccess ? user.hasMathAccess : user.hasClassAccess))));

    const before = await getCompetitionData();
    results = [...generalResults, row(users[0], math, 20), row(users[1], math, 18), row(users[2], math, 19), row(users[2], math, 20, { isRetake: true }), row(users[0], math, 20, { isDisqualified: true })];
    const after = await getCompetitionData();
    assert.deepEqual(after, before, 'Adding math results must leave every general total, rank, badge and house result unchanged');
    assert.equal(after.houseStandings.find(house => house.name === 'Gryffindor').totalPoints, 10);
    assert.equal(after.houseStandings.find(house => house.name === 'Slytherin').totalPoints, 16);
    assert.equal(after.leaderboard.find(student => student.studentId === 'bundle').rankInfo.rankPoints, 8);

    const competition = await getCompetitionData('math');
    assert.equal(competition.leaderboard.length, 4);
    assert.equal(competition.leaderboard.find(student => student.studentId === 'newStudent').rankInfo.rankPoints, 0);
    assert.deepEqual(competition.houseStandings, []);
    assert.deepEqual(competition.champions.houses, []);
    assert.ok(competition.leaderboard.every(student => student.house === '' && student.email === ''));
    assert.equal(competition.leaderboard.find(student => student.studentId === 'mathOnly').totalScore, 19);
    assert.equal(competition.leaderboard.find(student => student.studentId === 'original').totalScore, 20);
    assert.equal(competition.leaderboard.find(student => student.studentId === 'bundle').rankInfo.rankPoints, 9);
});
