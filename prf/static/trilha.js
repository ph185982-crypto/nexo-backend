/* Trilha: o edital como um caminho único de lições curtas (estilo Duolingo).
 *
 * O servidor monta o caminho e cada lição (prf/local/trilha_licoes.py); o
 * navegador guarda o que já foi feito (StudyState.trail) e decide qual é o
 * próximo nó. A lição roda numa camada própria por cima do app, com o seu
 * próprio desenho — o render() do app não precisa saber dela.
 */
const T = {path: null, loading: false, error: null, scrollToCurrent: true, showDone: false, showAllLocked: false,
  lesson: null, queue: [], pos: 0, pick: null, checked: null, firstTry: {}, xpStart: 0, result: null, testout: null};

const TI = {
  lei: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/><path d="M9 7h7M9 11h5"/></svg>',
  questoes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>',
  revisao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  path: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5-1.6 5.3-3 7.4C7.4 11.8 7 13.6 7 15a5 5 0 0 0 10 0c0-2.2-1.1-3.7-2-4.6.1 1.6-.6 2.6-1.6 2.6C14.6 9.6 14 5 12 2z"/></svg>',
};

const GOALS = [
  {xp: 50, name: 'Leve', hint: 'cerca de 1 lição'},
  {xp: 100, name: 'Regular', hint: 'cerca de 2 lições'},
  {xp: 200, name: 'Sério', hint: 'cerca de 4 lições'},
  {xp: 300, name: 'Intenso', hint: 'cerca de 6 lições'},
];

function trailExam() { return (S.targetExam || 'PMGO').startsWith('PM') ? 'PMGO' : 'PRF'; }

async function loadCaminho() {
  if (T.loading) return;
  T.loading = true; T.error = null;
  try { T.path = await api(`/api/prf/local/trilha/caminho?exam=${trailExam()}`); }
  catch (e) { T.error = 'Não foi possível carregar a trilha. Verifique a conexão e tente de novo.'; }
  T.loading = false; T.scrollToCurrent = true;
  if (S.tab === 'trilha') { render(); trailAfterRender(); }
}

// Onde a pessoa está: a primeira lição não feita a partir da unidade em que
// ela entrou (o "pular para cá" muda esse ponto de partida).
function trailProgress(state = localState()) {
  const units = T.path?.units || [];
  const done = state.trail?.done || {}, from = state.trail?.from || 0;
  let current = null;
  for (let u = from; u < units.length && !current; u++)
    for (const l of units[u].lessons) if (!done[l.id]) { current = {unit: u, id: l.id}; break; }
  const total = units.reduce((n, u) => n + u.lessons.length, 0);
  const finished = Object.keys(done).filter(id => units.some(u => u.lessons.some(l => l.id === id))).length;
  return {current, done, from, total, finished};
}

function lessonState(unitIdx, lesson, prog) {
  if (prog.done[lesson.id]) return 'done';
  if (prog.current && prog.current.id === lesson.id) return 'current';
  if (unitIdx < prog.from) return 'open';
  return 'locked';
}

function goalRing(xp, goal) {
  const pct = Math.min(1, xp / goal), r = 15, c = 2 * Math.PI * r;
  return `<svg class="tr-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="tr-ring-bg"/>
    <circle cx="18" cy="18" r="${r}" class="tr-ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(1)}"/></svg>`;
}

function trailHeader(state) {
  const xp = StudyState.xpToday(state), goal = state.trail?.goal || 100;
  const today = StudyState.day(), activeToday = state.last_active_date === today;
  const yesterday = StudyState.day(Date.now() - 86400000);
  const streak = (state.last_active_date === today || state.last_active_date === yesterday) ? state.streak : 0;
  const errors = Object.values(state.reviews || {}).filter(c => c.error_pending).length;
  return `<div class="tr-head">
    <button class="tr-chip ${activeToday ? 'lit' : ''}" onclick="trailStreakInfo()" aria-label="Sequência de ${streak} dias">${TI.flame}<b>${streak}</b></button>
    <button class="tr-chip tr-goal ${xp >= goal ? 'met' : ''}" onclick="openGoalPicker()" aria-label="Meta do dia: ${xp} de ${goal} XP">${goalRing(xp, goal)}<span><b>${xp}</b>/${goal} XP</span></button>
    <button class="tr-chip tr-err" onclick="openErrosDrill()" ${errors ? '' : 'disabled'} aria-label="Praticar erros">Erros <b>${errors}</b></button>
  </div>`;
}

function trailNode(unitIdx, unit, lesson, i, prog) {
  const st = lessonState(unitIdx, lesson, prog);
  const offset = [0, 46, 70, 46, 0, -46, -70, -46][i % 8];
  const label = {lei: 'Lei seca', questoes: 'Questões', audio: 'Áudio', revisao: 'Revisão'}[lesson.kind];
  const icon = st === 'done' && lesson.kind !== 'revisao' ? TI.check : st === 'locked' ? TI.lock : TI[lesson.kind];
  const bubble = st === 'current' ? `<span class="tr-bubble">${prog.finished ? 'CONTINUAR' : 'COMEÇAR'}</span>` : '';
  return `<div class="tr-node-row ${bubble ? 'has-bubble' : ''}" style="--x:${offset}px">
    ${bubble}<button class="tr-node ${st} k-${lesson.kind} ${st === 'current' ? 'tn-current' : ''}" ${st === 'locked' ? 'aria-disabled="true"' : ''}
      onclick="trailOpen('${lesson.id}',${unitIdx})" aria-label="${esc(label + ': ' + lesson.title + (st === 'done' ? ' (feita)' : st === 'locked' ? ' (bloqueada)' : ''))}">${icon}</button>
  </div>`;
}

function unitBanner(unit, unitIdx, prog, compact) {
  const done = unit.lessons.filter(l => prog.done[l.id]).length;
  const locked = prog.current ? unitIdx > prog.current.unit : false;
  const canJump = locked && unitIdx >= prog.from;
  return `<div class="tr-unit ${compact ? 'compact' : ''} ${locked ? 'locked' : ''}" style="--c:${esc(unit.color)}">
    <div class="tr-unit-txt"><small>Unidade ${unit.number} · ${esc(unit.subject_name)}</small><strong>${esc(unit.topic_name)}</strong>
    ${compact ? '' : `<span>${done} de ${unit.lessons.length} lições</span>`}</div>
    ${canJump ? `<button class="tr-jump" onclick="trailTestOut(${unitIdx})">Pular para cá</button>` : ''}
  </div>`;
}

function viewCaminho() {
  if (T.error) return `${appbar()}<div class="tr-empty"><p>${esc(T.error)}</p><button class="btn btn-primary" onclick="loadCaminho()">Tentar de novo</button></div>`;
  if (!T.path) { if (!T.loading) loadCaminho(); return appbar() + skeletonBlock(4, 90); }
  const state = localState(), prog = trailProgress(state), units = T.path.units;
  const cur = prog.current ? prog.current.unit : units.length;
  // Só as unidades em volta de onde a pessoa está ganham nós; as outras
  // viram uma faixa compacta. São ~700 nós no edital inteiro.
  const firstFull = Math.max(0, cur - 1), lastFull = Math.min(units.length - 1, cur + 2);
  const lockedLimit = T.showAllLocked ? units.length : lastFull + 12;
  let html = '';
  if (firstFull > 0) {
    html += `<button class="tr-more" onclick="T.showDone=!T.showDone;render()">${T.showDone ? 'Esconder' : 'Ver'} as ${firstFull} unidades anteriores</button>`;
    if (T.showDone) for (let u = 0; u < firstFull; u++) html += unitBanner(units[u], u, prog, true);
  }
  for (let u = firstFull; u <= lastFull; u++) {
    html += unitBanner(units[u], u, prog, false);
    html += `<div class="tr-nodes" style="--c:${esc(units[u].color)}">${units[u].lessons.map((l, i) => trailNode(u, units[u], l, i, prog)).join('')}</div>`;
  }
  for (let u = lastFull + 1; u < Math.min(units.length, lockedLimit); u++) html += unitBanner(units[u], u, prog, true);
  if (lockedLimit < units.length)
    html += `<button class="tr-more" onclick="T.showAllLocked=true;render()">Mostrar as outras ${units.length - lockedLimit} unidades</button>`;
  if (!prog.current) html += `<div class="tr-finish"><strong>Edital inteiro concluído.</strong><p>Agora é manter: revisões, erros e simulados.</p></div>`;
  const pct = prog.total ? Math.round(100 * prog.finished / prog.total) : 0;
  return `${appbar()}<div class="tr-wrap fade-in">${trailHeader(state)}
    <div class="tr-overall"><span>${prog.finished} de ${prog.total} lições do edital</span><div class="tr-bar"><i style="width:${pct}%"></i></div></div>
    ${html}</div>`;
}

function trailAfterRender() {
  if (!T.scrollToCurrent || S.tab !== 'trilha') return;
  const node = document.querySelector('.tn-current');
  if (node) { T.scrollToCurrent = false; node.scrollIntoView({block: 'center'}); }
}

function trailStreakInfo() {
  const s = localState(), today = s.last_active_date === StudyState.day();
  toast(today ? `Sequência de ${s.streak} ${s.streak === 1 ? 'dia' : 'dias'}. Amanhã tem mais.` : 'Faça uma lição hoje para manter a sequência.', today ? 'success' : 'info');
}

// ── Meta diária ─────────────────────────────────────────────────────────────
function openGoalPicker() {
  const goal = localState().trail?.goal || 100;
  trailLayer(`<div class="tr-sheet-wrap" onclick="if(event.target===this)closeTrailLayer()"><div class="tr-sheet" role="dialog" aria-label="Meta diária">
    <h2>Meta diária</h2><p class="muted">Quanto XP por dia? Cada questão certa vale 10, a lição concluída vale mais 10 a 15.</p>
    <div class="tr-goals">${GOALS.map(g => `<button class="tr-goal-opt ${g.xp === goal ? 'on' : ''}" onclick="setTrailGoal(${g.xp})"><b>${g.name}</b><span>${g.xp} XP · ${g.hint}</span></button>`).join('')}</div>
    <button class="btn btn-ghost" onclick="closeTrailLayer()">Fechar</button></div></div>`);
}
function setTrailGoal(xp) {
  const s = localState(); s.trail = {...(s.trail || {done: {}}), goal: xp}; saveLocalState(s);
  closeTrailLayer(); render(); toast(`Meta: ${xp} XP por dia`, 'success');
}

// ── Camada da lição ─────────────────────────────────────────────────────────
function trailLayer(html) {
  let el = document.getElementById('trail-layer');
  if (!el) { el = document.createElement('div'); el.id = 'trail-layer'; document.body.appendChild(el); }
  el.innerHTML = html; document.body.classList.add('tr-locked');
}
function closeTrailLayer() {
  document.getElementById('trail-layer')?.remove(); document.body.classList.remove('tr-locked');
}

function trailFind(id) {
  for (const [u, unit] of (T.path?.units || []).entries()) {
    const l = unit.lessons.find(x => x.id === id);
    if (l) return {unit, unitIdx: u, lesson: l};
  }
  return null;
}

async function trailOpen(id, unitIdx) {
  const found = trailFind(id);
  if (!found) return;
  const st = lessonState(unitIdx, found.lesson, trailProgress());
  if (st === 'locked') { toast('Termine a lição atual para liberar esta — ou use "Pular para cá" na unidade.', 'info'); return; }
  if (found.lesson.kind === 'audio') return trailAudio(found);
  await startLesson(id);
}

function trailAudio(found) {
  const tid = found.unit.id;
  const r = StudyState.trailLesson(localState(), {lesson_id: found.lesson.id, total: 0, correct: 0});
  saveLocalState(r.state);
  if (r.bonus) toast(`+${r.bonus} XP · aula de áudio na trilha`, 'xp');
  T.scrollToCurrent = true;
  playPodcast(tid, {tela: true});
}

async function startLesson(id, testout = null) {
  trailLayer(`<div class="tr-lesson"><div class="tr-loading"><div class="spinner"></div><p>Montando a lição…</p></div></div>`);
  const attempt = localState().trail?.done?.[id]?.attempts || 0;
  try {
    const lesson = await api(`/api/prf/local/trilha/licao/${encodeURIComponent(id)}?attempt=${attempt}`);
    if (!lesson.steps?.length) throw Error('vazia');
    Object.assign(T, {lesson, queue: lesson.steps.map((s, i) => ({...s, _i: i})), pos: 0, pick: null, checked: null,
      firstTry: {}, xpStart: localState().xp, result: null, testout});
    if (testout != null) T.lesson.pass_ratio = 0.8;
    renderLesson();
  } catch (e) {
    closeTrailLayer(); toast('Não foi possível abrir a lição. Tente de novo.', 'error');
  }
}

function trailTestOut(unitIdx) {
  const unit = T.path.units[unitIdx];
  trailLayer(`<div class="tr-sheet-wrap" onclick="if(event.target===this)closeTrailLayer()"><div class="tr-sheet" role="dialog" aria-label="Pular para esta unidade">
    <h2>Pular para a unidade ${unit.number}?</h2>
    <p class="muted">Você faz a revisão de "${esc(unit.topic_name)}". Acertando 80%, a trilha continua dali — as unidades anteriores ficam abertas para quando quiser.</p>
    <button class="btn btn-primary btn-block" onclick="startLesson('${unit.id}.r',${unitIdx})">Fazer o teste</button>
    <button class="btn btn-ghost btn-block" onclick="closeTrailLayer()">Agora não</button></div></div>`);
}

const STEP_SCORED = new Set(['lacuna', 'artigo', 'certo_errado', 'multipla']);

function stepPrompt(s) {
  if (s.type === 'card') {
    let text = esc(s.text);
    for (const h of (s.highlights || []).slice().sort((a, b) => b.length - a.length))
      if (h.length > 3) text = text.split(esc(h)).join(`<mark>${esc(h)}</mark>`);
    return `<div class="tr-eyebrow">Leia com atenção</div><h2 class="tr-ref">${esc(s.ref)}</h2>
      ${s.chapter ? `<div class="tr-chapter">${esc(s.chapter)}</div>` : ''}
      <div class="tr-law">${text.replace(/\n/g, '<br>')}</div>
      ${s.simple ? `<div class="tr-simple"><b>Em resumo:</b> ${esc(s.simple)}</div>` : ''}
      ${s.truncated ? '<p class="muted">Trecho principal do artigo — a íntegra está na Biblioteca jurídica.</p>' : ''}`;
  }
  if (s.type === 'lacuna') {
    const fill = T.pick != null ? `<span class="tr-blank filled">${esc(s.options[T.pick])}</span>` : '<span class="tr-blank"></span>';
    return `<div class="tr-eyebrow">Complete com a palavra da lei</div><h2 class="tr-ref">${esc(s.ref)}</h2>
      <div class="tr-law">${esc(s.before)} ${fill} ${esc(s.after)}</div>${optionList(s.options)}`;
  }
  if (s.type === 'artigo')
    return `<div class="tr-eyebrow">Em qual artigo está?</div><h2 class="tr-ref">${esc(s.ref)}</h2>
      <div class="tr-law">“${esc(s.quote)}”</div>${optionList(s.options)}`;
  const ctx = s.context ? `<details class="tr-ctx" ${s.context.length < 400 ? 'open' : ''}><summary>Texto de apoio</summary><p>${esc(s.context)}</p></details>` : '';
  if (s.type === 'certo_errado')
    return `<div class="tr-eyebrow">Certo ou errado? ${s.origin ? `<span>${esc(s.origin)}</span>` : ''}</div>${ctx}
      <div class="tr-q">${esc(s.statement)}</div>
      <div class="tr-ce">${['C', 'E'].map((l, i) => `<button class="tr-opt ${optClass(i, l === s.answer)}" onclick="trailPick(${i})" ${T.checked ? 'disabled' : ''}>${l === 'C' ? 'Certo' : 'Errado'}</button>`).join('')}</div>`;
  return `<div class="tr-eyebrow">Escolha a alternativa ${s.origin ? `<span>${esc(s.origin)}</span>` : ''}</div>${ctx}
    <div class="tr-q">${esc(s.statement)}</div>
    <div class="tr-opts">${s.options.map((o, i) => `<button class="tr-opt ${optClass(i, o.letter === s.answer)}" onclick="trailPick(${i})" ${T.checked ? 'disabled' : ''}><b>${esc(o.letter)}</b><span>${esc(o.text)}</span></button>`).join('')}</div>`;
}

function optClass(i, isAnswer) {
  if (!T.checked) return T.pick === i ? 'picked' : '';
  if (isAnswer) return 'right';
  return T.pick === i ? 'wrong' : 'dim';
}
function optionList(options) {
  const s = T.queue[T.pos];
  return `<div class="tr-opts chips">${options.map((o, i) => `<button class="tr-opt ${optClass(i, o === s.answer)}" onclick="trailPick(${i})" ${T.checked ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`;
}

function pickedValue(s) {
  if (T.pick == null) return null;
  if (s.type === 'certo_errado') return ['C', 'E'][T.pick];
  if (s.type === 'multipla') return s.options[T.pick].letter;
  return s.options[T.pick];
}

function feedbackHtml(s, ok) {
  let right = s.answer, why = '';
  if (s.type === 'certo_errado') right = s.answer === 'C' ? 'Certo' : 'Errado';
  if (s.type === 'multipla') right = `${s.answer}) ${s.options.find(o => o.letter === s.answer)?.text || ''}`;
  if (s.type === 'lacuna') { const said = s.said || s.answer; why = `<p class="tr-src">${esc(s.source).split(esc(said)).join(`<b>${esc(said)}</b>`)}</p>`; }
  if (s.type === 'artigo') why = `<p class="tr-src">${esc(s.answer)} · ${esc(s.ref)}</p>`;
  if (s.explanation) why = `<p class="tr-src">${esc(s.explanation)}</p>`;
  return `<div class="tr-feedback ${ok ? 'ok' : 'bad'}" role="status">
    <strong>${ok ? ['Isso!', 'Correto!', 'Mandou bem!'][T.pos % 3] : 'Resposta certa:'}</strong>
    ${ok ? '' : `<div class="tr-right">${esc(right)}</div>`}${why}
    <button class="tr-cta" onclick="trailNext()" autofocus>Continuar</button></div>`;
}

function renderLesson() {
  const L = T.lesson, s = T.queue[T.pos];
  if (T.result) return renderLessonEnd();
  const pct = Math.round(100 * T.pos / T.queue.length);
  const scored = STEP_SCORED.has(s.type);
  const ok = T.checked && T.checked.ok;
  const foot = !scored
    ? `<div class="tr-foot"><button class="tr-cta" onclick="trailNext()">Continuar</button></div>`
    : T.checked ? feedbackHtml(s, ok)
    : `<div class="tr-foot"><button class="tr-cta" onclick="trailCheck()" ${T.pick == null ? 'disabled' : ''}>Verificar</button></div>`;
  trailLayer(`<div class="tr-lesson" style="--c:${esc(L.color)}" role="dialog" aria-label="${esc(L.title)}">
    <div class="tr-top"><button class="tr-x" onclick="trailQuit()" aria-label="Sair da lição">${TI.close}</button>
      <div class="tr-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div></div>
    <div class="tr-body"><div class="tr-meta">${esc(L.subject_name)} · ${esc(L.topic_name)}</div>${s._retry ? '<div class="tr-again">Voltou o que você errou</div>' : ''}${stepPrompt(s)}</div>
    ${foot}</div>`);
  document.querySelector('#trail-layer .tr-body')?.scrollTo(0, 0);
}

function trailPick(i) { if (T.checked) return; T.pick = i; renderLesson(); }

function trailCheck() {
  const s = T.queue[T.pos];
  if (T.pick == null || T.checked) return;
  const ok = pickedValue(s) === s.answer;
  T.checked = {ok};
  if (!s._retry) {
    T.firstTry[s._i] = ok;
    if (s.question_id) {
      try {
        saveLocalState(StudyState.answer(localState(), {id: `trail:${T.lesson.id}:${T.lesson.attempt}:${s.question_id}`,
          question_id: s.question_id, subject_id: s.subject_id, topic_id: s.topic_id, subject_name: T.lesson.subject_name,
          text: s.statement, is_correct: ok, selected_letter: pickedValue(s), correct_letter: s.answer}));
      } catch (e) {}
    }
  }
  // O erro volta uma vez no fim da lição, como no Duolingo.
  if (!ok && !s._retry) T.queue.push({...s, _retry: true});
  if (navigator.vibrate && !ok) try { navigator.vibrate(60); } catch (e) {}
  renderLesson();
}

function trailNext() {
  T.pos++; T.pick = null; T.checked = null;
  if (T.pos >= T.queue.length) return finishLesson();
  renderLesson();
}

function finishLesson() {
  const scored = Object.values(T.firstTry), total = scored.length, correct = scored.filter(Boolean).length;
  const r = StudyState.trailLesson(localState(), {lesson_id: T.lesson.id, total, correct, pass_ratio: T.lesson.pass_ratio});
  if (r.passed && T.testout != null) {
    r.state.trail.from = Math.max(r.state.trail.from || 0, T.testout);
  }
  saveLocalState(r.state);
  S.reviewSummary = null; S.trilha = null; S.history = null;
  T.result = {...r, total, correct, xp: r.state.xp - T.xpStart};
  T.scrollToCurrent = true;
  renderLessonEnd();
}

function renderLessonEnd() {
  const R = T.result, s = localState(), goal = s.trail?.goal || 100, today = StudyState.xpToday(s);
  const acc = R.total ? Math.round(100 * R.correct / R.total) : 100;
  const failed = !R.passed;
  const head = failed ? 'Quase lá' : T.testout != null ? 'Unidade liberada!' : acc === 100 && R.total ? 'Lição perfeita!' : 'Lição concluída!';
  const sub = failed ? `Para passar, acerte ${Math.round(100 * T.lesson.pass_ratio)}%. Você fez ${acc}%. Refaça agora — as questões mudam de ordem.`
    : today >= goal ? 'Meta do dia batida. Amanhã tem mais.' : `Faltam ${goal - today} XP para a meta de hoje.`;
  trailLayer(`<div class="tr-lesson tr-end ${failed ? 'failed' : ''}" style="--c:${esc(T.lesson.color)}" role="dialog" aria-label="${esc(head)}">
    <div class="tr-body"><div class="tr-burst">${failed ? TI.revisao : TI.check}</div>
      <h1>${head}</h1><p class="muted">${sub}</p>
      <div class="tr-stats">
        <div><small>XP</small><b>+${R.xp}</b></div>
        <div><small>Acertos</small><b>${acc}%</b></div>
        <div><small>Sequência</small><b>${s.streak} ${s.streak === 1 ? 'dia' : 'dias'}</b></div>
      </div>
      <div class="tr-goalbar"><span>Meta do dia</span><div class="tr-bar"><i style="width:${Math.min(100, Math.round(100 * today / goal))}%"></i></div><span>${today}/${goal} XP</span></div>
    </div>
    <div class="tr-foot">${failed ? `<button class="tr-cta" onclick="startLesson('${T.lesson.id}',${T.testout == null ? 'null' : T.testout})">Tentar de novo</button>
      <button class="tr-cta ghost" onclick="trailDone()">Voltar à trilha</button>` : `<button class="tr-cta" onclick="trailDone()">Continuar</button>`}</div></div>`);
}

function trailDone() {
  closeTrailLayer(); T.result = null; T.lesson = null;
  if (S.tab !== 'trilha') { switchTab('trilha'); return; }
  render(); trailAfterRender();
}

function trailQuit() {
  const answered = Object.keys(T.firstTry).length;
  if (answered && !confirm('Sair da lição? As respostas já dadas ficam no histórico, mas a lição não conta como feita.')) return;
  closeTrailLayer(); T.lesson = null; render();
}

document.addEventListener('keydown', e => {
  if (!document.getElementById('trail-layer') || !T.lesson || T.result) return;
  const s = T.queue[T.pos];
  if (!s) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!STEP_SCORED.has(s.type) || T.checked) trailNext(); else trailCheck();
  } else if (/^[1-5]$/.test(e.key) && STEP_SCORED.has(s.type) && !T.checked) {
    const n = Number(e.key) - 1, count = s.type === 'certo_errado' ? 2 : s.options.length;
    if (n < count) trailPick(n);
  } else if (e.key === 'Escape') trailQuit();
});
