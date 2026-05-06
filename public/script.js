// Global Dashboard State
const state = {
    diagnosticScore: 0,
    questionsAttempted: 0,
    correctAnswers: 0,
    chaptersCompleted: 0,
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

let accuracyChartInstance = null;
let progressionChartInstance = null;

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
        
        // Update UI with user info
        document.getElementById('nav-avatar').innerText = data.username.charAt(0).toUpperCase();
        document.getElementById('dropdown-username').innerText = data.username;
        // In the overview section
        const overviewAvatar = document.querySelector('.user-profile .avatar');
        const overviewName = document.querySelector('.user-profile .user-name');
        if (overviewAvatar) overviewAvatar.innerText = data.username.charAt(0).toUpperCase();
        if (overviewName) overviewName.innerText = data.username;
        
    } catch (e) {
        console.error("Auth check failed", e);
    }
    
    setupEventListeners();
    try {
        initCharts();
    } catch (e) {
        console.error("Failed to initialize charts", e);
    }
    
    // Calculate total questions for UI
    let totalQ = 0;
    state.chapters.forEach(ch => {
        if (state.questions[ch.id]) {
            totalQ += state.questions[ch.id].length;
        }
    });
    document.querySelectorAll('.stat-row span')[3].innerText = totalQ.toLocaleString() + ' Qs';
    
    renderDashboard();
    console.log("DOMContentLoaded finished");
});

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
    document.getElementById('nav-overview').addEventListener('click', (e) => { e.preventDefault(); switchView('overview'); closeSidebar(); });
    document.getElementById('nav-chapters').addEventListener('click', (e) => { e.preventDefault(); switchView('overview'); closeSidebar(); });
    document.getElementById('nav-diagnostics').addEventListener('click', (e) => { e.preventDefault(); switchView('overview'); closeSidebar(); });
    document.getElementById('back-to-overview').addEventListener('click', () => switchView('overview'));
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
            if (e.target.id !== 'logout-btn') {
                profileDropdown.style.display = profileDropdown.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (profileWidget && !profileWidget.contains(e.target)) {
            profileDropdown.style.display = 'none';
        }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    });
}

function switchView(viewName) {
    document.getElementById('overview-view').style.display = viewName === 'overview' ? 'block' : 'none';
    document.getElementById('quiz-view').style.display = viewName === 'quiz' ? 'block' : 'none';
    document.getElementById('results-view').style.display = viewName === 'results' ? 'block' : 'none';

    if (viewName === 'overview') {
        renderDashboard(); // Refresh stats when coming back
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
    document.getElementById('kpi-accuracy').innerText = `Accuracy: ${state.questionsAttempted > 0 ? acc + '%' : '--'}`;
    
    document.getElementById('kpi-chapters').innerHTML = `${state.chaptersCompleted}<span class="kpi-sub">/4</span>`;
    document.getElementById('kpi-chapters-bar').style.width = `${(state.chaptersCompleted / 4) * 100}%`;

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

    // Update Chart with dynamic accuracy if available
    if (acc > 0 && accuracyChartInstance) {
        accuracyChartInstance.data.datasets[0].data[0] = acc; 
        accuracyChartInstance.update();
    }
}

// === QUIZ ENGINE ===

let currentQuizCorrect = 0;
let currentQuizAttempted = 0;

window.startChapter = function(chapterId) {
    if (!state.questions[chapterId] || state.questions[chapterId].length === 0) {
        alert("No questions found for this chapter!");
        return;
    }
    
    state.currentChapterId = chapterId;
    state.currentQuestionIndex = 0;
    
    // Reset chapter stats
    currentQuizCorrect = 0;
    currentQuizAttempted = 0;
    
    const chapter = state.chapters.find(c => c.id === chapterId);
    chapter.status = 'in-progress';
    
    document.getElementById('quiz-chapter-title').innerText = chapter.title;
    document.getElementById('total-q-num').innerText = state.questions[chapterId].length;
    
    renderQuestion();
    switchView('quiz');
}

function renderQuestion() {
    const qList = state.questions[state.currentChapterId];
    const q = qList[state.currentQuestionIndex];
    
    document.getElementById('current-q-num').innerText = state.currentQuestionIndex + 1;
    
    // Render passage
    const passageEl = document.getElementById('quiz-passage');
    if (q.passage) {
        passageEl.innerText = q.passage;
        passageEl.style.display = 'block';
    } else {
        passageEl.style.display = 'none';
    }

    // Render text & options
    document.getElementById('quiz-question-text').innerText = q.text;
    
    const optsContainer = document.getElementById('quiz-options-container');
    optsContainer.innerHTML = '';
    
    q.options.forEach((optText, index) => {
        const div = document.createElement('div');
        div.className = 'quiz-option';
        div.innerHTML = `<span style="font-weight:600;color:var(--text-secondary);min-width:24px;">${String.fromCharCode(65 + index)}.</span> <span>${optText}</span>`;
        
        div.addEventListener('click', () => handleAnswer(index, div));
        optsContainer.appendChild(div);
    });

    document.getElementById('quiz-feedback').style.display = 'none';
}

function handleAnswer(selectedIndex, optElement) {
    const qList = state.questions[state.currentChapterId];
    const q = qList[state.currentQuestionIndex];
    
    const options = document.querySelectorAll('.quiz-option');
    options.forEach(opt => opt.style.pointerEvents = 'none'); // Disable clicking
    
    state.questionsAttempted++;
    currentQuizAttempted++;
    
    const feedback = document.getElementById('quiz-feedback');
    const fText = document.getElementById('feedback-text');
    const fExp = document.getElementById('feedback-explanation');
    
    if (selectedIndex === q.answer) {
        optElement.classList.add('correct');
        fText.innerText = "Correct! Well done.";
        fText.className = "success";
        state.correctAnswers++;
        currentQuizCorrect++;
    } else {
        optElement.classList.add('incorrect');
        options[q.answer].classList.add('correct'); // Show correct answer
        fText.innerText = "Incorrect.";
        fText.className = "error";
    }

    fExp.innerText = "Explanation: " + q.explanation;
    feedback.style.display = 'flex';
}

function nextQuestion() {
    const qList = state.questions[state.currentChapterId];
    state.currentQuestionIndex++;
    
    if (state.currentQuestionIndex >= qList.length) {
        finishChapter();
    } else {
        renderQuestion();
    }
}

function finishChapter() {
    const chapter = state.chapters.find(c => c.id === state.currentChapterId);
    chapter.status = 'completed';
    state.chaptersCompleted++;
    
    // Update diagnostic score based on ALL questions attempted
    const overallAcc = state.correctAnswers / state.questionsAttempted;
    state.diagnosticScore = Math.round(130 + (overallAcc * 40)); 

    document.getElementById('results-chapter-name').innerText = chapter.title;
    document.getElementById('result-correct').innerText = `${currentQuizCorrect} / ${currentQuizAttempted}`;
    document.getElementById('result-accuracy').innerText = `${Math.round((currentQuizCorrect/currentQuizAttempted)*100)}%`;
    
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
        type: 'bar',
        data: {
            labels: ['Verbal', 'Reading Comp.', 'Arithmetic', 'Algebra', 'Geometry', 'Data Interp.'],
            datasets: [{
                label: 'Accuracy %',
                data: [0, 0, 0, 0, 0, 0], // Starts empty
                backgroundColor: [
                    gradientPurple, gradientPurple, 
                    gradientBlue, gradientBlue, gradientBlue, gradientBlue
                ],
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 32
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { callback: function(value) { return value + '%'; } }
                },
                x: { grid: { display: false, drawBorder: false } }
            }
        }
    });

    const progCtx = document.getElementById('progressionChart').getContext('2d');
    progressionChartInstance = new Chart(progCtx, {
        type: 'radar',
        data: {
            labels: ['Diagnostic', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Current'],
            datasets: [
                {
                    label: 'Verbal',
                    data: [130, 130, 130, 130, 130, 130],
                    backgroundColor: 'rgba(139, 92, 246, 0.2)',
                    borderColor: '#8b5cf6',
                    pointBackgroundColor: '#8b5cf6',
                },
                {
                    label: 'Quant',
                    data: [130, 130, 130, 130, 130, 130],
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    borderColor: '#3b82f6',
                    pointBackgroundColor: '#3b82f6',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    pointLabels: { color: '#94a3b8', font: { family: "'Inter', sans-serif", size: 11 } },
                    ticks: { display: false, min: 130, max: 170 }
                }
            },
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } } }
        }
    });
}
