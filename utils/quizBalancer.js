function clean(value) {
    return value?.toString().trim() || '';
}

function shuffleItems(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

function getQuestionEffectiveArea(question) {
    return clean(question?.subTopic) || clean(question?.topic) || clean(question?.chapter) || 'General';
}

function getAreaKey(area) {
    return clean(area).toLowerCase() || 'general';
}

function getQuizUnitArea(unit) {
    if (unit.type === 'question') return getQuestionEffectiveArea(unit.question);
    return unit.area || unit.groupedTopicRule?.key || 'General';
}

function getAreaBalancedQuizUnits(units = []) {
    const bucketsByArea = new Map();

    for (const unit of shuffleItems(units)) {
        const area = getQuizUnitArea(unit);
        const areaKey = getAreaKey(area);

        if (!bucketsByArea.has(areaKey)) {
            bucketsByArea.set(areaKey, {
                area,
                units: []
            });
        }

        bucketsByArea.get(areaKey).units.push(unit);
    }

    const buckets = shuffleItems([...bucketsByArea.values()]);
    const orderedUnits = [];
    let hasAvailableUnit = true;

    while (hasAvailableUnit) {
        hasAvailableUnit = false;

        for (const bucket of buckets) {
            const unit = bucket.units.shift();
            if (!unit) continue;

            orderedUnits.push(unit);
            hasAvailableUnit = true;
        }
    }

    return orderedUnits;
}

module.exports = {
    getAreaBalancedQuizUnits,
    getQuestionEffectiveArea
};
