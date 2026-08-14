"""
Apelidos de tópico — o slug que veio no arquivo de questão contra o slug do edital.

As questões foram importadas de fontes diferentes ao longo do tempo e cada uma
nomeou o tópico do seu jeito: uma escreveu `licitacao`, o edital chama
`licitacoes-contratos`; outra escreveu `lei-maria-da-penha`, aqui é `maria-penha`.
O seeder comparava o slug ao pé da letra, não encontrava, e gravava a questão com
tópico nulo — 294 de 2.082 questões entravam órfãs. Sem tópico, a missão não
consegue amarrar o áudio, a lei seca e as questões no mesmo assunto do dia.

**Por que este mapa é escrito à mão e não gerado por semelhança de texto.**
Casamento automático por similaridade recuperava 133 das 245 órfãs, mas errava
feio no caminho: `lei-tortura` virava `lei-drogas`, `presuncao-inocencia` virava
`seguranca-publica`, `ortografia-acentuacao` virava `pontuacao`. Questão
arquivada no tópico errado é pior que questão sem tópico — o sistema passa a
confiar num vínculo falso e serve conteúdo de um assunto dizendo que é de outro.
Onde não havia correspondente honesto, a saída foi criar o tópico que faltava no
edital (ver TOPICS em seed_data.py), não forçar o mais parecido.

Um alias só entra aqui quando o tópico de origem e o de destino são a mesma
matéria de prova. Quando o slug de origem não é conteúdo do edital PMGO, ele
fica de fora de propósito e a questão segue sem tópico — é a resposta correta.
"""
from __future__ import annotations

# {subject_slug: {slug_que_veio_no_arquivo: slug_do_edital}}
TOPIC_ALIASES: dict[str, dict[str, str]] = {

    "direito-administrativo": {
        "principios-administracao-publica": "principios-adm",
        "licitacao": "licitacoes-contratos",
        "controle-administracao-publica": "controle-adm",
        "responsabilidade-civil-estado": "responsabilidade-estado",
    },

    "direito-constitucional": {
        # Art. 5º inteiro é "direitos e garantias fundamentais"; os incisos
        # avulsos são recortes dele, não tópicos irmãos.
        "direitos-fundamentais-art5": "direitos-garantias",
        "inviolabilidade-domicilio": "direitos-garantias",
        "liberdade-expressao": "direitos-garantias",
        "direito-reuniao": "direitos-garantias",
        "devido-processo-legal": "direitos-garantias",
        "presuncao-inocencia": "direitos-garantias",
        "provas-ilicitas": "direitos-garantias",
        "prisao-direitos-preso": "direitos-garantias",
        "objetivos-fundamentais": "principios-fundamentais",
        "organizacao-estado-federacao": "organizacao-estado",
        "competencia-legislativa-uniao": "organizacao-estado",
        "competencia-legislativa-concorrente": "organizacao-estado",
        "intervencao-federal": "organizacao-estado",
        "seguranca-publica-art144": "seguranca-publica",
        "policia-militar-competencia": "seguranca-publica",
        "tribunais-militares-estaduais": "poder-judiciario",
        "atribuicoes-presidente": "poder-executivo",
        "habeas-corpus": "remedios-constitucionais",
        "mandado-de-seguranca": "remedios-constitucionais",
        "nacionalidade": "direitos-politicos-nacionalidade",
        "cargos-privativos-brasileiro-nato": "direitos-politicos-nacionalidade",
        "direitos-politicos": "direitos-politicos-nacionalidade",
        "estado-defesa-sitio": "defesa-estado",
    },

    "direito-penal": {
        "principio-da-legalidade": "principios-penal",
        "principio-da-anterioridade": "principios-penal",
        "irretroatividade-da-lei-penal": "aplicacao-lei-penal",
        # Teoria do crime: fato típico, dolo, culpa, tentativa e iter criminis
        # são etapas do mesmo tópico, não tópicos separados.
        "fato-tipico": "crime",
        "crime-doloso": "crime",
        "crime-culposo": "crime",
        "dolo-eventual-culpa-consciente": "crime",
        "tentativa": "crime",
        "consumacao-iter-criminis": "crime",
        "desistencia-voluntaria-arrependimento-eficaz": "crime",
        "ilicitude": "excludentes-ilicitude",
        "legitima-defesa": "excludentes-ilicitude",
        "estado-de-necessidade": "excludentes-ilicitude",
        "excludente-culpabilidade": "culpabilidade",
        "concurso-de-pessoas": "concurso-pessoas",
        "concurso-de-pessoas-comunicabilidade": "concurso-pessoas",
        # Concurso de crimes é dosimetria — Título V, aplicação da pena.
        "concurso-de-crimes": "penas",
        "penas-especies": "penas",
        "penas-aplicacao": "penas",
        "homicidio": "crimes-pessoa",
        "lesao-corporal": "crimes-pessoa",
        "furto": "crimes-patrimonio",
        "roubo": "crimes-patrimonio",
        "peculato": "crimes-adm-publica",
        "crimes-contra-administracao-publica": "crimes-adm-publica",
    },

    "direito-penal-militar": {
        "aplicacao-lei": "aplicacao-lei-penal-militar",
        "crime-militar-conceito": "crime-militar",
        # Próprio/impróprio é classificação do crime militar, não espécie.
        "crimes-militares-proprios": "crime-militar",
        "jurisdicao-militar-estadual": "crime-militar",
        "responsabilidade-penal": "crime-militar",
        "tentativa": "crime-militar",
        "concurso-pessoas": "crime-militar",
        "exclusao-ilicitude": "crime-militar",
        "obediencia-hierarquica": "crime-militar",
        "penas": "penas-militares",
        "prescricao": "penas-militares",
        "crimes-contra-hierarquia": "crimes-hierarquia-disciplina",
        "insubordinacao": "crimes-hierarquia-disciplina",
        "violencia-contra-superior-inferior": "crimes-hierarquia-disciplina",
        "crimes-contra-servico": "crimes-servico-dever",
        "desercao": "crimes-servico-dever",
        "crimes-contra-administracao": "crimes-adm-militar",
        "crimes-contra-ordem-administrativa": "crimes-adm-militar",
        "crimes-contra-ordem": "crimes-adm-militar",
        "peculato-militar": "crimes-adm-militar",
        "crimes-contra-pessoa": "crimes-militares-especie",
        "crimes-contra-propriedade": "crimes-militares-especie",
        "crimes-contra-honra": "crimes-militares-especie",
        "crimes-contra-seguranca-nacional": "crimes-militares-especie",
    },

    "direito-processual-penal": {
        "inquerito-policial-instauracao": "inquerito-policial",
        "inquerito-policial-prazo": "inquerito-policial",
        "acao-penal-publica": "acao-penal",
        "acao-penal-privada": "acao-penal",
        # Toda modalidade de prisão cautelar e sua contrapartida em liberdade
        # cai no mesmo tópico do edital.
        "prisao-em-flagrante": "prisao-liberdade",
        "prisao-em-flagrante-formalidades": "prisao-liberdade",
        "prisao-preventiva": "prisao-liberdade",
        "prisao-preventiva-hipoteses": "prisao-liberdade",
        "prisao-temporaria": "prisao-liberdade",
        "liberdade-provisoria": "prisao-liberdade",
        "relaxamento-prisao": "prisao-liberdade",
        "audiencia-custodia": "prisao-liberdade",
        "medidas-cautelares-diversas": "prisao-liberdade",
        "provas-conceito": "provas",
        "provas-ilicitas-processo-penal": "provas",
        "provas-exame-corpo-delito": "provas",
        "interceptacao-telefonica": "provas",
        "competencia-ratione-materiae": "competencia-cpp",
        "competencia-territorial": "competencia-cpp",
        "principio-juiz-natural": "competencia-cpp",
        "citacao": "citacao-intimacao",
        "intimacao": "citacao-intimacao",
        # HC é ação autônoma de impugnação — anda com os recursos.
        "habeas-corpus-processual": "recursos-cpp",
        "habeas-corpus-hipoteses": "recursos-cpp",
    },

    "direito-processual-penal-militar": {
        "inquerito-policial-militar": "ipm",
        "competencia": "competencia-justica-militar",
        "competencia-justica-militar": "competencia-justica-militar",
        "competencia-stm": "competencia-justica-militar",
        "jurisdicao-competencia": "competencia-justica-militar",
        "conselho-justica": "competencia-justica-militar",
        "acao-penal": "acao-penal-militar",
        "acao-penal-militar": "acao-penal-militar",
        "prisao-flagrante": "prisao-liberdade-militar",
        "prisao-preventiva": "prisao-liberdade-militar",
        "prisao-liberdade-provisoria": "prisao-liberdade-militar",
        "liberdade-provisoria": "prisao-liberdade-militar",
        "provas": "provas-cppm",
        "recursos": "recursos-cppm",
        "apelacao": "recursos-cppm",
        "habeas-corpus": "recursos-cppm",
        "revisao-criminal": "recursos-cppm",
        "rito-processual": "processo-penal-militar-geral",
        "nulidades": "processo-penal-militar-geral",
        "absolvicao-sumaria": "processo-penal-militar-geral",
        "execucao-penal": "processo-penal-militar-geral",
        "extincao-punibilidade": "processo-penal-militar-geral",
        "exclusao-ilicitude": "processo-penal-militar-geral",
    },

    "legislacao-especial": {
        "lei-maria-da-penha": "maria-penha",
        "lei-tortura": "lei-tortura",
        # `codigo-consumidor` fica FORA de propósito: CDC não é conteúdo do
        # edital de Soldado PMGO. Sem tópico é a classificação honesta.
    },

    "legislacao-institucional-pm": {
        "estatuto-militares-goias": "estatuto-militares-go",
        "regime-juridico-militar": "estatuto-militares-go",
        "direitos-policial-militar": "estatuto-militares-go",
        "deveres-obrigacoes": "estatuto-militares-go",
        "lei-organica-pm-goias": "organizacao-pmgo",
        "postos-graduacoes-pm": "organizacao-pmgo",
        "missao-valores-pm": "organizacao-pmgo",
        "hierarquia-disciplina-pm": "hierarquia-disciplina",
        "transgressoes-disciplinares": "regulamento-disciplinar-pmgo",
    },

    "lingua-portuguesa": {
        "interpretacao-textual": "interpretacao-textos",
        "compreensao-textual": "interpretacao-textos",
        "concordancia-verbal-nominal": "concordancia",
        "regencia-verbal-nominal": "regencia",
        "classes-de-palavras": "classes-palavras",
        # Estes quatro NÃO tinham correspondente e ganharam tópico próprio —
        # ortografia não é pontuação, e coesão não é concordância.
        "ortografia-acentuacao": "ortografia-acentuacao",
        "crase": "crase",
        "coesao-coerencia": "coesao-coerencia",
        "sintaxe-periodo": "sintaxe-periodo",
    },

    "realidade-goias": {
        "historia": "historia-goias",
        "patrimonio-historico": "historia-goias",
        "geografia": "geografia-goias",
        "hidrografia": "geografia-goias",
        "bioma": "geografia-goias",
        "fronteiras": "geografia-goias",
        "regioes-administrativa": "geografia-goias",
        "economia": "economia-goias",
        "agronegocio": "economia-goias",
        "mineracao": "economia-goias",
        "turismo": "economia-goias",
        "infraestrutura": "economia-goias",
        "cultura": "cultura-sociedade-goiana",
        "cultura-goiana": "cultura-sociedade-goiana",
        "populacao": "cultura-sociedade-goiana",
        "esporte": "cultura-sociedade-goiana",
        "politica": "politica-organizacao-go",
        "politica-organizacao-estado": "politica-organizacao-go",
        "constituicao-estadual": "politica-organizacao-go",
        "constituicao-estadual-goias": "politica-organizacao-go",
        "judiciario": "politica-organizacao-go",
        "seguranca-publica": "seguranca-publica-go",
        "pmgo-estrutura": "seguranca-publica-go",
        "policiamento": "seguranca-publica-go",
        "direitos-humanos-pmgo": "seguranca-publica-go",
    },
}


def resolve_topic_slug(subject_slug: str | None, topic_slug: str | None) -> str | None:
    """Slug do edital para o que veio no arquivo. Devolve o próprio slug quando
    não há apelido — quem valida se ele existe é o seeder, contra TOPICS."""
    if not topic_slug or not subject_slug:
        return topic_slug
    return TOPIC_ALIASES.get(subject_slug, {}).get(topic_slug, topic_slug)
