/* Browser-owned study flows. No database fallback and no invented server state. */
let localCatalogPromise;
function filterSubjects(value){
  const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  let visible=0;
  document.querySelectorAll('[data-search]').forEach(el=>{el.hidden=!norm(el.dataset.search).includes(norm(value));if(!el.hidden)visible++;});
  const empty=document.getElementById('subject-empty');if(empty)empty.hidden=visible>0;
}
function openDueFlashcards(){
  const s=localState();
  S.fcCards=Object.values(s.flashcard_reviews||{}).filter(c=>Date.parse(c.next_review)<=Date.now()).map(c=>s.flashcards?.[c.id]).filter(Boolean);
  if(!S.fcCards.length){toast('Nenhum cartão para revisar agora. Novos cartões aparecem nas missões.','info');return;}
  S.missionBlockId=null;S.activeMissionIdx=null;S.fcIdx=0;S.fcFlipped=false;S.tab='more';S.subView='flashcards';render();scrollTop();
}
async function localCatalog(){
  if(!localCatalogPromise)localCatalogPromise=api('/api/prf/local/catalog').catch(e=>{localCatalogPromise=null;throw e;});
  return localCatalogPromise;
}
function recordLocalAnswer(question,result,selectedId,eventId){
  if(!question)return;
  const subject=(S.subjects||[]).find(s=>s.id===question.subject_id);
  const event={id:eventId,question_id:question.id,subject_id:question.subject_id,topic_id:question.topic_id,
    text:question.text,subject_name:question.subject_name||subject?.name||S.selSubjectName||'',is_correct:result.is_correct,
    selected_letter:question.alternatives?.find(a=>a.id===selectedId)?.letter||'',correct_letter:result.correct_alternative?.letter||result.correct_letter||''};
  saveLocalState(StudyState.answer(localState(),event));
  S.reviewSummary=null;S.trilha=null;S.history=null;S.plano=null;
}
async function localTrail(){
  const catalog=await localCatalog(),state=localState();
  const subjects=catalog.subjects.map(s=>{
    const topics=s.topics.map(t=>{
      const m=state.topic_mastery[t.id]||{},n=m.total_attempts||0,a=m.accuracy||0;
      const coverage=Math.round(100*Math.min(n/10,1)*a);
      return {...t,coverage,status:n>=10&&a>=.8?'done':n?'partial':'empty'};
    });
    const done=topics.filter(t=>t.status==='done').length;
    return {...s,topics,topics_total:topics.length,topics_done:done,coverage:topics.length?100*done/topics.length:0};
  });
  const total=subjects.reduce((n,s)=>n+s.topics_total,0),done=subjects.reduce((n,s)=>n+s.topics_done,0);
  const days=state.study_profile?.exam_date?Math.max(0,Math.ceil((Date.parse(state.study_profile.exam_date+'T12:00:00')-Date.now())/86400000)):null;
  return {subjects,topics_total:total,topics_done:done,coverage:total?100*done/total:0,days_left:days,topics_per_week_needed:days?Math.ceil((total-done)*7/days):null};
}
async function localCalendar(){
  const state=localState(),trail=await localTrail(),today=localToday(),exam=state.study_profile?.exam_date;
  const start=state.started_on||today,horizon=exam?Math.min(365,Math.max(0,Math.ceil((Date.parse(exam+'T12:00:00')-Date.parse(today+'T12:00:00'))/86400000))):90;
  const days=[],startAt=new Date(Math.max(Date.parse(start+'T12:00:00'),Date.parse(today+'T12:00:00')-30*86400000));
  for(let at=startAt;StudyState.day(at)<=StudyState.day(Date.parse(today+'T12:00:00')+horizon*86400000);at=new Date(at.getTime()+86400000)){
    const date=StudyState.day(at),weekday=(at.getDay()+6)%7;
    const rows=state.mission_history.filter(m=>m.date===date),row=rows.find(m=>m.mission_completed)||rows.at(-1);
    days.push({date,weekday,kind:weekday===5?'simulado':weekday===6?'revisao':'conteudo',is_today:date===today,is_past:date<today,
      status:row?.mission_completed?'done':row?.blocks_done?'partial':date<today?'missed':date===today?'today':'future',
      blocks_done:row?.blocks_done||0,blocks_total:row?.blocks_total||0,subject_name:row?.subject_name||'',topic_name:row?.topic_label||'',
      is_rest_day:!!state.routines?.find(r=>r.day_of_week===weekday)?.is_rest_day});
  }
  return {days,exam_date:exam,days_until_exam:exam?horizon:null,summary:{horizon_days:horizon,missions_done:days.filter(d=>d.status==='done').length,
    missions_missed:days.filter(d=>d.status==='missed').length,simulados_ahead:days.filter(d=>!d.is_past&&d.kind==='simulado').length,topics_remaining:trail.topics_total-trail.topics_done}};
}
async function localRequest(path,opts={}){
  const url=new URL(path,'https://local.invalid'),p=url.pathname,params=url.searchParams,state=localState();
  const yes=data=>({handled:true,data});
  if(p==='/api/prf/reviews/summary')return yes({total_due:StudyState.due(state).length});
  if(p==='/api/prf/reviews/due'){
    const ids=params.get('ids')?.split(',');
    return yes((ids?Object.values(state.reviews).filter(c=>ids.includes(c.id)):StudyState.due(state)).slice(0,Number(params.get('limit'))||30));
  }
  if(p==='/api/prf/reviews/submit'){
    const next=StudyState.review(state,opts.json.card_id,opts.json.quality);saveLocalState(next);S.reviewSummary=null;
    return yes({xp_earned:next.xp-state.xp});
  }
  const flash=p.match(/^\/api\/prf\/reviews\/flashcards\/([^/]+)\/answer$/);
  if(flash){
    const card=S.fcCards?.find(c=>c.id===flash[1]);if(!card)throw Error('Cartão não encontrado');
    state.flashcards ||= {};state.flashcards[card.id]=card;
    const progress={...state,reviews:{[card.id]:{id:card.id,next_review:new Date().toISOString(),...state.flashcard_reviews?.[card.id]}}};
    const next=StudyState.review(progress,card.id,params.get('quality'));
    state.flashcard_reviews={...(state.flashcard_reviews||{}),[card.id]:next.reviews[card.id]};state.xp=next.xp;state.level=next.level;saveLocalState(state);
    return yes({xp_earned:next.xp-progress.xp});
  }
  if(p==='/api/prf/reviews/flashcards/study')return yes({cards:(params.get('ids')||'').split(',').map(id=>state.flashcards?.[id]).filter(Boolean)});
  if(p==='/api/prf/questions/history')return yes({history:state.history.slice().reverse()});
  if(p==='/api/prf/missions/history')return yes({history:state.mission_history});
  if(p==='/api/prf/plano/calendario')return yes(await localCalendar());
  if(p==='/api/prf/trilha')return yes(await localTrail());
  if(p.startsWith('/api/prf/coverage/')){
    const c=await localCatalog(),subjects=c.subjects.map(s=>({...s,flag:s.question_count>=20?'good':s.question_count>=5?'low':s.question_count?'critical':'empty'}));
    return yes({subjects,exam_readiness_score:subjects.filter(s=>s.flag==='good').length/Math.max(1,subjects.length)});
  }
  if(p==='/api/prf/questions/errors/drill'){
    const ids=Object.values(state.reviews).filter(c=>c.error_pending).slice(0,30).map(c=>c.question_id);
    return yes(ids.length?await api('/api/prf/local/questions?ids='+encodeURIComponent(ids.join(','))):{questions:[]});
  }
  if(p==='/api/prf/questions/list')return yes(await api('/api/prf/local/questions?'+params));
  const question=p.match(/^\/api\/prf\/questions\/([\w-]+)$/);
  if(question&&p!=='/api/prf/questions/answer'){
    const d=await api('/api/prf/local/questions?ids='+encodeURIComponent(question[1]));if(!d.questions.length)throw Error('Questão não encontrada');return yes(d.questions[0]);
  }
  if(p==='/api/prf/questions/answer'){
    const result=await api('/api/prf/local/answer',{method:'POST',json:opts.json});
    const q=S.reviewQuestion||S.questions?.find(q=>q.id===opts.json.question_id);
    recordLocalAnswer(q,result,opts.json.selected_alternative_id,`review:${q?.id}:${S.reviewStartedAt||Date.now()}`);return yes(result);
  }
  const article=p.match(/^\/api\/prf\/legal\/articles\/([\w-]+)(\/read)?$/);
  if(article){
    if(article[2]){state.article_reads[article[1]]=new Date().toISOString();saveLocalState(state);return yes({read:true});}
    const d=await api('/api/prf/local/legal?ids='+encodeURIComponent(article[1]));return yes(d.articles[0]);
  }
  return {handled:false};
}
function downloadText(name,text,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportProgress(){
  try{const state=localState();downloadText('estudo-pmgo-backup-'+localToday()+'.json',JSON.stringify(StudyState.exportBackup(state),null,2));state.backup_at=new Date().toISOString();saveLocalState(state);toast('Backup exportado. Guarde o arquivo em um local seguro.','success');render();}
  catch(e){toast('Não foi possível exportar o backup','error');}
}
async function inspectProgressFile(input){
  const file=input.files?.[0];if(!file)return;
  try{
    if(file.size>20000000)throw Error('O arquivo deve ter até 20 MB');
    const state=StudyState.parseBackup(await file.text());S.pendingImport=state;S.pendingImportMeta=null;render();
  }catch(e){S.pendingImport=null;toast('Backup recusado: '+e.message,'error');}
}
function restoreProgress(){
  if(!S.pendingImport)return;
  try{
    // A single setItem is atomic; retain the previous state for undo.
    localStorage.setItem('prf_backup_before_restore',JSON.stringify(localState()));
    saveLocalState(S.pendingImport);if(S.pendingImportMeta&&S.pendingImportMeta.state===S.pendingImport&&!S.pendingImportMeta.previous){try{localStorage.setItem(CLOUD_CODE_KEY,S.pendingImportMeta.code);if(S.pendingImportMeta.updated_at)localStorage.setItem(CLOUD_LAST_KEY,S.pendingImportMeta.updated_at);}catch(e){}if(S.cloud){S.cloud.last=S.pendingImportMeta.updated_at||S.cloud.last;S.cloud.dirty=false;}}S.pendingImport=null;S.pendingImportMeta=null;
    const active=localState().active_exam;
    if(active&&!active.is_completed)localStorage.setItem(SIM_ID_KEY,active.id);else localStorage.removeItem(SIM_ID_KEY);
    S.mission=null;S.dashboard=localDashboard();S.trilha=null;S.plano=null;S.history=null;S.reviewSummary=null;S.studyProfile=null;S.taf=null;S.checklist=null;S.essayHistory=null;S.sim=null;S.simResult=null;S.simAnswers={};S.pendingSimBlockId=null;S.simQuestions={};clearInterval(timerInterval);
    toast('Backup restaurado. O estado anterior foi guardado neste navegador.','success');render();
  }catch(e){toast('Não foi possível restaurar. Seus dados anteriores foram preservados.','error');}
}
function undoRestore(){
  try{const previous=localStorage.getItem('prf_backup_before_restore');if(!previous)return;S.pendingImport=StudyState.normalize(JSON.parse(previous));restoreProgress();}
  catch(e){toast('Não foi possível recuperar o backup anterior','error');}
}
function openBackup(){S.tab='more';S.subView='backup';S.pendingImport=null;S.pendingImportMeta=null;render();scrollTop();if(cloud().available===null)cloudStatus();}
function viewBackup(){
  const state=localState(),incoming=S.pendingImport;
  return `<div class="topbar-sub"><button class="back-btn" aria-label="Voltar" onclick="goBack()">${I.back}</button><span class="title-sub">Seu progresso, protegido</span></div>
  <div class="settings-section backup-panel"><div class="section-eyebrow">Backup e troca de aparelho</div><h1 class="section-title">Leve seu estudo com você.</h1>
  <p>Respostas, redações, rotina, TAF e simulado ficam neste navegador. O backup automático envia uma cópia ao servidor; o arquivo abaixo é a segunda cópia, que fica com você.</p>
  ${cloudPanel()}
  <div class="backup-stats"><strong>${state.history.length}</strong> respostas <strong>${state.essays?.length||0}</strong> redações</div>
  <button class="btn btn-primary btn-full" onclick="exportProgress()">Exportar meu progresso</button>
  <p class="muted">${state.backup_at?'Última exportação: '+esc(new Date(state.backup_at).toLocaleString('pt-BR')):'Você ainda não exportou um backup.'} O áudio baixado não entra no arquivo e pode ser gerado novamente.</p>
  <label class="backup-import">Restaurar um backup<input type="file" accept="application/json,.json" onchange="inspectProgressFile(this)"></label>
  ${incoming?`<div class="import-preview"><h2>Conferir antes de restaurar</h2><p>${incoming.history.length} respostas · ${incoming.essays?.length||0} redações · ${incoming.xp} XP.${S.pendingImportMeta?.updated_at?' Salvo em '+esc(new Date(S.pendingImportMeta.updated_at).toLocaleString('pt-BR'))+'.':''}</p><p>Isto substituirá o progresso atual. Uma cópia anterior ficará disponível para desfazer.</p><button class="btn btn-primary" onclick="restoreProgress()">Restaurar este backup</button><button class="btn btn-ghost" onclick="S.pendingImport=null;S.pendingImportMeta=null;render()">Cancelar</button></div>`:''}
  ${localStorage.getItem('prf_backup_before_restore')?'<button class="btn btn-ghost btn-full" onclick="undoRestore()">Recuperar estado anterior à restauração</button>':''}
  </div>`;
}
/* ===== Backup automático (servidor) =====
   O progresso mora neste navegador; limpar os dados do site ou trocar de
   aparelho o apagava. Aqui uma cópia vai sozinha ao servidor, e um código de
   recuperação, que só a pessoa conhece, traz tudo de volta em qualquer
   aparelho. Sem armazenamento no servidor, tudo isto fica quieto e o app segue
   só com o navegador. */
const CLOUD_CODE_KEY='prf_cloud_code', CLOUD_LAST_KEY='prf_cloud_last', CLOUD_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function cloud(){
  if(!S.cloud){let last=null;try{last=localStorage.getItem(CLOUD_LAST_KEY);}catch(e){}S.cloud={available:null,busy:false,error:null,last,retryAt:0,dirty:false};}
  return S.cloud;
}
function cloudCode(create){
  try{
    let c=localStorage.getItem(CLOUD_CODE_KEY);
    if(!c&&create){c=[...crypto.getRandomValues(new Uint8Array(12))].map(x=>CLOUD_ALPHABET[x%32]).join('');localStorage.setItem(CLOUD_CODE_KEY,c);}
    return c||null;
  }catch(e){return null;}
}
function formatCloudCode(c){return c?c.replace(/(.{4})(?=.)/g,'$1-'):'';}
function cloudHasProgress(){const s=localState();return (s.history?.length||0)>0||s.xp>0;}
function cloudMessage(e){
  const raw=String(e&&e.message||e||'');
  try{const d=JSON.parse(raw).detail;if(typeof d==='string')return d;}catch(_){}
  return raw;
}
function cloudAgo(iso){
  const t=Date.parse(iso);if(!Number.isFinite(t))return '';
  const m=Math.max(0,Math.round((Date.now()-t)/60000));
  if(m<2)return 'agora há pouco';if(m<60)return 'há '+m+' min';
  const h=Math.round(m/60);if(h<24)return 'há '+h+' h';
  const d=Math.round(h/24);return 'há '+d+(d===1?' dia':' dias');
}
function cloudNoteText(){
  try{const last=localStorage.getItem(CLOUD_LAST_KEY);if(last)return '● Backup automático · '+cloudAgo(last);}catch(e){}
  return '● Progresso salvo neste navegador';
}
function cloudRefresh(){if(S.subView==='backup')render();}
let _cloudTimer;
function scheduleCloudBackup(){
  cloud().dirty=true;
  clearTimeout(_cloudTimer);
  _cloudTimer=setTimeout(()=>cloudBackupNow({silent:true}),20000);
}
async function cloudStatus(){
  const c=cloud();
  try{c.available=!!(await api('/api/prf/local/backup/status')).available;}catch(e){c.available=false;}
  cloudRefresh();
}
async function cloudBackupNow(opts={}){
  const c=cloud();
  if(c.busy)return;
  if(opts.silent&&(!navigator.onLine||Date.now()<c.retryAt))return;
  if(!cloudHasProgress()){if(!opts.silent)toast('Responda algumas questões antes: ainda não há progresso para guardar.','info');return;}
  c.busy=true;cloudRefresh();
  try{
    const code=cloudCode(true);
    await ensureAuth();
    const r=await api('/api/prf/local/backup',{method:'PUT',json:{code,backup:StudyState.exportBackup(localState())}});
    c.available=true;c.error=null;c.dirty=false;c.last=r.updated_at;c.retryAt=0;
    try{localStorage.setItem(CLOUD_LAST_KEY,r.updated_at);}catch(e){}
    if(!opts.silent)toast('Backup enviado.','success');
  }catch(e){
    const msg=cloudMessage(e);
    const unavailable=/indispon/i.test(msg);
    if(unavailable)c.available=false;
    c.error=msg;c.retryAt=Date.now()+(unavailable?30*60000:2*60000);
    if(!opts.silent)toast(unavailable?'Backup automático indisponível: o servidor ainda não tem armazenamento ligado.':'Não foi possível enviar agora: '+msg,'error');
  }finally{c.busy=false;cloudRefresh();}
}
async function cloudCopyCode(){
  const code=formatCloudCode(cloudCode(false));if(!code)return;
  try{await navigator.clipboard.writeText(code);toast('Código copiado. Guarde em um lugar seguro.','success');}
  catch(e){toast('Selecione o código e copie manualmente.','info');}
}
async function cloudFetch(previous){
  const input=document.getElementById('cloud-code-input');
  const raw=(input?input.value:'')||'';
  if(raw.replace(/[^A-Za-z0-9]/g,'').length!==12){toast('O código tem 12 letras e números.','error');return;}
  const c=cloud();c.busy=true;cloudRefresh();
  try{
    await ensureAuth();
    const r=await api('/api/prf/local/backup/restore',{method:'POST',json:{code:raw,previous:!!previous}});
    const state=StudyState.parseBackup(JSON.stringify(r.backup));
    S.pendingImport=state;
    S.pendingImportMeta={code:raw.replace(/[^A-Za-z0-9]/g,'').toUpperCase(),state,updated_at:r.updated_at,previous:!!previous};
    toast(previous?'Versão anterior encontrada. Confira antes de restaurar.':'Backup encontrado. Confira antes de restaurar.','success');
  }catch(e){
    S.pendingImport=null;S.pendingImportMeta=null;
    const msg=cloudMessage(e);
    toast(/404|Nenhum backup/.test(String(e&&e.message)+msg)?'Nenhum backup com este código.':'Não foi possível buscar: '+msg,'error');
  }finally{c.busy=false;cloudRefresh();}
}
function cloudPanel(){
  const c=cloud(),code=cloudCode(false);
  const input=`<label class="backup-import">Restaurar com o código<input id="cloud-code-input" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="20" placeholder="XXXX-XXXX-XXXX" class="cloud-input"></label>
    <div class="cloud-actions"><button class="btn btn-primary" ${c.busy?'disabled':''} onclick="cloudFetch(false)">Buscar meu backup</button><button class="btn btn-ghost" ${c.busy?'disabled':''} onclick="cloudFetch(true)">Buscar a versão anterior</button></div>`;
  if(c.available===false)return `<div class="cloud-box"><div class="section-eyebrow">Backup automático</div><h2>Ainda não está ligado</h2>
    <p class="muted">O servidor ainda não tem armazenamento, então seu progresso fica só neste navegador. Enquanto isso, exporte o arquivo abaixo para ter uma cópia. Quando o armazenamento for ligado, o envio passa a ser automático e o código aparece aqui.</p>
    <button class="btn btn-ghost" onclick="cloud().available=null;cloudStatus()">Verificar de novo</button></div>`;
  if(c.available===null&&!code)return `<div class="cloud-box"><div class="section-eyebrow">Backup automático</div><p class="muted">Verificando…</p></div>`;
  const last=c.last||(()=>{try{return localStorage.getItem(CLOUD_LAST_KEY);}catch(e){return null;}})();
  // Aparelho novo, sem progresso e sem código: quem chega aqui quer restaurar,
  // não gerar um código novo. O formulário de restauração vem primeiro.
  const freshDevice=!code&&!cloudHasProgress();
  return `<div class="cloud-box"><div class="section-eyebrow">Backup automático</div>
    ${freshDevice?`<h2>Trocou de aparelho?</h2><p class="muted">Digite o código de recuperação do seu aparelho anterior para trazer seu progresso de volta.</p>${input}<p class="muted">Primeira vez aqui? Responda algumas questões e volte: o código é gerado quando há progresso para guardar.</p></div>`:`
    <h2>${last?'Ativo':'Pronto para ativar'}</h2>
    <p class="muted">${last?'Último envio '+esc(cloudAgo(last))+'.':'O primeiro envio acontece depois da sua primeira resposta.'} Uma cópia vai sozinha ao servidor a cada alteração. <strong>Anote o código abaixo:</strong> é a única forma de recuperar tudo em outro aparelho, ou se você limpar os dados do navegador.</p>
    ${code?`<div class="cloud-code" aria-label="Código de recuperação">${esc(formatCloudCode(code))}</div><div class="cloud-actions"><button class="btn btn-ghost" onclick="cloudCopyCode()">Copiar código</button><button class="btn btn-ghost" ${c.busy?'disabled':''} onclick="cloudBackupNow()">${c.busy?'Enviando…':'Enviar agora'}</button></div>`
      :`<div class="cloud-actions"><button class="btn btn-primary" ${c.busy?'disabled':''} onclick="cloudBackupNow()">${c.busy?'Enviando…':'Ativar e gerar meu código'}</button></div>`}
    ${c.error?`<p class="muted cloud-error">Último erro: ${esc(c.error)}</p>`:''}
    ${input}</div>`}`;
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&S.cloud?.dirty)cloudBackupNow({silent:true});});
setTimeout(()=>{try{if(cloudHasProgress()&&!(S.cloud&&S.cloud.dirty===false&&S.cloud.last))cloudBackupNow({silent:true});}catch(e){}},8000);
function downloadStudyReminder(){
  const stamp=new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const start=localToday().replaceAll('-','')+'T190000';
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Estudo PMGO//Rotina//PT-BR','BEGIN:VEVENT','UID:study-'+uid()+'@estudopmgo','DTSTAMP:'+stamp,'DTSTART:'+start,'DURATION:PT30M','RRULE:FREQ=DAILY','SUMMARY:Meu estudo PMGO','DESCRIPTION:Abra a plataforma e continue sua missão. Ajuste o horário no calendário.','END:VEVENT','END:VCALENDAR'].join('\r\n');
  downloadText('lembrete-estudo-pmgo.ics',ics,'text/calendar');toast('Abra o arquivo no calendário e ajuste o horário.','success');
}
