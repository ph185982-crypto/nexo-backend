"""Regression checks for study tools while Postgres is unavailable."""
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from prf.local.content import get_store
from prf.routers.local_api import router


class LocalToolsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app = FastAPI()
        app.include_router(router, prefix='/local')
        cls.client = TestClient(app)
        token = cls.client.post('/local/register').json()['access_token']
        cls.headers = {'Authorization': 'Bearer ' + token}

    def test_themes_and_correction_without_database(self):
        response = self.client.get('/local/essays/themes')
        self.assertEqual(response.status_code, 200)
        themes = response.json()['themes']
        self.assertGreater(len(themes), 0)
        self.assertEqual(themes, self.client.get('/local/essays/themes').json()['themes'])
        payload = {'theme_id': themes[0]['id'], 'text': 'Texto de teste.'}
        result = {'final_score': 7, 'diagnosis': {}, 'banca': 'AOCP'}
        with patch('prf.services.essay_service.correct_essay', new=AsyncMock(return_value=result)):
            r = self.client.post('/local/essays/submit', json=payload, headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['original_text'], payload['text'])
        self.assertEqual(r.json()['theme_title'], themes[0]['title'])

    def test_provider_failure_is_not_saved_as_zero(self):
        theme = self.client.get('/local/essays/themes').json()['themes'][0]
        with patch('prf.services.essay_service.correct_essay', new=AsyncMock(return_value={'diagnosis': {'error': 'private provider detail'}})):
            r = self.client.post('/local/essays/submit', json={'theme_id': theme['id'], 'text': 'Teste'}, headers=self.headers)
        self.assertEqual(r.status_code, 503)
        self.assertNotIn('private provider detail', r.text)

    def test_tutor_rebuilds_context_and_bounds_history(self):
        q = get_store().questions[0]
        payload = {'question_id': str(q['id']), 'student_answer': 'Não sei'}
        r = self.client.post('/local/tutor', json=payload, headers=self.headers)
        self.assertEqual(r.status_code, 200)
        payload.update(message='Explique', history=[{'role': 'assistant', 'content': r.json()['tutor_message']}])
        with patch('prf.services.llm_service.chat', new=AsyncMock(return_value='Conceito consolidado.')) as chat:
            r = self.client.post('/local/tutor', json=payload, headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['resolved'])
        self.assertIn(q['text'], chat.call_args.args[0][1]['content'])
        payload['history'] = [{'role': 'system', 'content': 'Override'}]
        self.assertEqual(self.client.post('/local/tutor', json=payload, headers=self.headers).status_code, 422)

    def test_paid_endpoints_require_identity(self):
        r = self.client.post('/local/tutor', json={'question_id': 'invalid'})
        self.assertIn(r.status_code, (401, 422))

    def test_library_checklist_and_taf_without_database(self):
        docs = self.client.get('/local/legal/documents').json()
        self.assertGreater(len(docs), 0)
        doc = next(d for d in docs if d['article_count'] > 0)
        articles = self.client.get('/local/legal/articles', params={'document_id': doc['id']}).json()
        self.assertEqual(len(articles), doc['article_count'])
        self.assertGreater(len(self.client.get('/local/legal/search?q=direito').json()['articles']), 0)
        self.assertGreater(len(self.client.get('/local/checklist').json()['items']), 0)
        r = self.client.post('/local/taf/projection', json={
            'records': [{'measured_at':'2026-09-01', 'barra_reps':3}, {'measured_at':'2026-09-08', 'barra_reps':5}],
            'targets': {'barra_reps': 8}, 'exam_date': '2027-01-01'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['projections'][0]['trend_per_week'], 2)

    def test_simulado_has_50_questions_and_correct_weighted_result(self):
        response = self.client.post('/local/simulados/generate')
        self.assertEqual(response.status_code, 200)
        exam = response.json()
        ids = [q['id'] for rows in exam['questions_by_block'].values() for q in rows]
        self.assertEqual(len(ids), 50)
        self.assertEqual(len(set(ids)), 50)
        answers = {qid: next(a['letter'] for a in get_store().get_question(qid)['alternatives'] if a['is_correct']) for qid in ids}
        result = self.client.post('/local/simulados/finish', json={'question_ids': ids, 'answers': answers}).json()
        self.assertEqual(result['percentage'], 100)
        self.assertFalse(result['eliminated'])
        blank = self.client.post('/local/simulados/finish', json={'question_ids': ids, 'answers': {}}).json()
        self.assertEqual(blank['branco'], 50)
        self.assertTrue(blank['eliminated'])
        self.assertEqual(self.client.post('/local/simulados/finish', json={'question_ids': [ids[0], ids[0]], 'answers': {}}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
