const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../controllers/analyticsController');

test('competition exam filter includes open assessment exams', () => {
    const filter = _private.buildCompetitionExamFilter();

    assert.deepEqual(filter.$or[1], { examType: 'assessment' });
});

test('competition exam filter still requires non-assessment exams to be live official exams', () => {
    const filter = _private.buildCompetitionExamFilter();
    const liveOfficialBranch = filter.$or[0].$and;

    assert.deepEqual(liveOfficialBranch[0], { isLiveExam: true });
    assert.deepEqual(liveOfficialBranch[1], _private.buildOfficialExamFilter());
});
