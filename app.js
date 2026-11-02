(() => {
  'use strict';

  const STORAGE_KEY = 'aviation-english-100.pwa.v1';
  const app = document.getElementById('app');
  const bottomNav = document.getElementById('bottomNav');
  const toastEl = document.getElementById('toast');

  let DATA = null;
  let GROUPS = [];
  let ALL_TERMS = [];
  let GROUP_MAP = new Map();
  let TERM_MAP = new Map();
  let TERM_GROUP = new Map();
  let state = loadState();
  let installPrompt = null;
  let toastTimer = 0;
  let autoAdvanceTimer = null;

  const ui = {
    route: 'home',
    studyGroupId: null,
    studyIndex: 0,
    studyAnswered: false,
    studySelected: null,
    reviewTerms: [],
    reviewIndex: 0,
    reviewAnswered: false,
    reviewSelected: null,
    reviewCorrect: 0,
    reviewWrong: 0,
    quiz: null,
    quizIndex: 0,
    quizSelected: null,
    quizAnswered: false,
    quizFinished: false,
    quizMode: 'all',
  };

  const $ = (value) => String(value ?? '');
  const escapeHtml = (value) => $(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function emptyState() {
    return { version: 1, cards: {}, mistakes: {}, settings: { autoAdvance: true }, quiz: { total: 0, correct: 0 }, updatedAt: null };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return emptyState();
      const base = emptyState();
      return {
        ...base,
        ...parsed,
        cards: parsed.cards && typeof parsed.cards === 'object' ? parsed.cards : {},
        mistakes: parsed.mistakes && typeof parsed.mistakes === 'object' ? parsed.mistakes : {},
        settings: { ...base.settings, ...(parsed.settings || {}) },
        quiz: { ...base.quiz, ...(parsed.quiz || {}) },
      };
    } catch {
      return emptyState();
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      showToast('学习记录保存失败，请检查浏览器存储权限');
    }
  }

  function defaultCard() {
    return { status: 'new', streak: 0, correct: 0, wrong: 0, lastReviewed: null, nextReview: null };
  }

  function cardState(id) { return state.cards[String(id)] || null; }

  function ensureCard(id) {
    const key = String(id);
    if (!state.cards[key]) state.cards[key] = defaultCard();
    return state.cards[key];
  }

  function localDateKey(date = new Date()) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addDaysKey(days) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }

  function isDue(card) {
    return Boolean(card && card.status === 'learning' && card.nextReview && card.nextReview <= localDateKey());
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function getSummary() {
    let mastered = 0;
    let due = 0;
    let fresh = 0;
    for (const term of ALL_TERMS) {
      const card = cardState(term.id);
      if (!card || card.status === 'new') fresh += 1;
      if (card?.status === 'mastered') mastered += 1;
      if (isDue(card)) due += 1;
    }
    return {
      mastered, due, fresh,
      mistakes: Object.keys(state.mistakes).length,
      percent: ALL_TERMS.length ? Math.round((mastered / ALL_TERMS.length) * 100) : 0,
    };
  }

  function groupStats(group) {
    let mastered = 0;
    let learning = 0;
    for (const term of group.terms) {
      const card = cardState(term.id);
      if (card?.status === 'mastered') mastered += 1;
      if (card?.status === 'learning') learning += 1;
    }
    return { mastered, learning, percent: Math.round((mastered / group.terms.length) * 100) };
  }

  function addMistake(id) {
    const key = String(id);
    const existing = state.mistakes[key];
    state.mistakes[key] = { count: (existing?.count || 0) + 1, lastAt: localDateKey() };
  }

  function removeMistake(id) {
    delete state.mistakes[String(id)];
    saveState();
  }

  function recordReview(id, known) {
    const card = ensureCard(id);
    card.lastReviewed = localDateKey();
    if (known) {
      card.correct += 1;
      card.streak += 1;
      const intervals = [1, 3, 7, 14, 30];
      card.nextReview = addDaysKey(intervals[Math.min(card.streak - 1, intervals.length - 1)]);
      if (card.streak >= 2) {
        card.status = 'mastered';
        delete state.mistakes[String(id)];
      } else {
        card.status = 'learning';
      }
    } else {
      card.wrong += 1;
      card.streak = 0;
      card.status = 'learning';
      card.nextReview = addDaysKey(1);
      addMistake(id);
    }
    saveState();
  }

  function statusLabel(card) {
    if (!card || card.status === 'new') return '未学习';
    if (card.status === 'mastered') return '已掌握';
    return '学习中';
  }

  function statusClass(card) {
    if (card?.status === 'mastered') return 'mastered';
    if (card?.status === 'learning') return 'learning';
    return '';
  }

  function mistakeTerms() {
    return Object.keys(state.mistakes)
      .map((id) => TERM_MAP.get(String(id)))
      .filter(Boolean)
      .sort((a, b) => (state.mistakes[String(b.id)]?.count || 0) - (state.mistakes[String(a.id)]?.count || 0));
  }

  function dueTermIds() {
    return ALL_TERMS.filter((term) => isDue(cardState(term.id))).map((term) => term.id);
  }

  function unmasteredTermIds() {
    return ALL_TERMS.filter((term) => cardState(term.id)?.status !== 'mastered').map((term) => term.id);
  }

  function currentRoute() {
    const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'home', groupId: parts[1] || null };
  }

  function go(path) {
    const next = `#${path}`;
    if (location.hash === next) handleRoute();
    else location.hash = next;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function clearAutoAdvance() {
    if (autoAdvanceTimer) {
      window.clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function scheduleAutoAdvance(callback) {
    clearAutoAdvance();
    if (!state.settings?.autoAdvance) return;
    autoAdvanceTimer = window.setTimeout(() => {
      autoAdvanceTimer = null;
      callback();
    }, 900);
  }

  function autoAdvanceToggleMarkup() {
    const enabled = Boolean(state.settings?.autoAdvance);
    return `
      <div class="toggle-row">
        <div class="toggle-copy">
          <strong>答对后自动下一题</strong>
          <span>答错时停留查看正确答案</span>
        </div>
        <button class="switch ${enabled ? 'on' : ''}" type="button" role="switch" aria-checked="${enabled}" aria-label="答对后自动下一题" data-action="toggle-auto-advance">
          <span class="switch-knob"></span>
        </button>
      </div>`;
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function groupCardMarkup(group, compact = false) {
    const stats = groupStats(group);
    return `
      <button class="group-card" type="button" data-action="open-group" data-group="${escapeHtml(group.id)}">
        <span class="group-number">${String(group.number).padStart(2, '0')}</span>
        <span class="group-info">
          <h3>${escapeHtml(group.title)}</h3>
          <p>${compact ? `已掌握 ${stats.mastered} / ${group.terms.length}` : `10 题 · 已掌握 ${stats.mastered} / ${group.terms.length}`}</p>
          <span class="progress-track" aria-label="学习包进度 ${stats.percent}%">
            <span class="progress-fill" style="width:${stats.percent}%"></span>
          </span>
        </span>
        <span class="group-chevron" aria-hidden="true">›</span>
      </button>`;
  }

  function installCardMarkup() {
    if (isStandalone()) return '';
    return `
      <div class="install-card">
        <div><h3>安装到手机桌面</h3><p>通过 Chrome 添加到主屏幕，离线也能继续学习。</p></div>
        <button class="small-button" type="button" data-action="install-app">安装</button>
      </div>`;
  }

  function renderHome() {
    const s = getSummary();
    const primaryLabel = s.due > 0 ? `复习今日 ${s.due} 题` : '开始练习';
    app.innerHTML = `
      <section class="page" aria-labelledby="homeTitle">
        <header class="page-header">
          <div>
            <p class="eyebrow">L1 EXAM · 100 QUESTIONS</p>
            <h1 id="homeTitle">航空英语 100</h1>
            <p class="page-subtitle">直接作答考试原题选项，答错自动进入错词本。</p>
          </div>
        </header>
        <section class="hero-card" aria-label="总体学习进度">
          <div class="hero-top">
            <div class="hero-copy">
              <h2>${s.mastered === ALL_TERMS.length ? '100 题已全部掌握' : '继续完成航空英语选择题'}</h2>
              <p>${s.fresh > 0 ? `还有 ${s.fresh} 道题等待练习。` : '所有题都已开始练习。'}</p>
            </div>
            <div class="progress-ring" style="--progress:${s.percent}">
              <div class="progress-ring-copy"><strong>${s.percent}%</strong><small>掌握进度</small></div>
            </div>
          </div>
          <div class="hero-stats">
            <div class="hero-stat"><strong>${s.mastered}</strong><span>已掌握</span></div>
            <div class="hero-stat"><strong>${s.due}</strong><span>今日复习</span></div>
            <div class="hero-stat"><strong>${s.mistakes}</strong><span>错词</span></div>
          </div>
          <button class="hero-action" type="button" data-action="smart-start">${primaryLabel}</button>
        </section>
        ${installCardMarkup()}
        <div class="section-heading"><h2>主题练习包</h2><span>10 包 · 100 题</span></div>
        <div class="group-list">${GROUPS.map((group) => groupCardMarkup(group)).join('')}</div>
        <div class="page-footer">
          <button class="small-button" type="button" data-action="export-data">导出学习记录</button>
          <button class="small-button" type="button" data-action="reset-data">清空学习记录</button>
        </div>
      </section>`;
  }

  function renderStudyPicker() {
    const s = getSummary();
    const reviewTitle = s.due > 0 ? `今日到期 ${s.due} 道题` : '今日没有到期题';
    const reviewDesc = s.due > 0 ? '先完成到期题，再继续新的主题练习。' : '可以随机抽取 10 道未掌握题进行巩固。';
    app.innerHTML = `
      <section class="page" aria-labelledby="studyTitle">
        <header class="page-header"><div><p class="eyebrow">SMART REVIEW</p><h1 id="studyTitle">选择练习包</h1><p class="page-subtitle">直接用原题选项作答，不再先背释义。</p></div></header>
        <div class="info-card">
          <h3>${escapeHtml(reviewTitle)}</h3>
          <p>${escapeHtml(reviewDesc)}</p>
          <div class="button-row" style="margin-top:14px"><button class="primary-button" type="button" data-action="start-review">${s.due > 0 ? '开始今日复习' : '随机练习 10 题'}</button></div>
        </div>
        <div class="section-heading"><h2>10 个主题包</h2><span>每包 10 题</span></div>
        <div class="group-list">${GROUPS.map((group) => groupCardMarkup(group, true)).join('')}</div>
      </section>`;
  }

  function questionCardMarkup(term, answered, selectedKey, actionPrefix) {
    const card = cardState(term.id);
    const options = Object.entries(term.options || {});
    const correctKey = term.answer;
    const directionLabel = term.direction === 'zh2en' ? '中文 → 英文' : '英文 → 中文';
    const isCorrect = answered && selectedKey === correctKey;
    return `
      <article class="quiz-card" aria-label="单选题">
        <div class="card-topline">
          <span class="card-q">Q${String(term.q).padStart(3, '0')} · ${directionLabel}</span>
          <span class="status-chip ${statusClass(card)}">${statusLabel(card)}</span>
        </div>
        <p class="quiz-kicker">单选题</p>
        <h2 class="quiz-question">${escapeHtml(term.prompt || term.en)}</h2>
        <p class="quiz-subtext">请选择正确选项</p>
        <div class="options-list" role="group" aria-label="答案选项">
          ${options.map(([key, text]) => {
            let modifier = '';
            if (answered) {
              if (key === correctKey) modifier = ' correct';
              else if (key === selectedKey) modifier = ' wrong';
              else modifier = ' dimmed';
            }
            return `<button class="option-button${modifier}" type="button" data-action="${actionPrefix}-answer" data-key="${escapeHtml(key)}" ${answered ? 'disabled' : ''}>
              <span class="option-letter">${escapeHtml(key)}</span>
              <span class="option-text">${escapeHtml(text)}</span>
            </button>`;
          }).join('')}
        </div>
        ${answered ? `
          <div class="feedback ${isCorrect ? 'good' : 'bad'}">
            ${isCorrect ? '回答正确。' : `正确答案是：${escapeHtml(correctKey)}. ${escapeHtml(term.answerText || term.options[correctKey])}。`}
            <br><strong>${escapeHtml(term.en)}</strong> · ${escapeHtml(term.zh)}
            <br>${escapeHtml(term.system)}：${escapeHtml(term.scene)}
          </div>
          <button class="primary-button quiz-next" type="button" data-action="${actionPrefix}-next">下一题</button>` : ''}
      </article>`;
  }

  function renderStudy() {
    const group = GROUP_MAP.get(ui.studyGroupId);
    if (!group) { go('study'); return; }
    if (ui.studyIndex >= group.terms.length) { renderGroupComplete(group); return; }
    const term = group.terms[ui.studyIndex];
    const pct = Math.round((ui.studyIndex / group.terms.length) * 100);
    const stats = groupStats(group);
    app.innerHTML = `
      <section class="page" aria-labelledby="groupStudyTitle">
        <header class="page-header">
          <button class="back-button" type="button" data-route="study" aria-label="返回练习包列表">
            <svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>
          </button>
          <div style="flex:1;min-width:0">
            <p class="eyebrow">主题练习 ${group.number} / 10</p>
            <h1 id="groupStudyTitle" style="font-size:clamp(22px,6.2vw,28px)">${escapeHtml(group.title)}</h1>
            <p class="study-meta"><span>第 ${ui.studyIndex + 1} 题 / ${group.terms.length}</span><span>已掌握 ${stats.mastered} / ${group.terms.length}</span></p>
          </div>
        </header>
        <div class="session-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>
        ${autoAdvanceToggleMarkup()}
        ${questionCardMarkup(term, ui.studyAnswered, ui.studySelected, 'study')}
      </section>`;
  }

  function renderGroupComplete(group) {
    const stats = groupStats(group);
    app.innerHTML = `
      <section class="page">
        <header class="page-header">
          <button class="back-button" type="button" data-route="study" aria-label="返回学习包列表">
            <svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>
          </button>
          <div style="flex:1"><p class="eyebrow">学习包 ${group.number} / 10</p><h1 class="page-title">${escapeHtml(group.title)}</h1></div>
        </header>
        <div class="completion-card">
          <div class="completion-mark">✓</div>
          <h2>本包已完成</h2>
          <p>${stats.mastered === group.terms.length ? '这 10 个词已经全部掌握。' : '完成不等于掌握，明天继续复习不熟的词。'}</p>
          <div class="completion-stats">
            <div class="completion-stat"><strong>${stats.mastered}</strong><span>已掌握</span></div>
            <div class="completion-stat"><strong>${group.terms.length - stats.mastered}</strong><span>仍需复习</span></div>
          </div>
          <div class="button-row">
            <button class="secondary-button" type="button" data-action="restart-group">再学一遍</button>
            <button class="primary-button" type="button" data-route="study">选择其他包</button>
          </div>
        </div>
        <div class="info-card"><h3>易错提醒</h3><p>${escapeHtml(group.pitfall)}</p></div>
        <div class="info-card"><h3>本包自测</h3><p>${escapeHtml(group.selfcheck)}</p></div>
      </section>`;
  }

  function startDueReview() {
    const due = dueTermIds();
    const pool = due.length ? due : unmasteredTermIds();
    if (!pool.length) { showToast('所有词都已掌握，可以随时回来复习'); return; }
    ui.reviewTerms = shuffle(pool).slice(0, 20);
    ui.reviewIndex = 0;
    ui.reviewAnswered = false;
    ui.reviewSelected = null;
    ui.reviewCorrect = 0;
    ui.reviewWrong = 0;
    if (!due.length) showToast('今天没有到期词，已随机抽取复习内容');
    go('review');
  }

  function renderReview() {
    if (!ui.reviewTerms.length) {
      app.innerHTML = `
        <section class="page">
          <header class="page-header"><div><p class="eyebrow">DAILY REVIEW</p><h1>今日复习</h1><p class="page-subtitle">按 1 / 3 / 7 / 14 天的间隔复习。</p></div></header>
          <div class="empty-state">
            <div class="empty-icon">↻</div><h2>还没有生成复习队列</h2><p>点击下面的按钮，系统会优先抽取到期题。</p>
            <button class="primary-button" style="margin-top:16px" type="button" data-action="start-review">生成今日复习</button>
          </div>
        </section>`;
      return;
    }

    if (ui.reviewIndex >= ui.reviewTerms.length) {
      app.innerHTML = `
        <section class="page">
          <header class="page-header"><div><p class="eyebrow">DAILY REVIEW</p><h1>复习完成</h1></div></header>
          <div class="completion-card">
            <div class="completion-mark">✓</div><h2>本轮完成 ${ui.reviewTerms.length} 道题</h2>
            <p>答对 ${ui.reviewCorrect} 题，答错 ${ui.reviewWrong} 题。</p>
            <div class="button-row" style="margin-top:18px">
              <button class="secondary-button" type="button" data-route="mistakes">查看错词</button>
              <button class="primary-button" type="button" data-route="home">回到首页</button>
            </div>
          </div>
        </section>`;
      return;
    }

    const term = TERM_MAP.get(String(ui.reviewTerms[ui.reviewIndex]));
    if (!term) { ui.reviewIndex += 1; renderReview(); return; }
    const pct = Math.round((ui.reviewIndex / ui.reviewTerms.length) * 100);
    app.innerHTML = `
      <section class="page">
        <header class="page-header">
          <button class="back-button" type="button" data-route="study" aria-label="结束复习">
            <svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>
          </button>
          <div style="flex:1"><p class="eyebrow">DAILY REVIEW</p><h1>今日复习</h1><p class="study-meta"><span>第 ${ui.reviewIndex + 1} 题 / ${ui.reviewTerms.length}</span><span>优先到期题</span></p></div>
        </header>
        <div class="session-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>
        ${autoAdvanceToggleMarkup()}
        ${questionCardMarkup(term, ui.reviewAnswered, ui.reviewSelected, 'review')}
      </section>`;
  }

  function buildQuizItem(term) {
    return {
      termId: term.id,
      direction: term.direction,
      prompt: term.prompt || (term.direction === 'zh2en' ? term.zh : term.en),
      options: Object.entries(term.options || {}).map(([key, text]) => ({
        key,
        text,
        correct: key === term.answer,
      })),
    };
  }

  function startQuiz(mode = 'all') {
    let pool = mode === 'mistakes' ? mistakeTerms() : ALL_TERMS.filter((term) => cardState(term.id)?.status !== 'mastered');
    if (pool.length < 4) pool = ALL_TERMS;
    const selected = shuffle(pool).slice(0, 10);
    ui.quiz = {
      items: selected.map((term) => buildQuizItem(term)),
      index: 0,
      score: 0,
      answered: 0,
      mode,
    };
    ui.quizIndex = 0;
    ui.quizSelected = null;
    ui.quizAnswered = false;
    ui.quizFinished = false;
    ui.quizMode = mode;
    go('quiz');
  }

  function renderQuiz() {
    if (ui.quizFinished && ui.quiz) {
      const percent = ui.quiz.answered ? Math.round((ui.quiz.score / ui.quiz.answered) * 100) : 0;
      app.innerHTML = `
        <section class="page">
          <header class="page-header"><div><p class="eyebrow">QUIZ RESULT</p><h1>测验完成</h1></div></header>
          <div class="completion-card">
            <div class="completion-mark">${percent >= 80 ? '✓' : '↻'}</div>
            <h2>${ui.quiz.score} / ${ui.quiz.answered} 题正确</h2>
            <p>${percent >= 80 ? '表现不错，继续保持。' : '建议先复习错词，再做一轮测验。'}</p>
            <div class="completion-stats">
              <div class="completion-stat"><strong>${percent}%</strong><span>正确率</span></div>
              <div class="completion-stat"><strong>${ui.quiz.answered - ui.quiz.score}</strong><span>错题</span></div>
            </div>
            <div class="button-row">
              <button class="secondary-button" type="button" data-action="start-quiz" data-mode="${ui.quiz.mode}">再测一次</button>
              <button class="primary-button" type="button" data-route="home">回到首页</button>
            </div>
          </div>
        </section>`;
      return;
    }

    if (!ui.quiz) {
      const total = state.quiz.total;
      const correct = state.quiz.correct;
      const rate = total ? Math.round((correct / total) * 100) : 0;
      const mistakeCount = mistakeTerms().length;
      app.innerHTML = `
        <section class="page">
          <header class="page-header"><div><p class="eyebrow">MIXED QUIZ</p><h1>原题测验</h1><p class="page-subtitle">使用考试原题选项，每次随机 10 题。</p></div></header>
          <div class="quiz-intro">
            <h2>准备开始</h2>
            <p>题干和选项均来自题库，答错会自动进入错词本。</p>
            ${autoAdvanceToggleMarkup()}
            <div class="hero-stats" style="grid-template-columns:repeat(2,1fr);margin-top:16px">
              <div class="hero-stat" style="background:var(--surface-soft)"><strong style="color:var(--primary)">${total}</strong><span style="color:var(--muted)">累计答题</span></div>
              <div class="hero-stat" style="background:var(--surface-soft)"><strong style="color:var(--primary)">${rate}%</strong><span style="color:var(--muted)">总正确率</span></div>
            </div>
            <button class="primary-button" type="button" data-action="start-quiz" data-mode="all">开始 10 题</button>
            <button class="secondary-button" type="button" data-action="start-quiz" data-mode="mistakes" ${mistakeCount < 4 ? 'disabled' : ''}>错词专项${mistakeCount ? `（${mistakeCount}）` : ''}</button>
          </div>
        </section>`;
      return;
    }

    const item = ui.quiz.items[ui.quizIndex];
    const term = TERM_MAP.get(String(item.termId));
    const pct = Math.round((ui.quizIndex / ui.quiz.items.length) * 100);
    const correctIndex = item.options.findIndex((option) => option.correct);
    const answerFeedback = ui.quizAnswered ? `
      <div class="feedback ${ui.quizSelected === correctIndex ? 'good' : 'bad'}">
        ${ui.quizSelected === correctIndex ? '回答正确。' : `正确答案是：${escapeHtml(item.options[correctIndex].text)}。`}
        <br><strong>${escapeHtml(term.en)}</strong> · ${escapeHtml(term.zh)}
        <br>${escapeHtml(term.system)}
      </div>
      <button class="primary-button quiz-next" type="button" data-action="next-quiz">${ui.quizIndex + 1 >= ui.quiz.items.length ? '查看结果' : '下一题'}</button>` : '';

    app.innerHTML = `
      <section class="page">
        <header class="quiz-header">
          <p class="eyebrow">MIXED QUIZ · ${ui.quizIndex + 1} / ${ui.quiz.items.length}</p>
          <div class="session-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>
        </header>
        ${autoAdvanceToggleMarkup()}
        <div class="quiz-card">
          <p class="quiz-kicker">${item.direction === 'en2zh' ? '英文 → 中文' : '中文 → 英文'}</p>
          <h1 class="quiz-question">${escapeHtml(item.prompt)}</h1>
          <p class="quiz-subtext">请选择最准确的答案</p>
          <div class="options-list" role="group" aria-label="答案选项">
            ${item.options.map((option, index) => {
              let modifier = '';
              if (ui.quizAnswered) {
                if (option.correct) modifier = ' correct';
                else if (ui.quizSelected === index) modifier = ' wrong';
                else modifier = ' dimmed';
              }
              const letter = String.fromCharCode(65 + index);
              return `<button class="option-button${modifier}" type="button" data-action="answer-quiz" data-index="${index}" ${ui.quizAnswered ? 'disabled' : ''}>
                <span class="option-letter">${letter}</span>
                <span class="option-text">${escapeHtml(option.text)}</span>
              </button>`;
            }).join('')}
          </div>
          ${answerFeedback}
        </div>
      </section>`;
  }

  function renderMistakes() {
    const terms = mistakeTerms();
    app.innerHTML = `
      <section class="page">
        <header class="page-header"><div><p class="eyebrow">MISTAKE BOOK</p><h1>错词本</h1><p class="page-subtitle">答错或不认识的词会自动收录。</p></div></header>
        ${terms.length ? `
          <div class="section-heading"><h2>${terms.length} 个词</h2><button class="small-button" type="button" data-action="clear-mistakes">清空全部</button></div>
          <div class="mistake-list">
            ${terms.map((term) => {
              const count = state.mistakes[String(term.id)]?.count || 1;
              return `<article class="mistake-item">
                <div class="mistake-top"><h3>${escapeHtml(term.en)}</h3><span class="mistake-count">错 ${count} 次</span></div>
                <p>${escapeHtml(term.zh)} · ${escapeHtml(term.system)}</p>
                <div class="mistake-actions">
                  <button class="small-button" type="button" data-action="remove-mistake" data-term="${term.id}">移除</button>
                  <button class="primary-button" style="min-height:38px;padding-inline:14px;font-size:12px" type="button" data-action="review-mistake" data-term="${term.id}">复习</button>
                </div>
              </article>`;
            }).join('')}
          </div>` : `
          <div class="empty-state">
            <div class="empty-icon">✓</div><h2>暂时没有错词</h2><p>继续做测验；答错的词会自动出现在这里。</p>
            <button class="primary-button" style="margin-top:16px" type="button" data-route="quiz">去做测验</button>
          </div>`}
      </section>`;
  }

  function render() {
    const route = currentRoute();
    ui.route = route.name;
    const active = route.name === 'home' ? 'home'
      : route.name === 'quiz' ? 'quiz'
        : route.name === 'mistakes' ? 'mistakes' : 'study';
    bottomNav.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.route === active);
    });

    if (route.name === 'study' && route.groupId) {
      if (ui.studyGroupId !== route.groupId) {
        ui.studyGroupId = route.groupId;
        ui.studyIndex = 0;
        ui.studyAnswered = false;
        ui.studySelected = null;
      }
      renderStudy();
      return;
    }
    if (route.name === 'study') { renderStudyPicker(); return; }
    if (route.name === 'review') { renderReview(); return; }
    if (route.name === 'quiz') { renderQuiz(); return; }
    if (route.name === 'mistakes') { renderMistakes(); return; }
    renderHome();
  }

  function handleRoute() {
    clearAutoAdvance();
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openGroupStudy(groupId, termId = null) {
    const group = GROUP_MAP.get(groupId);
    if (!group) return;
    const sameGroup = ui.studyGroupId === groupId;
    ui.studyGroupId = groupId;
    ui.studyAnswered = false;
    ui.studySelected = null;
    if (termId !== null) {
      const index = group.terms.findIndex((term) => String(term.id) === String(termId));
      ui.studyIndex = index >= 0 ? index : 0;
    } else if (!sameGroup) {
      ui.studyIndex = 0;
    }
    go(`study/${groupId}`);
  }

  function answerQuiz(index) {
    if (!ui.quiz || ui.quizAnswered) return;
    const item = ui.quiz.items[ui.quizIndex];
    const selected = item.options[index];
    if (!selected) return;
    const correct = selected.correct;
    ui.quizSelected = index;
    ui.quizAnswered = true;
    ui.quiz.answered += 1;
    if (correct) ui.quiz.score += 1;
    state.quiz.total += 1;
    if (correct) state.quiz.correct += 1;
    const answeredIndex = ui.quizIndex;
    recordReview(item.termId, correct);
    render();
    requestAnimationFrame(() => document.querySelector('.feedback')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    if (correct) {
      scheduleAutoAdvance(() => {
        if (ui.route === 'quiz' && ui.quiz && ui.quizIndex === answeredIndex && ui.quizAnswered) {
          if (ui.quizIndex + 1 >= ui.quiz.items.length) {
            ui.quizFinished = true;
          } else {
            ui.quizIndex += 1;
            ui.quizSelected = null;
            ui.quizAnswered = false;
          }
          render();
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
      });
    }
  }

  function exportData() {
    const payload = { exportedAt: new Date().toISOString(), app: '航空英语100', state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `航空英语100-学习记录-${localDateKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('学习记录已导出');
  }

  function actionHandler(action, target) {
    switch (action) {
      case 'open-group':
        openGroupStudy(target.dataset.group);
        break;
      case 'smart-start':
        if (getSummary().due > 0) startDueReview();
        else go('study');
        break;
      case 'start-review':
        startDueReview();
        break;
      case 'study-answer': {
        if (ui.studyAnswered) break;
        const group = GROUP_MAP.get(ui.studyGroupId);
        const term = group.terms[ui.studyIndex];
        const selectedKey = target.dataset.key;
        ui.studyAnswered = true;
        const correct = selectedKey === term.answer;
        const answeredIndex = ui.studyIndex;
        ui.studySelected = selectedKey;
        recordReview(term.id, correct);
        render();
        requestAnimationFrame(() => document.querySelector('.feedback')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        if (correct) {
          scheduleAutoAdvance(() => {
            if (ui.route === 'study' && ui.studyIndex === answeredIndex && ui.studyAnswered && ui.studySelected === selectedKey) {
              ui.studyIndex += 1;
              ui.studyAnswered = false;
              ui.studySelected = null;
              render();
              window.scrollTo({ top: 0, behavior: 'auto' });
            }
          });
        }
        break;
      }
      case 'study-next': {
        clearAutoAdvance();
        ui.studyIndex += 1;
        ui.studyAnswered = false;
        ui.studySelected = null;
        render();
        window.scrollTo({ top: 0, behavior: 'auto' });
        break;
      }
      case 'restart-group':
        ui.studyIndex = 0;
        ui.studyAnswered = false;
        ui.studySelected = null;
        render();
        break;
      case 'review-answer': {
        if (ui.reviewAnswered) break;
        const id = ui.reviewTerms[ui.reviewIndex];
        const term = TERM_MAP.get(String(id));
        const selectedKey = target.dataset.key;
        const correct = selectedKey === term.answer;
        ui.reviewAnswered = true;
        ui.reviewSelected = selectedKey;
        const answeredIndex = ui.reviewIndex;
        if (correct) ui.reviewCorrect += 1; else ui.reviewWrong += 1;
        recordReview(id, correct);
        render();
        requestAnimationFrame(() => document.querySelector('.feedback')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        if (correct) {
          scheduleAutoAdvance(() => {
            if (ui.route === 'review' && ui.reviewIndex === answeredIndex && ui.reviewAnswered && ui.reviewSelected === selectedKey) {
              ui.reviewIndex += 1;
              ui.reviewAnswered = false;
              ui.reviewSelected = null;
              render();
              window.scrollTo({ top: 0, behavior: 'auto' });
            }
          });
        }
        break;
      }
      case 'review-next':
        clearAutoAdvance();
        ui.reviewIndex += 1;
        ui.reviewAnswered = false;
        ui.reviewSelected = null;
        render();
        window.scrollTo({ top: 0, behavior: 'auto' });
        break;
      case 'start-quiz':
        clearAutoAdvance();
        startQuiz(target.dataset.mode || 'all');
        break;
      case 'toggle-auto-advance':
        clearAutoAdvance();
        state.settings.autoAdvance = !state.settings.autoAdvance;
        saveState();
        render();
        break;
      case 'answer-quiz':
        answerQuiz(Number(target.dataset.index));
        break;
      case 'next-quiz':
        clearAutoAdvance();
        if (!ui.quiz) return;
        if (ui.quizIndex + 1 >= ui.quiz.items.length) {
          ui.quizFinished = true;
        } else {
          ui.quizIndex += 1;
          ui.quizSelected = null;
          ui.quizAnswered = false;
        }
        render();
        window.scrollTo({ top: 0, behavior: 'auto' });
        break;
      case 'review-mistake': {
        const id = Number(target.dataset.term);
        const group = TERM_GROUP.get(String(id));
        if (group) openGroupStudy(group.id, id);
        break;
      }
      case 'remove-mistake':
        removeMistake(target.dataset.term);
        render();
        break;
      case 'clear-mistakes':
        if (window.confirm('确定清空全部错词吗？学习进度不会被清除。')) {
          state.mistakes = {};
          saveState();
          render();
          showToast('错词本已清空');
        }
        break;
      case 'export-data':
        exportData();
        break;
      case 'reset-data':
        if (window.confirm('确定清空全部学习进度、错词和测验记录吗？此操作不可撤销。')) {
          state = emptyState();
          saveState();
          ui.quiz = null;
          ui.quizFinished = false;
          render();
          showToast('学习记录已清空');
        }
        break;
      case 'install-app':
        if (installPrompt) {
          installPrompt.prompt();
          installPrompt.userChoice.then((choice) => {
            if (choice.outcome === 'accepted') showToast('正在安装应用');
            installPrompt = null;
            render();
          });
        } else {
          showToast('请用 Chrome 打开 HTTPS 地址，或在菜单中选择“添加到主屏幕”');
        }
        break;
      default:
        break;
    }
  }

  document.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (actionTarget) {
      event.preventDefault();
      actionHandler(actionTarget.dataset.action, actionTarget);
      return;
    }
    const routeTarget = event.target.closest('[data-route]');
    if (routeTarget) {
      event.preventDefault();
      go(routeTarget.dataset.route);
    }
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target.closest('[data-action][role="button"]');
    if (!target) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actionHandler(target.dataset.action, target);
    }
  });

  window.addEventListener('hashchange', handleRoute);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    if (currentRoute().name === 'home' && DATA) render();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    showToast('已安装到主屏幕');
    render();
  });

  async function init() {
    try {
      const response = await fetch('./vocabulary.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      DATA = await response.json();
      GROUPS = DATA.groups || [];
      ALL_TERMS = GROUPS.flatMap((group) => group.terms);
      GROUP_MAP = new Map(GROUPS.map((group) => [group.id, group]));
      TERM_MAP = new Map(ALL_TERMS.map((term) => [String(term.id), term]));
      TERM_GROUP = new Map();
      for (const group of GROUPS) {
        for (const term of group.terms) TERM_GROUP.set(String(term.id), group);
      }
      if (!location.hash) history.replaceState(null, '', '#home');
      handleRoute();
      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      }
    } catch (error) {
      app.innerHTML = `
        <section class="page">
          <header class="page-header"><div><p class="eyebrow">STARTUP ERROR</p><h1>无法加载词汇数据</h1></div></header>
          <div class="empty-state">
            <div class="empty-icon">!</div><h2>请通过本地服务器打开</h2>
            <p>不要直接双击 index.html。请在 PyCharm 中运行 serve.py，然后访问 http://localhost:8080。</p>
          </div>
        </section>`;
      console.error(error);
    }
  }

  init();
})();

