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
        {"name": "Recursos no processo penal", "slug": "recursos-cpp", "weight": 2.0},
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
    "direito-administrativo": [
        {"name": "Atos administrativos", "slug": "atos-administrativos", "weight": 2.5},
        {"name": "Poderes administrativos", "slug": "poderes-administrativos", "weight": 2.5},
        {"name": "Licitações e contratos", "slug": "licitacoes-contratos", "weight": 2.0},
        {"name": "Servidores públicos", "slug": "servidores-publicos", "weight": 2.0},
        {"name": "Processo administrativo disciplinar", "slug": "pad", "weight": 2.0},
        {"name": "Controle da Administração Pública", "slug": "controle-adm", "weight": 1.5},
        {"name": "Responsabilidade civil do Estado", "slug": "responsabilidade-estado", "weight": 2.0},
        {"name": "Bens públicos", "slug": "bens-publicos", "weight": 1.0},
    ],
    "lingua-portuguesa": [
        {"name": "Interpretação de textos", "slug": "interpretacao-textos", "weight": 3.0},
        {"name": "Concordância verbal e nominal", "slug": "concordancia", "weight": 2.5},
        {"name": "Regência verbal e nominal", "slug": "regencia", "weight": 2.0},
        {"name": "Pontuação", "slug": "pontuacao", "weight": 2.0},
        {"name": "Redação oficial", "slug": "redacao-oficial", "weight": 1.5},
        {"name": "Classes de palavras", "slug": "classes-palavras", "weight": 2.0},
    ],
    "direitos-humanos": [
        {"name": "Declaração Universal dos Direitos Humanos", "slug": "dudh", "weight": 2.5},
        {"name": "Pacto de San José da Costa Rica", "slug": "pacto-san-jose", "weight": 2.5},
        {"name": "Sistema interamericano de proteção", "slug": "sistema-interamericano", "weight": 2.0},
        {"name": "Direitos das minorias e grupos vulneráveis", "slug": "minorias-vulneraveis", "weight": 1.5},
        {"name": "Proibição da tortura e tratamento degradante", "slug": "tortura-degradante", "weight": 2.0},
        {"name": "Garantias processuais e devido processo legal", "slug": "garantias-processuais-dh", "weight": 2.0},
    ],
    "fisica-aplicada": [
        {"name": "Cinemática aplicada ao trânsito", "slug": "cinematica", "weight": 2.5},
        {"name": "Dinâmica veicular", "slug": "dinamica-veicular", "weight": 2.5},
        {"name": "Energia e colisões", "slug": "energia-colisoes", "weight": 2.0},
        {"name": "Balística", "slug": "balistica", "weight": 1.5},
        {"name": "Frenagem e atrito", "slug": "frenagem-atrito", "weight": 2.0},
    ],
    "informatica": [
        {"name": "Sistemas operacionais", "slug": "sistemas-operacionais", "weight": 2.0},
        {"name": "Redes de computadores e internet", "slug": "redes-internet", "weight": 2.0},
        {"name": "Segurança da informação", "slug": "seguranca-info", "weight": 2.5},
        {"name": "Editores de texto e planilhas", "slug": "office", "weight": 1.5},
        {"name": "Computação em nuvem", "slug": "cloud", "weight": 1.5},
        {"name": "Banco de dados", "slug": "banco-dados", "weight": 1.0},
    ],
    "raciocinio-logico": [
        {"name": "Proposições e conectivos lógicos", "slug": "proposicoes-conectivos", "weight": 3.0},
        {"name": "Tabelas-verdade", "slug": "tabelas-verdade", "weight": 2.5},
        {"name": "Equivalências e negações", "slug": "equivalencias", "weight": 2.5},
        {"name": "Raciocínio quantitativo", "slug": "raciocinio-quantitativo", "weight": 2.0},
        {"name": "Sequências e padrões", "slug": "sequencias-padroes", "weight": 1.5},
    ],
    "etica-servico-publico": [
        {"name": "Código de Ética (Decreto 1.171/94)", "slug": "codigo-etica", "weight": 3.0},
        {"name": "Regime disciplinar do servidor", "slug": "regime-disciplinar", "weight": 2.0},
        {"name": "Lei de Improbidade Administrativa", "slug": "improbidade", "weight": 2.5},
        {"name": "Conflito de interesses", "slug": "conflito-interesses", "weight": 1.5},
    ],
    "policiamento-fiscalizacao": [
        {"name": "Atribuições da PRF", "slug": "atribuicoes-prf", "weight": 3.0},
        {"name": "Fiscalização de veículos", "slug": "fisc-veiculos", "weight": 2.5},
        {"name": "Fiscalização de cargas", "slug": "fisc-cargas", "weight": 2.0},
        {"name": "Abordagem policial", "slug": "abordagem-policial", "weight": 2.5},
        {"name": "Uso progressivo da força", "slug": "uso-forca", "weight": 2.5},
        {"name": "Policiamento rodoviário ostensivo", "slug": "policiamento-ostensivo", "weight": 2.0},
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
# LEGACY — questions and legal articles now live in JSON files
# under prf/seeds/questions/ and prf/seeds/articles/
# ═══════════════════════════════════════════════════════════════════

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
