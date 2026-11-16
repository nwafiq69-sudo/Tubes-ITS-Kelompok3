(() => {
  'use strict';

  const STORE_KEY = 'gamifiedItsStateV1';
  const TOKEN_KEY = 'gamifiedItsAccessToken';
  const modules = [
    { id: 'm1', title: 'Dasar Data & Pembelajaran', tag: 'MODUL 01', time: '8 menit', body: 'Kenali bagaimana aktivitas belajar digital dapat dirangkum menjadi fitur. Dalam sistem adaptif, pola aktivitas membantu pengajar memahami proses belajar, bukan menggantikan penilaian akademik.' },
    { id: 'm2', title: 'Mengenal K-Nearest Neighbors', tag: 'MODUL 02', time: '10 menit', body: 'KNN menentukan kelas sebuah data dengan melihat tetangga terdekat berdasarkan jarak fitur. Skala fitur dan pemilihan jumlah tetangga memengaruhi hasil model.' },
    { id: 'm3', title: 'Jaringan Saraf Tiruan', tag: 'MODUL 03', time: '12 menit', body: 'MLP mengolah fitur melalui lapisan neuron dan fungsi aktivasi. Model belajar dari contoh berlabel, lalu memperkirakan kelas untuk data baru.' },
    { id: 'm4', title: 'Membaca Hasil Prediksi', tag: 'MODUL 04', time: '7 menit', body: 'Prediksi model merupakan estimasi berdasarkan data masukan. Periksa konteks, kualitas data, dan probabilitas kelas; jangan menafsirkan hasil sebagai kepastian.' }
  ];
  let quizzes = [];
  const levels = [
    { name: 'Beginner', min: 0 }, { name: 'Explorer', min: 100 }, { name: 'Intermediate', min: 250 },
    { name: 'Advanced', min: 500 }, { name: 'Expert', min: 750 }
  ];
  const badgeDefs = [
    { id: 'first_quiz', icon: '✦', name: 'Langkah pertama', desc: 'Menyelesaikan kuis pertama', test: s => s.history.length >= 1 },
    { id: 'perfect_quiz', icon: '✧', name: 'Nilai sempurna', desc: 'Mendapat nilai 100', test: s => s.history.some(x => x.score === 100) },
    { id: 'three_day_streak', icon: '♨', name: 'Api konsisten', desc: 'Mempertahankan streak 3 hari', test: s => s.streak.best >= 3 },
    { id: 'xp_100', icon: '⚡', name: 'Pengumpul XP', desc: 'Mengumpulkan 100 XP', test: s => s.xp >= 100 },
    { id: 'ten_quizzes', icon: '◇', name: 'Tekun berlatih', desc: 'Menyelesaikan 10 kuis', test: s => s.history.length >= 10 }
  ];
  const dayKey = date => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const value = type => parts.find(p => p.type === type).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  const today = () => dayKey(new Date());
  const freshState = () => ({ xp: 0, unlockedLevel: 1, history: [], badges: {}, materialProgress: {}, activities: [], xpEvents: [], streak: { days: 0, best: 0, lastDate: '' }, dailyQuest: { date: today(), done: false, rewardClaimed: false }, latestPrediction: null, profileName: 'Pembelajar lokal' });
  let state = loadState();
  let currentQuiz = null;
  let timerId = null;
  let toastTimer = null;
  let healthData = null;
  let authUser = null;
  let remoteDashboard = null;
  let authMode = 'login';
  let streakTimerId = null;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!parsed || typeof parsed !== 'object') return freshState();
      const base = freshState();
      return { ...base, ...parsed, unlockedLevel: Number.isInteger(parsed.unlockedLevel) ? Math.min(5, Math.max(1, parsed.unlockedLevel)) : 1, latestPrediction: Array.isArray(parsed.latestPrediction?.badges) && parsed.latestPrediction?.features_used ? parsed.latestPrediction : null, streak: { ...base.streak, ...(parsed.streak || {}) }, dailyQuest: { ...base.dailyQuest, ...(parsed.dailyQuest || {}) } };
    } catch (_) { return freshState(); }
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  function escapeHtml(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function logActivity(type, label) {
    state.activities.push({ type, label, date: today(), at: new Date().toISOString() });
    if (state.activities.length > 500) state.activities = state.activities.slice(-500);
    save();
  }
  function addXP(amount, reason) {
    state.xp += amount;
    state.xpEvents.push({ amount, reason, date: today(), at: new Date().toISOString() });
    if (state.xpEvents.length > 500) state.xpEvents = state.xpEvents.slice(-500);
  }
  function currentLevel() {
    const index = Math.min(levels.length - 1, Math.max(0, state.unlockedLevel - 1));
    const start = levels[index].min, next = levels[index + 1]?.min;
    return { index, name: levels[index].name, start, next, percent: next ? Math.max(0, Math.min(100, Math.floor(((state.xp - start) / (next - start)) * 100))) : 100, within: Math.max(0, state.xp - start) };
  }
  function recordLearningDay() {
    const d = today(), last = state.streak.lastDate;
    if (last !== d) {
      const yesterday = dayKey(new Date(Date.now() - 86400000));
      state.streak.days = last === yesterday ? state.streak.days + 1 : 1;
      state.streak.lastDate = d;
      state.streak.best = Math.max(state.streak.best, state.streak.days);
    }
  }
  function checkBadges() {
    const earned = [];
    badgeDefs.forEach(b => { if (!state.badges[b.id] && b.test(state)) { state.badges[b.id] = new Date().toISOString(); earned.push(b.name); } });
    earned.forEach(n => toast(`Badge baru: ${n}`));
  }
  function toast(message) {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }
  function setPage(page) {
    if (authUser?.role === 'admin' && !['admin', 'leaderboard'].includes(page)) page = 'admin';
    if (authUser?.role === 'student' && page === 'admin') page = 'beranda';
    if (!document.getElementById(`page-${page}`)) page = 'beranda';
    document.querySelectorAll('.page-section').forEach(x => x.classList.toggle('active', x.id === `page-${page}`));
    document.querySelectorAll('.nav-link').forEach(x => x.classList.toggle('active', x.dataset.page === page));
    const nav = document.querySelector(`[data-page="${page}"]`);
    document.getElementById('breadcrumb-current').textContent = nav ? nav.textContent.trim().replace(/\d+$/, '').trim() : 'Beranda';
    document.getElementById('sidebar').classList.remove('open');
    if (page === 'analytics') renderAnalytics();
    if (page === 'adaptive') renderAdaptiveSummary();
    if (page === 'leaderboard') renderLeaderboard();
    if (page === 'admin') loadAdminData();
    if (page === 'streak') renderStreakPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderCommon() {
    const lv = currentLevel(), quizCount = remoteDashboard?.completed_quizzes ?? state.history.length, avg = remoteDashboard?.average_score ?? (quizCount ? Math.round(state.history.reduce((a, x) => a + x.score, 0) / quizCount) : '—');
    const name = state.profileName || 'Pembelajar lokal';
    ['profile-name'].forEach(id => document.getElementById(id).textContent = name);
    ['top-avatar', 'profile-avatar'].forEach(id => document.getElementById(id).textContent = name.charAt(0).toUpperCase());
    document.getElementById('welcome-name').textContent = name.toLowerCase() + '.';
    document.getElementById('today-label').textContent = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date());
    document.getElementById('welcome-date').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
    document.getElementById('xp-value').textContent = remoteDashboard?.xp ?? state.xp;
    document.getElementById('side-xp').textContent = remoteDashboard?.xp ?? state.xp;
    document.getElementById('level-label').textContent = lv.name;
    document.getElementById('side-level-name').textContent = lv.name;
    document.getElementById('side-level').textContent = String(lv.index + 1).padStart(2, '0');
    document.getElementById('path-level').textContent = `Level adaptif ${state.unlockedLevel} dari 5`;
    document.getElementById('stat-progress').style.width = `${lv.percent}%`;
    document.getElementById('side-progress').style.width = `${lv.percent}%`;
    document.getElementById('level-percent').textContent = `${lv.percent}%`;
    document.getElementById('quiz-value').textContent = quizCount;
    document.getElementById('quiz-nav-count').textContent = quizCount;
    document.getElementById('average-value').textContent = avg;
    document.getElementById('last-score').textContent = remoteDashboard?.last_score ?? state.history.at(-1)?.score ?? '—';
    document.getElementById('student-accuracy').textContent = remoteDashboard?.accuracy ?? '—';
    document.getElementById('student-average-time').textContent = remoteDashboard?.average_duration_seconds ? formatDuration(remoteDashboard.average_duration_seconds) : '—';
    document.getElementById('student-tier').textContent = remoteDashboard?.tier || 'Belum ada data';
    const streakNow = remoteDashboard?.streak?.current_streak ?? state.streak.days, streakBest = remoteDashboard?.streak?.best_streak ?? state.streak.best;
    document.getElementById('streak-value').textContent = streakNow;
    document.getElementById('streak-pill').textContent = streakNow ? `Terbaik ${streakBest} hari` : 'Mulai hari ini';
    document.getElementById('quiz-streak').textContent = `${streakNow} hari streak`;
    document.getElementById('badge-value').textContent = remoteDashboard?.achievements?.length ?? Object.keys(state.badges).length;
    document.getElementById('badge-mini-row').innerHTML = (remoteDashboard?.achievements || badgeDefs.filter(b => state.badges[b.id]).map(b => ({ name: b.name }))).slice(0, 4).map(b => `<span title="${escapeHtml(b.name)}">✦</span>`).join('') || '<small>Belum ada badge</small>';
    document.getElementById('xp-today').textContent = `${state.xpEvents.filter(x => x.date === today()).reduce((a, x) => a + x.amount, 0)} XP hari ini`;
    const done = modules.filter(m => state.materialProgress[m.id]).length;
    document.getElementById('material-value').textContent = done; document.getElementById('material-total').textContent = `${modules.length} materi`;
    document.getElementById('material-percent').textContent = `${Math.round(done / modules.length * 100)}%`;
    document.getElementById('material-progress').style.width = `${done / modules.length * 100}%`;
    document.getElementById('hero-path-progress').textContent = `${done} materi selesai`;
    document.getElementById('activity-count').textContent = `${remoteDashboard?.activities?.length ?? state.activities.length} aktivitas`;
    const activityRows = remoteDashboard?.activities || [];
    document.getElementById('student-activity-list').innerHTML = activityRows.length ? activityRows.map(x => `<div class="student-activity-row"><span>${escapeHtml(x.reason)}<small>${new Date(x.date).toLocaleString('id-ID')}</small></span><strong>${x.xp ? `+${x.xp} XP` : ''}</strong></div>`).join('') : '<p class="empty-copy">Aktivitas kuis dan XP akan muncul setelah mulai belajar.</p>';
    renderWeeklyChart(); renderPath(); renderQuizList(); renderHistory(); renderAchievements(); renderQuest(); renderDashboardPrediction();
  }
  function renderPath() {
    document.getElementById('learning-path-content').innerHTML = modules.map((m, i) => {
      const complete = !!state.materialProgress[m.id];
      const available = i === 0 || (i + 1 <= state.unlockedLevel && !!state.materialProgress[modules[i - 1].id]);
      return `<article class="panel module-card ${complete ? 'completed' : ''} ${available ? '' : 'locked'}"><div class="module-number">${complete ? '✓' : String(i + 1).padStart(2, '0')}</div><div class="module-copy"><div class="eyebrow">${m.tag} · ${m.time}</div><h3>${escapeHtml(m.title)}</h3><p>${escapeHtml(m.body)}</p><span class="module-state">${complete ? 'SELESAI' : available ? 'TERSEDIA' : 'TERKUNCI'}</span></div><button class="button ${complete ? 'button-quiet' : 'button-primary'}" data-module="${m.id}" ${available ? '' : 'disabled'}>${complete ? 'Ulangi materi' : 'Buka materi'} <span>→</span></button></article>`;
    }).join('');
    document.querySelectorAll('[data-module]').forEach(b => b.addEventListener('click', () => openModule(b.dataset.module)));
  }
  function openModule(id) {
    const m = modules.find(x => x.id === id); if (!m) return;
    logActivity('quiz_module_viewed', 'Membuka materi');
    const done = !!state.materialProgress[id];
    document.getElementById('dialog-root').innerHTML = `<div class="dialog-backdrop" data-close-dialog><section class="dialog panel" role="dialog" aria-modal="true"><button class="dialog-close" data-close-dialog aria-label="Tutup">×</button><div class="eyebrow">${m.tag} · ${m.time}</div><h2>${escapeHtml(m.title)}</h2><p>${escapeHtml(m.body)}</p><div class="notice"><span>✦</span><p>Materi latihan contoh untuk prototipe pembelajaran.</p></div><button class="button button-primary" id="complete-module" ${done ? 'disabled' : ''}>${done ? 'Materi sudah selesai' : 'Tandai selesai · +15 XP'}</button></section></div>`;
    document.querySelectorAll('[data-close-dialog]').forEach(x => x.addEventListener('click', e => { if (e.target === x || x.classList.contains('dialog-close')) document.getElementById('dialog-root').innerHTML = ''; }));
    document.getElementById('complete-module')?.addEventListener('click', async () => {
      if (state.materialProgress[id]) return;
      try {
        const reward = await apiJson('/api/students/material-complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module_id: id }) });
        state.xp = reward.total_xp;
        state.materialProgress[id] = new Date().toISOString(); recordLearningDay(); logActivity('material_complete', 'Menyelesaikan materi'); checkBadges();
        try { remoteDashboard = await loadStudentDashboard(false); } catch (_) { if (remoteDashboard) remoteDashboard.xp = reward.total_xp; }
        save(); document.getElementById('dialog-root').innerHTML = ''; renderAll(); toast(`Materi selesai · +${reward.xp_earned} XP`);
      } catch (error) { toast(`Progres materi gagal disimpan: ${error.message}`); }
    });
  }
  function renderQuizList() {
    const wrap = document.getElementById('quiz-list'); if (!wrap) return;
    wrap.hidden = false;
    wrap.innerHTML = quizzes.length ? quizzes.map((q, i) => {
      const best = state.history.filter(x => String(x.quizId) === String(q.id)).reduce((a, x) => Math.max(a, x.score), -1);
      return `<article class="panel quiz-tile"><div class="quiz-tile-icon">${(['◇', '◎', '✧'][i % 3])}</div><div class="quiz-tile-copy"><div class="eyebrow">${escapeHtml(q.topic)} · ${Math.ceil(q.duration / 60)} MENIT</div><h3>${escapeHtml(q.title)}</h3><p>${q.questions.length} soal · 10 XP per jawaban benar · bonus 50 XP jika lengkap${best >= 0 ? ` · Nilai terbaik ${best}` : ''}</p></div><button class="button button-primary" data-start-quiz="${q.id}">Mulai kuis <span>→</span></button></article>`;
    }).join('') : '<div class="panel empty-copy">Memuat kuis dari server…</div>';
    wrap.querySelectorAll('[data-start-quiz]').forEach(b => b.addEventListener('click', () => startQuiz(Number(b.dataset.startQuiz))));
  }
  async function startQuiz(id) {
    const q = quizzes.find(x => x.id === id); if (!q) return;
    if (authUser?.role !== 'student') return;
    try {
      const data = await apiJson('/api/attempts/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz_id: id }) });
      const liveQuiz = { ...data.quiz, questions: data.quiz.questions };
      logActivity('quiz_started', 'Memulai kuis');
      currentQuiz = { quiz: liveQuiz, attemptId: data.attempt_id, answers: Array(liveQuiz.questions.length).fill(null), hints: Array(liveQuiz.questions.length).fill(false), index: 0, remaining: liveQuiz.duration, startedAt: Date.now() };
    } catch (err) { toast(err.message); return; }
    document.getElementById('quiz-result').hidden = true; document.getElementById('quiz-list').hidden = true;
    renderQuizSession(); clearInterval(timerId); timerId = setInterval(() => { if (!currentQuiz) return; currentQuiz.remaining--; renderTimer(); if (currentQuiz.remaining <= 0) submitQuiz(true); }, 1000);
    document.getElementById('quiz-session').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderTimer() { const el = document.getElementById('quiz-timer'); if (el && currentQuiz) el.textContent = `${String(Math.floor(currentQuiz.remaining / 60)).padStart(2, '0')}:${String(currentQuiz.remaining % 60).padStart(2, '0')}`; }
  function renderQuizSession() {
    const s = currentQuiz, q = s.quiz, item = q.questions[s.index], box = document.getElementById('quiz-session'); box.hidden = false;
    box.innerHTML = `<div class="quiz-session-head"><div><div class="eyebrow">${escapeHtml(q.topic)}</div><h2>${escapeHtml(q.title)}</h2></div><span class="timer-chip" id="quiz-timer"></span></div><div class="quiz-progress-line"><i style="width:${((s.index + 1) / q.questions.length) * 100}%"></i></div><div class="quiz-question-meta">SOAL ${s.index + 1} DARI ${q.questions.length} · 10 XP JIKA BENAR</div><h3 class="quiz-question">${escapeHtml(item.q)}</h3><div class="quiz-options">${item.options.map((o, i) => `<button class="quiz-option ${s.answers[s.index] === i ? 'selected' : ''}" data-answer="${i}"><span>${String.fromCharCode(65 + i)}</span>${escapeHtml(o)}</button>`).join('')}</div><div class="hint-area"><button class="button button-quiet" id="show-hint">${s.hints[s.index] ? 'Petunjuk digunakan' : 'Lihat petunjuk'}</button><p ${s.hints[s.index] ? '' : 'hidden'}>${escapeHtml(item.hint || 'Baca kembali konsep pada materi.')}</p></div><div class="quiz-question-nav"><div class="question-dots">${q.questions.map((_, i) => `<button class="question-dot ${i === s.index ? 'current' : ''} ${s.answers[i] !== null ? 'answered' : ''}" data-question="${i}" aria-label="Soal ${i + 1}">${i + 1}</button>`).join('')}</div><div><button class="button button-quiet" id="quiz-prev" ${s.index === 0 ? 'disabled' : ''}>Sebelumnya</button> <button class="button button-primary" id="quiz-next">${s.index === q.questions.length - 1 ? 'Kumpulkan jawaban' : 'Berikutnya'} →</button></div></div>`;
    renderTimer(); box.querySelectorAll('[data-answer]').forEach(b => b.addEventListener('click', () => {
      const choice = Number(b.dataset.answer), question = item.id;
      if (s.answers[s.index] !== choice) {
        s.activityPromises ||= [];
        s.activityPromises.push(apiJson('/api/students/question-activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attempt_id: s.attemptId, question_id: question }) })
          .then(data => { if (remoteDashboard) { remoteDashboard.streak = data.streak; remoteDashboard.achievements = data.achievements.map(x => ({ ...x, name: badgeDefs.find(b => b.id === x.id)?.name || x.id })); } state.badges = Object.fromEntries(data.achievements.map(x => [x.id, x.earned_at])); state.streak = { days: data.streak.current_streak, best: data.streak.best_streak, lastDate: data.streak.last_activity_at?.slice(0, 10) || '' }; renderCommon(); })
          .catch(error => toast(`Streak gagal diperbarui: ${error.message}`)));
      }
      s.answers[s.index] = choice; renderQuizSession();
    }));
    box.querySelectorAll('[data-question]').forEach(b => b.addEventListener('click', () => { s.index = Number(b.dataset.question); renderQuizSession(); }));
    document.getElementById('quiz-prev').onclick = () => { s.index--; renderQuizSession(); };
    document.getElementById('show-hint').onclick = () => { s.hints[s.index] = true; renderQuizSession(); };
    document.getElementById('quiz-next').onclick = () => { if (s.index < q.questions.length - 1) { s.index++; renderQuizSession(); } else if (s.answers.includes(null)) { toast('Jawab semua soal sebelum mengumpulkan.'); } else submitQuiz(false); };
  }
  function nextStreakDays() {
    if (state.streak.lastDate === today()) return state.streak.days;
    const yesterday = dayKey(new Date(Date.now() - 86400000));
    return state.streak.lastDate === yesterday ? state.streak.days + 1 : 1;
  }
  function quizPayload(s, score, correct) {
    const total = s.quiz.questions.length;
    const completion = Math.round(s.answers.filter(x => x !== null).length / total * 100);
    const streak = nextStreakDays();
    return {
      quiz_score: score,
      duration_minutes: Math.max(0.01, Math.round((Date.now() - s.startedAt) / 600) / 100),
      attempt_count: state.history.filter(x => x.quizId === s.quiz.id).length + 1,
      task_difficulty: quizzes.indexOf(s.quiz) + 1,
      completion_rate: completion,
      accuracy: Math.round(correct / total * 100),
      streak_days: streak,
      engagement_score: Math.min(100, Math.round(completion * 0.5 + score * 0.3 + Math.min(streak * 20, 100) * 0.2)),
      hint_count: 0,
      feedback_frequency: null,
      game_level: state.unlockedLevel,
      accumulated_xp: state.xp,
      completed_modules: modules.filter(m => state.materialProgress[m.id]).length,
      total_modules: modules.length,
      completed_quizzes: state.history.length
    };
  }
  async function submitQuiz(auto) {
    if (!currentQuiz || currentQuiz.submitting) return;
    if (!auto && currentQuiz.answers.includes(null)) { toast('Jawab semua soal sebelum mengumpulkan.'); return; }
    clearInterval(timerId);
    const s = currentQuiz; s.submitting = true;
    const result = document.getElementById('quiz-result'); result.hidden = false;
    result.innerHTML = '<div class="empty-state">Menyimpan hasil kuis ke server?</div>';
    try {
      await Promise.all(s.activityPromises || []);
      const payload = { answers: s.quiz.questions.map((q, i) => ({ question_id: q.id, answer_index: s.answers[i], hint_used: s.hints[i] })) };
      const data = await apiJson(`/api/attempts/${encodeURIComponent(s.attemptId)}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const score = data.score, correct = data.correct_count, total = data.total_questions;
      const attempt = { id: data.attempt_id, quizId: s.quiz.id, quizTitle: s.quiz.title, score, correct, total,
        xp: data.xp_earned - data.completion_bonus, bonusXp: data.completion_bonus, date: new Date().toISOString(), duration: data.duration_seconds,
        answers: s.answers.slice(), hints: s.hints.slice(), gradedAnswers: data.graded_answers, status: data.status, tier: data.performance_status,
        adaptiveLevel: data.adaptive_level, streak: data.streak.current_streak, achievementCount: data.achievement_count };
      state.xp = data.total_xp; state.history.unshift(attempt); recordLearningDay();
      state.xpEvents.push({ amount: data.xp_earned, reason: `Kuis: ${s.quiz.title}`, date: today(), at: new Date().toISOString() });
      if (state.dailyQuest.date !== today()) state.dailyQuest = { date: today(), done: false, rewardClaimed: false };
      if (!state.dailyQuest.done && data.completed) { state.dailyQuest.done = true; state.dailyQuest.rewardClaimed = true; }
      state.unlockedLevel = Math.max(state.unlockedLevel, data.adaptive_level || 1);
      checkBadges();
      state.latestPrediction = { status: data.status, quiz_score: score, xp_earned: data.xp_earned, confidence: data.confidence,
        unlocked_level: data.adaptive_level, max_level: data.max_level, learning_progress: 0, badges: [],
        recommendation: data.recommendation, features_used: data.features_used || {}, at: new Date().toISOString() };
      try { remoteDashboard = await loadStudentDashboard(false); } catch (_) { /* Quiz score is already saved on the server. */ }
      save(); currentQuiz = null;
      document.getElementById('quiz-session').hidden = true; document.getElementById('quiz-list').hidden = false;
      renderAll(); renderQuizResult(attempt, auto); renderAdaptiveResult();
      toast(`Kuis selesai ? +${data.xp_earned} XP (${correct} soal benar${data.completed ? ' + 50 XP selesai' : ''})`);
    } catch (err) {
      result.innerHTML = `<div class="empty-state"><b>Hasil kuis gagal disimpan.</b><p>${escapeHtml(err.message)}</p><button class="button button-primary" id="retry-quiz">Coba lagi</button></div>`;
      document.getElementById('retry-quiz').onclick = () => { if (currentQuiz) { currentQuiz.submitting = false; submitQuiz(auto); } };
    } finally { if (currentQuiz === s) currentQuiz.submitting = false; }
  }
  function renderQuizResult(a, auto) {
    const q = quizzes.find(x => x.id === a.quizId);
    const data = state.latestPrediction;
    const el = document.getElementById('quiz-result');
    el.hidden = false;
    const review = (a.gradedAnswers || []).map(item => `<div class="review-item"><b>${item.position}. ${escapeHtml(item.prompt)}</b><p class="${item.is_correct ? 'correct-answer' : 'wrong-answer'}">Jawabanmu: ${item.answer_index === null ? 'Tidak dijawab' : escapeHtml(item.options[item.answer_index])} · ${item.xp_earned} XP</p><small>Kunci: ${escapeHtml(item.options[item.correct_index])}${item.hint_used ? ' · Petunjuk digunakan' : ''}</small><p class="answer-explanation"><b>Pembahasan:</b> ${escapeHtml(item.explanation)}</p></div>`).join('');
    el.innerHTML = `<div class="result-orb">${a.score}</div><div class="eyebrow">HASIL KUIS · ${escapeHtml(a.quizTitle)}</div><h2>${escapeHtml(a.tier)}</h2><p>${a.correct}/${a.total} jawaban benar${auto ? ' · waktu habis' : ''} · Prediksi KNN: ${escapeHtml(a.status)}</p><div class="result-stats"><span><b>${a.score}</b>Nilai /100</span><span><b>+${a.xp + a.bonusXp}</b>XP didapat</span><span><b>${formatDuration(a.duration)}</b>Durasi</span><span><b>${a.hints.filter(Boolean).length}</b>Hint digunakan</span><span><b>Level ${a.adaptiveLevel}</b>Level adaptif</span><span><b>🔥 ${a.streak}</b>Streak</span><span><b>${a.achievementCount}</b>Achievement</span></div><p class="result-recommendation">${escapeHtml(data.recommendation)}</p><details class="answer-review"><summary>Tinjau jawaban benar/salah, hint, XP dan pembahasan</summary>${review}</details><button class="button button-primary" id="result-next">Lihat kuis berikutnya <span>→</span></button>`;
    document.getElementById('result-next').onclick = () => { el.hidden = true; document.getElementById('quiz-list').scrollIntoView({ behavior: 'smooth' }); };
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function formatDuration(sec) { return `${Math.floor(sec / 60)}m ${sec % 60}d`; }
  function renderHistory() {
    const target = document.getElementById('attempt-history-list');
    if (!state.history.length) { target.className = 'empty-copy'; target.textContent = 'Belum ada attempt kuis. Riwayat akan tersimpan di browser setelah kuis selesai.'; }
    else { target.className = 'history-list'; target.innerHTML = [...state.history].reverse().slice(0, 12).map(a => `<div class="history-row"><span class="history-score">${a.score}</span><span><b>${escapeHtml(a.quizTitle)}</b><small>${new Date(a.date).toLocaleString('id-ID')} · ${a.correct}/${a.total} benar</small></span><b>+${a.xp} XP</b></div>`).join(''); }
  }
  function renderAchievements() {
    document.getElementById('achievement-grid').innerHTML = badgeDefs.map(b => { const date = state.badges[b.id]; return `<article class="panel achievement-card ${date ? 'earned' : 'locked'}"><span class="achievement-icon">${b.icon}</span><div><h3>${escapeHtml(b.name)}</h3><p>${escapeHtml(b.desc)}</p></div><span class="achievement-state">${date ? `DIPEROLEH ${new Date(date).toLocaleDateString('id-ID')}` : 'BELUM TERBUKA'}</span></article>`; }).join('');
    const events = [...state.xpEvents].reverse().slice(0, 20), badges = Object.entries(state.badges).map(([id, date]) => ({ reason: `Badge: ${badgeDefs.find(b => b.id === id)?.name || id}`, amount: 0, date: date.slice(0, 10) }));
    const rows = [...events, ...badges].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    document.getElementById('reward-history-list').innerHTML = rows.length ? rows.map(x => `<div class="history-row"><span class="history-score">${x.amount ? '+' + x.amount : '✦'}</span><span><b>${escapeHtml(x.reason)}</b><small>${new Date(x.date).toLocaleDateString('id-ID')}</small></span><b>${x.amount ? 'XP' : 'Badge'}</b></div>`).join('') : '<p class="empty-copy">Belum ada reward. Selesaikan kuis atau materi untuk mulai mengumpulkan XP.</p>';
  }
  function renderQuest() {
    const done = state.dailyQuest.date === today() && state.dailyQuest.done;
    document.getElementById('daily-quest-list').innerHTML = `<div class="quest-row"><span class="quest-icon">✦</span><span><b>Misi hari ini</b><small>Selesaikan 1 kuis · reward mengikuti aturan XP kuis</small></span><span class="quest-state">${done ? 'SELESAI ✓' : '0/1'}</span></div>`;
  }
  function last7() { return Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * 86400000))); }
  function renderBars(el, values, labels, max) {
    el.innerHTML = values.map((v, i) => `<div class="bar-column"><div class="bar-value">${v || ''}</div><div class="bar-track"><i style="height:${max ? Math.max(v ? 5 : 0, v / max * 100) : 0}%"></i></div><small>${labels[i]}</small></div>`).join('');
  }
  function renderWeeklyChart() {
    const days = last7(), vals = days.map(d => state.xpEvents.filter(x => x.date === d).reduce((a, x) => a + x.amount, 0));
    renderBars(document.getElementById('weekly-chart'), vals, days.map(d => new Date(`${d}T12:00:00`).toLocaleDateString('id-ID', { weekday: 'short' })), Math.max(...vals, 1));
    document.getElementById('weekly-xp').innerHTML = `${vals.reduce((a, x) => a + x, 0)} XP <small>7 hari ini</small>`;
  }
  function renderAnalytics() {
    const history = state.history, avg = history.length ? Math.round(history.reduce((a, x) => a + x.score, 0) / history.length) : 0, correct = history.reduce((a, x) => a + x.correct, 0), total = history.reduce((a, x) => a + x.total, 0);
    const kpis = [['Attempt kuis', history.length], ['Nilai rata-rata', history.length ? `${avg}/100` : '—'], ['Akurasi jawaban', total ? `${Math.round(correct / total * 100)}%` : '—'], ['Aktivitas lokal', state.activities.length]];
    document.getElementById('analytics-kpis').innerHTML = kpis.map(([l, v]) => `<article class="panel analytics-kpi"><span>${l}</span><b>${v}</b></article>`).join('');
    const ordered = [...history].slice(-8); renderBars(document.getElementById('score-chart'), ordered.map(x => x.score), ordered.map((x, i) => `#${history.length - ordered.length + i + 1}`), 100);
    const days = last7(), xp = days.map(d => state.xpEvents.filter(x => x.date === d).reduce((a, x) => a + x.amount, 0));
    renderBars(document.getElementById('xp-chart'), xp, days.map(d => new Date(`${d}T12:00:00`).toLocaleDateString('id-ID', { weekday: 'short' })), Math.max(...xp, 1));
    document.getElementById('analytics-history').innerHTML = history.length ? `<table><thead><tr><th>Tanggal</th><th>Kuis</th><th>Nilai</th><th>Benar</th><th>Durasi</th></tr></thead><tbody>${[...history].reverse().map(x => `<tr><td>${new Date(x.date).toLocaleDateString('id-ID')}</td><td>${escapeHtml(x.quizTitle)}</td><td>${x.score}</td><td>${x.correct}/${x.total}</td><td>${formatDuration(x.duration)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty-copy">Belum ada data analitik. Selesaikan kuis untuk membuat grafik lokal.</p>';
  }
  async function renderLeaderboard() {
    if (!authUser) return;
    const select = document.getElementById('leader-quiz');
    if (!select) return;
    const quizId = select.value;
    document.getElementById('leaderboard-title').textContent = quizId ? `Leaderboard kuis: ${quizzes.find(q => String(q.id) === quizId)?.title || ''}` : 'Leaderboard umum';
    const target = document.getElementById('leaderboard-rows'); target.innerHTML = '<p class="empty-copy">Memuat peringkat...</p>';
    try {
      const rows = await apiJson(`/api/leaderboard${quizId ? `?quiz_id=${encodeURIComponent(quizId)}` : ''}`);
      target.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Mahasiswa</th><th>Level</th><th>Status</th><th>Total XP</th><th>Rata-rata</th><th>Achievement</th><th>Streak</th>${quizId ? '<th>Nilai kuis</th>' : ''}</tr></thead><tbody>${rows.map(r => `<tr class="${r.student_id === authUser.student_id ? 'leader-you' : ''}"><td><b>#${r.rank}</b></td><td>${escapeHtml(r.name)}${r.student_id === authUser.student_id ? ' <small>(kamu)</small>' : ''}</td><td>${r.level}</td><td>${adminTag(r.status)}</td><td>${r.xp} XP</td><td>${r.average_score ?? '?'}</td><td>${r.achievements}</td><td>?? ${r.streak}</td>${quizId ? `<td><b>${r.best_score}</b>${r.best_duration_seconds ? `<small> ? ${formatDuration(r.best_duration_seconds)}</small>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="empty-copy">Belum ada attempt kuis untuk leaderboard ini.</p>';
    } catch (error) { target.innerHTML = `<p class="empty-copy">${escapeHtml(error.message)}</p>`; }
  }
  function renderDashboardPrediction() {
    const data = state.latestPrediction;
    const target = document.getElementById('dashboard-recommendation');
    const summary = document.getElementById('dashboard-prediction');
    if (!data) {
      target.textContent = 'Selesaikan kuis untuk mendapat rekomendasi KNN.';
      summary.innerHTML = '<p class="empty-copy">Hasil KNN akan tampil setelah kuis pertama selesai.</p>';
      return;
    }
    target.textContent = data.recommendation;
    const badgeText = data.badges.length ? data.badges.join(', ') : 'Belum ada badge baru';
    const progress = Math.round(modules.filter(m => state.materialProgress[m.id]).length / modules.length * 100);
    summary.innerHTML = `<div class="eyebrow">HASIL MODEL KNN TERAKHIR</div><div class="knn-metrics"><span><small>Status</small><b class="${data.status === 'Tuntas' ? 'complete' : 'remedial'}">${escapeHtml(data.status)}</b></span><span><small>Nilai kuis</small><b>${data.quiz_score}/100</b></span><span><small>XP kuis</small><b>+${data.xp_earned}</b></span><span><small>Akumulasi XP</small><b>${state.xp}</b></span><span><small>Level adaptif</small><b>${state.unlockedLevel}/${data.max_level}</b></span><span><small>Level berikutnya</small><b>${data.next_level ? `Level ${data.next_level}` : 'Penguatan'}</b></span><span><small>Progres materi</small><b>${progress}%</b></span><span><small>Badge baru</small><b>${escapeHtml(badgeText)}</b></span></div><div class="knn-progress"><i style="width:${progress}%"></i></div><p>${escapeHtml(data.recommendation)}</p>`;
  }
  function renderAdaptiveSummary() {
    const f = state.latestPrediction?.features_used;
    document.getElementById('feature-summary').innerHTML = f ? `<div class="feature-grid">${Object.entries(f).map(([k, v]) => `<div class="feature-item"><small>${escapeHtml(k)}</small><b>${escapeHtml(v)}</b></div>`).join('')}</div><p class="feature-footnote">Nilai kosong diisi dengan median training dari Joblib.</p>` : '<p class="empty-copy">Selesaikan kuis untuk melihat 11 fitur yang dipakai model.</p>';
    const n = document.getElementById('model-notice-text');
    if (healthData) n.textContent = healthData.model_loaded ? 'Model KNN asli berhasil dimuat dari model/gamified_its_model.joblib.' : (healthData.detail || 'Model KNN tidak tersedia.');
  }
  async function checkHealth() {
    const pill = document.getElementById('api-status');
    try {
      const response = await fetch('/health');
      const h = await response.json();
      healthData = h;
      pill.innerHTML = '<i></i> API ' + (h.model_loaded ? 'dan KNN terhubung' : 'model bermasalah');
      pill.classList.toggle('offline', !h.model_loaded);
    } catch (_) {
      healthData = { model_loaded: false, detail: 'API tidak terhubung.' };
      pill.innerHTML = '<i></i> API tidak terhubung';
      pill.classList.add('offline');
    }
    renderAdaptiveSummary();
  }
  function renderAdaptiveResult() {
    const data = state.latestPrediction;
    const result = document.getElementById('adaptive-result');
    if (!data) {
      result.innerHTML = '<div class="empty-state">Kerjakan kuis untuk menjalankan prediksi KNN.</div>';
      return;
    }
    result.innerHTML = `<div class="eyebrow">HASIL MODEL KNN</div><h2 class="prediction-status ${data.status === 'Tuntas' ? 'complete' : 'remedial'}">${escapeHtml(data.status)}</h2><p>${escapeHtml(data.recommendation)}</p><div class="knn-metrics"><span><small>Nilai</small><b>${data.quiz_score}/100</b></span><span><small>XP</small><b>+${data.xp_earned}</b></span><span><small>Level terbuka</small><b>${data.unlocked_level}/${data.max_level}</b></span><span><small>Progres materi</small><b>${data.learning_progress}%</b></span><span><small>Badge baru</small><b>${escapeHtml(data.badges.join(', ') || 'Belum ada')}</b></span><span><small>Probabilitas kelas</small><b>${data.confidence === null ? '—' : Math.round(data.confidence * 100) + '%'}</b></span></div><small>Prediksi KNN berdasarkan hasil kuis dan aktivitas yang tercatat.</small>`;
  }
  async function apiJson(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers });
    const raw = await response.text();
    let data = {};
    if (raw.trim()) {
      try { data = JSON.parse(raw); }
      catch (_) { throw new Error(`Server mengirim respons bukan JSON (HTTP ${response.status}). Restart Uvicorn dari folder proyek lalu coba lagi.`); }
    } else if (!response.ok) {
      throw new Error(`Server tidak mengirim detail error (HTTP ${response.status}). Pastikan Uvicorn memakai app.py terbaru dan sudah direstart.`);
    }
    if (!response.ok) {
      if (response.status === 401 && token && authUser) { localStorage.removeItem(TOKEN_KEY); authUser = null; remoteDashboard = null; showAuth('login', 'Sesi berakhir. Silakan login kembali.'); }
      const detail = data.detail;
      const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(x => x.msg).join(' · ') : 'Permintaan API gagal.';
      throw new Error(message);
    }
    return data;
  }
  async function loadQuizzes() {
    try {
      quizzes = await apiJson('/api/quizzes');
      renderQuizList();
      const select = document.getElementById('leader-quiz');
      if (select) { const selected = select.value; select.innerHTML = '<option value="">Leaderboard umum</option>' + quizzes.map(q => `<option value="${q.id}">${escapeHtml(q.title)}</option>`).join(''); select.value = selected; }
      if (document.getElementById('leader-quiz')) renderLeaderboard();
    } catch (error) { document.getElementById('quiz-list').innerHTML = `<div class="panel empty-copy">Kuis gagal dimuat: ${escapeHtml(error.message)}</div>`; }
  }
  async function loadStudentDashboard(render = true) {
    const data = await apiJson('/api/students/dashboard');
    remoteDashboard = data; state.profileName = data.name; state.xp = data.xp; state.unlockedLevel = Math.max(state.unlockedLevel, data.adaptive_level || 1);
    state.history = (data.attempts || []).slice().reverse();
    state.xpEvents = (data.xp_events || data.activities || []).slice().reverse().map(x => ({ amount: x.xp, reason: x.reason, date: x.date.slice(0, 10), at: x.date }));
    state.badges = Object.fromEntries((data.achievements || []).map(x => [x.id, x.earned_at]));
    if (data.streak) state.streak = { days: data.streak.current_streak, best: data.streak.best_streak, lastDate: data.streak.last_activity_at?.slice(0, 10) || '' };
    save(); if (render) renderAll(); return data;
  }
  function adminTag(level) {
    const cls = level === 'Perlu bimbingan' ? 'needs-help' : level === 'Mandiri' ? 'independent' : 'growing';
    return `<span class="admin-tag ${cls}">${escapeHtml(level)}</span>`;
  }
  function showAdminDialog(title, body) {
    document.getElementById('dialog-root').innerHTML = `<div class="dialog-backdrop" data-admin-close><section class="dialog panel admin-dialog" role="dialog" aria-modal="true"><button class="dialog-close" data-admin-close aria-label="Tutup">×</button><div class="eyebrow">ADMIN</div><h2>${escapeHtml(title)}</h2><div class="admin-dialog-body">${body}</div></section></div>`;
    document.querySelectorAll('[data-admin-close]').forEach(x => x.addEventListener('click', e => { if (e.target === x || x.classList.contains('dialog-close')) document.getElementById('dialog-root').innerHTML = ''; }));
  }
  async function loadAdminData() {
    const studentsEl = document.getElementById('admin-students'); if (!studentsEl) return;
    studentsEl.innerHTML = '<p class="empty-copy">Memuat data server…</p>';
    try {
      const [overview, students, qs] = await Promise.all([apiJson('/api/admin/overview'), apiJson('/api/admin/students'), apiJson('/api/admin/quizzes')]);
      document.getElementById('admin-kpis').innerHTML = [
        ['JUMLAH MAHASISWA', overview.student_count, 'Terdaftar di database'],
        ['RATA-RATA NILAI', overview.average_score == null ? '—' : overview.average_score, '/100 semua attempt'],
        ['PERLU BIMBINGAN', overview.needs_guidance, 'Berdasarkan nilai dan XP'],
        ['KUIS AKTIF', overview.active_quiz_count, '10 soal · maks. 150 XP']
      ].map(([label, value, caption]) => `<article class="stat-card"><div class="eyebrow">${label}</div><div class="stat-value"><b>${value}</b>${label === 'RATA-RATA NILAI' ? '<small>/100</small>' : ''}</div><div class="stat-caption">${caption}</div></article>`).join('');
      document.getElementById('student-count-chip').textContent = `${students.length} mahasiswa`;
      studentsEl.innerHTML = students.length ? `<table><thead><tr><th>Mahasiswa</th><th>Rata-rata</th><th>XP</th><th>Tingkat</th><th>Level adaptif</th><th>Kuis selesai</th><th></th></tr></thead><tbody>${students.map(s => `<tr><td><b>${escapeHtml(s.name)}</b><small class="admin-email">${escapeHtml(s.email)}</small></td><td>${s.average_score ?? '—'}</td><td>${s.xp}</td><td>${adminTag(s.level)}</td><td>${s.adaptive_level}</td><td>${s.completed_quizzes}</td><td><button class="text-button" data-student-detail="${s.id}">Detail</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty-copy">Belum ada mahasiswa. Mahasiswa tercatat saat memulai kuis dengan nama dan email.</p>';
      studentsEl.querySelectorAll('[data-student-detail]').forEach(b => b.addEventListener('click', () => openStudentDetail(Number(b.dataset.studentDetail))));
      const quizzesEl = document.getElementById('admin-quizzes');
      quizzesEl.innerHTML = qs.length ? `<table><thead><tr><th>Kuis</th><th>Soal</th><th>Penyelesaian</th><th>Rata-rata waktu</th><th>Rata-rata nilai</th><th>Detail</th></tr></thead><tbody>${qs.map(q => `<tr><td><b>${escapeHtml(q.title)}</b><small class="admin-email">${escapeHtml(q.topic)}</small></td><td>${q.question_count}</td><td>${q.completion_count}</td><td>${q.average_duration_seconds == null ? '—' : formatDuration(q.average_duration_seconds)}</td><td>${q.average_score ?? '—'}</td><td><button class="text-button" data-quiz-detail="${q.id}">Lihat soal & hasil</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty-copy">Belum ada kuis.</p>';
      quizzesEl.querySelectorAll('[data-quiz-detail]').forEach(b => b.addEventListener('click', () => openQuizDetail(Number(b.dataset.quizDetail))));
    } catch (error) { studentsEl.innerHTML = `<p class="empty-copy">Gagal memuat data admin: ${escapeHtml(error.message)}</p>`; }
  }
  async function openStudentDetail(id) {
    try {
      const s = await apiJson(`/api/admin/students/${id}`);
      const attempts = s.attempts.length ? s.attempts.map(a => `<article class="admin-attempt"><div class="admin-attempt-head"><b>${escapeHtml(a.quiz_title)}</b><span>${a.score}/100 · +${a.xp_earned} XP</span></div><p>${new Date(a.date).toLocaleString('id-ID')} · waktu ${formatDuration(a.duration_seconds)} · ${a.hint_count} hint · level adaptif ${a.adaptive_level}${a.prediction_status ? ` · ${escapeHtml(a.prediction_status)}` : ''}</p><div class="table-wrap"><table><thead><tr><th>No</th><th>Soal</th><th>Jawaban</th><th>Hasil</th><th>Hint</th><th>XP soal</th></tr></thead><tbody>${a.answers.map(x => `<tr><td>${x.position}</td><td>${escapeHtml(x.question)}</td><td>${escapeHtml(x.selected_answer || 'Tidak dijawab')}</td><td>${x.is_correct ? 'Benar' : 'Salah'}</td><td>${x.hint_used ? 'Dipakai' : '—'}</td><td>${x.xp_earned}</td></tr>`).join('')}</tbody></table></div></article>`).join('') : '<p class="empty-copy">Mahasiswa ini belum menyelesaikan kuis.</p>';
      showAdminDialog(`Detail ${s.name}`, `<div class="admin-student-summary"><span>Email<b>${escapeHtml(s.email)}</b></span><span>Rata-rata<b>${s.average_score ?? '—'}/100</b></span><span>Total XP<b>${s.xp}</b></span><span>Tingkat<b>${adminTag(s.level)}</b></span><span>Level adaptif<b>${s.adaptive_level}</b></span><span>Kuis selesai<b>${s.completed_quizzes}</b></span></div>${attempts}`);
    } catch (error) { toast(error.message); }
  }
  async function openQuizDetail(id) {
    try {
      const q = await apiJson(`/api/admin/quizzes/${id}`);
      const roster = q.students.length ? `<div class="table-wrap"><table><thead><tr><th>Mahasiswa</th><th>Nilai</th><th>Waktu</th><th>XP total</th><th>Hint</th><th>Rincian XP per soal</th></tr></thead><tbody>${q.students.map(s => `<tr><td>${escapeHtml(s.name)}<small class="admin-email">${escapeHtml(s.email)}</small></td><td>${s.score}/100</td><td>${formatDuration(s.duration_seconds)}</td><td>${s.xp_earned}</td><td>${s.hint_count}</td><td>${s.answers.map(a => `S${a.position}: ${a.xp_earned} XP${a.hint_used ? ' (hint)' : ''}`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-copy">Belum ada attempt pada kuis ini.</p>';
      const questionCards = q.questions.map(x => `<article class="question-admin-card"><b>Soal ${x.position}. ${escapeHtml(x.prompt)}</b><p>Jawaban benar: ${escapeHtml(x.options[x.correct_answer])}</p><small>Hint: ${escapeHtml(x.hint)}</small><p class="answer-explanation"><b>Pembahasan:</b> ${escapeHtml(x.explanation)}</p><div class="question-admin-metrics"><span>Hint dipakai <b>${x.hint_usage_count}×</b></span><span>XP rata-rata/soal <b>${x.average_xp == null ? '—' : Number(x.average_xp).toFixed(1)}</b></span></div></article>`).join('');
      showAdminDialog(`Kuis: ${q.title}`, `<div class="admin-student-summary"><span>Penyelesaian<b>${q.completion_count}</b></span><span>Rata-rata nilai<b>${q.average_score ?? '—'}</b></span><span>Rata-rata waktu<b>${q.average_duration_seconds == null ? '—' : formatDuration(q.average_duration_seconds)}</b></span></div><h3>Hasil mahasiswa</h3>${roster}<h3>Soal dan penggunaan hint</h3><div class="question-admin-grid">${questionCards}</div>`);
    } catch (error) { toast(error.message); }
  }
  function openAddQuizDialog() {
    const fields = Array.from({ length: 10 }, (_, i) => `<fieldset class="quiz-builder-question"><legend>Soal ${i + 1}</legend><label>Pertanyaan<input name="prompt_${i}" required maxlength="500"></label><label>Pilihan jawaban (satu per baris)<textarea name="options_${i}" required rows="4" placeholder="Pilihan A&#10;Pilihan B&#10;Pilihan C&#10;Pilihan D"></textarea></label><div class="quiz-builder-inline"><label>Kunci jawaban<select name="correct_${i}"><option value="0">Pilihan A</option><option value="1">Pilihan B</option><option value="2">Pilihan C</option><option value="3">Pilihan D</option></select></label><label>Petunjuk<input name="hint_${i}" required maxlength="300"></label></div><label>Pembahasan jawaban<textarea name="explanation_${i}" required rows="3" maxlength="1200" placeholder="Jelaskan alasan jawaban benar dan konsep yang terkait"></textarea></label></fieldset>`).join('');
    showAdminDialog('Tambah kuis baru', `<p class="empty-copy">Kuis wajib berisi tepat 10 soal dan berdurasi 10 menit. XP: 10 per jawaban benar, ditambah 50 XP bila seluruh soal dijawab. Maksimum 150 XP.</p><form id="new-quiz-form" class="quiz-builder-form"><label>Nama kuis<input name="title" required maxlength="120"></label><label>Topik<input name="topic" required maxlength="80"></label><div class="quiz-fixed-duration">Durasi pengerjaan <b>10 menit</b></div>${fields}<button class="button button-primary" type="submit">Simpan kuis</button></form>`);
    document.getElementById('new-quiz-form').addEventListener('submit', async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget);
      const questions = Array.from({ length: 10 }, (_, i) => ({ prompt: String(form.get(`prompt_${i}`)).trim(), options: String(form.get(`options_${i}`)).split('\n').map(x => x.trim()).filter(Boolean), correct_index: Number(form.get(`correct_${i}`)), hint: String(form.get(`hint_${i}`)).trim(), explanation: String(form.get(`explanation_${i}`)).trim() }));
      try {
        await apiJson('/api/admin/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.get('title'), topic: form.get('topic'), duration_minutes: 10, questions }) });
        document.getElementById('dialog-root').innerHTML = ''; await loadQuizzes(); await loadAdminData(); toast('Kuis baru tersimpan.');
      } catch (error) { toast(error.message); }
    });
  }
  async function renderStreakPage() {
    const overview = document.getElementById('streak-overview'); if (!overview) return;
    overview.innerHTML = '<p class="empty-copy">Memuat streak...</p>';
    try {
      const data = await apiJson('/api/students/streak');
      const left = data.hours_remaining || 0;
      overview.innerHTML = `<div class="streak-fire ${data.lit ? 'lit' : 'out'}">${data.lit ? '🔥' : '♨'}</div><div><div class="eyebrow">STREAK SAAT INI</div><h2>${data.current_streak} hari</h2><p>${data.lit ? `Api menyala · sisa waktu ${left} jam untuk menjawab soal berikutnya.` : 'Api padam. Jawab satu soal untuk menyalakannya kembali.'}</p><small>Streak terbaik: ${data.best_streak} hari</small></div>`;
      const all = data.days || [];
      document.getElementById('streak-calendar').innerHTML = all.length ? all.map(d => `<div class="streak-day"><span>${new Date(`${d.date}T12:00:00`).toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short'})}</span><b>🔥 ${d.questions_answered} soal</b></div>`).join('') : '<p class="empty-copy">Belum ada hari aktif. Jawab minimal satu soal kuis untuk memulai streak.</p>';
      clearInterval(streakTimerId); streakTimerId = setInterval(() => { if (location.hash === '#streak') renderStreakPage(); }, 60000);
    } catch (error) { overview.innerHTML = `<p class="empty-copy">${escapeHtml(error.message)}</p>`; }
  }
  function applyRoleVisibility() {
    const role = authUser.role;
    document.querySelectorAll('[data-role]').forEach(el => { const allowed = el.dataset.role === 'both' || el.dataset.role === role; el.hidden = !allowed; });
    document.querySelectorAll('.page-section').forEach(el => { el.hidden = role === 'admin' ? !['page-admin', 'page-leaderboard'].includes(el.id) : el.id === 'page-admin' || el.id === 'page-streak' && role !== 'student'; });
    document.querySelectorAll('.side-label-progress,.sidebar-level,.help-card').forEach(el => el.hidden = role === 'admin');
    document.getElementById('role-badge').textContent = role === 'admin' ? 'ADMIN' : 'MAHASISWA';
    document.getElementById('role-badge').className = `role-badge ${role}`;
    document.getElementById('profile-name').textContent = authUser.name;
    document.getElementById('profile-role').textContent = role === 'admin' ? 'Administrator' : 'Mahasiswa';
    document.getElementById('top-avatar').textContent = authUser.name.charAt(0).toUpperCase();
    document.getElementById('profile-avatar').textContent = authUser.name.charAt(0).toUpperCase();
  }
  function showAuth(mode = 'login', message = '') {
    authMode = mode;
    document.getElementById('auth-screen').hidden = false; document.getElementById('app-shell').hidden = true;
    const registering = mode === 'register';
    document.getElementById('auth-title').textContent = registering ? 'Buat akun.' : 'Selamat datang.';
    document.getElementById('auth-intro').textContent = registering ? 'Daftar sebagai mahasiswa atau admin.' : 'Masuk untuk melanjutkan perjalanan belajar.';
    document.getElementById('auth-name-wrap').hidden = !registering;
    document.getElementById('auth-name').required = registering;
    document.getElementById('auth-password').autocomplete = registering ? 'new-password' : 'current-password';
    document.getElementById('auth-role').disabled = false;
    document.getElementById('auth-submit').textContent = registering ? 'Daftar akun' : 'Masuk';
    document.getElementById('auth-switch-copy').textContent = registering ? 'Sudah punya akun?' : 'Belum punya akun?';
    document.getElementById('auth-switch').textContent = registering ? 'Masuk' : 'Daftar';
    document.getElementById('auth-error').textContent = message;
    updateAdminCodeField();
  }
  function updateAdminCodeField() {
    const show = authMode === 'register' && document.getElementById('auth-role').value === 'admin';
    document.getElementById('admin-code-wrap').hidden = !show;
    document.getElementById('auth-intro').textContent = show ? 'Admin pertama dapat mendaftar saat setup. Admin selanjutnya perlu kode undangan.' : authMode === 'register' ? 'Daftar akun mahasiswa untuk mulai belajar.' : 'Masuk untuk melanjutkan perjalanan belajar.';
  }
  async function enterApp(user) {
    authUser = user; state.profileName = user.name; remoteDashboard = null;
    document.getElementById('auth-screen').hidden = true; document.getElementById('app-shell').hidden = false;
    applyRoleVisibility(); bindApp();
    checkHealth();
    if (user.role === 'student') {
      try { await loadStudentDashboard(); } catch (error) { toast(error.message); }
      await loadQuizzes();
      setPage(location.hash.slice(1) || 'beranda');
    } else {
      await loadQuizzes(); await loadAdminData(); setPage('admin');
    }
    renderAll(); applyRoleVisibility();
  }
  async function submitAuth(event) {
    event.preventDefault();
    const error = document.getElementById('auth-error'); error.textContent = '';
    const role = document.getElementById('auth-role').value;
    const body = { email: document.getElementById('auth-email').value.trim(), password: document.getElementById('auth-password').value, role };
    if (authMode === 'register') {
      body.name = document.getElementById('auth-name').value.trim();
      body.admin_code = document.getElementById('admin-code').value || null;
      try {
        await apiJson('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        showAuth('login', 'Akun berhasil dibuat. Silakan masuk.');
        document.getElementById('auth-email').value = body.email;
        document.getElementById('auth-password').value = '';
      } catch (e) { error.textContent = e.message; }
      return;
    }
    try {
      const result = await apiJson('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      localStorage.setItem(TOKEN_KEY, result.access_token); await enterApp(result.user);
    } catch (e) { error.textContent = e.message; }
  }
  function bindApp() {
    document.querySelectorAll('[data-page]').forEach(a => a.onclick = e => { e.preventDefault(); setPage(a.dataset.page); });
    document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => setPage(b.dataset.goto));
    document.getElementById('menu-toggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('leader-quiz').onchange = renderLeaderboard;
    document.getElementById('run-analysis').onclick = runAnalysis;
    document.getElementById('profile-button').onclick = () => toast(`${authUser.name} · ${authUser.email}`);
    document.getElementById('admin-add-quiz').onclick = openAddQuizDialog;
    document.getElementById('logout-button').onclick = async () => { try { await apiJson('/api/auth/logout', { method: 'POST' }); } catch (_) {} localStorage.removeItem(TOKEN_KEY); authUser = null; remoteDashboard = null; clearInterval(timerId); currentQuiz = null; location.hash = ''; showAuth('login'); };
    window.onhashchange = () => setPage(location.hash.slice(1));
  }
  function runAnalysis() { renderAdaptiveResult(); }
  function bind() {
    document.getElementById('auth-form').addEventListener('submit', submitAuth);
    document.getElementById('auth-switch').addEventListener('click', () => showAuth(authMode === 'login' ? 'register' : 'login'));
    document.getElementById('auth-role').addEventListener('change', updateAdminCodeField);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('dialog-root').innerHTML = ''; });
  }
  async function init() {
    bind(); showAuth('login'); checkHealth();
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      try { const user = await apiJson('/api/auth/me'); await enterApp(user); }
      catch (_) { localStorage.removeItem(TOKEN_KEY); showAuth('login', 'Sesi sebelumnya berakhir. Silakan login kembali.'); }
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
