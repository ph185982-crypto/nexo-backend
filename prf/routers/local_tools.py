"""Stateless writing and tutoring; the browser owns the saved results."""
from datetime import date, datetime, timezone
from typing import Literal
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from prf.local.content import get_store
from prf.routers.deps import get_current_user_id
from prf.seeds.seed_data import ESSAY_THEMES
from prf.services import ai_tutor_service, essay_service, llm_service

router = APIRouter()


@router.get('/podcasts')
async def podcasts():
    store = get_store()
    episodes = []
    for topic in store.topics:
        subject = store.get_subject(str(topic['subject_id']))
        if not subject or not subject.get('weight_pm') or not store.get_articles(topic_id_=str(topic['id']), limit=1):
            continue
        episodes.append({'id': str(topic['id']), 'title': topic['name'],
                         'subject_name': subject['name'], 'on_demand': True})
    return {'episodes': episodes}


@router.get('/legal/documents')
async def documents():
    store = get_store()
    return [dict(doc, id=slug, article_count=sum(a.get('document_slug') == slug for a in store.articles))
            for slug, doc in store.legal_documents.items()]


@router.get('/legal/articles')
async def document_articles(document_id: str):
    from prf.local.mission_service import _public_article
    store = get_store()
    if document_id not in store.legal_documents:
        raise HTTPException(404, 'Documento não encontrado')
    return [_public_article(a) for a in store.articles if a.get('document_slug') == document_id]


@router.get('/legal/search')
async def search_articles(q: str = Query(min_length=2, max_length=200), limit: int = Query(20, ge=1, le=100)):
    import unicodedata
    from prf.local.mission_service import _public_article
    def normalized(text):
        return ''.join(c for c in unicodedata.normalize('NFD', text.casefold()) if not unicodedata.combining(c))
    terms = normalized(q).split()
    rows = [a for a in get_store().articles if all(t in normalized(a.get('official_text', '') + ' ' + a.get('document_name', '')) for t in terms)]
    return {'articles': [_public_article(a) for a in rows[:limit]]}


@router.get('/checklist')
async def checklist():
    from prf.seeds.checklist_items import CHECKLIST_ITEMS
    return {'items': CHECKLIST_ITEMS}


from prf.models.taf import TAFRecordIn, TAFTargetsIn


class TAFInput(BaseModel):
    records: list[TAFRecordIn] = Field(default_factory=list, max_length=1000)
    targets: TAFTargetsIn = Field(default_factory=TAFTargetsIn)
    exam_date: date | None = None


@router.post('/taf/projection')
async def taf_projection(body: TAFInput):
    from prf.services.taf_service import project_taf
    records = [r.model_dump() for r in body.records if r.measured_at]
    return {'projections': project_taf(records, body.targets.model_dump(exclude_none=True), body.exam_date)}


@router.post('/simulados/generate')
async def generate_exam():
    from prf.local.exam import build_exam
    try:
        return build_exam()
    except ValueError as error:
        raise HTTPException(422, str(error))


class ExamInput(BaseModel):
    question_ids: list[str] = Field(min_length=1, max_length=200)
    answers: dict[str, str] = Field(default_factory=dict)


@router.post('/simulados/finish')
async def finish_exam(body: ExamInput):
    from prf.local.exam import grade_exam
    try:
        return grade_exam(body.question_ids, body.answers)
    except ValueError as error:
        raise HTTPException(422, str(error))


def themes():
    return [dict(t, id=str(uuid5(NAMESPACE_URL, 'prf:essay:' + t['title'])))
            for t in ESSAY_THEMES if t.get('exam_tag', 'PRF') in ('PMGO', 'ALL')]


@router.get('/essays/themes')
async def essay_themes():
    items = themes()
    return {'themes': items, 'total': len(items)}


class EssayInput(BaseModel):
    theme_id: str
    text: str = Field(min_length=1, max_length=20000)


@router.post('/essays/submit', dependencies=[Depends(get_current_user_id)])
async def submit_essay(body: EssayInput):
    theme = next((t for t in themes() if t['id'] == body.theme_id), None)
    if not theme:
        raise HTTPException(404, 'Tema não encontrado')
    if not body.text.strip():
        raise HTTPException(422, 'Escreva sua redação antes de enviar')
    result = await essay_service.correct_essay(body.text, theme['context_text'], banca='AOCP')
    if result.get('diagnosis', {}).get('error'):
        # An unavailable provider is not a zero-grade essay.
        raise HTTPException(503, 'Correção temporariamente indisponível. Sua redação não foi avaliada; tente novamente.')
    return dict(result, id=str(uuid4()), theme_title=theme['title'],
                original_text=body.text, input_type='text',
                created_at=datetime.now(timezone.utc).isoformat())


class TutorMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1, max_length=4000)


class TutorInput(BaseModel):
    question_id: str
    student_answer: str = Field(default='Não sei', max_length=4000)
    history: list[TutorMessage] = Field(default_factory=list, max_length=20)
    message: str = Field(default='', max_length=4000)


@router.post('/tutor', dependencies=[Depends(get_current_user_id)])
async def tutor(body: TutorInput):
    question = get_store().get_question(body.question_id)
    if not question:
        raise HTTPException(404, 'Questão não encontrada')
    correct = next((a['text'] for a in question['alternatives'] if a['is_correct']), '')
    session = await ai_tutor_service.start_tutor_session(
        question['text'], correct, body.student_answer,
        question.get('explanation'), question.get('legal_basis'))
    if not body.message.strip():
        return {'tutor_message': session['tutor_message'], 'resolved': False}
    messages = session['messages'][:2]
    messages[0]['content'] = messages[0]['content'].replace('PRF (Polícia Rodoviária Federal)', 'PMGO (Polícia Militar de Goiás)')
    messages.extend(m.model_dump() for m in body.history)
    messages.append({'role': 'user', 'content': body.message})
    try:
        reply = await llm_service.chat(messages, temperature=0.6, max_tokens=400)
    except llm_service.LLMUnavailable:
        raise HTTPException(503, 'Tutor temporariamente indisponível. Tente novamente.')
    return {'tutor_message': reply, 'resolved': 'conceito consolidado' in reply.lower()}
