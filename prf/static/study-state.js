/* Pure progress operations shared by the app and regression tests. */
(function(root) {
  'use strict';
  const day = value => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(value || Date.now()));
  const clone = value => JSON.parse(JSON.stringify(value));
  const initial = () => ({version:2, xp:0, level:1, streak:0, last_active_date:null, mastery:{}, topic_mastery:{}, history:[], reviews:{}, article_reads:{}, mission_history:[], sessions:[], questions_today:{date:null,total:0,correct:0}, recent_subjects:[], recent_subjects_date:null, mission:null, mission_date:null, skip_topic_ids:[], xp_days:{}, trail:{done:{}, goal:100}});
  function normalize(value) {
    const s={...initial(), ...clone(value || {})};
    s.trail={done:{}, goal:100, ...(s.trail||{})};
    if(!s.xp_days||typeof s.xp_days!=='object') s.xp_days={};
    return s;
  }
  // XP do dia: é o que enche a meta diária. Guarda só os últimos 60 dias.
  function addXp(s, amount, now) {
    s.xp+=amount; s.level=1+Math.floor(s.xp/500);
    const d=day(now); s.xp_days[d]=(s.xp_days[d]||0)+amount;
    const keys=Object.keys(s.xp_days).sort(); while(keys.length>60) delete s.xp_days[keys.shift()];
  }
  function xpToday(value, now=Date.now()) { return normalize(value).xp_days[day(now)]||0; }
  // Lição da trilha concluída: passa se acertou a fração mínima (revisão pede
  // 80%); as questões do banco já foram contadas uma a uma por answer().
  function trailLesson(value, result, now=new Date().toISOString()) {
    const s=normalize(value);
    const total=Math.max(0,result.total|0), correct=Math.min(total,Math.max(0,result.correct|0));
    if(typeof result.lesson_id!=='string'||!/^[a-zA-Z0-9_:.\-]+$/.test(result.lesson_id)) throw Error('Lição inválida');
    const ratio=total?correct/total:1, passed=ratio>=(result.pass_ratio||0);
    const old=s.trail.done[result.lesson_id];
    const row={at:now, attempts:(old?.attempts||0)+1, best:Math.max(old?.best||0, Math.round(ratio*100))};
    if(passed||old) s.trail.done[result.lesson_id]=row;
    activity(s,now);
    const bonus=passed?(10+(ratio===1&&total>0?5:0)):0;
    if(bonus) addXp(s,bonus,now);
    return {state:s, passed, bonus, ratio};
  }
  function activity(s, now) {
    const today=day(now), yesterday=day(new Date(now).getTime()-86400000);
    if(s.last_active_date!==today) { s.streak=s.last_active_date===yesterday?s.streak+1:1; s.last_active_date=today; }
    s.started_on ||= today;
  }
  function mastery(old, correct, now) {
    const m={total_attempts:0,total_correct:0,...old};
    m.total_attempts++; m.total_correct+=correct?1:0;
    m.accuracy=m.total_correct/m.total_attempts;
    m.mastery_level=Math.min(1,m.accuracy*Math.min(m.total_attempts/20,1));
    m.last_studied=now; return m;
  }
  function answer(value, event, now=new Date().toISOString()) {
    const s=normalize(value);
    if(!event.question_id || typeof event.is_correct!=='boolean') throw Error('Resposta inválida');
    if(event.id && s.history.some(h=>h.id===event.id)) return s;
    const e={...event,id:event.id || (root.crypto?.randomUUID?.() || now+'-'+Math.random()),created_at:now};
    s.history.push(e); activity(s,now);
    addXp(s,e.is_correct?10:3,now);
    if(s.questions_today.date!==day(now)) s.questions_today={date:day(now),total:0,correct:0};
    s.questions_today.total++; s.questions_today.correct+=e.is_correct?1:0;
    if(e.subject_id) s.mastery[e.subject_id]=mastery(s.mastery[e.subject_id],e.is_correct,now);
    if(e.topic_id) s.topic_mastery[e.topic_id]=mastery(s.topic_mastery[e.topic_id],e.is_correct,now);
    const old=s.reviews[e.question_id];
    s.reviews[e.question_id]={...old,id:e.question_id,question_id:e.question_id,subject_name:e.subject_name||'',content_preview:e.text||'',
      error_pending:!e.is_correct,interval_days:old?.interval_days||0,repetitions:old?.repetitions||0,ease_factor:old?.ease_factor||2.5,
      next_review:!e.is_correct?now:(old?.next_review || new Date(new Date(now).getTime()+86400000).toISOString())};
    return s;
  }
  function review(value,id,quality,now=new Date().toISOString()) {
    const scores={blackout:0,wrong:1,hard:2,good:3,easy:4};
    if(!(quality in scores)) throw Error('Avaliação inválida');
    const s=normalize(value), c=s.reviews[id]; if(!c) throw Error('Revisão não encontrada');
    let ease=c.ease_factor||2.5, reps=c.repetitions||0, interval=c.interval_days||0;
    const q=scores[quality];
    if(q<=1){reps=0;interval=interval<=1?.5:Math.max(.5,interval*.2);ease=Math.max(1.3,ease-.2);}
    else {reps++;ease=Math.max(1.3,ease+(q===2?-.15:q===4?.15:0));interval=reps===1?(q===4?2:1):reps===2?(q===2?3:q===4?6:4):interval*ease*(q===2?.8:q===4?1.3:1);}
    Object.assign(c,{repetitions:reps,ease_factor:ease,interval_days:Math.min(365,Math.max(.5,interval)),last_reviewed:now});
    c.next_review=new Date(new Date(now).getTime()+c.interval_days*86400000).toISOString();
    activity(s,now);addXp(s,[2,3,8,10,12][q],now);return s;
  }
  function due(value, now=Date.now()) {return Object.values(normalize(value).reviews).filter(c=>Date.parse(c.next_review)<=new Date(now).getTime()).sort((a,b)=>a.next_review.localeCompare(b.next_review));}
  function archiveMission(value, mission, date=day()) {
    const s=normalize(value); if(!mission) return s;
    const row={id:mission.id,date,mission_completed:mission.status==='completed',blocks_done:mission.blocks_done||0,blocks_total:mission.blocks_total||mission.blocks?.length||0,topic_label:mission.topic_label||'',subject_name:mission.blocks?.find(b=>b.subject_name)?.subject_name||''};
    s.mission_history=s.mission_history.filter(m=>m.id!==row.id);s.mission_history.push(row);return s;
  }
  function exportBackup(value, preferences={}) {
    return {app:'estudo-pmgo',version:2,exported_at:new Date().toISOString(),progress:normalize(value),preferences};
  }
  function parseBackup(text) {
    if(text.length>20000000) throw Error('Arquivo maior que 20 MB');
    const b=JSON.parse(text);
    const unsafe=v=>v && typeof v==='object' && Object.entries(v).some(([k,x])=>['__proto__','constructor','prototype'].includes(k)||unsafe(x));
    if(unsafe(b)||b.app!=='estudo-pmgo'||b.version!==2||!b.progress||typeof b.progress!=='object') throw Error('Backup incompatível');
    const p=b.progress;
    for(const key of ['history','mission_history','sessions','essays','routines','taf_history']) if(p[key]!=null&&!Array.isArray(p[key])) throw Error('Lista inválida: '+key);
    for(const key of ['mastery','topic_mastery','reviews','article_reads','checklist','study_profile','taf_targets','xp_days','trail']) if(p[key]!=null&&(typeof p[key]!=='object'||Array.isArray(p[key]))) throw Error('Registro inválido: '+key);
    for(const key of ['xp','level','streak']) if(!Number.isFinite(p[key])||p[key]<0) throw Error('Progresso inválido');
    for(const h of p.history||[]) if(typeof h.question_id!=='string'||typeof h.is_correct!=='boolean'||!Number.isFinite(Date.parse(h.created_at))) throw Error('Histórico inválido');
    for(const c of Object.values(p.reviews||{})) if(typeof c.id!=='string'||!Number.isFinite(Date.parse(c.next_review))) throw Error('Revisão inválida');
    // No tokens, credentials, or arbitrary storage keys are imported.
    const safeIds=v=>{
      if(!v||typeof v!=='object')return;
      for(const [k,x] of Object.entries(v)) {
        if(['estimated_mins','blocks_done','blocks_total','total_questions','time_limit_mins','score','final_score','max_score','nc_score','ne_count','total_lines','penalty','total_attempts','total_correct','accuracy','mastery_level','interval_days','repetitions','ease_factor'].includes(k)&&x!=null&&(typeof x!=='number'||!Number.isFinite(x)))throw Error('Número inválido');
        if(['letter','selected_letter','correct_letter'].includes(k)&&x!=null&&(typeof x!=='string'||! /^[A-E]?$/.test(x)))throw Error('Alternativa inválida');
        if((k==='id'||k.endsWith('_id'))&&x!=null&&(typeof x!=='string'||! /^[a-zA-Z0-9_:.\-]+$/.test(x)))throw Error('Identificador inválido');
        if(k.endsWith('_ids')&&(!Array.isArray(x)||x.some(id=>typeof id!=='string'||! /^[a-zA-Z0-9_:.\-]+$/.test(id))))throw Error('Lista de identificadores inválida');
        safeIds(x);
      }
    };
    safeIds(p);
    const allowed=Object.keys(initial()).concat(['started_on','essays','taf_history','taf_targets','study_profile','routines','checklist','active_exam','flashcards','flashcard_reviews','essay_drafts','reminder_time','backup_at']);
    const clean={};for(const k of allowed)if(Object.hasOwn(p,k))clean[k]=p[k];
    return normalize(clean);
  }
  const api={day,initial,normalize,answer,review,due,archiveMission,exportBackup,parseBackup,trailLesson,xpToday};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.StudyState=api;
})(typeof globalThis!=='undefined'?globalThis:this);
