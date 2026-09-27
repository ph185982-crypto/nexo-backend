import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient


class EntryTest(unittest.TestCase):
    def test_browser_storage_routes_never_initialize_database(self):
        import api.index as entry
        client = TestClient(entry.app)
        with patch.object(entry, '_init_prf', new=AsyncMock()) as init:
            for path in ('/app', '/status', '/api/prf/local/catalog', '/api/prf/local/assets/refresh.css'):
                self.assertEqual(client.get(path).status_code, 200)
            init.assert_not_awaited()

    def test_essay_uses_five_scores_of_five(self):
        from prf.services.essay_service import correct_essay
        import asyncio
        diagnosis = {'macro': {key: {'score': 4, 'feedback': 'Teste'} for key in ('estrutura','desenvolvimento','coesao','argumentacao','norma_culta')}, 'ne_count': 0}
        with patch('prf.services.llm_service.active_provider', return_value='openai'), patch('prf.services.llm_service.chat_json', new=AsyncMock(return_value=diagnosis)):
            result = asyncio.run(correct_essay('Texto', 'Tema', banca='AOCP'))
        self.assertEqual(result['max_score'], 25)
        self.assertEqual(result['final_score'], 20)
