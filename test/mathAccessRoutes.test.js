const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Exam = require('../models/Exam');
const { invalidateAuthUser } = require('../middleware/auth');

// Exercise the actual router/middleware chains without connecting to the production database.
// Controller sentinels prove that forbidden requests never reach protected content handlers.
for (const file of ['examController', 'analyticsController', 'assessmentController', 'liveClassController']) {
    const controller = require(`../controllers/${file}`);
    for (const key of Object.keys(controller)) {
        if (typeof controller[key] === 'function') controller[key] = (req, res) => res.json({ handler: key, program: req.program });
    }
}
const routers = {
    exams: require('../routes/examRoutes'), analytics: require('../routes/analyticsRoutes'),
    classes: require('../routes/liveClassRoutes'), assessment: require('../routes/assessmentRoutes')
};
const userId = '507f1f77bcf86cd799439011';
const mathExamId = '507f1f77bcf86cd799439012';
const generalExamId = '507f1f77bcf86cd799439013';
let currentUser;
function query(value) { return { select() { return this; }, sort() { return this; }, lean: async () => value }; }
User.findById = () => query(currentUser);
Payment.find = () => query([]);
User.findByIdAndUpdate = async (_id, fields) => { currentUser = { ...currentUser, ...fields }; };
Exam.findById = id => query(id === mathExamId ? { program: 'math' } : id === generalExamId ? {} : null);

async function request(routerName, method, path, user, params = {}, queryParams = {}) {
    currentUser = { _id: userId, name: 'Test', role: 'student', ...user };
    invalidateAuthUser(userId);
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'local-route-test-secret';
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET);
    const route = routers[routerName].stack.find(layer => layer.route?.path === path && layer.route.methods[method]);
    assert.ok(route, `${method} ${routerName}${path}`);
    try {
        return await new Promise((resolve, reject) => {
            const req = { headers: { authorization: `Bearer ${token}` }, body: {}, params, query: queryParams };
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
            let index = 0;
            const next = error => {
                if (error) return reject(error);
                const layer = route.route.stack[index++];
                if (!layer) return resolve({ status: res.statusCode });
                Promise.resolve(layer.handle(req, res, next)).catch(reject);
            };
            next();
        });
    } finally { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; }
}

for (const [label, user, general, math] of [
    ['math-only', { hasMathAccess: true }, false, true],
    ['general-only', { hasClassAccess: true }, true, false],
    ['both memberships', { hasMathAccess: true, hasClassAccess: true }, true, true],
    ['unapproved', {}, false, false],
    ['admin', { role: 'admin' }, true, true]
]) {
    test(`${label}: direct exam reads, submissions and rankings obey the exam's program`, async () => {
        for (const [id, allowed] of [[mathExamId, math], [generalExamId, general]]) {
            for (const [router, method, path, params] of [
                ['exams', 'get', '/:id', { id }], ['exams', 'post', '/:id/submit', { id }],
                ['analytics', 'get', '/leaderboard/:examId', { examId: id }]
            ]) {
                const response = await request(router, method, path, user, params, { retake: 'true' });
                assert.equal(response.status, allowed ? 200 : 403, `${path} ${id}`);
            }
        }
    });
    test(`${label}: class, exam-list, analytics and leaderboard queries enforce membership`, async () => {
        for (const [program, allowed] of [['general', general], ['math', math]]) {
            for (const [router, path] of [['exams', '/live'], ['classes', '/current'], ['classes', '/catalog'], ['analytics', '/competition'], ['analytics', '/leaderboard'], ['analytics', '/my-stats']]) {
                const response = await request(router, 'get', path, user, {}, { program });
                assert.equal(response.status, allowed ? 200 : 403, `${path}?program=${program}`);
                if (path === '/catalog' && allowed && math && program === 'math') {
                    assert.equal(response.body.data.length, 2);
                    assert.equal(response.body.data.flatMap(group => group.topics).length, 24);
                    assert.ok(response.body.data.every(group => group.topics.every(item => item.href === '')));
                }
            }
        }
    });
}
test('math-only students cannot bypass general practice, quizzes, assignments, or assessment gates using a query parameter', async () => {
    const user = { hasMathAccess: true };
    for (const [router, method, path] of [
        ['exams','get','/'], ['exams','get','/practice/meta'], ['exams','post','/practice/start'],
        ['exams','post','/quiz/start'], ['exams','get','/assignments'],
        ['assessment','get','/'], ['assessment','get','/exam'], ['assessment','post','/submit']
    ]) assert.equal((await request(router, method, path, user, {}, { program: 'math' })).status, 403);
});
test('student memberships cannot access authoring or moderation routes', async () => {
    const user = { hasMathAccess: true, hasClassAccess: true };
    for (const [router, method, path] of [
        ['exams','get','/live/admin'], ['exams','post','/live/admin'], ['exams','patch','/live/admin/:id'],
        ['classes','get','/admin'], ['classes','post','/admin'],
        ['analytics','get','/admin/live-exams/:examId/submissions'], ['analytics','patch','/admin/submissions/:submissionId/moderation']
    ]) assert.equal((await request(router, method, path, user, { id: mathExamId }, { program: 'math' })).status, 403);
});
test('invalid exam IDs and unrecognized program queries are rejected', async () => {
    assert.equal((await request('exams','get','/:id', { hasMathAccess: true }, { id: 'invalid' })).status, 404);
    assert.equal((await request('exams','get','/live', { hasClassAccess: true }, {}, { program: 'everything' })).status, 400);
});
test('invalidating a cached approved user prevents access after membership revocation', async () => {
    assert.equal((await request('exams','get','/live', { hasMathAccess: true }, {}, { program: 'math' })).status, 200);
    assert.equal((await request('exams','get','/live', {}, {}, { program: 'math' })).status, 403);
});
