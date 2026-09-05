const HOUSES = ['Gryffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin'];

const HOUSE_META = {
    Gryffindor: {
        name: 'Gryffindor',
        planId: 'offline',
        preferredBatch: 'Farmgate',
        mode: 'Offline',
        location: 'Farmgate'
    },
    Hufflepuff: {
        name: 'Hufflepuff',
        planId: 'online',
        preferredBatch: 'Bailey Road',
        mode: 'Offline',
        location: 'Bailey Road'
    },
    Ravenclaw: {
        name: 'Ravenclaw',
        planId: 'premium',
        preferredBatch: 'Online',
        mode: 'Online',
        location: 'Live Room'
    },
    Slytherin: {
        name: 'Slytherin',
        planId: 'mathSlytherin',
        preferredBatch: 'Slytherin',
        mode: 'Online',
        location: 'Full Website Access'
    }
};

const PLAN_TO_HOUSE = {
    offline: 'Gryffindor',
    gryffindor2: 'Gryffindor',
    online: 'Hufflepuff',
    premium: 'Ravenclaw',
    mathAdvanced: 'Slytherin',
    mathSlytherin: 'Slytherin',
    slytherinUpgrade: 'Slytherin'
};

const BATCH_TO_HOUSE = {
    Farmgate: 'Gryffindor',
    'Farmgate - Gryffindor 2.0': 'Gryffindor',
    'Bailey Road': 'Hufflepuff',
    Online: 'Ravenclaw',
    'Math Advanced': 'Slytherin',
    Slytherin: 'Slytherin'
};

const COMPETITION_CATEGORIES = ['daily', 'weekly'];

function normalizeHouse(value) {
    const house = value?.toString().trim();
    return HOUSES.includes(house) ? house : '';
}

function getHouseFromPlanId(planId) {
    return PLAN_TO_HOUSE[planId?.toString().trim()] || '';
}

function getHouseFromPreferredBatch(preferredBatch) {
    return BATCH_TO_HOUSE[preferredBatch?.toString().trim()] || '';
}

function resolveHouse({ planId, preferredBatch, fallbackHouse } = {}) {
    return getHouseFromPlanId(planId)
        || getHouseFromPreferredBatch(preferredBatch)
        || normalizeHouse(fallbackHouse);
}

function normalizeCompetitionCategory(value) {
    const category = value?.toString().trim().toLowerCase();
    return COMPETITION_CATEGORIES.includes(category) ? category : 'daily';
}

module.exports = {
    HOUSES,
    HOUSE_META,
    PLAN_TO_HOUSE,
    BATCH_TO_HOUSE,
    COMPETITION_CATEGORIES,
    getHouseFromPlanId,
    getHouseFromPreferredBatch,
    normalizeCompetitionCategory,
    normalizeHouse,
    resolveHouse
};
