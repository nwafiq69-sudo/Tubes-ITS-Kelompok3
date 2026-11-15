(() => {
  'use strict';

  const STORE_KEY = 'gamifiedItsStateV1';
  const modules = [
    { id: 'm1', title: 'Dasar Data & Pembelajaran', tag: 'MODUL 01', time: '8 menit', body: 'Kenali bagaimana aktivitas belajar digital dapat dirangkum menjadi fitur. Dalam sistem adaptif, pola aktivitas membantu pengajar memahami proses belajar, bukan menggantikan penilaian akademik.' },
    { id: 'm2', title: 'Mengenal K-Nearest Neighbors', tag: 'MODUL 02', time: '10 menit', body: 'KNN menentukan kelas sebuah data dengan melihat tetangga terdekat berdasarkan jarak fitur. Skala fitur dan pemilihan jumlah tetangga memengaruhi hasil model.' },
    { id: 'm3', title: 'Jaringan Saraf Tiruan', tag: 'MODUL 03', time: '12 menit', body: 'MLP mengolah fitur melalui lapisan neuron dan fungsi aktivasi. Model belajar dari contoh berlabel, lalu memperkirakan kelas untuk data baru.' },
    { id: 'm4', title: 'Membaca Hasil Prediksi', tag: 'MODUL 04', time: '7 menit', body: 'Prediksi model merupakan estimasi berdasarkan data masukan. Periksa konteks, kualitas data, dan probabilitas kelas; jangan menafsirkan hasil sebagai kepastian.' }
  ];
  const quizzes = [
    { id: 'q1', title: 'Fondasi Machine Learning', topic: 'Dasar data', duration: 120, module: 'm1', questions: [
      { q: 'Apa tujuan utama data preprocessing?', options: ['Menyiapkan data agar sesuai untuk analisis/model', 'Menghapus seluruh data', 'Mengganti target secara acak', 'Menjamin model selalu benar'], answer: 0 },
      { q: 'Apa yang dimaksud fitur dalam dataset?', options: ['Atribut masukan yang menggambarkan satu observasi', 'Nama file hasil model', 'Nilai jawaban akhir saja', 'Jenis database'], answer: 0 },
      { q: 'Mengapa data latih dan data uji dipisahkan?', options: ['Mengukur kemampuan generalisasi pada data yang tidak dilatih', 'Memperbanyak label', 'Menghilangkan preprocessing', 'Menaikkan nilai secara otomatis'], answer: 0 }
    ] },
    { id: 'q2', title: 'KNN: Tetangga Terdekat', topic: 'Algoritma KNN', duration: 150, module: 'm2', questions: [
      { q: 'Bagaimana KNN menentukan kelas data baru?', options: ['Berdasarkan kelas tetangga terdekat', 'Dengan mengurutkan nama fitur', 'Dengan memilih kelas paling jarang', 'Dengan mengabaikan jarak'], answer: 0 },
      { q: 'Apa arti parameter k pada KNN?', options: ['Jumlah tetangga yang dipertimbangkan', 'Jumlah kolom target', 'Kecepatan internet', 'Jumlah dataset uji'], answer: 0 },
      { q: 'Mengapa penskalaan fitur dapat penting untuk KNN?', options: ['Fitur berskala besar bisa mendominasi perhitungan jarak', 'KNN hanya menerima teks', 'Agar label berubah', 'Untuk menghapus data uji'], answer: 0 }
    ] },
    { id: 'q3', title: 'JST dan Evaluasi', topic: 'JST / evaluasi', duration: 180, module: 'm3', questions: [
      { q: 'MLP merupakan salah satu jenis...', options: ['Jaringan saraf tiruan berlapis', 'Basis data relasional', 'Metode pengurutan', 'Visualisasi peta'], answer: 0 },
      { q: 'Apa fungsi data validasi?', options: ['Membantu memilih konfigurasi model selama pengembangan', 'Menjadi nama kelas keluaran', 'Menghapus data pelatihan', 'Menggantikan semua evaluasi'], answer: 0 },
      { q: 'Confidence prediksi sebaiknya dipahami sebagai...', options: ['Probabilitas/tingkat keyakinan model, bukan kepastian', 'Jaminan nilai akademik', 'Jumlah XP', 'Akurasi universal model'], answer: 0 }
    ] }
  ];
  const levels = [
    { name: 'Beginner', min: 0 }, { name: 'Explorer', min: 100 }, { name: 'Intermediate', min: 250 },
    { name: 'Advanced', min: 500 }, { name: 'Expert', min: 750 }
  ];
  const badgeDefs = [
    { id: 'first', icon: '✦', name: 'Langkah Pertama', desc: 'Selesaikan kuis pertama.', test: s => s.history.length >= 1 },
    { id: 'quick', icon: '⚡', name: 'Quick Learner', desc: 'Raih nilai minimal 80.', test: s => s.history.some(x => x.score >= 80) },
    { id: 'perfect', icon: '✧', name: 'Sempurna', desc: 'Jawab seluruh soal dengan benar.', test: s => s.history.some(x => x.score === 100) },
    { id: 'streak3', icon: '♨', name: 'Konsisten', desc: 'Bangun streak selama 3 hari.', test: s => s.streak.best >= 3 },
    { id: 'ten', icon: '◇', name: 'Tekun Berlatih', desc: 'Selesaikan 10 kuis.', test: s => s.history.length >= 10 },
    { id: 'level5', icon: '★', name: 'Level 5', desc: 'Kumpulkan 750 XP.', test: s => s.xp >= 750 }
  ];
  const today = () => new Date().toISOString().slice(0, 10);
  const freshState = () => ({ xp: 0, history: [], badges: {}, materialProgress: {}, activities: [], xpEvents: [], streak: { days: 0, best: 0, lastDate: '' }, dailyQuest: { date: today(), done: false, rewardClaimed: false }, latestPrediction: null, profileName: 'Pembelajar lokal' });
  let state = loadState();
  let currentQuiz = null;
  let timerId = null;
  let toastTimer = null;
  let healthData = null;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!parsed || typeof parsed !== 'object') return freshState();
      const base = freshState();
      return { ...base, ...parsed, streak: { ...base.streak, ...(parsed.streak || {}) }, dailyQuest: { ...base.dailyQuest, ...(parsed.dailyQuest || {}) } };
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
    let index = 0;
    levels.forEach((x, i) => { if (state.xp >= x.min) index = i; });
    const start = levels[index].min, next = levels[index + 1]?.min;
    return { index, name: levels[index].name, start, next, percent: next ? Math.min(100, Math.floor(((state.xp - start) / (next - start)) * 100)) : 100, within: next ? state.xp - start : state.xp - start };
  }
  function recordLearningDay() {
    const d = today(), last = state.streak.lastDate;
    if (last !== d) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
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
    if (!document.getElementById(`page-${page}`)) page = 'beranda';
    document.querySelectorAll('.page-section').forEach(x => x.classList.toggle('active', x.id === `page-${page}`));
    document.querySelectorAll('.nav-link').forEach(x => x.classList.toggle('active', x.dataset.page === page));
    const nav = document.querySelector(`[data-page="${page}"]`);
    document.getElementById('breadcrumb-current').textContent = nav ? nav.textContent.trim().replace(/\d+$/, '').trim() : 'Beranda';
    document.getElementById('sidebar').classList.remove('open');
    if (page === 'analytics') renderAnalytics();
    if (page === 'adaptive') renderAdaptiveSummary();
    if (page === 'leaderboard') renderLeaderboard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderCommon() {
    const lv = currentLevel(), quizCount = state.history.length, avg = quizCount ? Math.round(state.history.reduce((a, x) => a + x.score, 0) / quizCount) : '—';
    const name = state.profileName || 'Pembelajar lokal';
    ['profile-name'].forEach(id => document.getElementById(id).textContent = name);
    ['top-avatar', 'profile-avatar'].forEach(id => document.getElementById(id).textContent = name.charAt(0).toUpperCase());
    document.getElementById('welcome-name').textContent = name.toLowerCase() + '.';
    document.getElementById('today-label').textContent = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date());
    document.getElementById('welcome-date').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
    document.getElementById('xp-value').textContent = state.xp;
    document.getElementById('side-xp').textContent = state.xp;
    document.getElementById('level-label').textContent = lv.name;
    document.getElementById('side-level-name').textContent = lv.name;
    document.getElementById('side-level').textContent = String(lv.index + 1).padStart(2, '0');
    document.getElementById('path-level').textContent = `Level ${lv.index + 1} - ${lv.name}`;
    document.getElementById('stat-progress').style.width = `${lv.percent}%`;
    document.getElementById('side-progress').style.width = `${lv.percent}%`;
    document.getElementById('level-percent').textContent = `${lv.percent}%`;
    document.getElementById('quiz-value').textContent = quizCount;
    document.getElementById('quiz-nav-count').textContent = quizCount;
    document.getElementById('average-value').textContent = avg;
    document.getElementById('streak-value').textContent = state.streak.days;
    document.getElementById('streak-pill').textContent = state.streak.days ? `Terbaik ${state.streak.best} hari` : 'Mulai hari ini';
    document.getElementById('quiz-streak').textContent = `${state.streak.days} hari streak`;
    document.getElementById('badge-value').textContent = Object.keys(state.badges).length;
    document.getElementById('badge-mini-row').innerHTML = badgeDefs.filter(b => state.badges[b.id]).slice(0, 4).map(b => `<span title="${escapeHtml(b.name)}">${b.icon}</span>`).join('') || '<small>Belum ada badge</small>';
    document.getElementById('xp-today').textContent = `${state.xpEvents.filter(x => x.date === today()).reduce((a, x) => a + x.amount, 0)} XP hari ini`;
    const done = modules.filter(m => state.materialProgress[m.id]).length;
    document.getElementById('material-value').textContent = done; document.getElementById('material-total').textContent = `${modules.length} materi`;
    document.getElementById('material-percent').textContent = `${Math.round(done / modules.length * 100)}%`;
    document.getElementById('material-progress').style.width = `${done / modules.length * 100}%`;
    document.getElementById('hero-path-progress').textContent = `${done} materi selesai`;
    document.getElementById('activity-count').textContent = `${state.activities.length} aktivitas`;
    renderWeeklyChart(); renderPath(); renderQuizList(); renderHistory(); renderAchievements(); renderQuest();
  }
  function renderPath() {
    let unlocked = true;
    document.getElementById('learning-path-content').innerHTML = modules.map((m, i) => {
      const complete = !!state.materialProgress[m.id], available = unlocked; unlocked = complete;
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
    document.getElementById('complete-module')?.addEventListener('click', () => {
      if (state.materialProgress[id]) return;
      state.materialProgress[id] = new Date().toISOString(); recordLearningDay(); addXP(15, `Materi: ${m.title}`); logActivity('material_complete', 'Menyelesaikan materi'); checkBadges(); save(); document.getElementById('dialog-root').innerHTML = ''; renderAll(); toast('Materi selesai · +15 XP');
    });
  }
  function renderQuizList() {
    const wrap = document.getElementById('quiz-list'); if (!wrap) return;
    wrap.hidden = false;
    wrap.innerHTML = quizzes.map((q, i) => {
      const unlocked = i === 0 || !!state.materialProgress[q.module];
      const best = state.history.filter(x => x.quizId === q.id).reduce((a, x) => Math.max(a, x.score), -1);
      return `<article class="panel quiz-tile"><div class="quiz-tile-icon">${['◇', '◎', '✧'][i]}</div><div class="quiz-tile-copy"><div class="eyebrow">${escapeHtml(q.topic)} · ${Math.ceil(q.duration / 60)} MENIT</div><h3>${escapeHtml(q.title)}</h3><p>${q.questions.length} soal latihan contoh${best >= 0 ? ` · Nilai terbaik ${best}` : ''}</p></div><button class="button ${unlocked ? 'button-primary' : 'button-quiet'}" data-start-quiz="${q.id}" ${unlocked ? '' : 'disabled'}>${unlocked ? 'Mulai kuis' : 'Selesaikan materi dulu'} <span>→</span></button></article>`;
    }).join('');
    wrap.querySelectorAll('[data-start-quiz]').forEach(b => b.addEventListener('click', () => startQuiz(b.dataset.startQuiz)));
  }
  function startQuiz(id) {
    const q = quizzes.find(x => x.id === id); if (!q) return;
    logActivity('quiz_started', 'Memulai kuis');
    currentQuiz = { quiz: q, answers: Array(q.questions.length).fill(null), index: 0, remaining: q.duration, startedAt: Date.now() };
    document.getElementById('quiz-result').hidden = true; document.getElementById('quiz-list').hidden = true;
    renderQuizSession(); clearInterval(timerId); timerId = setInterval(() => { if (!currentQuiz) return; currentQuiz.remaining--; renderTimer(); if (currentQuiz.remaining <= 0) submitQuiz(true); }, 1000);
    document.getElementById('quiz-session').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderTimer() { const el = document.getElementById('quiz-timer'); if (el && currentQuiz) el.textContent = `${String(Math.floor(currentQuiz.remaining / 60)).padStart(2, '0')}:${String(currentQuiz.remaining % 60).padStart(2, '0')}`; }
  function renderQuizSession() {
    const s = currentQuiz, q = s.quiz, item = q.questions[s.index], box = document.getElementById('quiz-session'); box.hidden = false;
    box.innerHTML = `<div class="quiz-session-head"><div><div class="eyebrow">${escapeHtml(q.topic)}</div><h2>${escapeHtml(q.title)}</h2></div><span class="timer-chip" id="quiz-timer"></span></div><div class="quiz-progress-line"><i style="width:${((s.index + 1) / q.questions.length) * 100}%"></i></div><div class="quiz-question-meta">SOAL ${s.index + 1} DARI ${q.questions.length}</div><h3 class="quiz-question">${escapeHtml(item.q)}</h3><div class="quiz-options">${item.options.map((o, i) => `<button class="quiz-option ${s.answers[s.index] === i ? 'selected' : ''}" data-answer="${i}"><span>${String.fromCharCode(65 + i)}</span>${escapeHtml(o)}</button>`).join('')}</div><div class="quiz-question-nav"><div class="question-dots">${q.questions.map((_, i) => `<button class="question-dot ${i === s.index ? 'current' : ''} ${s.answers[i] !== null ? 'answered' : ''}" data-question="${i}" aria-label="Soal ${i + 1}">${i + 1}</button>`).join('')}</div><div><button class="button button-quiet" id="quiz-prev" ${s.index === 0 ? 'disabled' : ''}>Sebelumnya</button> <button class="button button-primary" id="quiz-next">${s.index === q.questions.length - 1 ? 'Kumpulkan jawaban' : 'Berikutnya'} →</button></div></div>`;
    renderTimer(); box.querySelectorAll('[data-answer]').forEach(b => b.addEventListener('click', () => { s.answers[s.index] = Number(b.dataset.answer); renderQuizSession(); }));
    box.querySelectorAll('[data-question]').forEach(b => b.addEventListener('click', () => { s.index = Number(b.dataset.question); renderQuizSession(); }));
    document.getElementById('quiz-prev').onclick = () => { s.index--; renderQuizSession(); };
    document.getElementById('quiz-next').onclick = () => { if (s.index < q.questions.length - 1) { s.index++; renderQuizSession(); } else if (s.answers.includes(null)) { toast('Jawab semua soal sebelum mengumpulkan.'); } else submitQuiz(false); };
  }
  function submitQuiz(auto) {
    if (!currentQuiz) return;
    if (!auto && currentQuiz.answers.includes(null)) { toast('Jawab semua soal sebelum mengumpulkan.'); return; }
    clearInterval(timerId); const s = currentQuiz, correct = s.answers.reduce((n, a, i) => n + (a === s.quiz.questions[i].answer ? 1 : 0), 0), score = Math.round(correct / s.quiz.questions.length * 100);
    let reward = 10 + correct * 10 + (score >= 90 ? 40 : score >= 80 ? 20 : 0) + (score === 100 ? 30 : 0);
    recordLearningDay(); addXP(reward, `Kuis: ${s.quiz.title}`);
    const attempt = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, quizId: s.quiz.id, quizTitle: s.quiz.title, score, correct, total: s.quiz.questions.length, xp: reward, date: new Date().toISOString(), duration: Math.max(1, Math.round((Date.now() - s.startedAt) / 1000)), answers: s.answers.slice() };
    state.history.push(attempt); logActivity('quiz_submitted', 'Mengumpulkan kuis');
    if (state.dailyQuest.date !== today()) state.dailyQuest = { date: today(), done: false, rewardClaimed: false };
    if (!state.dailyQuest.done) { state.dailyQuest.done = true; state.dailyQuest.rewardClaimed = true; addXP(15, 'Misi harian: selesaikan kuis'); }
    checkBadges(); save(); currentQuiz = null; document.getElementById('quiz-session').hidden = true; document.getElementById('quiz-list').hidden = false;
    renderAll(); renderQuizResult(attempt, auto); toast(`Kuis selesai · +${reward + 15} XP`);
  }
  function renderQuizResult(a, auto) {
    const q = quizzes.find(x => x.id === a.quizId), el = document.getElementById('quiz-result'); el.hidden = false;
    el.innerHTML = `<div class="result-orb">${a.score}</div><div class="eyebrow">HASIL TANTANGAN</div><h2>${a.score >= 80 ? 'Kerja bagus!' : 'Terus berlatih!'}</h2><p>${escapeHtml(a.quizTitle)} · ${a.correct}/${a.total} jawaban benar${auto ? ' · waktu habis' : ''}</p><div class="result-stats"><span><b>${a.score}</b>Nilai</span><span><b>+${a.xp + 15}</b>XP total</span><span><b>${formatDuration(a.duration)}</b>Durasi</span></div><details class="answer-review"><summary>Tinjau jawaban</summary>${q.questions.map((item, i) => `<div class="review-item"><b>${i + 1}. ${escapeHtml(item.q)}</b><p class="${a.answers[i] === item.answer ? 'correct-answer' : 'wrong-answer'}">Jawabanmu: ${a.answers[i] === null ? 'Tidak dijawab' : escapeHtml(item.options[a.answers[i]])}</p><small>Kunci: ${escapeHtml(item.options[item.answer])}</small></div>`).join('')}</details><button class="button button-primary" id="result-next">Lihat kuis berikutnya <span>→</span></button>`;
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
    document.getElementById('daily-quest-list').innerHTML = `<div class="quest-row"><span class="quest-icon">✦</span><span><b>Misi hari ini</b><small>Selesaikan 1 kuis latihan · bonus 15 XP</small></span><span class="quest-state">${done ? 'SELESAI ✓' : '0/1'}</span></div>`;
  }
  function last7() { return Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(0, 10); }); }
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
  function renderLeaderboard() {
    const period = document.getElementById('leader-period').value;
    const samples = period === 'week' ? [{ n: 'Siswa simulasi A', xp: 180, score: 88 }, { n: 'Siswa simulasi B', xp: 120, score: 91 }, { n: 'Siswa simulasi C', xp: 75, score: 76 }] : [{ n: 'Siswa simulasi A', xp: 640, score: 84 }, { n: 'Siswa simulasi B', xp: 520, score: 89 }, { n: 'Siswa simulasi C', xp: 380, score: 80 }];
    const localXp = period === 'week' ? state.xpEvents.filter(x => x.date >= last7()[0]).reduce((a, x) => a + x.amount, 0) : state.xp;
    const rows = [...samples, { n: state.profileName || 'Pembelajar lokal (kamu)', xp: localXp, score: state.history.length ? Math.round(state.history.reduce((a, x) => a + x.score, 0) / state.history.length) : 0, you: true }].sort((a, b) => b.xp - a.xp || b.score - a.score);
    document.getElementById('leaderboard-rows').innerHTML = rows.map((x, i) => `<div class="leader-row ${x.you ? 'leader-you' : ''}"><span class="leader-place">${String(i + 1).padStart(2, '0')}</span><span class="leader-avatar">${x.you ? 'L' : 'S'}</span><span class="leader-name"><b>${escapeHtml(x.n)}</b><small>${x.you ? 'Data lokal perangkat ini' : 'Peserta simulasi'}</small></span><span class="leader-score"><b>${x.xp} XP</b><small>rata-rata ${x.score || '—'}</small></span></div>`).join('');
  }
  const featureNames = ['total_events', 'quiz_started', 'quiz_submitted', 'quiz_viewed', 'quiz_reviewed', 'quiz_module_viewed', 'assignment_events', 'learning_material_events', 'forum_events', 'active_days', 'active_span_days', 'unique_activity_types', 'submit_rate', 'dominant_activity_type'];
  function buildFeatures() {
    const logs = state.activities, count = type => logs.filter(x => x.type === type).length;
    const dates = [...new Set(logs.map(x => x.date))].sort(), typeMap = { quiz_started: 'Kuis', quiz_submitted: 'Kuis', quiz_viewed: 'Kuis', quiz_reviewed: 'Kuis', quiz_module_viewed: 'Navigasi Kursus', material_open: 'Materi Belajar', material_complete: 'Materi Belajar' };
    const types = logs.map(x => typeMap[x.type] || 'Aktivitas Lain'), freq = types.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {}), dominant = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || 'Aktivitas Lain';
    const span = dates.length ? Math.max(1, Math.round((new Date(`${dates[dates.length - 1]}T12:00:00`) - new Date(`${dates[0]}T12:00:00`)) / 86400000) + 1) : 0;
    const features = { total_events: logs.length, quiz_started: count('quiz_started'), quiz_submitted: count('quiz_submitted'), quiz_viewed: count('quiz_viewed'), quiz_reviewed: count('quiz_reviewed'), quiz_module_viewed: count('quiz_module_viewed'), assignment_events: 0, learning_material_events: count('material_open') + count('material_complete'), forum_events: 0, active_days: dates.length, active_span_days: span, unique_activity_types: new Set(types).size, submit_rate: count('quiz_started') ? Math.min(1, count('quiz_submitted') / count('quiz_started')) : 0, dominant_activity_type: dominant };
    return features;
  }
  function renderAdaptiveSummary() {
    const f = buildFeatures();
    document.getElementById('feature-summary').innerHTML = `<div class="feature-grid">${featureNames.map(k => `<div class="feature-item"><small>${k}</small><b>${escapeHtml(f[k])}</b></div>`).join('')}</div><p class="feature-footnote">Tugas dan forum bernilai 0 karena prototipe ini tidak mencatat aktivitas tersebut. Data diambil dari aktivitas halaman ini.</p>`;
    const n = document.getElementById('model-notice-text'); if (healthData) n.textContent = healthData.model_available ? 'Model Joblib tersedia. Analisis menggunakan model terlatih yang terpasang.' : 'Model Joblib belum tersedia. Letakkan model asli di model/model_kelompok_3.joblib untuk mengaktifkan prediksi.';
  }
  async function checkHealth() {
    const pill = document.getElementById('api-status');
    try { const [h] = await Promise.all([fetch('/health').then(r => r.json()), fetch('/api/analytics').then(r => r.json())]); healthData = h; pill.innerHTML = `<i></i> API ${h.status === 'ok' ? 'terhubung' : 'tidak tersedia'}`; pill.classList.toggle('offline', !h.model_available); }
    catch (_) { pill.innerHTML = '<i></i> API tidak terhubung'; pill.classList.add('offline'); healthData = { model_available: false }; }
    renderAdaptiveSummary();
  }
  async function runAnalysis() {
    const btn = document.getElementById('run-analysis'), result = document.getElementById('adaptive-result');
    if (state.activities.length < 1) { result.innerHTML = '<div class="empty-state">Belum ada aktivitas untuk dianalisis. Buka materi atau kerjakan kuis terlebih dahulu.</div>'; return; }
    btn.disabled = true; btn.innerHTML = 'Memproses…'; result.innerHTML = '<div class="empty-state">Sedang mengirim ringkasan aktivitas ke pipeline model…</div>';
    try {
      const h = await fetch('/health').then(r => r.json()); healthData = h;
      if (!h.model_available) { result.innerHTML = '<div class="empty-state"><b>Model Joblib belum tersedia.</b><p>Prediksi belum dijalankan. Tambahkan file model asli sesuai nama dan lokasi yang ditampilkan pada panel ketersediaan model.</p></div>'; renderAdaptiveSummary(); return; }
      const response = await fetch('/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildFeatures()) });
      const data = await response.json(); if (!response.ok) throw new Error(data.detail || 'Analisis gagal.');
      state.latestPrediction = { ...data, at: new Date().toISOString() }; logActivity('analysis_run', 'Menjalankan analisis adaptif'); save();
      let recommendation = null; try { recommendation = await fetch(`/api/recommendations?status=${encodeURIComponent(data.status)}`).then(r => r.json()); } catch (_) { }
      result.innerHTML = `<div class="eyebrow">HASIL MODEL ${escapeHtml(data.algorithm)}</div><h2 class="prediction-status ${data.class_id === 1 ? 'remedial' : 'complete'}">${escapeHtml(data.status)}</h2><p>${recommendation ? escapeHtml(recommendation.message) : 'Hasil prediksi berasal dari pipeline Joblib.'}</p><div class="result-stats"><span><b>${data.confidence == null ? '—' : `${Math.round(data.confidence * 100)}%`}</b>Probabilitas kelas</span><span><b>${data.class_id}</b>Kelas prediksi</span></div><small>Probabilitas bukan kepastian. ${escapeHtml(data.confidence_label || '')}</small>`;
    } catch (err) { result.innerHTML = `<div class="empty-state"><b>Analisis gagal.</b><p>${escapeHtml(err.message)}</p></div>`; }
    finally { btn.disabled = false; btn.innerHTML = 'Analisis aktivitasku <span>→</span>'; renderAdaptiveSummary(); }
  }
  function bind() {
    document.querySelectorAll('[data-page]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); setPage(a.dataset.page); }));
    document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => setPage(b.dataset.goto)));
    document.getElementById('menu-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('leader-period').addEventListener('change', renderLeaderboard);
    document.getElementById('run-analysis').addEventListener('click', runAnalysis);
    document.getElementById('profile-button').addEventListener('click', () => { const name = prompt('Nama tampilan untuk perangkat ini:', state.profileName); if (name && name.trim()) { state.profileName = name.trim().slice(0, 32); save(); renderAll(); toast('Nama tampilan diperbarui.'); } });
    window.addEventListener('hashchange', () => setPage(location.hash.slice(1)));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('dialog-root').innerHTML = ''; });
  }
  function renderAll() { renderCommon(); renderAnalytics(); renderAdaptiveSummary(); renderLeaderboard(); }
  function init() { if (state.dailyQuest.date !== today()) state.dailyQuest = { date: today(), done: false, rewardClaimed: false }; save(); bind(); renderAll(); checkHealth(); setPage(location.hash.slice(1) || 'beranda'); }
  document.addEventListener('DOMContentLoaded', init);
})();
