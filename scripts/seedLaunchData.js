const dotenv = require('dotenv');
dotenv.config();

const connectDB = require('../config/db');
const Exam = require('../models/Exam');
const QuestionBank = require('../models/QuestionBank');
const Submission = require('../models/Submission');
const User = require('../models/User');
const LIVE_EXAM_SOURCE = 'liveExam';

async function seedLaunchData() {
  await connectDB();

  const questions = await QuestionBank.find({ source: { $ne: LIVE_EXAM_SOURCE } }).limit(8);
  if (!questions.length) {
    console.log('No questions found. Skipping launch-data seed.');
    process.exit(0);
  }

  const examDefinitions = [
    {
      title: 'Rapid Revision: Algebra Sprint',
      duration: 12,
      totalMarks: 10,
      allowRetakes: true,
      isLiveExam: false,
      questions: questions.slice(0, 3).map((question) => question._id),
    },
    {
      title: 'Weekend Sprint: Geometry Focus',
      duration: 15,
      totalMarks: 12,
      allowRetakes: true,
      isLiveExam: false,
      questions: questions.slice(2, 5).map((question) => question._id),
    },
    {
      title: 'Momentum Builder: Mixed Review',
      duration: 20,
      totalMarks: 15,
      allowRetakes: false,
      isLiveExam: false,
      questions: questions.slice(4, 7).map((question) => question._id),
    },
  ];

  for (const definition of examDefinitions) {
    const existing = await Exam.findOne({ title: definition.title });
    if (!existing) {
      await Exam.create(definition);
    }
  }

  const user = await User.findOne({ email: 'launchdemo@example.com' }) || await User.findOne({});
  if (!user) {
    console.log('No user found. Skipping submission seed.');
    process.exit(0);
  }

  const exams = await Exam.find({ title: { $in: examDefinitions.map((item) => item.title) } });
  for (const exam of exams) {
    const alreadySubmitted = await Submission.findOne({ student: user._id, exam: exam._id });
    if (!alreadySubmitted) {
      const answerPattern = Array.from({ length: exam.questions.length }, (_, index) => index % 4);
      await Submission.create({
        student: user._id,
        exam: exam._id,
        answers: answerPattern,
        score: Number((Math.max(4, exam.totalMarks - 2.5)).toFixed(2)),
      });
    }
  }

  console.log('Launch data seeded successfully.');
  process.exit(0);
}

seedLaunchData().catch((error) => {
  console.error(error);
  process.exit(1);
});
