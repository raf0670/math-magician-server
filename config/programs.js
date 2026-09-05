const MATH_PLAN_IDS = ['math', 'mathSlytherin', 'slytherinUpgrade'];
const HOUSE_PLAN_IDS = ['offline', 'gryffindor2', 'premium', 'online'];
const APPROVED_STATUSES = ['approved', 'paid'];
const PREPARATION_METHODS = ['By myself', 'Offline coaching ( Mentors / Blueprint )', 'Online coaching ( ACS / Michil )', 'Personal batch'];
const MATH_WEAKNESSES = ['Weak mental calculation', 'Lack of question understanding', 'Wrong approach', 'Others'];

function programOf(value) { return value === 'math' ? 'math' : 'general'; }
function programFilter(program = 'general') {
    return { program: programOf(program) === 'math' ? 'math' : { $ne: 'math' } };
}
function canAccessProgram(user, program = 'general') {
    return user?.role === 'admin' || Boolean(programOf(program) === 'math' ? user?.hasMathAccess : user?.hasClassAccess);
}
module.exports = { MATH_PLAN_IDS, HOUSE_PLAN_IDS, APPROVED_STATUSES, PREPARATION_METHODS, MATH_WEAKNESSES, programOf, programFilter, canAccessProgram };
