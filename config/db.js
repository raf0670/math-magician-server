const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE) || 25;
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            maxPoolSize,
            minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 2,
            serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 10000
        });
        console.log(`🍃 MongoDB Atlas Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ Database Connection Error: ${error.message}`);
        process.exit(1); // Stop the server immediately if database connection fails
    }
};

module.exports = connectDB;
