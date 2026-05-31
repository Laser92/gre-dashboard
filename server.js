const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.MongoStore || connectMongo.default || connectMongo;
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

// Prevent unhandled errors from crashing the server
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err.message || err);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message || err);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Render's reverse proxy (needed for secure cookies behind HTTPS)
app.set('trust proxy', 1);

// Database setup
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gre-dashboard';

let dbConnected = false;
mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
})
    .then(() => { dbConnected = true; console.log('Connected to MongoDB.'); })
    .catch(err => console.error('MongoDB connection error:', err.message));

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// === PROGRESS SCHEMA ===
// Stores per-user, per-question progress for spaced repetition
const progressSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    chapterId: { type: String, required: true },
    questionId: { type: Number, required: true },
    // Status: 'unseen' | 'missed' | 'revision' | 'correct'
    // missed = answered incorrectly, needs retry
    // revision = was missed but got it right on retry, revision recommended
    // correct = answered correctly (either first time or after revision)
    status: { type: String, default: 'unseen', enum: ['unseen', 'missed', 'revision', 'correct'] },
    attempts: { type: Number, default: 0 },
    lastAttemptedAt: { type: Date, default: null },
}, { timestamps: true });

progressSchema.index({ userId: 1, chapterId: 1, questionId: 1 }, { unique: true });
progressSchema.index({ userId: 1, chapterId: 1, status: 1 });

const Progress = mongoose.model('Progress', progressSchema);

// === USER STATS SCHEMA ===
// Stores study time, streaks, and login history per user (server-side persistence)
const userStatsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    totalStudyTimeSeconds: { type: Number, default: 0 },
    todayStudyTimeSeconds: { type: Number, default: 0 },
    todayDate: { type: String, default: '' }, // YYYY-MM-DD
    daysStreak: { type: Number, default: 0 },
    lastStudyDate: { type: String, default: '' },
    correctStreak: { type: Number, default: 0 },
    maxCorrectStreak: { type: Number, default: 0 },
    loginHistory: { type: [String], default: [] }, // Array of YYYY-MM-DD strings
    dailyActivity: { type: Map, of: Number, default: {} }, // YYYY-MM-DD -> study time in seconds
    sumOfCorrectStreaks: { type: Number, default: 0 },
    totalStreaksCompleted: { type: Number, default: 0 },
    maxCorrectStreakDate: { type: String, default: '' },
    starredWords: { type: [String], default: [] },
    missedWords: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    srsData: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    badges: { type: [String], default: [] }
}, { timestamps: true });

const UserStats = mongoose.model('UserStats', userStatsSchema);

// Build session config — only use MongoStore if URI looks valid
let sessionStore;
try {
    sessionStore = MongoStore.create({
        mongoUrl: MONGODB_URI,
        ttl: 60 * 60 * 24,
    });
    // Handle store errors gracefully
    sessionStore.on('error', (err) => {
        console.error('Session store error:', err.message);
    });
} catch (err) {
    console.error('MongoStore init failed, using in-memory sessions:', err.message);
    sessionStore = undefined;
}

app.use(express.json());

app.get('/questions_bank.js', (req, res, next) => {
    const gzPath = path.join(__dirname, 'public', 'questions_bank.js.gz');
    if (!req.headers['accept-encoding']?.includes('gzip') || !fs.existsSync(gzPath)) {
        return next();
    }

    res.set({
        'Content-Encoding': 'gzip',
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Vary': 'Accept-Encoding'
    });
    res.sendFile(gzPath);
});

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true
}));
app.use(session({
    secret: process.env.SESSION_SECRET || 'gre_dashboard_secret_key',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// API Routes
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Username already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        
        req.session.userId = newUser._id;
        req.session.username = newUser.username;
        
        // Wait for session to be saved before responding
        req.session.save((err) => {
            if (err) console.error('Session save error:', err.message);
            res.json({ success: true, username });
        });
    } catch (err) {
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.userId = user._id;
            req.session.username = user.username;
            
            // Wait for session to be saved before responding
            req.session.save((err) => {
                if (err) console.error('Session save error:', err.message);
                res.json({ success: true, username: user.username });
            });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

// Profile update: change username
app.put('/api/profile/username', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { newUsername } = req.body;
    if (!newUsername || newUsername.trim().length < 2) {
        return res.status(400).json({ error: 'Username must be at least 2 characters' });
    }
    try {
        const existing = await User.findOne({ username: newUsername.trim() });
        if (existing && existing._id.toString() !== req.session.userId.toString()) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        await User.findByIdAndUpdate(req.session.userId, { username: newUsername.trim() });
        req.session.username = newUsername.trim();
        req.session.save((err) => {
            if (err) console.error('Session save error:', err.message);
            res.json({ success: true, username: newUsername.trim() });
        });
    } catch (err) {
        console.error('Username update error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Profile update: change password
app.put('/api/profile/password', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Both current and new password required' });
    }
    if (newPassword.length < 4) {
        return res.status(400).json({ error: 'New password must be at least 4 characters' });
    }
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error('Password update error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// === PROGRESS API ENDPOINTS ===

// GET /api/progress/:chapterId — load all progress for a chapter
app.get('/api/progress/:chapterId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const docs = await Progress.find({
            userId: req.session.userId,
            chapterId: req.params.chapterId
        }).lean();
        // Return as a map: questionId -> { status, attempts, lastAttemptedAt }
        const progressMap = {};
        docs.forEach(d => {
            progressMap[d.questionId] = {
                status: d.status,
                attempts: d.attempts,
                lastAttemptedAt: d.lastAttemptedAt
            };
        });
        res.json({ progress: progressMap });
    } catch (err) {
        console.error('Progress load error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/progress — load ALL progress for the user (all chapters)
app.get('/api/progress', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const docs = await Progress.find({
            userId: req.session.userId
        }).lean();
        // Return as nested map: chapterId -> questionId -> { status, attempts, lastAttemptedAt }
        const progressMap = {};
        docs.forEach(d => {
            if (!progressMap[d.chapterId]) progressMap[d.chapterId] = {};
            progressMap[d.chapterId][d.questionId] = {
                status: d.status,
                attempts: d.attempts,
                lastAttemptedAt: d.lastAttemptedAt
            };
        });
        res.json({ progress: progressMap });
    } catch (err) {
        console.error('Progress load error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/progress — save a single question result
app.post('/api/progress', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { chapterId, questionId, isCorrect } = req.body;
    if (!chapterId || questionId === undefined || isCorrect === undefined) {
        return res.status(400).json({ error: 'chapterId, questionId, and isCorrect required' });
    }
    try {
        let doc = await Progress.findOne({
            userId: req.session.userId,
            chapterId,
            questionId
        });

        if (!doc) {
            // First attempt on this question
            doc = new Progress({
                userId: req.session.userId,
                chapterId,
                questionId,
                status: isCorrect ? 'correct' : 'missed',
                attempts: 1,
                lastAttemptedAt: new Date()
            });
        } else {
            doc.attempts += 1;
            doc.lastAttemptedAt = new Date();

            if (doc.status === 'missed') {
                // Second attempt after missing
                if (isCorrect) {
                    doc.status = 'revision'; // Got it right on retry
                }
                // If still wrong, stays as 'missed'
            } else if (doc.status === 'revision') {
                // Third+ attempt after revision recommended
                if (isCorrect) {
                    doc.status = 'correct'; // Finally mastered
                }
                // If wrong, stays as 'revision'
            } else if (doc.status === 'correct') {
                // Re-attempting a correct question (from 5% correct pool)
                if (!isCorrect) {
                    doc.status = 'missed'; // Demoted
                }
            } else {
                // unseen (shouldn't normally hit this path)
                doc.status = isCorrect ? 'correct' : 'missed';
            }
        }

        await doc.save();
        res.json({ success: true, status: doc.status });
    } catch (err) {
        console.error('Progress save error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});
// === USER STATS API ENDPOINTS ===

// GET /api/stats — load user stats (study time, streaks, login history)
app.get('/api/stats', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    try {
        let stats = await UserStats.findOne({ userId: req.session.userId }).lean();
        if (!stats) {
            stats = {
                totalStudyTimeSeconds: 0,
                todayStudyTimeSeconds: 0,
                todayDate: '',
                daysStreak: 0,
                lastStudyDate: '',
                correctStreak: 0,
                maxCorrectStreak: 0,
                loginHistory: [],
                badges: [],
            };
        }
        res.json({ stats });
    } catch (err) {
        console.error('Stats load error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/stats — save user stats (study time, streaks, login history)
app.put('/api/stats', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    const {
        totalStudyTimeSeconds, todayStudyTimeSeconds, todayDate,
        daysStreak, lastStudyDate,
        correctStreak, maxCorrectStreak,
        loginHistory, dailyActivity,
        sumOfCorrectStreaks, totalStreaksCompleted, maxCorrectStreakDate,
        starredWords, missedWords, srsData, badges
    } = req.body;
    try {
        const update = {};
        if (totalStudyTimeSeconds !== undefined) update.totalStudyTimeSeconds = Number(totalStudyTimeSeconds);
        if (todayStudyTimeSeconds !== undefined) update.todayStudyTimeSeconds = Number(todayStudyTimeSeconds);
        if (todayDate !== undefined) update.todayDate = String(todayDate);
        if (daysStreak !== undefined) update.daysStreak = Number(daysStreak);
        if (lastStudyDate !== undefined) update.lastStudyDate = String(lastStudyDate);
        if (correctStreak !== undefined) update.correctStreak = Number(correctStreak);
        if (maxCorrectStreak !== undefined) update.maxCorrectStreak = Number(maxCorrectStreak);
        if (loginHistory !== undefined) update.loginHistory = loginHistory;
        
        if (dailyActivity !== undefined) update.dailyActivity = dailyActivity;
        if (sumOfCorrectStreaks !== undefined) update.sumOfCorrectStreaks = Number(sumOfCorrectStreaks);
        if (totalStreaksCompleted !== undefined) update.totalStreaksCompleted = Number(totalStreaksCompleted);
        if (maxCorrectStreakDate !== undefined) update.maxCorrectStreakDate = String(maxCorrectStreakDate);
        if (starredWords !== undefined) update.starredWords = starredWords;
        if (missedWords !== undefined) update.missedWords = missedWords;
        if (srsData !== undefined) update.srsData = srsData;
        if (badges !== undefined) update.badges = badges;

        await UserStats.findOneAndUpdate(
            { userId: req.session.userId },
            { $set: update },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Stats save error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Serve frontend files securely
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Any other route serves static files (if requested directly) or redirects
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, req.path), err => {
        if (err) {
            if (!req.session.userId) res.redirect('/login');
            else res.sendFile(path.join(__dirname, 'index.html'));
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
