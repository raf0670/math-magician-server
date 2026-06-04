const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

connectDB();

// Mount Router Middleware
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/courses', require('./routes/courseRoutes'));

app.get('/', (req, res) => {
    res.send('Exam & Course Archive API is running smoothly...');
});

// Define the port variable
const PORT = process.env.PORT || 5000;

// Fire up the local server listener
app.listen(PORT, () => {
    console.log(`🚀 Server spinning up in development mode on port ${PORT}`);
});