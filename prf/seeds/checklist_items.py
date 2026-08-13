"""
Checklist das fases eliminatórias além da prova objetiva e da redação.

Itens comuns a concursos de Polícia Militar — não são a lista oficial do
próximo edital PMGO (ainda não publicado). Confira a lista exata e os prazos
no edital quando ele sair; isto é um ponto de partida pra não descobrir em
cima da hora que falta um documento.
"""
from __future__ import annotations

CHECKLIST_ITEMS = [
    # ── Investigação social ──────────────────────────────────────────────
    {
        "key": "investigacao_antecedentes_estadual",
        "category": "investigacao_social",
        "title": "Certidão de antecedentes criminais (estadual)",
        "description": "Emitida pela Secretaria de Segurança Pública do seu estado. Costuma ter validade curta — não tire com muita antecedência.",
    },
    {
        "key": "investigacao_antecedentes_federal",
        "category": "investigacao_social",
        "title": "Certidão de antecedentes criminais (Polícia Federal)",
        "description": "Emitida pelo site da Polícia Federal.",
    },
    {
        "key": "investigacao_distribuicao_civel_criminal",
        "category": "investigacao_social",
        "title": "Certidão de distribuição cível e criminal (Justiça Estadual e Federal)",
        "description": "Confirme no edital se pede 1º e 2º grau, e se cobre todos os estados em que você já residiu.",
    },
    {
        "key": "investigacao_quitacao_eleitoral",
        "category": "investigacao_social",
        "title": "Certidão de quitação eleitoral",
        "description": "Emitida pelo site do TSE.",
    },
    {
        "key": "investigacao_folha_militar",
        "category": "investigacao_social",
        "title": "Certidão de situação militar (se aplicável)",
        "description": "Se você já serviu ou tem obrigações militares pendentes, reúna a documentação correspondente.",
    },
    {
        "key": "investigacao_comprovante_residencia",
        "category": "investigacao_social",
        "title": "Comprovante de residência atualizado",
        "description": "Costuma ser pedido com poucos meses de emissão — deixe pra providenciar perto da data.",
    },
    {
        "key": "investigacao_ficha_social",
        "category": "investigacao_social",
        "title": "Formulário / ficha de investigação social preenchido",
        "description": "Muitos editais pedem histórico de endereços, empregos e referências dos últimos anos — vale já ir organizando essa linha do tempo.",
    },

    # ── Exame psicotécnico ───────────────────────────────────────────────
    {
        "key": "psicotecnico_documento",
        "category": "psicotecnico",
        "title": "Documento de identidade original em dia",
        "description": "Confirme se o edital aceita apenas RG ou também CNH/carteira de trabalho digital.",
    },
    {
        "key": "psicotecnico_descanso",
        "category": "psicotecnico",
        "title": "Noite de sono regular antes do exame",
        "description": "Não dá pra 'estudar' pra parte de personalidade — descanso e regularidade nos dias anteriores é a orientação mais comum.",
    },
    {
        "key": "psicotecnico_recurso",
        "category": "psicotecnico",
        "title": "Saber o prazo de recurso caso seja considerado inapto",
        "description": "O prazo costuma ser curto (poucos dias úteis) — confirme no edital assim que ele sair pra não perder o prazo se precisar recorrer.",
    },

    # ── Exame médico ─────────────────────────────────────────────────────
    {
        "key": "medica_exames_basicos",
        "category": "medica",
        "title": "Exames pré-admissionais básicos em dia",
        "description": "Hemograma, exame de vista, audiometria e eletrocardiograma costumam aparecer — confirme a lista exata e a validade de cada um no edital.",
    },
    {
        "key": "medica_avaliacao_odontologica",
        "category": "medica",
        "title": "Avaliação odontológica",
        "description": "Alguns editais de PM incluem exame odontológico na fase médica.",
    },
    {
        "key": "medica_tatuagens",
        "category": "medica",
        "title": "Checar critério de tatuagens/piercings do edital",
        "description": "Editais de PM costumam ter regras específicas sobre localização e conteúdo de tatuagens visíveis — vale conferir antes, não depois.",
    },
]
