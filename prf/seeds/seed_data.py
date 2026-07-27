"""
Seed data for the PRF Adaptive Study Platform.
Contains subjects, topics, legal documents, sample questions, and achievements.
"""

# ═══════════════════════════════════════════════════════════════════
# SUBJECTS — weighted by PRF exam importance
# ═══════════════════════════════════════════════════════════════════

SUBJECTS = [
    {
        "name": "Legislação de Trânsito",
        "slug": "legislacao-transito",
        "description": "Código de Trânsito Brasileiro e legislação complementar",
        "weight_prf": 3.0,
        "color": "#2563EB",
        "icon": "car",
        "display_order": 1,
    },
    {
        "name": "Direito Constitucional",
        "slug": "direito-constitucional",
        "description": "Constituição Federal, direitos e garantias fundamentais",
        "weight_prf": 2.5,
        "color": "#7C3AED",
        "icon": "scale",
        "display_order": 2,
    },
    {
        "name": "Direito Penal",
        "slug": "direito-penal",
        "description": "Código Penal, crimes e penas",
        "weight_prf": 2.5,
        "color": "#DC2626",
        "icon": "shield",
        "display_order": 3,
    },
    {
        "name": "Direito Processual Penal",
        "slug": "direito-processual-penal",
        "description": "Código de Processo Penal, inquérito, prisão",
        "weight_prf": 2.0,
        "color": "#EA580C",
        "icon": "gavel",
        "display_order": 4,
    },
    {
        "name": "Direito Administrativo",
        "slug": "direito-administrativo",
        "description": "Administração pública, atos e poderes administrativos",
        "weight_prf": 2.0,
        "color": "#0891B2",
        "icon": "building",
        "display_order": 5,
    },
    {
        "name": "Língua Portuguesa",
        "slug": "lingua-portuguesa",
        "description": "Interpretação, gramática, redação oficial",
        "weight_prf": 2.0,
        "color": "#059669",
        "icon": "book",
        "display_order": 6,
    },
    {
        "name": "Legislação Especial",
        "slug": "legislacao-especial",
        "description": "Estatuto do Desarmamento, Drogas, Maria da Penha, ECA",
        "weight_prf": 2.0,
        "color": "#D97706",
        "icon": "bookmark",
        "display_order": 7,
    },
    {
        "name": "Direitos Humanos",
        "slug": "direitos-humanos",
        "description": "Declarações, tratados e proteção dos direitos humanos",
        "weight_prf": 1.5,
        "color": "#4F46E5",
        "icon": "heart",
        "display_order": 8,
    },
    {
        "name": "Física Aplicada",
        "slug": "fisica-aplicada",
        "description": "Física aplicada a acidentes de trânsito e balística",
        "weight_prf": 1.0,
        "color": "#6366F1",
        "icon": "zap",
        "display_order": 9,
    },
    {
        "name": "Informática",
        "slug": "informatica",
        "description": "Noções de informática e segurança da informação",
        "weight_prf": 1.0,
        "color": "#8B5CF6",
        "icon": "monitor",
        "display_order": 10,
    },
    {
        "name": "Raciocínio Lógico",
        "slug": "raciocinio-logico",
        "description": "Lógica proposicional, quantitativa e raciocínio analítico",
        "weight_prf": 1.0,
        "color": "#10B981",
        "icon": "brain",
        "display_order": 11,
    },
    {
        "name": "Ética no Serviço Público",
        "slug": "etica-servico-publico",
        "description": "Código de ética, conduta do servidor público",
        "weight_prf": 1.0,
        "color": "#F59E0B",
        "icon": "award",
        "display_order": 12,
    },
    {
        "name": "Policiamento e Fiscalização",
        "slug": "policiamento-fiscalizacao",
        "description": "Atribuições da PRF, fiscalização de veículos e cargas",
        "weight_prf": 2.5,
        "color": "#1D4ED8",
        "icon": "badge",
        "display_order": 13,
    },
]

# ═══════════════════════════════════════════════════════════════════
# TOPICS — main topics per subject
# ═══════════════════════════════════════════════════════════════════

TOPICS = {
    "legislacao-transito": [
        {"name": "Sistema Nacional de Trânsito", "slug": "snt", "weight": 2.0},
        {"name": "Normas gerais de circulação e conduta", "slug": "normas-circulacao", "weight": 3.0},
        {"name": "Pedestres e condutores de veículos não motorizados", "slug": "pedestres", "weight": 1.5},
        {"name": "Habilitação", "slug": "habilitacao", "weight": 2.0},
        {"name": "Infrações", "slug": "infracoes", "weight": 3.0},
        {"name": "Penalidades e medidas administrativas", "slug": "penalidades", "weight": 2.5},
        {"name": "Crimes de trânsito", "slug": "crimes-transito", "weight": 3.0},
        {"name": "Sinalização de trânsito", "slug": "sinalizacao", "weight": 2.0},
        {"name": "Veículos", "slug": "veiculos", "weight": 1.5},
        {"name": "Registro e licenciamento", "slug": "registro-licenciamento", "weight": 1.5},
    ],
    "direito-constitucional": [
        {"name": "Princípios fundamentais", "slug": "principios-fundamentais", "weight": 2.0},
        {"name": "Direitos e garantias fundamentais", "slug": "direitos-garantias", "weight": 3.0},
        {"name": "Organização do Estado", "slug": "organizacao-estado", "weight": 2.0},
        {"name": "Segurança pública", "slug": "seguranca-publica", "weight": 3.0},
        {"name": "Poder Legislativo", "slug": "poder-legislativo", "weight": 1.0},
        {"name": "Poder Executivo", "slug": "poder-executivo", "weight": 1.0},
        {"name": "Poder Judiciário", "slug": "poder-judiciario", "weight": 1.0},
        {"name": "Administração Pública", "slug": "adm-publica-cf", "weight": 2.0},
        {"name": "Remédios constitucionais", "slug": "remedios-constitucionais", "weight": 2.0},
    ],
    "direito-penal": [
        {"name": "Princípios do Direito Penal", "slug": "principios-penal", "weight": 2.0},
        {"name": "Aplicação da lei penal", "slug": "aplicacao-lei-penal", "weight": 2.0},
        {"name": "Crime", "slug": "crime", "weight": 3.0},
        {"name": "Excludentes de ilicitude", "slug": "excludentes-ilicitude", "weight": 2.5},
        {"name": "Culpabilidade", "slug": "culpabilidade", "weight": 2.0},
        {"name": "Concurso de pessoas", "slug": "concurso-pessoas", "weight": 2.0},
        {"name": "Penas", "slug": "penas", "weight": 2.0},
        {"name": "Crimes contra a pessoa", "slug": "crimes-pessoa", "weight": 2.5},
        {"name": "Crimes contra o patrimônio", "slug": "crimes-patrimonio", "weight": 2.5},
        {"name": "Crimes contra a Administração Pública", "slug": "crimes-adm-publica", "weight": 3.0},
    ],
    "direito-processual-penal": [
        {"name": "Inquérito policial", "slug": "inquerito-policial", "weight": 3.0},
        {"name": "Ação penal", "slug": "acao-penal", "weight": 2.0},
        {"name": "Prisão e liberdade provisória", "slug": "prisao-liberdade", "weight": 3.0},
        {"name": "Provas", "slug": "provas", "weight": 2.5},
        {"name": "Competência", "slug": "competencia-cpp", "weight": 1.5},
    ],
    "legislacao-especial": [
        {"name": "Lei de Drogas (11.343/06)", "slug": "lei-drogas", "weight": 3.0},
        {"name": "Estatuto do Desarmamento (10.826/03)", "slug": "estatuto-desarmamento", "weight": 2.5},
        {"name": "Lei Maria da Penha (11.340/06)", "slug": "maria-penha", "weight": 2.0},
        {"name": "Abuso de Autoridade (13.869/19)", "slug": "abuso-autoridade", "weight": 2.0},
        {"name": "ECA (8.069/90)", "slug": "eca", "weight": 1.5},
        {"name": "Lei de Crimes Ambientais (9.605/98)", "slug": "crimes-ambientais", "weight": 1.5},
        {"name": "Crimes Hediondos (8.072/90)", "slug": "crimes-hediondos", "weight": 2.0},
    ],
}

# ═══════════════════════════════════════════════════════════════════
# LEGAL DOCUMENTS
# ═══════════════════════════════════════════════════════════════════

LEGAL_DOCUMENTS = [
    {"name": "Constituição Federal", "slug": "cf-88", "abbreviation": "CF/88", "display_order": 1},
    {"name": "Código de Trânsito Brasileiro", "slug": "ctb", "abbreviation": "CTB", "display_order": 2},
    {"name": "Código Penal", "slug": "cp", "abbreviation": "CP", "display_order": 3},
    {"name": "Código de Processo Penal", "slug": "cpp", "abbreviation": "CPP", "display_order": 4},
    {"name": "Lei de Drogas", "slug": "lei-drogas", "abbreviation": "Lei 11.343/06", "display_order": 5},
    {"name": "Estatuto do Desarmamento", "slug": "estatuto-desarmamento", "abbreviation": "Lei 10.826/03", "display_order": 6},
    {"name": "Lei Maria da Penha", "slug": "maria-penha", "abbreviation": "Lei 11.340/06", "display_order": 7},
    {"name": "Lei de Abuso de Autoridade", "slug": "abuso-autoridade", "abbreviation": "Lei 13.869/19", "display_order": 8},
]

# ═══════════════════════════════════════════════════════════════════
# SAMPLE LEGAL ARTICLES (CF Art. 144 — Segurança Pública)
# ═══════════════════════════════════════════════════════════════════

SAMPLE_LEGAL_ARTICLES = [
    {
        "document_slug": "cf-88",
        "subject_slug": "direito-constitucional",
        "article_number": "Art. 144",
        "chapter": "Da Segurança Pública",
        "official_text": "A segurança pública, dever do Estado, direito e responsabilidade de todos, é exercida para a preservação da ordem pública e da incolumidade das pessoas e do patrimônio, através dos seguintes órgãos: I - polícia federal; II - polícia rodoviária federal; III - polícia ferroviária federal; IV - polícias civis; V - polícias militares e corpos de bombeiros militares; VI - polícias penais federal, estaduais e distrital.",
        "simple_text": "A segurança pública é dever do Estado mas também responsabilidade de todos. É exercida por órgãos específicos para preservar a ordem pública e proteger pessoas e patrimônio. A PRF é um desses órgãos.",
        "highlights": ["dever do Estado", "direito e responsabilidade de todos", "polícia rodoviária federal"],
        "frequency_score": 10.0,
    },
    {
        "document_slug": "cf-88",
        "subject_slug": "direito-constitucional",
        "article_number": "Art. 144, §2°",
        "chapter": "Da Segurança Pública",
        "official_text": "A polícia rodoviária federal, órgão permanente, organizado e mantido pela União e estruturado em carreira, destina-se, na forma da lei, ao patrulhamento ostensivo das rodovias federais.",
        "simple_text": "A PRF é um órgão permanente da União, com carreira estruturada, cuja função principal é o patrulhamento ostensivo das rodovias federais.",
        "highlights": ["órgão permanente", "mantido pela União", "patrulhamento ostensivo", "rodovias federais"],
        "frequency_score": 10.0,
    },
    {
        "document_slug": "cf-88",
        "subject_slug": "direito-constitucional",
        "article_number": "Art. 5°, caput",
        "chapter": "Dos Direitos e Garantias Fundamentais",
        "official_text": "Todos são iguais perante a lei, sem distinção de qualquer natureza, garantindo-se aos brasileiros e aos estrangeiros residentes no País a inviolabilidade do direito à vida, à liberdade, à igualdade, à segurança e à propriedade.",
        "simple_text": "Todos são iguais perante a lei. Brasileiros e estrangeiros residentes têm garantidos os direitos à vida, liberdade, igualdade, segurança e propriedade.",
        "highlights": ["iguais perante a lei", "inviolabilidade", "vida, liberdade, igualdade, segurança, propriedade"],
        "frequency_score": 9.0,
    },
    {
        "document_slug": "ctb",
        "subject_slug": "legislacao-transito",
        "article_number": "Art. 1°",
        "chapter": "Disposições Preliminares",
        "official_text": "O trânsito de qualquer natureza nas vias terrestres do território nacional, abertas à circulação, rege-se por este Código.",
        "simple_text": "O CTB regula todo tipo de trânsito nas vias terrestres abertas à circulação em território nacional.",
        "highlights": ["qualquer natureza", "vias terrestres", "território nacional", "abertas à circulação"],
        "frequency_score": 7.0,
    },
    {
        "document_slug": "ctb",
        "subject_slug": "legislacao-transito",
        "article_number": "Art. 165",
        "chapter": "Das Infrações",
        "official_text": "Dirigir sob a influência de álcool ou de qualquer outra substância psicoativa que determine dependência: Infração - gravíssima; Penalidade - multa (dez vezes) e suspensão do direito de dirigir por 12 (doze) meses.",
        "simple_text": "Dirigir alcoolizado ou sob efeito de drogas é infração gravíssima com multa 10x e suspensão da habilitação por 12 meses.",
        "highlights": ["gravíssima", "multa dez vezes", "suspensão 12 meses", "álcool ou substância psicoativa"],
        "frequency_score": 9.5,
    },
    {
        "document_slug": "ctb",
        "subject_slug": "legislacao-transito",
        "article_number": "Art. 302",
        "chapter": "Dos Crimes de Trânsito",
        "official_text": "Praticar homicídio culposo na direção de veículo automotor: Penas - detenção, de dois a quatro anos, e suspensão ou proibição de se obter a permissão ou a habilitação para dirigir veículo automotor.",
        "simple_text": "Matar alguém culposamente (sem intenção) ao dirigir: detenção de 2 a 4 anos e suspensão/proibição de habilitação.",
        "highlights": ["homicídio culposo", "detenção 2 a 4 anos", "suspensão da habilitação"],
        "frequency_score": 9.0,
    },
]

# ═══════════════════════════════════════════════════════════════════
# SAMPLE QUESTIONS
# ═══════════════════════════════════════════════════════════════════

SAMPLE_QUESTIONS = [
    {
        "subject_slug": "direito-constitucional",
        "text": "De acordo com a Constituição Federal, a polícia rodoviária federal destina-se:",
        "difficulty": "medium",
        "source": "CESPE/2021",
        "year": 2021,
        "examiner": "CESPE",
        "explanation": "Conforme o Art. 144, §2° da CF, a PRF destina-se ao patrulhamento ostensivo das rodovias federais.",
        "legal_basis": "Art. 144, §2°, CF/88",
        "alternatives": [
            {"letter": "A", "text": "ao patrulhamento ostensivo das rodovias federais", "is_correct": True, "explanation": "Correto. É a literalidade do Art. 144, §2° da CF."},
            {"letter": "B", "text": "à apuração de infrações penais contra a ordem política e social", "is_correct": False, "explanation": "Essa é atribuição da Polícia Federal (Art. 144, §1°, I)."},
            {"letter": "C", "text": "à preservação da ordem pública e da incolumidade das pessoas", "is_correct": False, "explanation": "Essa é uma função geral da segurança pública, não específica da PRF."},
            {"letter": "D", "text": "às funções de polícia judiciária da União", "is_correct": False, "explanation": "Essa é atribuição da Polícia Federal (Art. 144, §1°, IV)."},
            {"letter": "E", "text": "à polícia ostensiva e à preservação da ordem pública", "is_correct": False, "explanation": "Essa é atribuição das Polícias Militares (Art. 144, §5°)."},
        ],
    },
    {
        "subject_slug": "legislacao-transito",
        "text": "Segundo o CTB, dirigir sob a influência de álcool constitui infração:",
        "difficulty": "easy",
        "source": "CESPE/2019",
        "year": 2019,
        "examiner": "CESPE",
        "explanation": "Art. 165 do CTB classifica dirigir sob influência de álcool como infração gravíssima.",
        "legal_basis": "Art. 165, CTB",
        "alternatives": [
            {"letter": "A", "text": "leve", "is_correct": False, "explanation": "Incorreto. A infração é gravíssima, não leve."},
            {"letter": "B", "text": "média", "is_correct": False, "explanation": "Incorreto. A infração é gravíssima, não média."},
            {"letter": "C", "text": "grave", "is_correct": False, "explanation": "Incorreto. A infração é gravíssima, não apenas grave."},
            {"letter": "D", "text": "gravíssima", "is_correct": True, "explanation": "Correto. Art. 165 do CTB: infração gravíssima, multa (dez vezes) e suspensão por 12 meses."},
            {"letter": "E", "text": "gravíssima agravada", "is_correct": False, "explanation": "Não existe essa classificação no CTB."},
        ],
    },
    {
        "subject_slug": "direito-penal",
        "text": "São causas excludentes de ilicitude previstas no Código Penal:",
        "difficulty": "medium",
        "source": "CESPE/2020",
        "year": 2020,
        "examiner": "CESPE",
        "explanation": "Art. 23 do CP prevê as excludentes de ilicitude: estado de necessidade, legítima defesa, estrito cumprimento de dever legal e exercício regular de direito.",
        "legal_basis": "Art. 23, CP",
        "alternatives": [
            {"letter": "A", "text": "estado de necessidade, legítima defesa, estrito cumprimento de dever legal e exercício regular de direito", "is_correct": True, "explanation": "Correto. São as quatro excludentes previstas no Art. 23 do CP."},
            {"letter": "B", "text": "coação irresistível, obediência hierárquica e embriaguez fortuita", "is_correct": False, "explanation": "Essas são causas de exclusão de culpabilidade, não de ilicitude."},
            {"letter": "C", "text": "estado de necessidade, legítima defesa e coação moral irresistível", "is_correct": False, "explanation": "Coação moral irresistível é causa de exclusão de culpabilidade."},
            {"letter": "D", "text": "legítima defesa, exercício regular de direito e erro de tipo", "is_correct": False, "explanation": "Erro de tipo exclui o dolo, não a ilicitude."},
            {"letter": "E", "text": "estado de necessidade, legítima defesa e prescrição", "is_correct": False, "explanation": "Prescrição é causa de extinção da punibilidade, não de ilicitude."},
        ],
    },
    {
        "subject_slug": "legislacao-transito",
        "text": "O homicídio culposo na direção de veículo automotor é punido com:",
        "difficulty": "medium",
        "source": "CESPE/2021",
        "year": 2021,
        "examiner": "CESPE",
        "explanation": "Art. 302 do CTB: detenção de 2 a 4 anos e suspensão ou proibição de habilitação.",
        "legal_basis": "Art. 302, CTB",
        "alternatives": [
            {"letter": "A", "text": "detenção de 6 meses a 2 anos", "is_correct": False, "explanation": "Essa é a pena do homicídio culposo do CP (Art. 121, §3°), não do CTB."},
            {"letter": "B", "text": "detenção de 2 a 4 anos e suspensão da habilitação", "is_correct": True, "explanation": "Correto. Art. 302 do CTB."},
            {"letter": "C", "text": "reclusão de 2 a 4 anos", "is_correct": False, "explanation": "A pena é de detenção, não reclusão."},
            {"letter": "D", "text": "detenção de 1 a 3 anos", "is_correct": False, "explanation": "A pena prevista é de 2 a 4 anos, não 1 a 3."},
            {"letter": "E", "text": "reclusão de 6 a 20 anos", "is_correct": False, "explanation": "Essa é a pena do homicídio doloso simples (Art. 121, CP)."},
        ],
    },
    {
        "subject_slug": "direito-constitucional",
        "text": "A segurança pública, conforme a Constituição Federal, é:",
        "difficulty": "easy",
        "source": "CESPE/2018",
        "year": 2018,
        "examiner": "CESPE",
        "explanation": "Art. 144, caput da CF: 'A segurança pública, dever do Estado, direito e responsabilidade de todos'.",
        "legal_basis": "Art. 144, caput, CF/88",
        "alternatives": [
            {"letter": "A", "text": "dever exclusivo do Estado", "is_correct": False, "explanation": "Não é exclusivo. A CF diz que é 'direito e responsabilidade de todos'."},
            {"letter": "B", "text": "dever do Estado, direito e responsabilidade de todos", "is_correct": True, "explanation": "Correto. Literalidade do Art. 144, caput, CF."},
            {"letter": "C", "text": "responsabilidade exclusiva dos órgãos policiais", "is_correct": False, "explanation": "A CF atribui a responsabilidade a todos, não apenas aos órgãos policiais."},
            {"letter": "D", "text": "competência privativa da União", "is_correct": False, "explanation": "A segurança pública envolve estados e municípios também."},
            {"letter": "E", "text": "atribuição das Forças Armadas", "is_correct": False, "explanation": "As Forças Armadas são tratadas no Art. 142 e têm função diferente."},
        ],
    },
]

# ═══════════════════════════════════════════════════════════════════
# ACHIEVEMENTS
# ═══════════════════════════════════════════════════════════════════

ACHIEVEMENTS = [
    {"slug": "first-mission", "name": "Primeira Missão", "description": "Complete sua primeira missão diária.", "category": "milestone", "xp_reward": 50, "condition_json": {"type": "missions_completed", "threshold": 1}},
    {"slug": "streak-3", "name": "3 Dias Seguidos", "description": "Mantenha uma sequência de 3 dias.", "category": "streak", "xp_reward": 30, "condition_json": {"type": "streak", "threshold": 3}},
    {"slug": "streak-7", "name": "Semana Completa", "description": "Mantenha uma sequência de 7 dias.", "category": "streak", "xp_reward": 100, "condition_json": {"type": "streak", "threshold": 7}},
    {"slug": "streak-30", "name": "Mês de Ferro", "description": "Mantenha uma sequência de 30 dias.", "category": "streak", "xp_reward": 500, "condition_json": {"type": "streak", "threshold": 30}},
    {"slug": "streak-100", "name": "Centurião", "description": "100 dias seguidos de estudo.", "category": "streak", "xp_reward": 2000, "condition_json": {"type": "streak", "threshold": 100}},
    {"slug": "questions-50", "name": "50 Questões", "description": "Responda 50 questões.", "category": "milestone", "xp_reward": 50, "condition_json": {"type": "questions_answered", "threshold": 50}},
    {"slug": "questions-500", "name": "500 Questões", "description": "Responda 500 questões.", "category": "milestone", "xp_reward": 200, "condition_json": {"type": "questions_answered", "threshold": 500}},
    {"slug": "questions-1000", "name": "Mil Questões", "description": "Responda 1000 questões.", "category": "milestone", "xp_reward": 500, "condition_json": {"type": "questions_answered", "threshold": 1000}},
    {"slug": "accuracy-80", "name": "Precisão 80%", "description": "Alcance 80% de acurácia em uma matéria.", "category": "mastery", "xp_reward": 100, "condition_json": {"type": "accuracy", "threshold": 0.8}},
    {"slug": "accuracy-90", "name": "Precisão 90%", "description": "Alcance 90% de acurácia em uma matéria.", "category": "mastery", "xp_reward": 300, "condition_json": {"type": "accuracy", "threshold": 0.9}},
    {"slug": "all-subjects", "name": "Explorador", "description": "Estude todas as matérias pelo menos uma vez.", "category": "exploration", "xp_reward": 100, "condition_json": {"type": "subjects_studied", "threshold": 13}},
    {"slug": "commute-10h", "name": "Aproveitador de Tempo", "description": "Acumule 10 horas de estudo no deslocamento.", "category": "consistency", "xp_reward": 200, "condition_json": {"type": "commute_hours", "threshold": 10}},
    {"slug": "study-50h", "name": "50 Horas", "description": "Acumule 50 horas totais de estudo.", "category": "milestone", "xp_reward": 300, "condition_json": {"type": "study_hours", "threshold": 50}},
    {"slug": "study-200h", "name": "200 Horas", "description": "Acumule 200 horas totais de estudo.", "category": "milestone", "xp_reward": 1000, "condition_json": {"type": "study_hours", "threshold": 200}},
    {"slug": "level-10", "name": "Nível 10", "description": "Alcance o nível 10.", "category": "milestone", "xp_reward": 200, "condition_json": {"type": "level", "threshold": 10}},
    {"slug": "zero-errors", "name": "Perfeição", "description": "Complete uma missão inteira sem erros.", "category": "mastery", "xp_reward": 150, "condition_json": {"type": "perfect_mission", "threshold": 1}},
]
