const test = require('node:test');
const assert = require('node:assert/strict');
const { getAreaBalancedQuizUnits, getQuestionEffectiveArea } = require('../utils/quizBalancer');

function questionUnit(area, index, field = 'subTopic') {
    return {
        type: 'question',
        question: {
            _id: `${area}-${index}`,
            [field]: area
        }
    };
}

function getUnitArea(unit) {
    return unit.type === 'question' ? getQuestionEffectiveArea(unit.question) : unit.area;
}

function countAreas(units) {
    return units.reduce((counts, unit) => {
        const area = getUnitArea(unit);
        counts[area] = (counts[area] || 0) + 1;
        return counts;
    }, {});
}

test('getQuestionEffectiveArea prefers subTopic, then topic, then chapter, then General', () => {
    assert.equal(getQuestionEffectiveArea({ subTopic: 'Ratios', topic: 'Arithmetic', chapter: 'Math' }), 'Ratios');
    assert.equal(getQuestionEffectiveArea({ topic: 'Vocabulary', chapter: 'English' }), 'Vocabulary');
    assert.equal(getQuestionEffectiveArea({ chapter: 'Puzzle' }), 'Puzzle');
    assert.equal(getQuestionEffectiveArea({}), 'General');
});

test('getAreaBalancedQuizUnits round-robins across areas before repeating dominant areas', () => {
    const units = [
        ...Array.from({ length: 8 }, (_, index) => questionUnit('Algebra', index)),
        ...Array.from({ length: 2 }, (_, index) => questionUnit('Geometry', index)),
        ...Array.from({ length: 2 }, (_, index) => questionUnit('Ratios', index))
    ];

    const orderedUnits = getAreaBalancedQuizUnits(units);
    const firstThreeAreas = new Set(orderedUnits.slice(0, 3).map(getUnitArea));
    const firstSixCounts = countAreas(orderedUnits.slice(0, 6));

    assert.equal(orderedUnits.length, units.length);
    assert.equal(firstThreeAreas.size, 3);
    assert.deepEqual(Object.values(firstSixCounts).sort((first, second) => first - second), [2, 2, 2]);
});

test('getAreaBalancedQuizUnits keeps filling from available areas when scarce areas run out', () => {
    const units = [
        ...Array.from({ length: 8 }, (_, index) => questionUnit('Algebra', index)),
        questionUnit('Geometry', 0),
        questionUnit('Ratios', 0)
    ];

    const firstFiveCounts = countAreas(getAreaBalancedQuizUnits(units).slice(0, 5));

    assert.equal(firstFiveCounts.Geometry, 1);
    assert.equal(firstFiveCounts.Ratios, 1);
    assert.equal(firstFiveCounts.Algebra, 3);
});

test('getAreaBalancedQuizUnits treats grouped sets as area-balanced units', () => {
    const units = [
        questionUnit('Vocabulary', 0),
        questionUnit('Vocabulary', 1),
        questionUnit('Grammar', 0),
        questionUnit('Grammar', 1),
        { type: 'groupedSet', area: 'Reading Comprehension', setNumber: 1 },
        { type: 'groupedSet', area: 'Reading Comprehension', setNumber: 2 }
    ];

    const firstThreeAreas = new Set(getAreaBalancedQuizUnits(units).slice(0, 3).map(getUnitArea));

    assert.equal(firstThreeAreas.size, 3);
});
