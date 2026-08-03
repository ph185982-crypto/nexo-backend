# PRF / PMGO Estudo Backend — FastAPI + Supabase + Vercel

Plataforma adaptativa de estudo para concursos policiais. Suporta dois exames:

| Parâmetro | PRF | PMGO |
|---|---|---|
| Banca | CEBRASPE | Instituto AOCP |
| Formato de questão | Certo / Errado | Múltipla escolha A-E |
| Simulado | 120 questões · 3 blocos · 4h30 | 50 questões · 2 blocos |
| Peso no edital | `weight_prf` | `weight_pm` |

---

## Banco de Questões

### Fontes

| Diretório | Conteúdo |
|---|---|
| `prf/seeds/questions/` | Questões gerais (PRF e PMGO) — JSON por matéria |
| `data/pmgo/seed/` | Questões PMGO adicionais — JSON por matéria |
| `data/pmgo/imports/` | Importações autorizadas (PDFs convertidos) |

### Adicionar questões novas

1. Crie ou edite um arquivo JSON em `data/pmgo/seed/` (PMGO) ou `prf/seeds/questions/` (geral).
2. Siga o schema:

```json
{
  "subject_slug": "criminologia",
  "topic_slug": "teorias-criminologicas",
  "question_type": "multipla_escolha",
  "text": "Texto da questão...",
  "alternatives": [
    { "letter": "A", "text": "...", "is_correct": false },
    { "letter": "B", "text": "...", "is_correct": true }
  ],
  "difficulty": "medium",
  "source": "AOCP/PMGO",
  "year": 2022,
  "examiner": "Instituto AOCP",
  "explanation": "Explicação da alternativa correta...",
  "legal_basis": "Lei X, art. Y"
}
```

3. O campo `difficulty` aceita: `easy`, `medium`, `hard`.
4. A pipeline de ingestão (`core/question_ingestion/`) normaliza, valida e deduplica automaticamente na inicialização do app.

### Contagem atual (PMGO)

| Matéria | weight_pm | Questões | Status |
|---|---|---|---|
| Direito Penal | 3.0 | 173+ | ✅ GOOD |
| Legislação Institucional PM | 3.0 | 22 | ✅ GOOD |
| Direito Constitucional | 2.5 | 296+ | ✅ GOOD |
| Língua Portuguesa | 2.5 | 135+ | ✅ GOOD |
| Direito Penal Militar | 2.5 | 24 | ✅ GOOD |
| Direito Processual Penal | 2.0 | 137+ | ✅ GOOD |
| Direito Administrativo | 2.0 | 130+ | ✅ GOOD |
| Legislação Especial | 2.0 | 98+ | ✅ GOOD |
| Direitos Humanos | 2.0 | 109+ | ✅ GOOD |
| Dir. Proc. Penal Militar | 2.0 | 20 | ✅ GOOD |
| Raciocínio Lógico | 1.5 | 90+ | ✅ GOOD |
| Criminologia | 1.5 | 29 | ✅ GOOD |
| Realidade de Goiás | 1.5 | 25 | ✅ GOOD |
| Informática | 1.0 | 89 | ✅ GOOD |
| Ética no Serviço Público | 1.0 | 87 | ✅ GOOD |
| Medicina Legal | 1.0 | 26 | ✅ GOOD |

Todas as matérias do edital PMGO com ≥ 20 questões (limiar GOOD).

---

## API Endpoints

### Questões

| Endpoint | Descrição |
|---|---|
| `GET /api/prf/questions/list` | Lista questões com filtros (subject_id, topic_id, difficulty, question_type) |
| `GET /api/prf/questions/smart` | Seleção inteligente — prioriza matérias com cobertura baixa |
| `GET /api/prf/questions/{id}` | Detalhe de uma questão |
| `POST /api/prf/questions/answer` | Enviar resposta — retorna feedback, XP e agendamento de revisão |

### Cobertura

| Endpoint | Descrição |
|---|---|
| `GET /api/prf/coverage/pmgo` | Relatório de cobertura PMGO (matérias, tópicos, dificuldade) |
| `GET /api/prf/coverage/prf` | Relatório de cobertura PRF |
| `GET /api/prf/coverage/ingest` | Preview da pipeline de ingestão (sem escrita no DB) |

O relatório de cobertura inclui:
- Flag por matéria: `good` (≥20q), `low` (5-19q), `critical` (1-4q), `empty` (0q)
- Distribuição de dificuldade por matéria e por tópico
- Score de prontidão (`exam_readiness_score` 0-1)
- Lista de prioridades de importação

### Biblioteca Jurídica

| Endpoint | Descrição |
|---|---|
| `GET /api/prf/legal/documents` | Lista documentos (CF, CP, CPP, CTB, etc.) |
| `GET /api/prf/legal/articles` | Artigos com filtros |
| `GET /api/prf/legal/articles/{id}` | Detalhe do artigo |
| `POST /api/prf/legal/articles/{id}/explain` | Gera explicação com IA (cached) |
| `POST /api/prf/legal/articles/{id}/read` | Registra leitura — atualiza mastery score |
| `GET /api/prf/legal/mastery` | Artigos com menor domínio (lista de revisão) |
| `GET /api/prf/legal/weak-articles` | Artigos com maior taxa de erro |
| `POST /api/prf/legal/bookmarks` | Toggle bookmark |
| `GET /api/prf/legal/bookmarks` | Artigos favoritados |
| `GET /api/prf/legal/search` | Busca full-text |

### Trilha do Edital

| Endpoint | Descrição |
|---|---|
| `GET /api/prf/trilha` | Cobertura pessoal do edital (estudado vs total) |

---

## Tema PMGO

O frontend detecta `S.targetExam === 'PMGO'` e aplica o atributo `data-exam="PMGO"` na raiz do documento. As variáveis CSS são sobrescritas via:

```css
:root[data-exam="PMGO"] {
  --primary: #0D7A6B;    /* teal — identidade PMGO */
  --accent:  #2A9D6E;
}
/* dark mode */
:root[data-exam="PMGO"][data-theme="dark"] {
  --primary: #4ECDB4;
}
```

Mudar de exam (PRF ↔ PMGO) em **Mais → Meu concurso** atualiza:
- Tema de cores (instantâneo)
- Lista de matérias filtradas por peso
- Tipo de questão preferido (C/E para PRF, A-E para PMGO)
- Cobertura e trilha recarregadas para o novo exame

---

## Pipeline de Ingestão

Módulo em `core/question_ingestion/`:

1. **Loader** (`prf/seeds/loader.py`) — escaneia `prf/seeds/questions/`, `data/pmgo/seed/`, `data/pmgo/imports/`
2. **Normalizer** — mapeia aliases de dificuldade, infere tipo (C/E se 2 alternativas)
3. **Validator** — verifica campos obrigatórios, exatamente 1 alternativa correta, mínimo de alternativas por tipo
4. **Deduplicator** — SHA-256 do `subject_slug + text`; pula duplicatas
5. **Detector** — detecta exame alvo (PMGO, PRF, ou ambos) pelo `subject_slug`
6. **Seeder** (`prf/seeds/seeder.py`) — persiste no PostgreSQL na inicialização

Para auditar sem gravar: `GET /api/prf/coverage/ingest`

---

## Desenvolvimento

### Smoke tests

```bash
python -m core.coverage_audit.smoke_test
python -m core.question_ingestion.smoke_test
python -m core.question_selection.smoke_test
python -m core.study_runtime.smoke_test
python -m core.approval_engine.smoke_test
python -m core.error_intelligence.smoke_test
```

### Variáveis de ambiente

```
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
REDIS_URL=redis://...  (opcional — caching)
```

### Deploy

O projeto é servido via Vercel (serverless) com Supabase como banco PostgreSQL.
O schema é aplicado automaticamente na inicialização. Migrações idempotentes ficam em `prf/database/migrations.py`.
