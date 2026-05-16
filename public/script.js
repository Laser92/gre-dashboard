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
    ],
    questions: window.QUESTION_BANK || {}
};

// Per-user progress: { chapterId: { questionId: { status, attempts, lastAttemptedAt } } }
let userProgress = {};
// The ordered quiz queue built by the spaced-repetition algorithm
let quizQueue = [];

let accuracyChartInstance = null;
let progressionChartInstance = null;
let selectedAnswerIndexes = [];

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
let totalStudyTimeSeconds = 0;    // Total across all chapters this session
let chapterStartTime = null;      // When current chapter started
let chapterElapsedSeconds = 0;    // Time for current chapter
let questionStartTime = null;     // When current question started
let timerInterval = null;         // Interval for live timer

function startTimer() {
    chapterStartTime = Date.now();
    chapterElapsedSeconds = 0;
    questionStartTime = Date.now();
    
    // Clear any existing interval
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        if (chapterStartTime) {
            chapterElapsedSeconds = Math.floor((Date.now() - chapterStartTime) / 1000);
            
            const enableCountdown = document.getElementById('enable-countdown');
            if (enableCountdown && enableCountdown.checked) {
                const limit = parseInt(document.getElementById('countdown-time').value, 10) || 60;
                const elapsedForQuestion = Math.floor((Date.now() - questionStartTime) / 1000);
                let remaining = limit - elapsedForQuestion;
                if (remaining < 0) remaining = 0;
                updateTimerDisplay(remaining);
                
                const timerText = document.getElementById('quiz-timer-text');
                if (timerText) {
                    timerText.style.color = remaining === 0 ? 'var(--accent-error)' : '';
                }
            } else {
                const timerText = document.getElementById('quiz-timer-text');
                if (timerText) timerText.style.color = '';
                updateTimerDisplay(chapterElapsedSeconds);
            }
        }
    }, 1000);
}

function stopTimer() {
    if (chapterStartTime) {
        chapterElapsedSeconds = Math.floor((Date.now() - chapterStartTime) / 1000);
        totalStudyTimeSeconds += chapterElapsedSeconds;
    }
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    chapterStartTime = null;
}

function updateTimerDisplay(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timerText = document.getElementById('quiz-timer-text');
    if (timerText) {
        timerText.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

function splitQuestionLabel(text, fallbackNumber) {
    const match = String(text || '').match(/^((?:SE|TC|RC)?\s*Question\s*\d+):\s*(.*)$/i);
    if (!match) {
        return { label: `Question ${fallbackNumber}`, body: text || '' };
    }
    return {
        label: match[1].replace(/\s+/g, ' ').trim(),
        body: match[2].trim()
    };
}

// Current user info (populated on load)
let currentUsername = '';

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOMContentLoaded started");
    
    // Auth Check
    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (!data.loggedIn) {
            window.location.href = '/login';
            return;
        }
        
        currentUsername = data.username;
        
        // Update UI with user info
        document.getElementById('nav-avatar').innerText = data.username.charAt(0).toUpperCase();
        document.getElementById('dropdown-username').innerText = data.username;
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
    let attempted = 0, correct = 0;
    state.chaptersCompleted = 0;
    for (const chId of Object.keys(userProgress)) {
        const chProgress = userProgress[chId];
        for (const qId of Object.keys(chProgress)) {
            const p = chProgress[qId];
            attempted += p.attempts || 0;
            if (p.status === 'correct') correct++;
        }
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
    state.questionsAttempted = attempted;
    state.correctAnswers = correct;
    state.questionsCompleted = correct;
    if (attempted > 0) {
        const overallAcc = correct / attempted;
        state.diagnosticScore = Math.round(130 + (overallAcc * 40));
    }
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
    document.getElementById('nav-diagnostics').addEventListener('click', (e) => { e.preventDefault(); showOverviewSection('nav-diagnostics', '.charts-grid'); });
    document.getElementById('nav-flashcards').addEventListener('click', (e) => { e.preventDefault(); showOverviewSection('nav-flashcards', '#flashcards-view'); switchView('flashcards'); });
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
        timerSettingsBtn.addEventListener('click', () => {
            const prompt = document.getElementById('timer-challenge-prompt');
            if (prompt) prompt.style.display = 'none';
            timerSettingsDropdown.style.display = timerSettingsDropdown.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', (e) => {
            if (!timerSettingsBtn.contains(e.target) && !timerSettingsDropdown.contains(e.target)) {
                timerSettingsDropdown.style.display = 'none';
            }
        });
    }

    const timerAddBtn = document.getElementById('timer-add-btn');
    const timerSubBtn = document.getElementById('timer-sub-btn');
    const countdownInput = document.getElementById('countdown-time');
    
    if (timerAddBtn && timerSubBtn && countdownInput) {
        timerAddBtn.addEventListener('click', () => {
            let val = parseInt(countdownInput.value, 10) || 60;
            countdownInput.value = val + 15;
        });
        timerSubBtn.addEventListener('click', () => {
            let val = parseInt(countdownInput.value, 10) || 60;
            if (val > 15) {
                countdownInput.value = val - 15;
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

function switchView(viewName) {
    document.getElementById('overview-view').style.display = viewName === 'overview' ? 'block' : 'none';
    document.getElementById('quiz-view').style.display = viewName === 'quiz' ? 'block' : 'none';
    document.getElementById('results-view').style.display = viewName === 'results' ? 'block' : 'none';
    document.getElementById('flashcards-view').style.display = viewName === 'flashcards' ? 'block' : 'none';

    if (viewName === 'overview') {
        renderDashboard(); // Refresh stats when coming back
    } else if (viewName === 'flashcards' && typeof flashcardsData !== 'undefined' && flashcardsData.length === 0) {
        loadFlashcards();
    }
}

function renderDashboard() {
    // Update KPI Cards
    const acc = state.questionsAttempted > 0 ? Math.round((state.correctAnswers / state.questionsAttempted) * 100) : 0;
    
    document.getElementById('kpi-score').innerHTML = `${state.diagnosticScore > 0 ? state.diagnosticScore : '--'}<span class="kpi-sub">/170</span>`;
    document.getElementById('top-target-score').innerText = `Current: ${state.diagnosticScore > 0 ? state.diagnosticScore : '--'} / 170`;
    
    if (state.diagnosticScore > 0) {
        document.getElementById('kpi-score-trend').innerText = `Based on Diagnostic`;
        document.getElementById('kpi-score-trend').className = 'kpi-trend positive';
    }

    document.getElementById('kpi-attempted').innerText = state.questionsAttempted;
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
    
    const totalQuestions = getTotalQuestionCount();
    document.getElementById('kpi-chapters').innerHTML = `${state.questionsCompleted}<span class="kpi-sub">/${totalQuestions}</span>`;
    document.getElementById('kpi-chapters-bar').style.width = `${totalQuestions > 0 ? (state.questionsCompleted / totalQuestions) * 100 : 0}%`;

    // Update time KPI
    updateTimeKPI();

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
    if (!timeEl) return;

    // Include currently running timer if active
    let displayTime = totalStudyTimeSeconds;
    if (chapterStartTime) {
        displayTime += Math.floor((Date.now() - chapterStartTime) / 1000);
    }

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
    }
}

function getChapterAccuracy(chapterId) {
    const chProgress = userProgress[chapterId] || {};
    const records = Object.values(chProgress);
    const attempts = records.reduce((sum, item) => sum + (item.attempts || 0), 0);
    if (attempts === 0) return 0;
    const correct = records.filter(item => item.status === 'correct').length;
    return Math.round((correct / attempts) * 100);
}

function getWeeklyScoreProgression() {
    const records = [];
    Object.values(userProgress).forEach(chProgress => {
        Object.values(chProgress).forEach(item => {
            if (item.lastAttemptedAt) records.push(item);
        });
    });

    records.sort((a, b) => new Date(a.lastAttemptedAt) - new Date(b.lastAttemptedAt));
    if (records.length === 0) {
        return { labels: ['Week 1'], data: [130] };
    }

    const firstDate = new Date(records[0].lastAttemptedAt);
    const weekly = new Map();
    records.forEach(item => {
        const weekIndex = Math.floor((new Date(item.lastAttemptedAt) - firstDate) / (7 * 24 * 60 * 60 * 1000));
        if (!weekly.has(weekIndex)) weekly.set(weekIndex, { attempted: 0, correct: 0 });
        const bucket = weekly.get(weekIndex);
        bucket.attempted += item.attempts || 1;
        if (item.status === 'correct') bucket.correct += 1;
    });

    let cumulativeAttempted = 0;
    let cumulativeCorrect = 0;
    const labels = [];
    const data = [];
    [...weekly.keys()].sort((a, b) => a - b).forEach(weekIndex => {
        const bucket = weekly.get(weekIndex);
        cumulativeAttempted += bucket.attempted;
        cumulativeCorrect += bucket.correct;
        labels.push(`Week ${weekIndex + 1}`);
        data.push(Math.round(130 + (cumulativeCorrect / cumulativeAttempted) * 40));
    });

    return { labels, data };
}

function updateCharts() {
    if (accuracyChartInstance) {
        accuracyChartInstance.data.datasets[0].data = state.chapters.map(chapter => getChapterAccuracy(chapter.id));
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
function buildQuizQueue(chapterId) {
    const allQuestions = state.questions[chapterId] || [];
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

    const questionParts = splitQuestionLabel(q.text, state.currentQuestionIndex + 1);
    document.getElementById('quiz-question-number').innerText = questionParts.label;
    const tagEl = document.getElementById('quiz-question-tag');

    const statusTag = {
        new: { className: 'question-tag new', text: 'New' },
        correct_review: { className: 'question-tag correct-review', text: 'Correct previously' },
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
    const isMultiAnswer = correctAnswers.length > 1;
    document.getElementById('quiz-question-text').innerText = questionParts.body;

    const instructionEl = document.getElementById('quiz-question-instruction');
    if (isMultiAnswer) {
        instructionEl.innerText = 'Select exactly two answer choices.';
        instructionEl.style.display = 'block';
    } else {
        instructionEl.style.display = 'none';
    }
    
    // Challenge prompt logic
    const enableCountdown = document.getElementById('enable-countdown');
    const challengePrompt = document.getElementById('timer-challenge-prompt');
    if (enableCountdown && !enableCountdown.checked && challengePrompt) {
        if (Math.random() < 0.15 && currentQuizAttempted >= 2) {
            challengePrompt.style.display = 'block';
        } else {
            challengePrompt.style.display = 'none';
        }
    } else if (challengePrompt) {
        challengePrompt.style.display = 'none';
    }
    
    q.options.forEach((optText, index) => {
        const div = document.createElement('div');
        div.className = 'quiz-option';
        div.innerHTML = `<span style="font-weight:600;color:var(--text-secondary);min-width:24px;">${String.fromCharCode(65 + index)}.</span> <span>${optText}</span>`;
        
        div.addEventListener('click', () => {
            if (isMultiAnswer) {
                toggleMultiAnswer(index, div, correctAnswers.length);
            } else {
                handleAnswer([index], div);
            }
        });
        optsContainer.appendChild(div);
    });

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

async function handleAnswer(selectedIndexes, optElement = null) {
    const q = quizQueue[state.currentQuestionIndex];
    
    const options = document.querySelectorAll('.quiz-option');
    options.forEach(opt => opt.style.pointerEvents = 'none'); // Disable clicking
    
    state.questionsAttempted++;
    currentQuizAttempted++;
    
    const correctAnswers = getCorrectAnswers(q);
    const selected = [...selectedIndexes].sort((a, b) => a - b);
    const expected = [...correctAnswers].sort((a, b) => a - b);
    const isCorrect = selected.length === expected.length && selected.every((index, i) => index === expected[i]);
    
    const feedback = document.getElementById('quiz-feedback');
    const fText = document.getElementById('feedback-text');
    const fExp = document.getElementById('feedback-explanation');
    
    if (isCorrect) {
        selected.forEach(index => options[index]?.classList.add('correct'));
        const successMessages = ["Correct! Well done.", "Nice one!", "Great job!", "Spot on!", "Excellent work!", "Awesome!"];
        fText.innerText = successMessages[Math.floor(Math.random() * successMessages.length)];
        fText.className = "success";
        state.correctAnswers++;
        currentQuizCorrect++;
        rememberCorrectQuestion(q);
        
        // GREAT floating animation
        const quizCard = document.querySelector('.quiz-card');
        if (quizCard) {
            const greatEl = document.createElement('div');
            greatEl.className = 'floating-great';
            greatEl.innerText = 'GREAT!';
            greatEl.style.left = '50%';
            greatEl.style.top = '40%';
            quizCard.style.position = 'relative';
            quizCard.appendChild(greatEl);
            setTimeout(() => greatEl.remove(), 1200);
        }
    } else {
        selected.forEach(index => {
            if (!expected.includes(index)) options[index]?.classList.add('incorrect');
        });
        expected.forEach(index => options[index]?.classList.add('correct'));
        fText.innerText = "Incorrect.";
        fText.className = "error";
        
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
    
    // Update diagnostic score based on ALL questions attempted
    if (state.questionsAttempted > 0) {
        const overallAcc = state.correctAnswers / state.questionsAttempted;
        state.diagnosticScore = Math.round(130 + (overallAcc * 40));
    }

    document.getElementById('results-chapter-name').innerText = chapter.title;
    document.getElementById('result-correct').innerText = `${currentQuizCorrect} / ${currentQuizAttempted}`;
    document.getElementById('result-accuracy').innerText = `${Math.round((currentQuizCorrect/currentQuizAttempted)*100)}%`;
    document.getElementById('result-time').innerText = formatTime(chapterElapsedSeconds);
    
    switchView('results');
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
            labels: ['Diagnostic', 'Text Comp.', 'Sentence Eq.', 'Reading Comp.'],
            datasets: [{
                label: 'Accuracy %',
                data: [0, 0, 0, 0], // Starts empty
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
            plugins: { legend: { display: false } },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { display: false, stepSize: 20 },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    pointLabels: {
                        color: '#94a3b8',
                        font: { family: "'Inter', sans-serif", size: 12 }
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
    
    const tagEl = document.getElementById('fc-tag');
    if (tagEl) {
        const statusTag = {
            new: { className: 'question-tag new', text: 'New' },
            correct_review: { className: 'question-tag correct-review', text: 'Correct previously' },
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
