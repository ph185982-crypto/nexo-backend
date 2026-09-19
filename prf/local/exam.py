"""Exam assembly and grading using bundled questions, with no database."""
import random
from datetime import datetime, timezone
from uuid import uuid4
from prf.local.content import get_store
from prf.local.mission_service import _public_question
from prf.seeds.seed_data import EXAM_BLOCKS_PM, ITEMS_PER_SUBJECT_SIMULADO_PM


def build_exam():
    store = get_store()
    questions = {}
    blocks = {}
    for number, block in EXAM_BLOCKS_PM.items():
        rows = []
        for slug in block['subjects']:
            candidates = [q for q in store.questions if q['subject_slug'] == slug and q.get('question_type') == 'multipla_escolha']
            count = ITEMS_PER_SUBJECT_SIMULADO_PM.get(slug, 5)
            if len(candidates) < count:
                raise ValueError('Questões insuficientes para ' + slug)
            for question in random.sample(candidates, count):
                rows.append(dict(_public_question(question), block=number,
                                 subject_name=store.get_subject(str(question['subject_id']))['name']))
        questions[str(number)] = rows
        blocks[f'bloco_{number}'] = dict(block, total=len(rows))
    return {'id': str(uuid4()), 'blocks': blocks, 'questions_by_block': questions,
            'total_questions': sum(len(q) for q in questions.values()), 'time_limit_mins': 240,
            'started_at': datetime.now(timezone.utc).isoformat(), 'exam_type': 'PMGO',
            'question_format': 'multipla_escolha', 'answers': {}, 'is_completed': False}


def grade_exam(ids, answers):
    store = get_store()
    stats = {f'bloco_{n}': dict(certas=0, erradas=0, branco=0, total=0, score=0)
             for n in EXAM_BLOCKS_PM}
    attempts = []
    if len(ids) != len(set(ids)):
        raise ValueError('Questões repetidas')
    for qid in ids:
        q = store.get_question(qid)
        if not q:
            raise ValueError('Questão não encontrada')
        number = next((n for n, b in EXAM_BLOCKS_PM.items() if q['subject_slug'] in b['subjects']), None)
        if number is None or q.get('question_type') != 'multipla_escolha':
            raise ValueError('Questão fora do simulado PMGO')
        stat = stats[f'bloco_{number}']
        stat['total'] += 1
        selected = answers.get(qid)
        correct = next(a['letter'] for a in q['alternatives'] if a['is_correct'])
        if not selected:
            stat['branco'] += 1
        else:
            if selected not in {a['letter'] for a in q['alternatives']}:
                raise ValueError('Alternativa inválida')
            ok = selected == correct
            stat['certas' if ok else 'erradas'] += 1
            attempts.append({'question_id': qid, 'subject_id': str(q['subject_id']), 'is_correct': ok})
    maximum = 0
    for n, b in EXAM_BLOCKS_PM.items():
        stat = stats[f'bloco_{n}']
        stat['score'] = stat['certas'] * b.get('weight', 1)
        maximum += stat['total'] * b.get('weight', 1)
    score = sum(s['score'] for s in stats.values())
    percentage = round(100 * score / max(maximum, 1), 1)
    return dict(score=score, score_raw=sum(s['certas'] for s in stats.values()),
                certas=sum(s['certas'] for s in stats.values()), erradas=sum(s['erradas'] for s in stats.values()),
                branco=sum(s['branco'] for s in stats.values()), blocks=stats, total_questions=len(ids),
                percentage=percentage, max_score=maximum, scoring_method='aocp_weighted',
                passing_threshold='60%', attempts=attempts,
                eliminated=percentage < 60 or any(s['total'] and not s['certas'] for s in stats.values()))
