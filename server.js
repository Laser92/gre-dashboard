const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.MongoStore || connectMongo.default || connectMongo;
const bcrypt = require('bcrypt');
const path = require('path');

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
app.use(express.static(path.join(__dirname, 'public')));
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
