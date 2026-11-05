const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const state=require('./study-state.js');
const event={id:'event-1',question_id:'q-1',subject_id:'s-1',topic_id:'t-1',text:'Pergunta',is_correct:false};
test('Answer persists history, mastery and immediate error review exactly once',()=>{
 const s=state.answer({},event,'2026-09-23T01:00:00Z');
 assert.equal(s.history.length,1);assert.equal(s.questions_today.date,'2026-09-22');assert.equal(s.xp,3);
 assert.equal(s.topic_mastery['t-1'].total_attempts,1);assert.equal(state.due(s,'2026-09-23T01:00:00Z').length,1);
 assert.deepEqual(state.answer(s,event),s);
 const fixed=state.answer(s,{...event,id:'event-2',is_correct:true},'2026-09-23T10:00:00Z');
 assert.equal(fixed.reviews['q-1'].error_pending,false);assert.equal(fixed.streak,2);
});
test('Review reschedules and backup restores without credentials',()=>{
 let s=state.answer({},event,'2026-09-23T01:00:00Z');
 s=state.review(s,'q-1','easy','2026-09-23T01:00:00Z');
 assert.equal(state.due(s,'2026-09-23T01:00:00Z').length,0);
 assert.equal(s.reviews['q-1'].next_review,'2026-09-25T01:00:00.000Z');
 s.token='private';s.flashcard_reviews={};
 const restored=state.parseBackup(JSON.stringify(state.exportBackup(s)));
 assert.equal(restored.xp,s.xp);assert.equal(restored.token,undefined);assert.deepEqual(restored.history,s.history);
});
test('Backup rejects injection, wrong formats and damaged records',()=>{
 const original=state.exportBackup(state.initial());
 for(const bad of [JSON.stringify({...original,version:99}),'{',JSON.stringify({...original,progress:{...original.progress,xp:-1}}),JSON.stringify({...original,progress:{...original.progress,mission:{id:"bad');alert(1)//"}}})])assert.throws(()=>state.parseBackup(bad));
 assert.throws(()=>state.parseBackup('{"app":"estudo-pmgo","version":2,"progress":{"__proto__":{}}}'));
});
test('Mission history updates a single row',()=>{
 let s=state.archiveMission({}, {id:'m-1',blocks_total:3,blocks_done:1,status:'pending'});
 s=state.archiveMission(s,{id:'m-1',blocks_total:3,blocks_done:3,status:'completed'});
 assert.equal(s.mission_history.length,1);assert.equal(s.mission_history[0].mission_completed,true);
});
test('All frontend scripts parse',()=>{
 for(const name of ['study-state.js','local-client.js','trilha.js','sw.js'])new vm.Script(fs.readFileSync(__dirname+'/'+name,'utf8'),{filename:name});
 const html=fs.readFileSync(__dirname+'/app.html','utf8');for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
test('Trail lessons: pass threshold, daily XP, retry and backup',()=>{
 const now='2026-11-05T15:00:00Z';
 let r=state.trailLesson(state.initial(),{lesson_id:'t-1.l1',total:4,correct:4},now);
 assert.equal(r.passed,true);assert.equal(r.bonus,15);assert.equal(state.xpToday(r.state,now),15);assert.equal(r.state.streak,1);
 r=state.trailLesson(r.state,{lesson_id:'t-1.r',total:10,correct:7,pass_ratio:.8},now);
 assert.equal(r.passed,false);assert.equal(r.bonus,0);assert.equal(r.state.trail.done['t-1.r'],undefined);
 r=state.trailLesson(r.state,{lesson_id:'t-1.r',total:10,correct:9,pass_ratio:.8},now);
 assert.equal(r.passed,true);assert.equal(r.state.trail.done['t-1.r'].best,90);
 assert.throws(()=>state.trailLesson(r.state,{lesson_id:"x');alert(1)//",total:1,correct:1}));
 const s=state.answer(r.state,{question_id:'q-9',is_correct:true},now);
 assert.equal(state.xpToday(s,now),15+10+10);
 const back=state.parseBackup(JSON.stringify(state.exportBackup(s)));
 assert.deepEqual(back.trail,s.trail);assert.deepEqual(back.xp_days,s.xp_days);
 assert.deepEqual(state.normalize({xp:5}).trail,{done:{},goal:100});
});
