// Global Dashboard State
const state = {
    diagnosticScore: 0,
    questionsAttempted: 0,
    correctAnswers: 0,
    chaptersCompleted: 0,
    questionsCompleted: 0,
    currentChapterId: null,
    currentQuestionIndex: 0,
    chapters: [
        { id: '1', title: '1. Verbal Diagnostic Test', subject: 'Verbal', status: 'not-started', totalQuestions: 300 },
        { id: '3', title: '3. Text Completions', subject: 'Verbal', status: 'not-started', totalQuestions: 300 },
        { id: '4', title: '4. Sentence Equivalence', subject: 'Verbal', status: 'not-started', totalQuestions: 300 },
        { id: '5', title: '5. Reading Comprehension', subject: 'Verbal', status: 'not-started', totalQuestions: 300 },
        { id: '6', title: '6. Sentence Completion Multiple Blanks', subject: 'Verbal', status: 'not-started', totalQuestions: 300 },
    ],
    questions: window.QUESTION_BANK || {}
};

// Per-user progress: { chapterId: { questionId: { status, attempts, lastAttemptedAt } } }
let userProgress = {};
// The ordered quiz queue built by the spaced-repetition algorithm
let quizQueue = [];

let accuracyChartInstance = null;
let progressionChartInstance = null;
let chaptersBreakdownChartInstance = null;
let selectedAnswerIndexes = [];
let multiBlankSelections = {};

const SE_SYNONYM_PAIRS = {
    chicanery: 'deception',
    polemic: 'diatribe',
    esoteric: 'arcane',
    calumny: 'slander',
    equivocate: 'prevaricate',
    truculent: 'belligerent',
    spurious: 'counterfeit',
    apocryphal: 'fabricated',
    vitiate: 'undermine',
    alacrity: 'eagerness',
    scarcity: 'dearth',
    paucity: 'dearth',
    prosaic: 'ordinary',
    didactic: 'instructive',
    transient: 'ephemeral'
};

// === TIME TRACKING ===
let totalStudyTimeSeconds = 0;    // All-time accumulated study time
let todayStudyTimeSeconds = 0;    // Today's accumulated study time
let chapterStartTime = null;      // When current chapter started
let chapterElapsedSeconds = 0;    // Time for current chapter
let questionStartTime = null;     // When current question started
let timerInterval = null;         // Interval for live timer
let passiveStudyStartTime = null; // Non-quiz study time, such as flashcards
let currentViewName = 'overview';
let questionPausedRemaining = null;
let tenSecondsToastShown = false;
let timerPaused = false;
let questionTimeExpired = false;
let globalStudyInterval = null;   // Global 1s activity tracker
let lastActivityTime = Date.now();
let _statsSyncTimer = null;       // Debounced server sync timer
let _serverStats = null;          // Cached server stats to avoid redundant saves

// Additional tracked stats
let dailyActivity = {};           // Map of YYYY-MM-DD -> seconds
let sumOfCorrectStreaks = 0;
let totalStreaksCompleted = 0;
let maxCorrectStreakDate = '';
let userBadges = [];

function getStudyTimeStorageKey() {
    return `greStudyTimeSeconds:${currentUsername || 'guest'}`;
}

function getTodayStudyTimeStorageKey() {
    return `greTodayStudyTimeSeconds:${currentUsername || 'guest'}`;
}

function getTodayDateStorageKey() {
    return `greTodayDate:${currentUsername || 'guest'}`;
}

function getTodayDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

// Load study time: prefer server, fallback to localStorage
async function loadStoredStudyTime() {
    // First load from localStorage as immediate fallback
    const savedTotal = Number(localStorage.getItem(getStudyTimeStorageKey()) || 0);
    totalStudyTimeSeconds = Number.isFinite(savedTotal) ? savedTotal : 0;
    
    const storedDate = localStorage.getItem(getTodayDateStorageKey());
    const today = getTodayDateString();
    if (storedDate === today) {
        const savedToday = Number(localStorage.getItem(getTodayStudyTimeStorageKey()) || 0);
        todayStudyTimeSeconds = Number.isFinite(savedToday) ? savedToday : 0;
    } else {
        todayStudyTimeSeconds = 0;
    }
    
    // Then try to load from server (authoritative source)
    try {
        const res = await fetch('/api/stats');
        if (res.ok) {
            const data = await res.json();
            const s = data.stats;
            _serverStats = s;
            // Server has the authoritative total — use whichever is larger
            if (s.totalStudyTimeSeconds > totalStudyTimeSeconds) {
                totalStudyTimeSeconds = s.totalStudyTimeSeconds;
            }
            // Handle today's time from server
            if (s.todayDate === today) {
                if (s.todayStudyTimeSeconds > todayStudyTimeSeconds) {
                    todayStudyTimeSeconds = s.todayStudyTimeSeconds;
                }
            } else {
                todayStudyTimeSeconds = 0;
            }
            // Sync localStorage with authoritative values
            localStorage.setItem(getStudyTimeStorageKey(), String(totalStudyTimeSeconds));
            localStorage.setItem(getTodayStudyTimeStorageKey(), String(todayStudyTimeSeconds));
            localStorage.setItem(getTodayDateStorageKey(), today);
        }
    } catch (e) {
        console.warn('Could not load stats from server, using localStorage:', e.message);
    }
}

function persistStudyTime() {
    const today = getTodayDateString();
    localStorage.setItem(getStudyTimeStorageKey(), String(totalStudyTimeSeconds));
    localStorage.setItem(getTodayStudyTimeStorageKey(), String(todayStudyTimeSeconds));
    localStorage.setItem(getTodayDateStorageKey(), today);
    dailyActivity[today] = todayStudyTimeSeconds;
    // Debounced server sync (every 30 seconds)
    _debouncedSyncStats();
}

function _debouncedSyncStats() {
    if (_statsSyncTimer) return; // already scheduled
    _statsSyncTimer = setTimeout(() => {
        _statsSyncTimer = null;
        _syncStatsToServer();
    }, 30000);
}

function _syncStatsToServer() {
    if (!currentUsername) return;
    const payload = {
        totalStudyTimeSeconds,
        todayStudyTimeSeconds,
        todayDate: getTodayDateString(),
        daysStreak: Number(localStorage.getItem(getDaysStreakKey()) || 0),
        lastStudyDate: localStorage.getItem(getLastStudyDateKey()) || '',
        correctStreak: Number(localStorage.getItem(getCorrectStreakKey()) || 0),
        maxCorrectStreak: Number(localStorage.getItem(getMaxCorrectStreakKey()) || 0),
        dailyActivity,
        sumOfCorrectStreaks,
        totalStreaksCompleted,
        maxCorrectStreakDate,
        starredWords: getStarredWords(),
        missedWords: getMissedWords(),
        badges: userBadges
    };
    fetch('/api/stats', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(err => console.warn('Stats sync failed:', err.message));
}

// Force immediate sync (used before page unload)
function _forceStatsSync() {
    if (_statsSyncTimer) { clearTimeout(_statsSyncTimer); _statsSyncTimer = null; }
    if (!currentUsername) return;
    const payload = {
        totalStudyTimeSeconds,
        todayStudyTimeSeconds,
        todayDate: getTodayDateString(),
        daysStreak: Number(localStorage.getItem(getDaysStreakKey()) || 0),
        lastStudyDate: localStorage.getItem(getLastStudyDateKey()) || '',
        correctStreak: Number(localStorage.getItem(getCorrectStreakKey()) || 0),
        maxCorrectStreak: Number(localStorage.getItem(getMaxCorrectStreakKey()) || 0),
        dailyActivity,
        sumOfCorrectStreaks,
        totalStreaksCompleted,
        maxCorrectStreakDate,
        starredWords: getStarredWords(),
        missedWords: getMissedWords(),
        badges: userBadges
    };
    try {
        fetch('/api/stats', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(() => {});
    } catch (e) { /* ignore */ }
}

// === STREAK HELPERS ===

function getDaysStreakKey() { return `greDaysStreak:${currentUsername || 'guest'}`; }
function getLastStudyDateKey() { return `greLastStudyDate:${currentUsername || 'guest'}`; }
function getCorrectStreakKey() { return `greCorrectStreak:${currentUsername || 'guest'}`; }
function getMaxCorrectStreakKey() { return `greMaxCorrectStreak:${currentUsername || 'guest'}`; }

function getGradeFromAccuracy(val) {
    if (val >= 90) return 'S';
    if (val >= 75) return 'A';
    if (val >= 60) return 'B';
    if (val >= 45) return 'C';
    if (val >= 30) return 'D';
    return 'F';
}

// === STREAK COLOR TIERS ===
function getStreakColorTier(streak) {
    if (streak >= 25) return { rgb: '239, 68, 68',   name: 'inferno' };   // Red/hot
    if (streak >= 20) return { rgb: '245, 158, 11',  name: 'gold' };      // Gold
    if (streak >= 15) return { rgb: '16, 185, 129',  name: 'emerald' };   // Green
    if (streak >= 10) return { rgb: '59, 130, 246',  name: 'sapphire' };  // Blue
    if (streak >= 5)  return { rgb: '168, 85, 247',  name: 'amethyst' };  // Brighter purple
    return              { rgb: '139, 92, 246',  name: 'default' };   // Default purple
}

function applyStreakVisuals(streak) {
    const el = document.getElementById('streak-correct');
    if (!el) return;
    const tier = getStreakColorTier(streak);
    el.style.setProperty('--streak-color', tier.rgb);
    // Apply glow at 5+
    if (streak >= 5) {
        el.classList.add('streak-glow');
    } else {
        el.classList.remove('streak-glow');
    }
}

function triggerStreakBump() {
    const el = document.getElementById('streak-correct');
    if (!el) return;
    el.classList.remove('streak-bump');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('streak-bump');
    setTimeout(() => el.classList.remove('streak-bump'), 600);
}

function showStreakMilestoneToast(streak) {
    // Only show for multiples of 5
    if (streak <= 0 || streak % 5 !== 0) return;
    const tier = getStreakColorTier(streak);
    const emojis = ['⚡', '🔥', '💥', '🌟', '👑', '🚀'];
    const emoji = emojis[Math.min(Math.floor(streak / 5) - 1, emojis.length - 1)];
    
    const toast = document.createElement('div');
    toast.className = 'streak-toast';
    toast.style.setProperty('--streak-color', tier.rgb);
    toast.innerHTML = `
        <div class="streak-toast-number">${streak}</div>
        <div class="streak-toast-label">IN A ROW!!</div>
        <div class="streak-toast-emoji">${emoji}</div>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, 2000);
}

function updateDaysStreak() {
    if (!currentUsername) return;
    const today = getTodayDateString();
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;

    let storedStreak = Number(localStorage.getItem(getDaysStreakKey()) || 0);
    let lastStudyDate = localStorage.getItem(getLastStudyDateKey()) || '';
    
    const el = document.getElementById('streak-days');
    const countEl = document.getElementById('streak-days-count');
    if (!el || !countEl) return;

    // Check if streak is broken (last study was before yesterday)
    if (lastStudyDate !== '' && lastStudyDate !== today && lastStudyDate !== yesterdayStr) {
        storedStreak = 0;
        localStorage.setItem(getDaysStreakKey(), "0");
    }
    
    if (lastStudyDate === today) {
        // Already counted today — just show current streak
        countEl.textContent = storedStreak;
        el.classList.remove('inactive');
        el.classList.add('active');
        el.setAttribute('title', `🔥 ${storedStreak} day streak! Keep it up!`);
        return;
    }
    
    // Check if studied today (todayStudyTimeSeconds > 0)
    if (todayStudyTimeSeconds > 0) {
        // Calculate new streak
        let newStreak;
        if (lastStudyDate === yesterdayStr) {
            newStreak = storedStreak + 1; // Consecutive!
        } else {
            newStreak = 1; // Streak broken, restart
        }
        
        localStorage.setItem(getDaysStreakKey(), String(newStreak));
        localStorage.setItem(getLastStudyDateKey(), today);
        countEl.textContent = newStreak;
        el.classList.remove('inactive');
        el.classList.add('active');
        el.setAttribute('title', `🔥 ${newStreak} day streak! Keep it up!`);
    } else {
        // Haven't studied today yet
        countEl.textContent = storedStreak;
        el.classList.remove('active');
        el.classList.add('inactive');
        el.setAttribute('title', `Start studying to build your ${storedStreak > 0 ? storedStreak + ' day' : ''} streak!`);
    }
}

function updateCorrectStreak(isCorrect) {
    if (!currentUsername) return;
    
    let currentStreak = Number(localStorage.getItem(getCorrectStreakKey()) || 0);
    let maxStreak = Number(localStorage.getItem(getMaxCorrectStreakKey()) || 0);
    
    if (isCorrect) {
        currentStreak++;
        if (currentStreak > maxStreak) {
            maxStreak = currentStreak;
            maxCorrectStreakDate = getTodayDateString();
            localStorage.setItem(getMaxCorrectStreakKey(), String(maxStreak));
        }
    } else {
        if (currentStreak > 0) {
            sumOfCorrectStreaks += currentStreak;
            totalStreaksCompleted++;
        }
        currentStreak = 0;
    }
    
    localStorage.setItem(getCorrectStreakKey(), String(currentStreak));
    
    const el = document.getElementById('streak-correct');
    const countEl = document.getElementById('streak-correct-count');
    if (el && countEl) {
        countEl.textContent = currentStreak;
        el.setAttribute('title', `⚡ ${currentStreak} correct in a row! (Best: ${maxStreak})`);
    }
    
    // Apply visual effects
    applyStreakVisuals(currentStreak);
    if (isCorrect && currentStreak > 0) {
        triggerStreakBump();
        showStreakMilestoneToast(currentStreak);
    }
    
    // Sync to server
    _debouncedSyncStats();
}

async function loadStoredStreaks() {
    if (!currentUsername) return;
    
    // Try to restore from server first
    try {
        if (_serverStats) {
            const s = _serverStats;
            const today = getTodayDateString();
            // Merge: take the larger of server vs localStorage
            const localDaysStreak = Number(localStorage.getItem(getDaysStreakKey()) || 0);
            const localCorrectStreak = Number(localStorage.getItem(getCorrectStreakKey()) || 0);
            const localMaxCorrectStreak = Number(localStorage.getItem(getMaxCorrectStreakKey()) || 0);
            
            if (s.daysStreak > localDaysStreak) {
                localStorage.setItem(getDaysStreakKey(), String(s.daysStreak));
            }
            if (s.lastStudyDate && !localStorage.getItem(getLastStudyDateKey())) {
                localStorage.setItem(getLastStudyDateKey(), s.lastStudyDate);
            }
            if (s.correctStreak > localCorrectStreak) {
                localStorage.setItem(getCorrectStreakKey(), String(s.correctStreak));
            }
            if (s.maxCorrectStreak > localMaxCorrectStreak) {
                localStorage.setItem(getMaxCorrectStreakKey(), String(s.maxCorrectStreak));
            }
            if (s.dailyActivity) dailyActivity = s.dailyActivity;
            if (s.sumOfCorrectStreaks) sumOfCorrectStreaks = s.sumOfCorrectStreaks;
            if (s.totalStreaksCompleted) totalStreaksCompleted = s.totalStreaksCompleted;
            if (s.maxCorrectStreakDate) maxCorrectStreakDate = s.maxCorrectStreakDate;
            
            // Sync vocab lists from server to localStorage if they exist on server
            if (s.starredWords) {
                saveStarredWords(s.starredWords);
            }
            if (s.missedWords) {
                saveMissedWords(s.missedWords);
            }
            if (s.badges) {
                userBadges = s.badges;
            }
        }
    } catch (e) {
        console.warn('Failed to restore streaks from server:', e.message);
    }
    
    updateDaysStreak();
    
    const currentStreak = Number(localStorage.getItem(getCorrectStreakKey()) || 0);
    const maxStreak = Number(localStorage.getItem(getMaxCorrectStreakKey()) || 0);
    
    const el = document.getElementById('streak-correct');
    const countEl = document.getElementById('streak-correct-count');
    if (el && countEl) {
        countEl.textContent = currentStreak;
        el.setAttribute('title', `⚡ ${currentStreak} correct in a row! (Best: ${maxStreak})`);
    }
    
    // Apply color tier visuals on load
    applyStreakVisuals(currentStreak);
}

function startGlobalStudyTimer() {
    // Track user activity
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, () => { lastActivityTime = Date.now(); }, { passive: true });
    });
    
    if (globalStudyInterval) clearInterval(globalStudyInterval);
    globalStudyInterval = setInterval(() => {
        // Only count time if user was active in the last 2 minutes and window is focused
        const isActive = (Date.now() - lastActivityTime) < 120000;
        if (isActive && document.hasFocus()) {
            totalStudyTimeSeconds++;
            todayStudyTimeSeconds++;
            persistStudyTime();
            updateTimeKPI();
            updateDaysStreak();
        }
    }, 1000);
}

function showToast(message, type = 'warning') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('hide'), 2500);
    setTimeout(() => toast.remove(), 3000);
}

function showTimerToast(message) {
    const timerEl = document.getElementById('quiz-timer');
    if (!timerEl) return;
    timerEl.style.position = 'relative';
    const toast = document.createElement('div');
    toast.className = 'timer-toast';
    toast.innerHTML = message;
    Object.assign(toast.style, {
        position: 'absolute',
        top: '-40px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--accent-warning)',
        color: '#000',
        padding: '4px 10px',
        borderRadius: '8px',
        fontWeight: 'bold',
        fontSize: '0.85rem',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        zIndex: '100',
        opacity: '0',
        transition: 'opacity 0.3s ease-in-out'
    });
    timerEl.appendChild(toast);
    setTimeout(() => toast.style.opacity = '1', 10);
    setTimeout(() => toast.style.opacity = '0', 2000);
    setTimeout(() => toast.remove(), 2500);
}

function startPassiveStudyTimer() {
    // No-op: global study timer handles all time tracking
}

function stopPassiveStudyTimer() {
    // No-op: global study timer handles all time tracking
}

function startTimer() {
    chapterStartTime = Date.now();
    chapterElapsedSeconds = 0;
    questionStartTime = Date.now();
    
    // Clear any existing interval
    if (timerInterval) clearInterval(timerInterval);
    updateTimerModeDisplay();
    
    timerInterval = setInterval(() => {
        if (chapterStartTime && !timerPaused) {
            chapterElapsedSeconds = Math.floor((Date.now() - chapterStartTime) / 1000);
            updateTimerModeDisplay();
        } else if (timerPaused && chapterStartTime) {
            chapterStartTime += 1000;
        }
    }, 1000);
}

function stopTimer() {
    if (chapterStartTime) {
        chapterElapsedSeconds = Math.floor((Date.now() - chapterStartTime) / 1000);
        // Note: global study timer handles total/today time accumulation
    }
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    chapterStartTime = null;
}

function persistActiveStudyTime() {
    // Global study timer persists automatically every second
    persistStudyTime();
}

function updateTimerDisplay(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timerText = document.getElementById('quiz-timer-text');
    if (timerText) {
        timerText.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}

function updateTimerModeDisplay() {
    const enableCountdown = document.getElementById('enable-countdown');
    const timerEl = document.getElementById('quiz-timer');
    const timerText = document.getElementById('quiz-timer-text');
    const countdownEnabled = Boolean(enableCountdown && enableCountdown.checked);

    if (timerEl) timerEl.classList.toggle('countdown-active', countdownEnabled);

    if (countdownEnabled) {
        const limit = parseInt(document.getElementById('countdown-time')?.value, 10) || 60;
        const elapsedForQuestion = questionStartTime ? Math.floor((Date.now() - questionStartTime) / 1000) : 0;
        let remaining = Math.max(0, limit - elapsedForQuestion);
        
        if (timerPaused) {
            if (questionPausedRemaining === null) questionPausedRemaining = remaining;
            remaining = questionPausedRemaining;
        } else {
            questionPausedRemaining = null;
        }

        updateTimerDisplay(remaining);
        if (timerText) timerText.style.color = remaining <= 10 && remaining > 0 ? 'var(--accent-warning)' : (remaining === 0 ? 'var(--accent-error)' : '');
        
        if (remaining <= 10 && remaining > 0 && !timerPaused && !tenSecondsToastShown) {
            tenSecondsToastShown = true;
            showTimerToast("10 seconds left!");
        }
        
        if (remaining === 0 && !questionTimeExpired && !timerPaused) {
            questionTimeExpired = true;
            timerPaused = true;
            const q = quizQueue[state.currentQuestionIndex];
            const isMultiBlank = Array.isArray(q.options[0]);
            handleAnswer([], null, isMultiBlank);
        }
    } else {
        if (timerText) timerText.style.color = '';
        updateTimerDisplay(chapterElapsedSeconds);
    }
}

function formatTime(totalSeconds) {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hrs > 0) {
        return `${hrs}h ${mins}m`;
    } else if (mins > 0) {
        return `${mins}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

function formatTimeShort(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function isSentenceEquivalenceQuestion(question, chapterId = '') {
    return chapterId === '4' || /^SE Question/i.test(question.text || '') || /Sentence Equivalence/i.test(question.explanation || '');
}

function getCorrectAnswers(question) {
    if (Array.isArray(question.answers)) return question.answers;
    if (Array.isArray(question.answer)) return question.answer;
    return [question.answer];
}

function normalizeQuestionBank() {
    Object.entries(state.questions).forEach(([chapterId, questions]) => {
        questions.forEach(question => {
            if (!isSentenceEquivalenceQuestion(question, chapterId) || !Array.isArray(question.options)) return;

            const originalAnswers = getCorrectAnswers(question).filter(index => Number.isInteger(index));
            if (originalAnswers.length >= 2) {
                question.answers = originalAnswers.slice(0, 2);
                return;
            }

            const firstAnswer = originalAnswers[0] ?? question.answer;
            const firstAnswerText = question.options[firstAnswer];
            const synonym = SE_SYNONYM_PAIRS[String(firstAnswerText || '').toLowerCase()] || `${firstAnswerText} (synonym)`;
            let secondAnswer = question.options.findIndex((option, index) =>
                index !== firstAnswer && String(option).toLowerCase() === String(synonym).toLowerCase()
            );

            if (secondAnswer === -1) {
                question.options.push(synonym);
                secondAnswer = question.options.length - 1;
            }

            question.answers = [firstAnswer, secondAnswer].sort((a, b) => a - b);
        });
    });
}

function getQuestionKey(question) {
    return String(question.text || question.id || '')
        .replace(/^SE Question\s*\d*:\s*/i, 'SE Question: ')
        .replace(/^TC Question\s*\d*:\s*/i, 'TC Question: ')
        .replace(/^RC Question\s*\d*:\s*/i, 'RC Question: ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function getRecentCorrectQuestionKeys() {
    try {
        return JSON.parse(localStorage.getItem('recentCorrectQuestionKeys') || '[]');
    } catch (e) {
        return [];
    }
}

function rememberCorrectQuestion(question) {
    const key = getQuestionKey(question);
    const next = [key, ...getRecentCorrectQuestionKeys().filter(item => item !== key)].slice(0, 5);
    localStorage.setItem('recentCorrectQuestionKeys', JSON.stringify(next));
}

function isOnCorrectCooldown(question) {
    return getRecentCorrectQuestionKeys().includes(getQuestionKey(question));
}

function getTotalQuestionCount() {
    return state.chapters.reduce((total, chapter) => total + (state.questions[chapter.id]?.length || 0), 0);
}

function syncChaptersFromQuestionBank() {
    const knownChapters = {
        '1': { title: '1. Verbal Diagnostic Test', subject: 'Verbal' },
        '3': { title: '3. Text Completions', subject: 'Verbal' },
        '4': { title: '4. Sentence Equivalence', subject: 'Verbal' },
        '5': { title: '5. Reading Comprehension', subject: 'Verbal' },
        '6': { title: '6. Sentence Completion Multiple Blanks', subject: 'Verbal' }
    };

    Object.keys(state.questions).forEach(chapterId => {
        if (state.chapters.some(chapter => chapter.id === chapterId)) return;
        const meta = knownChapters[chapterId] || { title: `${chapterId}. Chapter ${chapterId}`, subject: 'Verbal' };
        state.chapters.push({
            id: chapterId,
            title: meta.title,
            subject: meta.subject,
            status: 'not-started',
            totalQuestions: state.questions[chapterId]?.length || 0
        });
    });

    state.chapters.forEach(chapter => {
        chapter.totalQuestions = state.questions[chapter.id]?.length || chapter.totalQuestions;
    });
    state.chapters.sort((a, b) => Number(a.id) - Number(b.id));
}

function splitQuestionLabel(text, fallbackNumber) {
    const match = String(text || '').match(/^((?:SE|TC|RC|SC)?\s*Question\s*\d+):\s*(.*)$/i);
    if (!match) {
        return { label: `Question ${fallbackNumber}`, body: text || '' };
    }
    return {
        label: match[1].replace(/\s+/g, ' ').trim(),
        body: match[2].trim()
    };
}

function getStatusCredit(status) {
    if (status === 'correct') return 1;
    if (status === 'revision') return 0.5; // partial credit: they missed it first
    return 0;
}

function getProgressAccuracy(chapterId = null) {
    const records = [];
    if (chapterId) {
        records.push(...Object.values(userProgress[chapterId] || {}));
    } else {
        Object.values(userProgress).forEach(chProgress => {
            records.push(...Object.values(chProgress || {}));
        });
    }
    const attemptedRecords = records.filter(item => (item.attempts || 0) > 0);
    if (attemptedRecords.length === 0) return { attempted: 0, correct: 0, percent: 0 };
    const correct = attemptedRecords.reduce((sum, item) => sum + getStatusCredit(item.status), 0);
    return {
        attempted: attemptedRecords.length,
        correct,
        percent: Math.round((correct / attemptedRecords.length) * 100)
    };
}

function refreshStatsFromProgress() {
    const overall = getProgressAccuracy();
    state.questionsAttempted = overall.attempted;
    state.correctAnswers = overall.correct;
    state.questionsCompleted = Math.round(overall.correct);
    state.diagnosticScore = computeVerbalScore(overall.correct, overall.attempted);
}

function computeVerbalScore(correct, attempted) {
    if (attempted === 0) return 0;
    const acc = correct / attempted;
    // Confidence ramp: score becomes more reliable as more questions are attempted
    // At 10 questions we only have ~30% confidence, at 50 we're at ~80%, at 100+ we're near full
    const confidence = Math.min(1, attempted / 120);
    // Raw score: map accuracy to 130-170 range with a slight curve
    // 0% accuracy = 130, 50% = ~148, 75% = ~158, 90% = ~165, 100% = 170
    const rawScore = 130 + Math.pow(acc, 1.3) * 40;
    // Blend raw score with baseline (130) based on confidence
    const blendedScore = 130 + (rawScore - 130) * confidence;
    return Math.round(Math.min(170, Math.max(130, blendedScore)));
}

// Current user info (populated on load)
let currentUsername = '';

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOMContentLoaded started");
    syncChaptersFromQuestionBank();

    // Preload flashcards in background
    fetch('/flashcards.json')
        .then(r => r.ok ? r.json() : [])
        .then(raw => {
            flashcardsData = raw.map((fc, i) => ({ ...fc, id: i }));
        })
        .catch(err => console.error("Failed to preload flashcards", err));
    
    // Auth Check
    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (!data.loggedIn) {
            window.location.href = '/login';
            return;
        }
        
        currentUsername = data.username;
        await loadStoredStudyTime();
        await loadStoredStreaks();
        startGlobalStudyTimer();
        
        // Sync stats to server on page unload
        window.addEventListener('beforeunload', _forceStatsSync);
        // Also periodic sync every 60 seconds as a safety net
        setInterval(_syncStatsToServer, 60000);
        
        // Update UI with user info
        const capitalizedName = data.username.charAt(0).toUpperCase() + data.username.slice(1);
        document.getElementById('nav-avatar').innerText = data.username.charAt(0).toUpperCase();
        document.getElementById('dropdown-username').innerText = data.username;
        
        // Personalize welcome message
        const welcomeH1 = document.querySelector('.welcome-text h1');
        if (welcomeH1) welcomeH1.textContent = `Welcome back, ${capitalizedName}`;
        
        const overviewAvatar = document.querySelector('.user-profile .avatar');
        const overviewName = document.querySelector('.user-profile .user-name');
        if (overviewAvatar) overviewAvatar.innerText = data.username.charAt(0).toUpperCase();
        if (overviewName) overviewName.innerText = data.username;
        
        // Keep session alive to prevent progress loss
        setInterval(() => {
            fetch('/api/me').catch(() => {});
        }, 15 * 60 * 1000);
        
    } catch (e) {
        console.error("Auth check failed", e);
    }

    normalizeQuestionBank();
    
    // Load saved progress from server
    try {
        const pRes = await fetch('/api/progress');
        const pData = await pRes.json();
        if (pData.progress) {
            userProgress = pData.progress;
            rehydrateStatsFromProgress();
        }
    } catch (e) {
        console.error("Progress load failed", e);
    }
    
    setupEventListeners();
    setupProfileModal();
    setupCalendarAndStatsModals();
    window.addEventListener('beforeunload', persistActiveStudyTime);

    // Scroll-based shine animation logic
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        const updateScrollShine = () => {
            const scrollTop = mainContent.scrollTop;
            const scrollHeight = mainContent.scrollHeight - mainContent.clientHeight;
            const scrollPercent = scrollHeight > 0 ? (scrollTop / scrollHeight) : 0;
            document.documentElement.style.setProperty('--scroll-percent', scrollPercent);
        };
        mainContent.addEventListener('scroll', updateScrollShine, { passive: true });
        updateScrollShine();
    }
    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPercent = scrollHeight > 0 ? (scrollTop / scrollHeight) : 0;
        document.documentElement.style.setProperty('--scroll-percent', scrollPercent);
    }, { passive: true });
    
    try {
        initCharts();
    } catch (e) {
        console.error("Failed to initialize charts", e);
    }
    
    // Calculate total questions for UI
    let totalQ = getTotalQuestionCount();
    document.querySelectorAll('.stat-row span')[3].innerText = totalQ.toLocaleString() + ' Qs';
    
    renderDashboard();
    console.log("DOMContentLoaded finished");
});

// Rehydrate state stats from saved progress
function rehydrateStatsFromProgress() {
    state.chaptersCompleted = 0;
    for (const chId of Object.keys(userProgress)) {
        const chProgress = userProgress[chId];
        // Check if chapter is completed or in-progress
        const chapter = state.chapters.find(c => c.id === chId);
        if (chapter) {
            const totalQs = state.questions[chId] ? state.questions[chId].length : 0;
            const attemptedQs = Object.keys(chProgress).length;
            if (attemptedQs >= totalQs && totalQs > 0) {
                chapter.status = 'completed';
                state.chaptersCompleted++;
            } else if (attemptedQs > 0) {
                chapter.status = 'in-progress';
            }
        }
    }
    refreshStatsFromProgress();
}

function setupEventListeners() {
    // Mobile menu toggle
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    function openSidebar() {
        sidebar.classList.add('open');
        mobileToggle.classList.add('active');
        sidebarOverlay.classList.add('active');
        sidebarOverlay.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        mobileToggle.classList.remove('active');
        sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => { sidebarOverlay.style.display = 'none'; }, 300);
    }

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            if (sidebar.classList.contains('open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // Navigation (auto-close sidebar on mobile)
    function setActiveNav(activeId) {
        document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.id === activeId));
    }

    function showOverviewSection(activeId, selector) {
        switchView('overview');
        setActiveNav(activeId);
        closeSidebar();
        requestAnimationFrame(() => {
            const target = selector ? document.querySelector(selector) : document.querySelector('.topbar');
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    document.getElementById('nav-overview').addEventListener('click', (e) => { e.preventDefault(); showOverviewSection('nav-overview', '.topbar'); });
    document.getElementById('nav-chapters').addEventListener('click', (e) => { e.preventDefault(); showOverviewSection('nav-chapters', '.table-section'); });
    document.getElementById('nav-flashcards').addEventListener('click', (e) => { e.preventDefault(); showOverviewSection('nav-flashcards', '#flashcards-view'); switchView('flashcards'); });
    document.getElementById('nav-vocab').addEventListener('click', (e) => { e.preventDefault(); showOverviewSection('nav-vocab', '#vocab-view'); switchView('vocab'); showVocabTab('missed'); });
    document.getElementById('back-to-overview').addEventListener('click', () => {
        stopTimer(); // Stop timer if leaving quiz mid-way
        switchView('overview');
    });
    document.getElementById('results-home-btn').addEventListener('click', () => switchView('overview'));
    document.getElementById('start-diagnostic-btn').addEventListener('click', () => {
        startChapter('1');
    });
    
    // Quiz Actions
    document.getElementById('next-question-btn').addEventListener('click', nextQuestion);
    
    // Profile Actions
    const profileWidget = document.getElementById('profile-widget');
    const profileDropdown = document.getElementById('profile-dropdown');
    
    if (profileWidget) {
        profileWidget.addEventListener('click', (e) => {
            if (e.target.id !== 'logout-btn' && e.target.id !== 'edit-profile-btn') {
                profileDropdown.style.display = profileDropdown.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (profileWidget && !profileWidget.contains(e.target)) {
            profileDropdown.style.display = 'none';
        }
    });

    // Edit Profile button
    document.getElementById('edit-profile-btn').addEventListener('click', () => {
        profileDropdown.style.display = 'none';
        openProfileModal();
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    // Timer dropdown logic
    const timerSettingsBtn = document.getElementById('timer-settings-btn');
    const timerSettingsDropdown = document.getElementById('timer-settings-dropdown');
    if (timerSettingsBtn && timerSettingsDropdown) {
        timerSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const prompt = document.getElementById('timer-challenge-prompt');
            if (prompt) prompt.style.display = 'none';
            timerSettingsDropdown.style.display = timerSettingsDropdown.style.display === 'none' ? 'block' : 'none';
        });
        timerSettingsDropdown.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', (e) => {
            if (!timerSettingsBtn.contains(e.target) && !timerSettingsDropdown.contains(e.target)) {
                timerSettingsDropdown.style.display = 'none';
            }
        });
    }

    const timerAddBtn = document.getElementById('timer-add-btn');
    const timerSubBtn = document.getElementById('timer-sub-btn');
    const countdownInput = document.getElementById('countdown-time');
    const enableCountdown = document.getElementById('enable-countdown');
    
    if (timerAddBtn && timerSubBtn && countdownInput) {
        timerAddBtn.addEventListener('click', () => {
            let val = parseInt(countdownInput.value, 10) || 60;
            countdownInput.value = val + 15;
            questionStartTime = Date.now();
            updateTimerModeDisplay();
        });
        timerSubBtn.addEventListener('click', () => {
            let val = parseInt(countdownInput.value, 10) || 60;
            if (val > 15) {
                countdownInput.value = val - 15;
            }
            questionStartTime = Date.now();
            updateTimerModeDisplay();
        });
    }
    if (enableCountdown) {
        enableCountdown.addEventListener('change', () => {
            const prompt = document.getElementById('timer-challenge-prompt');
            if (prompt && enableCountdown.checked) {
                prompt.style.display = 'none';
            }
            questionStartTime = Date.now();
            updateTimerModeDisplay();
        });
    }

    // Close button for challenge prompt
    const closeTimerPrompt = document.getElementById('close-timer-prompt');
    if (closeTimerPrompt) {
        closeTimerPrompt.addEventListener('click', (e) => {
            e.stopPropagation();
            const prompt = document.getElementById('timer-challenge-prompt');
            if (prompt) prompt.style.display = 'none';
        });
    }

    // Chapters breakdown modal events
    const completedCard = document.getElementById('kpi-completed-card');
    const chaptersModalOverlay = document.getElementById('chapters-modal-overlay');
    const chaptersModalClose = document.getElementById('chapters-modal-close');
    
    if (completedCard) {
        completedCard.addEventListener('click', () => {
            openChaptersBreakdownModal();
        });
    }
    
    if (chaptersModalClose) {
        chaptersModalClose.addEventListener('click', () => {
            chaptersModalOverlay.classList.remove('open');
        });
    }
    
    if (chaptersModalOverlay) {
        chaptersModalOverlay.addEventListener('click', (e) => {
            if (e.target === chaptersModalOverlay) {
                chaptersModalOverlay.classList.remove('open');
            }
        });
    }
}

// === PROFILE MODAL ===

function openProfileModal() {
    document.getElementById('profile-current-username').value = currentUsername;
    document.getElementById('profile-new-username').value = '';
    document.getElementById('profile-current-password').value = '';
    document.getElementById('profile-new-password').value = '';
    document.getElementById('profile-confirm-password').value = '';
    document.getElementById('username-msg').textContent = '';
    document.getElementById('username-msg').className = 'modal-msg';
    document.getElementById('password-msg').textContent = '';
    document.getElementById('password-msg').className = 'modal-msg';
    document.getElementById('profile-modal-overlay').classList.add('open');
}

function closeProfileModal() {
    document.getElementById('profile-modal-overlay').classList.remove('open');
}

function setupProfileModal() {
    // Close modal
    document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);
    document.getElementById('profile-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeProfileModal();
    });

    // Tab switching
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.querySelector(`.modal-tab-content[data-tab="${tabId}"]`).classList.add('active');
        });
    });

    // Username form
    document.getElementById('username-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('username-msg');
        const newUsername = document.getElementById('profile-new-username').value.trim();
        
        if (!newUsername || newUsername.length < 2) {
            msgEl.textContent = 'Username must be at least 2 characters';
            msgEl.className = 'modal-msg error';
            return;
        }

        try {
            const res = await fetch('/api/profile/username', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newUsername })
            });
            const data = await res.json();
            
            if (data.success) {
                currentUsername = data.username;
                document.getElementById('nav-avatar').innerText = currentUsername.charAt(0).toUpperCase();
                document.getElementById('dropdown-username').innerText = currentUsername;
                document.getElementById('profile-current-username').value = currentUsername;
                document.getElementById('profile-new-username').value = '';
                msgEl.textContent = 'Username updated successfully!';
                msgEl.className = 'modal-msg success';
            } else {
                msgEl.textContent = data.error || 'Failed to update username';
                msgEl.className = 'modal-msg error';
            }
        } catch (err) {
            msgEl.textContent = 'Connection error';
            msgEl.className = 'modal-msg error';
        }
    });

    // Password form
    document.getElementById('password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('password-msg');
        const currentPassword = document.getElementById('profile-current-password').value;
        const newPassword = document.getElementById('profile-new-password').value;
        const confirmPassword = document.getElementById('profile-confirm-password').value;

        if (newPassword !== confirmPassword) {
            msgEl.textContent = 'New passwords do not match';
            msgEl.className = 'modal-msg error';
            return;
        }

        if (newPassword.length < 4) {
            msgEl.textContent = 'Password must be at least 4 characters';
            msgEl.className = 'modal-msg error';
            return;
        }

        try {
            const res = await fetch('/api/profile/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const data = await res.json();

            if (data.success) {
                document.getElementById('profile-current-password').value = '';
                document.getElementById('profile-new-password').value = '';
                document.getElementById('profile-confirm-password').value = '';
                msgEl.textContent = 'Password updated successfully!';
                msgEl.className = 'modal-msg success';
            } else {
                msgEl.textContent = data.error || 'Failed to update password';
                msgEl.className = 'modal-msg error';
            }
        } catch (err) {
            msgEl.textContent = 'Connection error';
            msgEl.className = 'modal-msg error';
        }
    });

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('profile-modal-overlay').classList.contains('open')) {
            closeProfileModal();
        }
    });
}
// === CALENDAR & STATS MODALS ===
let currentCalendarYear = new Date().getFullYear();
let currentCalendarMonth = new Date().getMonth();

function setupCalendarAndStatsModals() {
    // Days Streak -> Calendar Modal
    const daysStreakBadge = document.getElementById('streak-days');
    const calendarModalOverlay = document.getElementById('calendar-modal-overlay');
    const calendarModalClose = document.getElementById('calendar-modal-close');
    const prevMonthBtn = document.getElementById('calendar-prev-month');
    const nextMonthBtn = document.getElementById('calendar-next-month');

    if (daysStreakBadge) {
        daysStreakBadge.addEventListener('click', () => {
            currentCalendarYear = new Date().getFullYear();
            currentCalendarMonth = new Date().getMonth();
            renderCalendar();
            calendarModalOverlay.classList.add('open');
        });
    }

    if (calendarModalClose) {
        calendarModalClose.addEventListener('click', () => calendarModalOverlay.classList.remove('open'));
    }

    if (calendarModalOverlay) {
        calendarModalOverlay.addEventListener('click', (e) => {
            if (e.target === calendarModalOverlay) calendarModalOverlay.classList.remove('open');
        });
    }

    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
            currentCalendarMonth--;
            if (currentCalendarMonth < 0) {
                currentCalendarMonth = 11;
                currentCalendarYear--;
            }
            renderCalendar();
        });
    }

    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', () => {
            currentCalendarMonth++;
            if (currentCalendarMonth > 11) {
                currentCalendarMonth = 0;
                currentCalendarYear++;
            }
            renderCalendar();
        });
    }

    // Correct Streak -> Stats Modal
    const correctStreakBadge = document.getElementById('streak-correct');
    const statsModalOverlay = document.getElementById('streak-stats-modal-overlay');
    const statsModalClose = document.getElementById('streak-stats-modal-close');

    if (correctStreakBadge) {
        correctStreakBadge.addEventListener('click', () => {
            const avgEl = document.getElementById('stat-avg-streak');
            const maxEl = document.getElementById('stat-max-streak');
            const maxDateEl = document.getElementById('stat-max-streak-date');
            
            const currentStreak = Number(localStorage.getItem(getCorrectStreakKey()) || 0);
            const totalC = sumOfCorrectStreaks + currentStreak;
            const completedC = totalStreaksCompleted + (currentStreak > 0 ? 1 : 0);
            
            let avg = 0;
            if (completedC > 0) {
                avg = Math.round((totalC / completedC) * 10) / 10;
            }
            
            avgEl.textContent = avg;
            maxEl.textContent = localStorage.getItem(getMaxCorrectStreakKey()) || 0;
            maxDateEl.textContent = maxCorrectStreakDate || '-';
            
            statsModalOverlay.classList.add('open');
        });
    }

    if (statsModalClose) {
        statsModalClose.addEventListener('click', () => statsModalOverlay.classList.remove('open'));
    }

    if (statsModalOverlay) {
        statsModalOverlay.addEventListener('click', (e) => {
            if (e.target === statsModalOverlay) statsModalOverlay.classList.remove('open');
        });
    }
}

function renderCalendar() {
    const monthYearEl = document.getElementById('calendar-month-year');
    const gridEl = document.getElementById('calendar-grid');
    const currentStreakEl = document.getElementById('calendar-current-streak');
    
    if (!monthYearEl || !gridEl) return;

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    monthYearEl.textContent = `${monthNames[currentCalendarMonth]} ${currentCalendarYear}`;

    gridEl.innerHTML = '';

    const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
    const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    const today = new Date();
    
    // Fill empty cells before the 1st
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day-cell empty';
        gridEl.appendChild(emptyCell);
    }

    // Determine max study time in the month for scaling
    let maxStudyTimeInMonth = 1; // avoid div by 0
    for (let i = 1; i <= daysInMonth; i++) {
        const dStr = `${currentCalendarYear}-${String(currentCalendarMonth+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        if (dailyActivity[dStr] && dailyActivity[dStr] > maxStudyTimeInMonth) {
            maxStudyTimeInMonth = dailyActivity[dStr];
        }
    }
    
    // Cap the goal scale at 1 hour (3600 seconds) so studying an hour gives a full circle
    const MAX_SCALE_SECONDS = 3600;

    for (let i = 1; i <= daysInMonth; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell';
        cell.textContent = i;
        
        const dStr = `${currentCalendarYear}-${String(currentCalendarMonth+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        
        // Highlight today
        if (today.getFullYear() === currentCalendarYear && today.getMonth() === currentCalendarMonth && today.getDate() === i) {
            cell.classList.add('today');
        }

        // Highlight active days
        if (dailyActivity[dStr] > 0) {
            cell.classList.add('active-day');
            
            // Calculate scale: min 0.3, max 1.1 depending on study time
            let ratio = dailyActivity[dStr] / MAX_SCALE_SECONDS;
            if (ratio > 1) ratio = 1;
            const scale = 0.3 + (ratio * 0.8); 
            cell.style.setProperty('--activity-scale', scale);
            cell.title = `Studied for ${Math.round(dailyActivity[dStr] / 60)} mins`;
        }

        gridEl.appendChild(cell);
    }
    
    if (currentStreakEl) {
        currentStreakEl.textContent = localStorage.getItem(getDaysStreakKey()) || 0;
    }
}

function switchView(viewName) {
    if (currentViewName === 'flashcards' && viewName !== 'flashcards') {
        stopPassiveStudyTimer();
    }

    document.getElementById('overview-view').style.display = viewName === 'overview' ? 'block' : 'none';
    document.getElementById('quiz-view').style.display = viewName === 'quiz' ? 'block' : 'none';
    document.getElementById('results-view').style.display = viewName === 'results' ? 'block' : 'none';
    document.getElementById('flashcards-view').style.display = viewName === 'flashcards' ? 'block' : 'none';
    document.getElementById('vocab-view').style.display = viewName === 'vocab' ? 'block' : 'none';

    if (viewName === 'overview') {
        renderDashboard(); // Refresh stats when coming back
    } else if (viewName === 'flashcards') {
        if (typeof flashcardsData === 'undefined' || flashcardsData.length === 0) {
            loadFlashcards();
        } else if (flashcardQueue.length === 0) {
            // Data was preloaded but queue wasn't built yet — build and show
            loadFlashcards();
        }
    }

    if (viewName === 'flashcards') {
        startPassiveStudyTimer();
    }
    currentViewName = viewName;
}

function renderDashboard() {
    // Update KPI Cards
    refreshStatsFromProgress();
    const acc = state.questionsAttempted > 0 ? Math.round((state.correctAnswers / state.questionsAttempted) * 100) : 0;
    
    document.getElementById('kpi-score').innerHTML = `${state.diagnosticScore > 0 ? state.diagnosticScore : '--'}<span class="kpi-sub">/170</span>`;
    document.getElementById('top-target-score').innerText = `Current: ${state.diagnosticScore > 0 ? state.diagnosticScore : '--'} / 170`;
    
    if (state.diagnosticScore > 0) {
        const minQForReliable = 50;
        if (state.questionsAttempted < minQForReliable) {
            document.getElementById('kpi-score-trend').innerText = `Estimated (${state.questionsAttempted}/${minQForReliable} Qs for reliable score)`;
            document.getElementById('kpi-score-trend').className = 'kpi-trend neutral';
        } else {
            document.getElementById('kpi-score-trend').innerText = `Based on ${state.questionsAttempted} questions`;
            document.getElementById('kpi-score-trend').className = 'kpi-trend positive';
        }
    }

    const totalQuestions = getTotalQuestionCount();
    document.getElementById('kpi-attempted').innerHTML = `${state.questionsCompleted}<span class="kpi-sub">/${totalQuestions}</span>`;
    const accEl = document.getElementById('kpi-accuracy');
    accEl.innerText = `Accuracy: ${state.questionsAttempted > 0 ? acc + '%' : '--'}`;
    // Dynamic accuracy color
    if (state.questionsAttempted > 0) {
        if (acc >= 70) { accEl.className = 'kpi-trend positive'; }
        else if (acc >= 40) { accEl.className = 'kpi-trend neutral'; }
        else { accEl.className = 'kpi-trend negative'; }
    } else {
        accEl.className = 'kpi-trend neutral';
    }
    
    const attemptedBar = document.getElementById('kpi-attempted-bar');
    if (attemptedBar) {
        attemptedBar.style.width = `${totalQuestions > 0 ? (state.questionsCompleted / totalQuestions) * 100 : 0}%`;
    }

    // Update time KPI
    updateTimeKPI();
    
    // Evaluate and Render Achievements
    checkAndRenderAchievements();

    // Render Table
    const tbody = document.getElementById('chapter-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    state.chapters.forEach(ch => {
        let statusHtml = '';
        let actionHtml = '';
        
        if (ch.status === 'completed') {
            statusHtml = `<span class="status completed">Completed</span>`;
            actionHtml = `<span class="action-link" style="color:var(--text-secondary)">Review</span>`;
        } else if (ch.status === 'in-progress') {
            statusHtml = `<span class="status in-progress">In Progress</span>`;
            actionHtml = `<button class="action-link" onclick="startChapter('${ch.id}')" style="background:none;border:none;cursor:pointer;font-size:1rem;">Continue</button>`;
        } else {
            statusHtml = `<span class="status not-started">Not Started</span>`;
            if (state.questions[ch.id] && state.questions[ch.id].length > 0) {
                actionHtml = `<button class="action-link" onclick="startChapter('${ch.id}')" style="background:none;border:none;cursor:pointer;font-size:1rem;">Start Chapter</button>`;
            } else {
                actionHtml = `<span style="color:var(--text-secondary);font-size:0.85rem">Coming Soon</span>`;
            }
        }

        tbody.innerHTML += `
            <tr>
                <td>${ch.title}</td>
                <td>${ch.subject} <span style="font-size:0.75rem;opacity:0.6;">(${ch.totalQuestions} Qs)</span></td>
                <td>${statusHtml}</td>
                <td>${actionHtml}</td>
            </tr>
        `;
    });

    updateCharts();
}

function updateTimeKPI() {
    const timeEl = document.getElementById('kpi-time');
    const trendEl = document.getElementById('kpi-time-trend');
    const todayEl = document.getElementById('kpi-time-today');
    if (!timeEl) return;

    // All-time display
    const displayTime = totalStudyTimeSeconds;
    const hrs = Math.floor(displayTime / 3600);
    const mins = Math.floor((displayTime % 3600) / 60);

    if (hrs > 0) {
        timeEl.innerHTML = `${hrs}<span class="kpi-sub">h</span> ${mins}<span class="kpi-sub">m</span>`;
    } else {
        timeEl.innerHTML = `${mins}<span class="kpi-sub">min</span>`;
    }

    // Show per-question average if we have data
    if (state.questionsAttempted > 0) {
        const avgSecs = Math.round(displayTime / state.questionsAttempted);
        trendEl.innerText = `~${avgSecs}s per question`;
        trendEl.className = 'kpi-trend neutral';
    } else {
        trendEl.innerText = 'All time';
        trendEl.className = 'kpi-trend neutral';
    }

    // Today's time display
    if (todayEl) {
        const todayHrs = Math.floor(todayStudyTimeSeconds / 3600);
        const todayMins = Math.floor((todayStudyTimeSeconds % 3600) / 60);
        if (todayHrs > 0) {
            todayEl.textContent = `${todayHrs}h ${todayMins}m`;
        } else {
            todayEl.textContent = `${todayMins}m`;
        }
    }
}

function getChapterAccuracy(chapterId) {
    return getProgressAccuracy(chapterId).percent;
}

function getWeeklyScoreProgression() {
    const records = [];
    Object.values(userProgress).forEach(chProgress => {
        Object.values(chProgress).forEach(item => {
            if (item.lastAttemptedAt) records.push(item);
        });
    });

    const validRecords = records.filter(item => item.lastAttemptedAt && !isNaN(new Date(item.lastAttemptedAt).getTime()));
    validRecords.sort((a, b) => new Date(a.lastAttemptedAt) - new Date(b.lastAttemptedAt));
    if (validRecords.length === 0) {
        return { labels: ['Week 1'], data: [130] };
    }

    const firstDate = new Date(validRecords[0].lastAttemptedAt);
    const weekly = new Map();
    validRecords.forEach(item => {
        const weekIndex = Math.floor((new Date(item.lastAttemptedAt) - firstDate) / (7 * 24 * 60 * 60 * 1000));
        if (!weekly.has(weekIndex)) weekly.set(weekIndex, { attempted: 0, correct: 0 });
        const bucket = weekly.get(weekIndex);
        bucket.attempted += 1;
        bucket.correct += getStatusCredit(item.status);
    });

    let cumulativeAttempted = 0;
    let cumulativeCorrect = 0;
    const labels = [];
    const data = [];
    [...weekly.keys()].sort((a, b) => a - b).forEach(weekIndex => {
        const bucket = weekly.get(weekIndex);
        cumulativeAttempted += bucket.attempted;
        cumulativeCorrect += bucket.correct;
        const weekScore = computeVerbalScore(cumulativeCorrect, cumulativeAttempted);
        labels.push(`Week ${weekIndex + 1}`);
        data.push(weekScore);
    });

    return { labels, data };
}

function updateCharts() {
    const baseLabels = ['Diagnostic', 'Text Comp.', 'Sentence Eq.', 'Reading Comp.', 'Multi-Blank', 'Flashcards'];
    
    if (accuracyChartInstance) {
        const data = [
            ...state.chapters.map(chapter => getChapterAccuracy(chapter.id)),
            getChapterAccuracy('flashcards')
        ];
        accuracyChartInstance.data.datasets[0].data = data;
        
        // Multi-line labels with grade at the vertex
        accuracyChartInstance.data.labels = baseLabels.map((label, i) => {
            const grade = getGradeFromAccuracy(data[i]);
            return [label, `Grade: ${grade}`];
        });
        accuracyChartInstance.update();
    }

    if (progressionChartInstance) {
        const progression = getWeeklyScoreProgression();
        progressionChartInstance.data.labels = progression.labels;
        progressionChartInstance.data.datasets[0].data = progression.data;
        progressionChartInstance.update();
    }
}

// === QUIZ ENGINE ===

let currentQuizCorrect = 0;
let currentQuizAttempted = 0;

// Build the quiz queue using user-defined probabilities:
// 60% unseen, 20% missed, 10% revision, 10% correct
function deduplicateQuestions(questions) {
    const seen = new Map();
    const unique = [];
    questions.forEach(q => {
        const key = (q.text || '').replace(/^SC Question\s*\d+:\s*/i, 'SC: ')
            .replace(/^SE Question\s*\d+:\s*/i, 'SE: ')
            .replace(/^TC Question\s*\d+:\s*/i, 'TC: ')
            .replace(/^RC Question\s*\d+:\s*/i, 'RC: ')
            .replace(/^Question\s*\d+:\s*/i, 'Q: ')
            .replace(/\s+/g, ' ').trim().toLowerCase();
        if (!seen.has(key)) {
            seen.set(key, q);
            unique.push(q);
        }
    });
    return unique;
}

function buildQuizQueue(chapterId) {
    const allQuestions = deduplicateQuestions(state.questions[chapterId] || []);
    const chProgress = userProgress[chapterId] || {};

    const unseen = [], missed = [], revision = [], correct = [];
    allQuestions.forEach((q, idx) => {
        const p = chProgress[q.id || idx];
        if (!p) { unseen.push(q); }
        else if (p.status === 'missed') { missed.push(q); }
        else if (p.status === 'revision') { revision.push(q); }
        else if (p.status === 'correct') { correct.push(q); }
        else { unseen.push(q); }
    });

    shuffleArray(unseen);
    shuffleArray(missed);
    shuffleArray(revision);
    shuffleArray(correct);

    const pools = [
        { arr: unseen, weight: 5, tag: 'new' },
        { arr: missed, weight: 2, tag: 'missed' },
        { arr: revision, weight: 2, tag: 'revision' },
        { arr: correct, weight: 1, tag: 'correct_review' }
    ];

    let queue = [];
    const totalQuestions = unseen.length + missed.length + revision.length + correct.length;

    for (let i = 0; i < totalQuestions; i++) {
        let availablePools = pools.filter(p => p.arr.length > 0);
        if (availablePools.length === 0) break;

        let totalWeight = availablePools.reduce((sum, p) => sum + p.weight, 0);
        let rand = Math.random() * totalWeight;
        let cumulative = 0;

        for (let p of availablePools) {
            cumulative += p.weight;
            if (rand <= cumulative) {
                const q = p.arr.pop();
                q._tag = p.tag;
                queue.push(q);
                break;
            }
        }
    }

    // For diagnostic test (chapter 1), cluster RC questions together
    if (chapterId === '1') {
        queue = clusterRCQuestions(queue);
    }

    return queue;
}

// Cluster RC questions (those with passages) together in sequence
function clusterRCQuestions(questions) {
    const rc = [], nonRc = [];
    const passageGroups = {};

    questions.forEach(q => {
        if (q.passage) {
            const key = q.passage.substring(0, 100);
            if (!passageGroups[key]) passageGroups[key] = [];
            passageGroups[key].push(q);
        } else {
            nonRc.push(q);
        }
    });

    // Build ordered list: non-RC first in order, then each RC passage group together
    const result = [...nonRc];
    // Insert RC groups interspersed (every ~3 non-RC questions, insert an RC group)
    const rcGroups = Object.values(passageGroups);
    if (rcGroups.length === 0) return result;

    // Sort RC within each group by id
    rcGroups.forEach(g => g.sort((a, b) => (a.id || 0) - (b.id || 0)));

    // Interleave: place RC clusters at regular intervals
    const interval = Math.max(3, Math.floor(nonRc.length / (rcGroups.length + 1)));
    const finalQueue = [];
    let nonRcIdx = 0, rcIdx = 0;

    while (nonRcIdx < nonRc.length || rcIdx < rcGroups.length) {
        // Add a batch of non-RC
        const batchEnd = Math.min(nonRcIdx + interval, nonRc.length);
        for (let i = nonRcIdx; i < batchEnd; i++) {
            finalQueue.push(nonRc[i]);
        }
        nonRcIdx = batchEnd;

        // Add an RC cluster
        if (rcIdx < rcGroups.length) {
            rcGroups[rcIdx].forEach(q => finalQueue.push(q));
            rcIdx++;
        }
    }

    return finalQueue;
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

window.startChapter = function(chapterId) {
    if (!state.questions[chapterId] || state.questions[chapterId].length === 0) {
        alert("No questions found for this chapter!");
        return;
    }
    
    state.currentChapterId = chapterId;
    state.currentQuestionIndex = 0;
    
    // Build spaced-repetition queue
    quizQueue = buildQuizQueue(chapterId);

    if (quizQueue.length === 0) {
        alert("You've completed all questions in this chapter! All questions are marked correct.");
        return;
    }
    
    // Reset chapter stats
    currentQuizCorrect = 0;
    currentQuizAttempted = 0;
    
    const chapter = state.chapters.find(c => c.id === chapterId);
    chapter.status = 'in-progress';
    
    document.getElementById('quiz-chapter-title').innerText = chapter.title;
    document.getElementById('total-q-num').innerText = quizQueue.length;
    
    // Start timer
    startTimer();
    
    renderQuestion();
    switchView('quiz');
}

function renderQuestion() {
    const q = quizQueue[state.currentQuestionIndex];
    selectedAnswerIndexes = [];
    
    document.getElementById('current-q-num').innerText = state.currentQuestionIndex + 1;
    
    // Reset question timer
    questionStartTime = Date.now();
    timerPaused = false;
    questionTimeExpired = false;
    tenSecondsToastShown = false;
    questionPausedRemaining = null;
    updateTimerModeDisplay();

    const questionParts = splitQuestionLabel(q.text, state.currentQuestionIndex + 1);
    let body = questionParts.body;
    body = body.replace(/\b(?:a\/an|a|an)\s+(_+)/gi, "a/an $1");
    document.getElementById('quiz-question-number').innerText = questionParts.label;
    const tagEl = document.getElementById('quiz-question-tag');

    const statusTag = {
        new: { className: 'question-tag new', text: 'New' },
        correct_review: { className: 'question-tag correct-review', text: 'Correct last time' },
        revision: { className: 'question-tag revision', text: 'Revision' },
        missed: { className: 'question-tag missed', text: 'Missed last time' }
    }[q._tag] || { className: 'question-tag new', text: 'New' };
    tagEl.className = statusTag.className;
    tagEl.innerText = statusTag.text;
    tagEl.style.display = 'inline-flex';

    // Render passage
    const passageEl = document.getElementById('quiz-passage');
    if (q.passage) {
        passageEl.innerText = q.passage;
        passageEl.style.display = 'block';
    } else {
        passageEl.style.display = 'none';
    }

    // Render text & options
    const optsContainer = document.getElementById('quiz-options-container');
    optsContainer.innerHTML = '';
    
    const correctAnswers = getCorrectAnswers(q);
    const isMultiBlank = Array.isArray(q.options[0]);
    const isMultiAnswer = !isMultiBlank && correctAnswers.length > 1;
    document.getElementById('quiz-question-text').innerText = body;

    const instructionEl = document.getElementById('quiz-question-instruction');
    if (isMultiBlank) {
        instructionEl.innerText = `Select one entry for each blank. (${q.options.length} blanks)`;
        instructionEl.style.display = 'block';
    } else if (isMultiAnswer) {
        instructionEl.innerText = 'Select exactly two answer choices.';
        instructionEl.style.display = 'block';
    } else {
        instructionEl.style.display = 'none';
    }
    
    // Challenge prompt logic
    const enableCountdown = document.getElementById('enable-countdown');
    const challengePrompt = document.getElementById('timer-challenge-prompt');
    if (enableCountdown && !enableCountdown.checked && challengePrompt) {
        if (state.currentQuestionIndex === 0) {
            challengePrompt.style.display = 'block';
            // Auto hide after 6 seconds
            setTimeout(() => {
                if (challengePrompt.style.display === 'block') {
                    challengePrompt.style.display = 'none';
                }
            }, 6000);
        }
    } else if (challengePrompt) {
        challengePrompt.style.display = 'none';
    }
    
    if (isMultiBlank) {
        multiBlankSelections = {};
        optsContainer.style.display = 'flex';
        optsContainer.style.gap = '2rem';
        optsContainer.style.flexWrap = 'wrap';

        q.options.forEach((blankOptions, blankIndex) => {
            let indices = blankOptions.map((_, i) => i);
            shuffleArray(indices);
            
            const groupDiv = document.createElement('div');
            groupDiv.className = 'quiz-blank-group';
            groupDiv.style.flex = '1';
            groupDiv.style.minWidth = '200px';
            
            const groupTitle = document.createElement('h4');
            groupTitle.innerText = `Blank ${blankIndex + 1}`;
            groupTitle.style.marginBottom = '10px';
            groupTitle.style.color = 'var(--text-secondary)';
            groupDiv.appendChild(groupTitle);
            
            indices.forEach((optIndex, loopIndex) => {
                const optText = blankOptions[optIndex];
                const div = document.createElement('div');
                div.className = 'quiz-option';
                div.dataset.blank = blankIndex;
                div.dataset.option = optIndex;
                div.innerHTML = `<span style="font-weight:600;color:var(--text-secondary);min-width:24px;">${String.fromCharCode(65 + loopIndex)}.</span> <span>${optText}</span>`;
                
                div.addEventListener('click', () => {
                    const groupOptions = document.querySelectorAll(`.quiz-option[data-blank="${blankIndex}"]`);
                    groupOptions.forEach(el => el.classList.remove('selected'));
                    
                    div.classList.add('selected');
                    multiBlankSelections[blankIndex] = optIndex;
                    
                    if (Object.keys(multiBlankSelections).length === q.options.length) {
                        const selected = [];
                        for (let i = 0; i < q.options.length; i++) {
                            selected.push(multiBlankSelections[i]);
                        }
                        handleAnswer(selected, null, true);
                    }
                });
                groupDiv.appendChild(div);
            });
            optsContainer.appendChild(groupDiv);
        });
    } else {
        optsContainer.style.display = 'flex';
        optsContainer.style.flexDirection = 'column';
        optsContainer.style.gap = '1rem';
        let indices = q.options.map((_, i) => i);
        shuffleArray(indices);
        indices.forEach((optIndex, loopIndex) => {
            const optText = q.options[optIndex];
            const div = document.createElement('div');
            div.className = 'quiz-option';
            div.dataset.option = optIndex;
            div.innerHTML = `<span style="font-weight:600;color:var(--text-secondary);min-width:24px;">${String.fromCharCode(65 + loopIndex)}.</span> <span>${optText}</span>`;
            
            div.addEventListener('click', () => {
                if (isMultiAnswer) {
                    toggleMultiAnswer(optIndex, div, correctAnswers.length);
                } else {
                    handleAnswer([optIndex], div);
                }
            });
            optsContainer.appendChild(div);
        });
    }

    document.getElementById('quiz-feedback').style.display = 'none';
}

function toggleMultiAnswer(selectedIndex, optElement, requiredCount) {
    if (selectedAnswerIndexes.includes(selectedIndex)) {
        selectedAnswerIndexes = selectedAnswerIndexes.filter(index => index !== selectedIndex);
        optElement.classList.remove('selected');
        return;
    }

    if (selectedAnswerIndexes.length >= requiredCount) return;

    selectedAnswerIndexes.push(selectedIndex);
    optElement.classList.add('selected');

    if (selectedAnswerIndexes.length === requiredCount) {
        handleAnswer([...selectedAnswerIndexes]);
    }
}

async function handleAnswer(selectedIndexes, optElement = null, isMultiBlank = false) {
    timerPaused = true;
    const q = quizQueue[state.currentQuestionIndex];
    
    const options = document.querySelectorAll('.quiz-option');
    options.forEach(opt => opt.style.pointerEvents = 'none'); // Disable clicking
    
    currentQuizAttempted++;
    
    const correctAnswers = getCorrectAnswers(q);
    let isCorrect = false;
    let expected = [];
    if (isMultiBlank) {
        const selected = [...selectedIndexes];
        expected = [...correctAnswers];
        isCorrect = selected.length === expected.length && selected.every((val, i) => Number(val) === Number(expected[i]));
    } else {
        const selected = [...selectedIndexes].sort((a, b) => a - b);
        expected = [...correctAnswers].sort((a, b) => a - b);
        isCorrect = selected.length === expected.length && selected.every((index, i) => Number(index) === Number(expected[i]));
    }
    
    const feedback = document.getElementById('quiz-feedback');
    const fText = document.getElementById('feedback-text');
    const fExp = document.getElementById('feedback-explanation');
    
    if (isCorrect) {
        if (isMultiBlank) {
            selectedIndexes.forEach((optIdx, blankIdx) => {
                const el = document.querySelector(`.quiz-option[data-blank="${blankIdx}"][data-option="${optIdx}"]`);
                if (el) el.classList.add('correct');
            });
        } else {
            selectedIndexes.forEach(index => {
                const el = document.querySelector(`.quiz-option[data-option="${index}"]`);
                if (el) el.classList.add('correct');
            });
        }
        const successMessages = ["Correct! Well done.", "Nice one!", "Great job!", "Spot on!", "Excellent work!", "Awesome!"];
        fText.innerText = successMessages[Math.floor(Math.random() * successMessages.length)];
        fText.className = "success";
        currentQuizCorrect++;
        rememberCorrectQuestion(q);
        updateCorrectStreak(true);
        
        // Floating encouragement animation
        const quizCard = document.querySelector('.quiz-card');
        if (quizCard) {
            const encouragements = [
                'GREAT!', 'NICE!', 'AWESOME!', 'BRILLIANT!', 'PERFECT!',
                'SUPERB!', 'NAILED IT!', 'STELLAR!', 'CRUSHED IT!', 'WELL DONE!',
                'BRAVO!', 'FANTASTIC!', 'ON FIRE!', 'IMPRESSIVE!', 'SHARP!',
                'EXCELLENT!', 'GENIUS!', 'UNSTOPPABLE!', 'FLAWLESS!', 'LEGEND!'
            ];
            const greatEl = document.createElement('div');
            greatEl.className = 'floating-great';
            greatEl.innerText = encouragements[Math.floor(Math.random() * encouragements.length)];
            greatEl.style.left = '50%';
            greatEl.style.top = '40%';
            quizCard.style.position = 'relative';
            quizCard.appendChild(greatEl);
            setTimeout(() => greatEl.remove(), 1200);
        }
    } else {
        if (isMultiBlank) {
            selectedIndexes.forEach((optIdx, blankIdx) => {
                const el = document.querySelector(`.quiz-option[data-blank="${blankIdx}"][data-option="${optIdx}"]`);
                if (el && Number(expected[blankIdx]) !== Number(optIdx)) el.classList.add('incorrect');
            });
            expected.forEach((optIdx, blankIdx) => {
                const el = document.querySelector(`.quiz-option[data-blank="${blankIdx}"][data-option="${optIdx}"]`);
                if (el) el.classList.add('correct');
            });
        } else {
            selectedIndexes.forEach(index => {
                const isExpected = expected.some(exp => Number(exp) === Number(index));
                if (!isExpected) {
                    const el = document.querySelector(`.quiz-option[data-option="${index}"]`);
                    if (el) el.classList.add('incorrect');
                }
            });
            expected.forEach(index => {
                const el = document.querySelector(`.quiz-option[data-option="${index}"]`);
                if (el) el.classList.add('correct');
            });
        }
        if (questionTimeExpired) {
            fText.innerText = "Time's up! Incorrect.";
        } else {
            fText.innerText = "Incorrect.";
        }
        fText.className = "error";
        updateCorrectStreak(false);
        
        // Shake and Haptics
        const quizCard = document.querySelector('.quiz-card');
        if (quizCard) {
            quizCard.classList.remove('shake');
            void quizCard.offsetWidth; // Trigger reflow
            quizCard.classList.add('shake');
        }
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]); // Short vibration pattern
        }
    }

    fExp.innerText = "Explanation: " + q.explanation;
    feedback.style.display = 'flex';

    // Vocab logic
    const isVocabQuestion = state.currentChapterId === '3' || state.currentChapterId === '4' || state.currentChapterId === '6';

    // Show meanings of options
    const meaningsContainer = document.getElementById('feedback-meanings');
    if (meaningsContainer) {
        if (isVocabQuestion && typeof flashcardsData !== 'undefined' && flashcardsData.length > 0) {
            meaningsContainer.innerHTML = '<h4 style="margin-top: 0.5rem; margin-bottom: 0.25rem; color: var(--text-primary);">Option Meanings</h4>';
            meaningsContainer.style.display = 'flex';
            
            let allOptions = [];
            if (isMultiBlank) {
                q.options.forEach((blankOpts, blankIdx) => {
                    blankOpts.forEach((optText, optIdx) => {
                        allOptions.push({ text: optText, blankIdx, optIdx });
                    });
                });
            } else {
                q.options.forEach((optText, optIdx) => {
                    allOptions.push({ text: optText, blankIdx: null, optIdx });
                });
            }

            allOptions.forEach(opt => {
                let word = opt.text.replace(/[^a-zA-Z\s\-]/g, '').trim().toLowerCase();
                let definition = 'Definition not found.';
                const fc = flashcardsData.find(f => f.word.toLowerCase() === word);
                if (fc) definition = fc.definition;

                let isCorrectOpt = false;
                let isSelectedOpt = false;

                if (isMultiBlank) {
                    isCorrectOpt = Number(expected[opt.blankIdx]) === opt.optIdx;
                    isSelectedOpt = Number(selectedIndexes[opt.blankIdx]) === opt.optIdx;
                } else {
                    isCorrectOpt = expected.some(exp => Number(exp) === opt.optIdx);
                    isSelectedOpt = selectedIndexes.some(sel => Number(sel) === opt.optIdx);
                }

                let colorStyle = 'var(--text-secondary)';
                let bgStyle = 'rgba(255,255,255,0.02)';
                let borderStyle = '1px solid var(--glass-border)';
                let iconHtml = '';
                
                if (isCorrectOpt) {
                    colorStyle = 'var(--accent-success)';
                    bgStyle = 'rgba(16, 185, 129, 0.1)';
                    borderStyle = '1px solid var(--accent-success)';
                    iconHtml = '<i class="fas fa-check-circle" style="color: var(--accent-success); margin-right: 6px;"></i>';
                } else if (isSelectedOpt && !isCorrectOpt) {
                    colorStyle = 'var(--accent-error)';
                    bgStyle = 'rgba(239, 68, 68, 0.1)';
                    borderStyle = '1px solid var(--accent-error)';
                    iconHtml = '<i class="fas fa-times-circle" style="color: var(--accent-error); margin-right: 6px;"></i>';
                }

                meaningsContainer.innerHTML += `
                    <div style="background: ${bgStyle}; border: ${borderStyle}; padding: 0.75rem; border-radius: 8px; font-size: 0.95rem; display: flex; align-items: flex-start;">
                        <div style="margin-top: 2px; min-width: 24px;">${iconHtml}</div>
                        <div>
                            <span style="font-weight: 600; color: ${colorStyle}; text-transform: capitalize;">${opt.text}</span>: 
                            <span style="color: var(--text-secondary);">${definition}</span>
                        </div>
                    </div>
                `;
            });
        } else {
            meaningsContainer.style.display = 'none';
        }
    }
    if (isVocabQuestion) {
        let targetOptions = [];
        if (isMultiBlank) {
            expected.forEach((optIdx, blankIdx) => {
                targetOptions.push(q.options[blankIdx][optIdx]);
            });
            if (!isCorrect) {
                selectedIndexes.forEach((optIdx, blankIdx) => {
                    if (optIdx !== undefined) targetOptions.push(q.options[blankIdx][optIdx]);
                });
            }
        } else {
            expected.forEach(idx => targetOptions.push(q.options[idx]));
            if (!isCorrect) {
                selectedIndexes.forEach(idx => targetOptions.push(q.options[idx]));
            }
        }
        targetOptions.forEach(opt => {
            let word = opt.replace(/[^a-zA-Z\s\-]/g, '').trim().toLowerCase();
            if (word) {
                if (isCorrect) incrementMissedWordCorrectCount(word);
                else addMissedWord(word);
            }
        });
    }

    // Save progress to server
    try {
        const resp = await fetch('/api/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chapterId: state.currentChapterId,
                questionId: q.id,
                isCorrect
            })
        });
        if (resp.status === 401) {
            alert("Your session has expired. Please log in again to save progress.");
            window.location.href = '/login';
            return;
        }
        const data = await resp.json();
        // Update local progress cache
        if (!userProgress[state.currentChapterId]) userProgress[state.currentChapterId] = {};
        const prev = userProgress[state.currentChapterId][q.id];
        userProgress[state.currentChapterId][q.id] = {
            status: data.status || (isCorrect ? 'correct' : 'missed'),
            attempts: (prev ? prev.attempts + 1 : 1),
            lastAttemptedAt: new Date().toISOString()
        };
        const nextStatus = userProgress[state.currentChapterId][q.id].status;
        if (prev?.status !== 'correct' && nextStatus === 'correct') {
            state.questionsCompleted++;
        } else if (prev?.status === 'correct' && nextStatus !== 'correct') {
            state.questionsCompleted = Math.max(0, state.questionsCompleted - 1);
        }
        refreshStatsFromProgress();
        renderDashboard();
    } catch (e) {
        console.error('Failed to save progress:', e);
    }
}

function nextQuestion() {
    state.currentQuestionIndex++;
    
    if (state.currentQuestionIndex >= quizQueue.length) {
        finishChapter();
    } else {
        renderQuestion();
    }
}

function finishChapter() {
    // Stop timer and record time
    stopTimer();
    
    const chapter = state.chapters.find(c => c.id === state.currentChapterId);
    // Check if all questions in chapter have been attempted
    const chProgress = userProgress[state.currentChapterId] || {};
    const totalQs = state.questions[state.currentChapterId] ? state.questions[state.currentChapterId].length : 0;
    if (Object.keys(chProgress).length >= totalQs && totalQs > 0) {
        chapter.status = 'completed';
        state.chaptersCompleted++;
    }
    
    refreshStatsFromProgress();

    document.getElementById('results-chapter-name').innerText = chapter.title;
    document.getElementById('result-correct').innerText = `${currentQuizCorrect} / ${currentQuizAttempted}`;
    document.getElementById('result-accuracy').innerText = `${Math.round((currentQuizCorrect/currentQuizAttempted)*100)}%`;
    document.getElementById('result-time').innerText = formatTime(chapterElapsedSeconds);
    
    switchView('results');
}

// === CHAPTERS BREAKDOWN MODAL ===
function openChaptersBreakdownModal() {
    const chaptersModalOverlay = document.getElementById('chapters-modal-overlay');
    if (!chaptersModalOverlay) return;
    
    chaptersModalOverlay.classList.add('open');
    
    // Check if flashcard data is loaded. If not, load it in the background and re-run.
    if (typeof flashcardsData === 'undefined' || flashcardsData.length === 0) {
        fetch('/flashcards.json')
            .then(r => r.ok ? r.json() : [])
            .then(raw => {
                flashcardsData = raw.map((fc, i) => ({ ...fc, id: i }));
                if (chaptersModalOverlay.classList.contains('open')) {
                    openChaptersBreakdownModal();
                }
            })
            .catch(err => console.error("Failed to lazy-load flashcards for radar chart", err));
    }
    
    const chIds = ['1', '3', '4', '5', '6', 'flashcards'];
    const labels = [
        'Verbal Diagnostic',
        'Text Completions',
        'Sentence Equivalence',
        'Reading Comprehension',
        'Sentence Comp. (Multi-Blank)',
        'Flashcards'
    ];
    
    const totals = chIds.map(chId => {
        if (chId === 'flashcards') {
            return typeof flashcardsData !== 'undefined' ? flashcardsData.length : 0;
        }
        return state.questions[chId]?.length || 0;
    });
    const completed = chIds.map(chId => {
        const chProgress = userProgress[chId] || {};
        return Object.values(chProgress).filter(item => item.status === 'correct').length;
    });
    const completionPercentages = completed.map((comp, idx) => {
        const total = totals[idx];
        return total > 0 ? Math.round((comp / total) * 100) : 0;
    });
    
    const canvas = document.getElementById('chaptersBreakdownChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (chaptersBreakdownChartInstance) {
        chaptersBreakdownChartInstance.data.labels = labels;
        chaptersBreakdownChartInstance.data.datasets[0].data = completionPercentages;
        chaptersBreakdownChartInstance.data.datasets[0].totals = totals;
        chaptersBreakdownChartInstance.data.datasets[0].completed = completed;
        chaptersBreakdownChartInstance.update();
    } else {
        chaptersBreakdownChartInstance = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Completion %',
                    data: completionPercentages,
                    totals: totals,
                    completed: completed,
                    backgroundColor: 'rgba(139, 92, 246, 0.2)',
                    borderColor: 'rgba(139, 92, 246, 0.8)',
                    pointBackgroundColor: 'rgba(59, 130, 246, 0.8)',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: 'rgba(59, 130, 246, 0.8)',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const idx = context.dataIndex;
                                const ds = context.dataset;
                                const comp = ds.completed[idx];
                                const tot = ds.totals[idx];
                                const pct = context.raw;
                                return `Completed: ${pct}% (${comp}/${tot} Qs)`;
                            }
                        }
                    }
                },
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            display: true,
                            stepSize: 20,
                            backdropColor: 'transparent',
                            color: '#94a3b8',
                            font: { size: 9, weight: 'bold' },
                            callback: function(value) {
                                return value + '%';
                            }
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        pointLabels: {
                            color: '#94a3b8',
                            font: { family: "'Inter', sans-serif", size: 10, weight: '600' }
                        },
                        angleLines: { color: 'rgba(255, 255, 255, 0.1)' }
                    }
                }
            }
        });
    }
}

// === CHART INIT ===

function initCharts() {
    if (typeof Chart === 'undefined') return;
    
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10, 15, 22, 0.9)';
    Chart.defaults.plugins.tooltip.titleColor = '#fff';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;

    const accuracyCtx = document.getElementById('accuracyChart').getContext('2d');
    
    const gradientBlue = accuracyCtx.createLinearGradient(0, 0, 0, 400);
    gradientBlue.addColorStop(0, 'rgba(59, 130, 246, 0.8)');
    gradientBlue.addColorStop(1, 'rgba(59, 130, 246, 0.2)');

    const gradientPurple = accuracyCtx.createLinearGradient(0, 0, 0, 400);
    gradientPurple.addColorStop(0, 'rgba(139, 92, 246, 0.8)');
    gradientPurple.addColorStop(1, 'rgba(139, 92, 246, 0.2)');

    accuracyChartInstance = new Chart(accuracyCtx, {
        type: 'radar',
        data: {
            labels: ['Diagnostic', 'Text Comp.', 'Sentence Eq.', 'Reading Comp.', 'Multi-Blank', 'Flashcards'],
            datasets: [{
                label: 'Accuracy %',
                data: [0, 0, 0, 0, 0, 0], // Starts empty
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderColor: 'rgba(59, 130, 246, 0.8)',
                pointBackgroundColor: 'rgba(139, 92, 246, 0.8)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgba(139, 92, 246, 0.8)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = Math.round(context.raw);
                            let grade = 'F';
                            if (val >= 90) grade = 'S';
                            else if (val >= 75) grade = 'A';
                            else if (val >= 60) grade = 'B';
                            else if (val >= 45) grade = 'C';
                            else if (val >= 30) grade = 'D';
                            return `Accuracy: ${val}% (Grade ${grade})`;
                        }
                    }
                }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        display: true,
                        stepSize: 20,
                        backdropColor: 'transparent',
                        color: '#94a3b8',
                        font: { size: 10, weight: 'bold' },
                        callback: function(value) {
                            if (value === 100) return 'S';
                            if (value === 80) return 'A';
                            if (value === 60) return 'B';
                            if (value === 40) return 'C';
                            if (value === 20) return 'D';
                            return '';
                        }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    pointLabels: {
                        color: '#94a3b8',
                        font: { family: "'Inter', sans-serif", size: 12, weight: '600' }
                    },
                    angleLines: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        }
    });

    const progCtx = document.getElementById('progressionChart').getContext('2d');
    progressionChartInstance = new Chart(progCtx, {
        type: 'line',
        data: {
            labels: ['Week 1'],
            datasets: [
                {
                    label: 'Estimated Verbal Score',
                    data: [130],
                    backgroundColor: 'rgba(16, 185, 129, 0.16)',
                    borderColor: '#10b981',
                    pointBackgroundColor: '#10b981',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.35
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 130,
                    max: 170,
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { stepSize: 10 }
                },
                x: { grid: { display: false, drawBorder: false } }
            },
            plugins: { legend: { display: false } }
        }
    });

    updateCharts();
}

// === FLASHCARDS ENGINE ===
let flashcardsData = [];
let flashcardQueue = [];
let currentFlashcardIndex = 0;

async function loadFlashcards() {
    try {
        const res = await fetch('/flashcards.json');
        if (res.ok) {
            const raw = await res.json();
            flashcardsData = raw.map((fc, i) => ({ ...fc, id: i }));
            
            const progRes = await fetch('/api/progress/flashcards');
            if (progRes.ok) {
                const progData = await progRes.json();
                if (!userProgress) userProgress = {};
                userProgress['flashcards'] = progData.progress;
            }
            
            buildFlashcardQueue();
            currentFlashcardIndex = 0;
            showFlashcard();
        }
    } catch (e) {
        console.error('Failed to load flashcards:', e);
    }
}

function buildFlashcardQueue() {
    const chProgress = userProgress['flashcards'] || {};
    const unseen = [], missed = [], revision = [], correct = [];
    
    flashcardsData.forEach(q => {
        const p = chProgress[q.id];
        if (!p) { unseen.push(q); }
        else if (p.status === 'missed') { missed.push(q); }
        else if (p.status === 'revision') { revision.push(q); }
        else if (p.status === 'correct') { correct.push(q); }
        else { unseen.push(q); }
    });

    shuffleArray(unseen);
    shuffleArray(missed);
    shuffleArray(revision);
    shuffleArray(correct);

    const pools = [
        { arr: unseen, weight: 5, tag: 'new' },
        { arr: missed, weight: 2, tag: 'missed' },
        { arr: revision, weight: 2, tag: 'revision' },
        { arr: correct, weight: 1, tag: 'correct_review' }
    ];

    flashcardQueue = [];
    const totalFlashcards = flashcardsData.length;

    for (let i = 0; i < totalFlashcards; i++) {
        let availablePools = pools.filter(p => p.arr.length > 0);
        if (availablePools.length === 0) break;

        let totalWeight = availablePools.reduce((sum, p) => sum + p.weight, 0);
        let rand = Math.random() * totalWeight;
        let cumulative = 0;

        for (let p of availablePools) {
            cumulative += p.weight;
            if (rand <= cumulative) {
                const q = p.arr.pop();
                q._tag = p.tag;
                flashcardQueue.push(q);
                break;
            }
        }
    }
}

function showFlashcard() {
    if (!flashcardQueue || flashcardQueue.length === 0) return;
    if (currentFlashcardIndex >= flashcardQueue.length) {
        buildFlashcardQueue();
        currentFlashcardIndex = 0;
        if (flashcardQueue.length === 0) return;
    }
    
    const card = flashcardQueue[currentFlashcardIndex];
    document.getElementById('fc-word').innerText = card.word || '';
    document.getElementById('fc-pos').innerText = card['part of speech'] ? `(${card['part of speech']})` : '';
    document.getElementById('fc-def').innerText = card.definition || '';
    document.getElementById('fc-example').innerText = card.example ? `"${card.example}"` : '';
    document.getElementById('fc-root').innerText = card.root ? `Root: ${card.root}` : '';
    
    const btn = document.getElementById('fc-star-btn');
    if (btn) {
        const starred = getStarredWords();
        const word = (card.word || '').toLowerCase().trim();
        if (starred.includes(word)) {
            btn.innerHTML = '<i class="fas fa-star"></i>';
            btn.style.color = '#fbbf24';
        } else {
            btn.innerHTML = '<i class="far fa-star"></i>';
            btn.style.color = 'var(--text-secondary)';
        }
    }

    const tagEl = document.getElementById('fc-tag');
    if (tagEl) {
        const statusTag = {
            new: { className: 'question-tag new', text: 'New' },
            correct_review: { className: 'question-tag correct-review', text: 'Correct last time' },
            revision: { className: 'question-tag revision', text: 'Revision' },
            missed: { className: 'question-tag missed', text: 'Missed last time' }
        }[card._tag] || { className: 'question-tag new', text: 'New' };
        tagEl.className = statusTag.className;
        tagEl.innerText = statusTag.text;
    }
    
    const cardInner = document.querySelector('.flashcard-inner');
    if (cardInner) {
        cardInner.classList.remove('is-flipped');
    }
    const actions = document.getElementById('fc-actions');
    if (actions) {
        actions.style.display = 'none';
    }
    document.getElementById('fc-counter').innerText = `${currentFlashcardIndex + 1} / ${flashcardQueue.length}`;
}

window.handleFlashcardAnswer = async function(isCorrect) {
    if (!flashcardQueue || flashcardQueue.length === 0) return;
    const card = flashcardQueue[currentFlashcardIndex];
    let word = card.word.toLowerCase().trim();
    if (isCorrect) incrementMissedWordCorrectCount(word);
    else addMissedWord(word);
    
    // Save progress in background for a snappy UI
    (async () => {
        try {
            const resp = await fetch('/api/progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chapterId: 'flashcards',
                    questionId: card.id,
                    isCorrect
                })
            });
            if (resp.status === 401) {
                alert("Your session has expired. Please log in again to save progress.");
                window.location.href = '/login';
                return;
            }
            const data = await resp.json();
            if (!userProgress) userProgress = {};
            if (!userProgress['flashcards']) userProgress['flashcards'] = {};
            const prev = userProgress['flashcards'][card.id];
            userProgress['flashcards'][card.id] = {
                status: data.status || (isCorrect ? 'correct' : 'missed'),
                attempts: (prev ? prev.attempts + 1 : 1),
                lastAttemptedAt: new Date().toISOString()
            };
            refreshStatsFromProgress();
            renderDashboard();
        } catch (e) {
            console.error('Failed to save flashcard progress:', e);
        }
    })();
    
    const container = document.querySelector('.flashcard-container');
    if (container) {
        // Hide buttons immediately
        const actions = document.getElementById('fc-actions');
        if (actions) actions.style.display = 'none';
        
        // Apply swipe animation
        container.classList.add(isCorrect ? 'swipe-right' : 'swipe-left');
        
        setTimeout(() => {
            container.classList.remove('swipe-right', 'swipe-left');
            container.classList.add('card-enter');
            
            currentFlashcardIndex++;
            showFlashcard();
            
            setTimeout(() => container.classList.remove('card-enter'), 300);
        }, 350);
    } else {
        currentFlashcardIndex++;
        showFlashcard();
    }
};

window.flipFlashcard = function() {
    const inner = document.querySelector('.flashcard-inner');
    if (inner) {
        inner.classList.toggle('is-flipped');
        const actions = document.getElementById('fc-actions');
        if (actions) {
            actions.style.display = inner.classList.contains('is-flipped') ? 'flex' : 'none';
        }
    }
};

// === VOCAB LISTS ENGINE ===

function getStarredWordsKey() { return `greStarredWords:${currentUsername || 'guest'}`; }
function getMissedWordsKey() { return `greMissedWords:${currentUsername || 'guest'}`; }

function getStarredWords() {
    try { return JSON.parse(localStorage.getItem(getStarredWordsKey())) || []; } catch(e) { return []; }
}

function saveStarredWords(arr) {
    localStorage.setItem(getStarredWordsKey(), JSON.stringify(arr));
    if (typeof _forceStatsSync === 'function') _forceStatsSync();
}

function getMissedWords() {
    try { return JSON.parse(localStorage.getItem(getMissedWordsKey())) || {}; } catch(e) { return {}; }
}

function saveMissedWords(obj) {
    localStorage.setItem(getMissedWordsKey(), JSON.stringify(obj));
    if (typeof _forceStatsSync === 'function') _forceStatsSync();
}

function addMissedWord(word) {
    if (!word) return;
    const missed = getMissedWords();
    if (!missed[word]) missed[word] = { correctCount: 0 };
    saveMissedWords(missed);
}

function incrementMissedWordCorrectCount(word) {
    if (!word) return;
    const missed = getMissedWords();
    if (missed[word]) {
        missed[word].correctCount = (missed[word].correctCount || 0) + 1;
        if (missed[word].correctCount >= 4) {
            delete missed[word];
        }
        saveMissedWords(missed);
    }
}

window.toggleStarWord = function() {
    const card = flashcardQueue[currentFlashcardIndex];
    if (!card) return;
    const word = card.word.toLowerCase().trim();
    let starred = getStarredWords();
    if (starred.includes(word)) {
        starred = starred.filter(w => w !== word);
    } else {
        starred.push(word);
    }
    saveStarredWords(starred);
    
    const btn = document.getElementById('fc-star-btn');
    if (btn) {
        if (starred.includes(word)) {
            btn.innerHTML = '<i class="fas fa-star"></i>';
            btn.style.color = '#fbbf24';
        } else {
            btn.innerHTML = '<i class="far fa-star"></i>';
            btn.style.color = 'var(--text-secondary)';
        }
    }
}

window.showVocabTab = function(tabName) {
    document.querySelectorAll('#vocab-view .modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.vocab-content-section').forEach(c => c.style.display = 'none');
    
    const targetTab = document.getElementById(`tab-${tabName}-words`);
    if(targetTab) targetTab.classList.add('active');
    const targetContent = document.getElementById(`vocab-${tabName}-content`);
    if(targetContent) targetContent.style.display = 'block';
    
    if (tabName === 'missed') {
        const list = document.getElementById('missed-words-list');
        const missed = getMissedWords();
        list.innerHTML = '';
        Object.keys(missed).forEach(word => {
            list.innerHTML += `<li style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <span style="font-weight:600; text-transform:capitalize;">${word}</span>
                    <button onclick="playAudio('${word.replace(/'/g, "\\'")}')" style="background:none; border:none; color:var(--accent-primary); cursor:pointer; font-size:1.1rem; opacity:0.7;" title="Listen" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'"><i class="fas fa-volume-up"></i></button>
                </div>
                <span style="color:var(--text-secondary); font-size:0.85rem; background:rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 12px;">Progress: ${missed[word].correctCount}/4</span>
            </li>`;
        });
        if(Object.keys(missed).length === 0) list.innerHTML = '<li style="color:var(--text-secondary); border: none; padding: 2rem 1rem; text-align: center;">No missed words yet!</li>';
    } else {
        // Ensure flashcard data is loaded for word definitions
        if (flashcardsData.length === 0) {
            fetch('/flashcards.json').then(r => r.ok ? r.json() : []).then(raw => {
                flashcardsData = raw.map((fc, i) => ({ ...fc, id: i }));
                showVocabTab('starred'); // Re-render with data
            }).catch(() => {});
        }
        const list = document.getElementById('starred-words-list');
        const starred = getStarredWords();
        list.innerHTML = '';
        starred.forEach(word => {
            // Look up flashcard data for this word
            const fc = flashcardsData.find(f => f.word.toLowerCase() === word.toLowerCase());
            const li = document.createElement('li');
            li.className = 'starred-word-item';
            
            const headerRow = document.createElement('div');
            headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; width:100%;';
            headerRow.innerHTML = `
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <span style="font-weight:600; text-transform:capitalize; font-size: 1.1rem;">${word}</span>
                    <button onclick="event.stopPropagation(); playAudio('${word.replace(/'/g, "\\'")}')" style="background:none; border:none; color:var(--accent-primary); cursor:pointer; font-size:1.1rem; opacity:0.7;" title="Listen" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'"><i class="fas fa-volume-up"></i></button>
                </div>
                <i class="fas fa-chevron-down" style="color:var(--text-secondary); font-size:0.75rem; transition: transform 0.3s;"></i>
            `;
            li.appendChild(headerRow);
            
            li.addEventListener('click', () => {
                const existing = li.querySelector('.starred-word-detail');
                const chevron = li.querySelector('.fa-chevron-down, .fa-chevron-up');
                if (existing) {
                    existing.remove();
                    if (chevron) { chevron.classList.replace('fa-chevron-up', 'fa-chevron-down'); }
                    return;
                }
                if (chevron) { chevron.classList.replace('fa-chevron-down', 'fa-chevron-up'); }
                
                const detail = document.createElement('div');
                detail.className = 'starred-word-detail';
                
                if (fc) {
                    detail.innerHTML = `
                        <h4>Definition</h4>
                        <p class="detail-definition">${fc.definition}</p>
                        ${fc.example ? `<h4>Example</h4><p class="detail-example">"${fc.example}"</p>` : ''}
                        <div class="detail-meta">
                            ${fc['part of speech'] ? `<span>${fc['part of speech']}</span>` : ''}
                            ${fc.root ? `<span>Root: ${fc.root}</span>` : ''}
                        </div>
                    `;
                } else {
                    detail.innerHTML = '<p class="detail-definition" style="color:var(--text-secondary);">Definition not found in flashcard database.</p>';
                }
                li.appendChild(detail);
            });
            
            list.appendChild(li);
        });
        if(starred.length === 0) list.innerHTML = '<li style="color:var(--text-secondary); border: none; padding: 2rem 1rem; text-align: center;">No starred words yet!</li>';
    }
}

// Keyboard shortcut: Alt+Left Arrow to return to overview
document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        const viewsToClose = ['flashcards-view', 'vocab-view', 'results-view', 'quiz-view'];
        let needsSwitch = false;
        for (const view of viewsToClose) {
            const el = document.getElementById(view);
            if (el && el.style.display !== 'none') {
                needsSwitch = true;
                break;
            }
        }
        if (needsSwitch || state.currentChapterId !== null) {
            if (timerInterval) clearInterval(timerInterval);
            for (const view of viewsToClose) {
                const el = document.getElementById(view);
                if (el) el.style.display = 'none';
            }
            switchView('overview');
        }
    }
});

// === AUTOMATIC INACTIVITY RELOADER ===
(function() {
    let inactivityTimeout;
    const INACTIVITY_TIME = 10 * 60 * 1000; // 10 minutes

    function resetInactivityTimer() {
        clearTimeout(inactivityTimeout);
        inactivityTimeout = setTimeout(reloadPage, INACTIVITY_TIME);
    }

    function reloadPage() {
        console.log("Inactive for 10 minutes, reloading...");
        window.location.reload();
    }

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(name => {
        document.addEventListener(name, resetInactivityTimer, { passive: true });
    });

    resetInactivityTimer();
})();

// === AUDIO HELPERS ===

window.playAudio = function(text) {
    if (!('speechSynthesis' in window)) {
        showToast('Text-to-speech is not supported in this browser.', 'error');
        return;
    }
    
    // Stop any currently playing audio
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    // Use US English voice if available, otherwise default
    const voices = window.speechSynthesis.getVoices();
    const usVoice = voices.find(v => v.lang === 'en-US' && v.name.includes('Google'));
    if (usVoice) {
        utterance.voice = usVoice;
    } else {
        const enVoice = voices.find(v => v.lang.startsWith('en'));
        if (enVoice) utterance.voice = enVoice;
    }
    
    utterance.rate = 0.9; // slightly slower for clarity
    window.speechSynthesis.speak(utterance);
};

// === ACHIEVEMENTS HELPERS ===
function checkAndRenderAchievements() {
    const BADGES = {
        'night_owl': { id: 'night_owl', name: 'Night Owl', icon: 'fa-moon', color: '#6366f1', desc: 'Studied after 10 PM' },
        '7_day_streak': { id: '7_day_streak', name: 'Dedicated', icon: 'fa-fire', color: '#f97316', desc: 'Reached a 7-day streak' },
        'sharpshooter': { id: 'sharpshooter', name: 'Sharpshooter', icon: 'fa-bullseye', color: '#ef4444', desc: '10 correct in a row' },
        '100_qs': { id: '100_qs', name: 'Centurion', icon: 'fa-check-double', color: '#10b981', desc: 'Answered 100 questions' }
    };
    
    let newBadge = false;
    
    // Check Night Owl
    const hour = new Date().getHours();
    if (todayStudyTimeSeconds > 0 && (hour >= 22 || hour < 4) && !userBadges.includes('night_owl')) {
        userBadges.push('night_owl'); newBadge = true;
    }
    
    // Check 7 Day Streak
    const daysStreak = Number(localStorage.getItem(getDaysStreakKey()) || 0);
    if (daysStreak >= 7 && !userBadges.includes('7_day_streak')) {
        userBadges.push('7_day_streak'); newBadge = true;
    }
    
    // Check Sharpshooter
    const correctStreak = Number(localStorage.getItem(getCorrectStreakKey()) || 0);
    if (correctStreak >= 10 && !userBadges.includes('sharpshooter')) {
        userBadges.push('sharpshooter'); newBadge = true;
    }
    
    // Check 100 Questions
    if (state.questionsAttempted >= 100 && !userBadges.includes('100_qs')) {
        userBadges.push('100_qs'); newBadge = true;
    }
    
    if (newBadge) {
        showToast('🏆 New Achievement Unlocked!', 'success');
        _forceStatsSync();
    }
    
    // Render
    const container = document.getElementById('achievements-container');
    if (container) {
        if (userBadges.length === 0) {
            container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.9rem;">Keep studying to unlock achievements!</div>';
            return;
        }
        
        container.innerHTML = userBadges.map(bId => {
            const b = BADGES[bId];
            if (!b) return '';
            return `
                <div class="badge-card" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); padding: 0.75rem 1rem; border-radius: 12px; display: flex; align-items: center; gap: 1rem; flex: 1; min-width: 200px;">
                    <div style="background: ${b.color}20; color: ${b.color}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">
                        <i class="fas ${b.icon}"></i>
                    </div>
                    <div>
                        <div style="font-weight: 600; font-size: 0.95rem;">${b.name}</div>
                        <div style="color: var(--text-secondary); font-size: 0.8rem;">${b.desc}</div>
                    </div>
                </div>
            `;
        }).join('');
    }
}
