export const MAX_TOOLS: Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}> = [
  {
    type: "function",
    function: {
      name: "registrar_transacao",
      description:
        "Registra uma nova transacao financeira (receita ou despesa). Use sempre que Pedro informar um gasto ou recebimento.",
      parameters: {
        type: "object",
        properties: {
          tipo: {
            type: "string",
            enum: ["receita", "despesa"],
            description: "Tipo da transacao",
          },
          valor: {
            type: "number",
            description: "Valor da transacao (positivo)",
          },
          descricao: {
            type: "string",
            description: "Descricao curta da transacao",
          },
          categoria: {
            type: "string",
            enum: [
              "Moradia",
              "Transporte",
              "Alimentação",
              "Saúde",
              "Lazer",
              "Vestuário",
              "Assinaturas",
              "Negócios",
              "Dívidas/Parcelas",
              "Fornecedor",
              "Marketing",
              "Salário",
              "Renda Variável",
              "Outros",
            ],
            description: "Categoria da transacao",
          },
          tipo_negocio: {
            type: "string",
            enum: ["pessoal", "vendedoria", "lukaizen", "geral"],
            description: "Qual negocio/ambito se refere",
          },
          data: {
            type: "string",
            description:
              "Data em que a transacao ocorreu, formato YYYY-MM-DD. OBRIGATORIO: sempre infira a data da mensagem do usuario (hoje, ontem, segunda, etc). Use a data de hoje se nao houver indicacao.",
          },
          empresa: {
            type: "string",
            description:
              "Empresa ou estabelecimento relacionado (opcional)",
          },
        },
        required: ["tipo", "valor", "descricao", "categoria", "tipo_negocio"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "desfazer_ultima",
      description:
        "Desfaz (exclui) a ultima transacao registrada, ou uma transacao especifica por ID.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "ID da transacao a excluir. Se omitido, exclui a mais recente.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "criar_lembrete",
      description:
        "Cria um lembrete para Pedro com data e hora especifica. Pode ser recorrente.",
      parameters: {
        type: "object",
        properties: {
          descricao: {
            type: "string",
            description: "Descricao do lembrete",
          },
          data_hora: {
            type: "string",
            description:
              "Data e hora do lembrete em formato ISO 8601 (horario de Brasilia)",
          },
          recorrente: {
            type: "boolean",
            description: "Se o lembrete se repete",
          },
          frequencia: {
            type: "string",
            enum: ["diario", "semanal", "mensal"],
            description: "Frequencia de recorrencia (se recorrente=true)",
          },
        },
        required: ["descricao", "data_hora"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_financas",
      description:
        "Consulta resumo financeiro de um periodo: receitas, despesas e saldo.",
      parameters: {
        type: "object",
        properties: {
          periodo: {
            type: "string",
            enum: ["hoje", "ontem", "semana", "mes", "mes_passado"],
            description: "Periodo da consulta",
          },
          tipo_negocio: {
            type: "string",
            enum: ["pessoal", "vendedoria", "lukaizen", "geral"],
            description: "Filtrar por tipo de negocio",
          },
          categoria: {
            type: "string",
            description: "Filtrar por categoria",
          },
        },
        required: ["periodo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "salvar_informacao",
      description:
        "Salva uma informacao importante sobre Pedro no contexto permanente (preferencias, dados pessoais, metas, etc).",
      parameters: {
        type: "object",
        properties: {
          chave: {
            type: "string",
            description:
              "Chave unica para identificar a informacao (ex: salario_vendedoria, meta_2025)",
          },
          valor: {
            type: "string",
            description: "Valor/conteudo da informacao",
          },
          categoria: {
            type: "string",
            enum: [
              "financeiro",
              "negocio",
              "pessoal",
              "meta",
              "contato",
              "rotina",
              "outros",
            ],
            description: "Categoria da informacao",
          },
        },
        required: ["chave", "valor", "categoria"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_lembretes",
      description: "Lista os proximos lembretes pendentes de Pedro.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_na_web",
      description:
        "Busca informacoes atualizadas na internet sobre qualquer assunto.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: "Termo ou pergunta para buscar na web",
          },
        },
        required: ["consulta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analise_profunda",
      description:
        "Realiza uma analise financeira profunda usando um modelo mais avancado. Usa para perguntas complexas, projecoes ou conselhos financeiros detalhados.",
      parameters: {
        type: "object",
        properties: {
          pergunta: {
            type: "string",
            description:
              "Pergunta ou topico para analise profunda",
          },
        },
        required: ["pergunta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerenciar_divida",
      description:
        "Gerencia dividas: listar dividas ativas, registrar pagamento de parcela ou quitar divida.",
      parameters: {
        type: "object",
        properties: {
          acao: {
            type: "string",
            enum: ["listar", "pagar_parcela", "quitar"],
            description: "Acao a executar",
          },
          id: {
            type: "string",
            description: "ID da divida (necessario para pagar_parcela e quitar)",
          },
          valor: {
            type: "number",
            description:
              "Valor do pagamento da parcela (obrigatorio para pagar_parcela)",
          },
        },
        required: ["acao"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerenciar_receita_prevista",
      description:
        "Gerencia receitas previstas (a receber): criar, listar ou confirmar recebimento.",
      parameters: {
        type: "object",
        properties: {
          acao: {
            type: "string",
            enum: ["criar", "listar", "confirmar"],
            description: "Acao a executar",
          },
          id: {
            type: "string",
            description: "ID da receita prevista (para confirmar)",
          },
          descricao: {
            type: "string",
            description: "Descricao da receita (para criar)",
          },
          valor: {
            type: "number",
            description: "Valor previsto (para criar)",
          },
          data_prevista: {
            type: "string",
            description: "Data prevista YYYY-MM-DD (para criar)",
          },
          cliente: {
            type: "string",
            description: "Nome do cliente (para criar)",
          },
          tipo_negocio: {
            type: "string",
            enum: ["pessoal", "vendedoria", "lukaizen", "geral"],
            description: "Tipo de negocio",
          },
        },
        required: ["acao"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_transacoes",
      description:
        "Busca transacoes com filtros avancados. Retorna com IDs para permitir edicao/exclusao.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: {
            type: "string",
            description: "Data inicio YYYY-MM-DD",
          },
          data_fim: {
            type: "string",
            description: "Data fim YYYY-MM-DD",
          },
          texto: {
            type: "string",
            description:
              "Busca por texto na descricao ou empresa (case-insensitive)",
          },
          categoria: {
            type: "string",
            description: "Filtrar por categoria",
          },
          tipo: {
            type: "string",
            enum: ["receita", "despesa"],
            description: "Filtrar por tipo",
          },
          tipo_negocio: {
            type: "string",
            enum: ["pessoal", "vendedoria", "lukaizen", "geral"],
            description: "Filtrar por tipo de negocio",
          },
          limite: {
            type: "number",
            description: "Maximo de resultados (default 30, max 100)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "editar_transacao",
      description:
        "Edita campos de uma transacao existente pelo ID.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID da transacao a editar",
          },
          valor: { type: "number", description: "Novo valor" },
          descricao: { type: "string", description: "Nova descricao" },
          categoria: { type: "string", description: "Nova categoria" },
          tipo: {
            type: "string",
            enum: ["receita", "despesa"],
            description: "Novo tipo",
          },
          tipo_negocio: {
            type: "string",
            enum: ["pessoal", "vendedoria", "lukaizen", "geral"],
            description: "Novo tipo de negocio",
          },
          data_transacao: {
            type: "string",
            description: "Nova data YYYY-MM-DD (recalcula o campo mes)",
          },
          empresa: { type: "string", description: "Nova empresa" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "excluir_transacao",
      description: "Exclui permanentemente uma transacao pelo ID.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID da transacao a excluir",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerar_extrato",
      description:
        "Gera extrato detalhado completo de um periodo. Retorna linha a linha com totais por categoria e resumo final. O agente deve repassar o extrato integralmente.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: {
            type: "string",
            description: "Data inicio YYYY-MM-DD",
          },
          data_fim: {
            type: "string",
            description: "Data fim YYYY-MM-DD",
          },
          tipo_negocio: {
            type: "string",
            enum: ["pessoal", "vendedoria", "lukaizen", "geral"],
            description: "Filtrar por tipo de negocio",
          },
          categoria: {
            type: "string",
            description: "Filtrar por categoria",
          },
        },
        required: ["data_inicio", "data_fim"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerenciar_conta_pagar",
      description:
        "Gerencia contas a pagar: criar, listar pendentes, pagar ou cancelar.",
      parameters: {
        type: "object",
        properties: {
          acao: {
            type: "string",
            enum: ["criar", "listar", "pagar", "cancelar"],
            description: "Acao a executar",
          },
          id: {
            type: "string",
            description: "ID da conta (para pagar/cancelar)",
          },
          descricao: { type: "string", description: "Descricao da conta" },
          valor: { type: "number", description: "Valor da conta" },
          data_vencimento: {
            type: "string",
            description: "Data de vencimento YYYY-MM-DD",
          },
          categoria: {
            type: "string",
            description: "Categoria da conta",
          },
          tipo_negocio: {
            type: "string",
            enum: ["pessoal", "vendedoria", "lukaizen", "geral"],
            description: "Tipo de negocio",
          },
          recorrente: {
            type: "boolean",
            description: "Se a conta e recorrente",
          },
          frequencia: {
            type: "string",
            enum: ["semanal", "mensal", "anual"],
            description: "Frequencia de recorrencia",
          },
        },
        required: ["acao"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerenciar_orcamento",
      description:
        "Gerencia orcamentos mensais por categoria: definir limite, listar com gasto atual ou remover.",
      parameters: {
        type: "object",
        properties: {
          acao: {
            type: "string",
            enum: ["definir", "listar", "remover"],
            description: "Acao a executar",
          },
          categoria: {
            type: "string",
            description: "Categoria do orcamento",
          },
          limite_mensal: {
            type: "number",
            description: "Limite mensal em reais",
          },
        },
        required: ["acao"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "projecao_caixa",
      description:
        "Faz uma projecao de fluxo de caixa para os proximos dias, considerando receitas previstas, contas a pagar e taxa diaria de gastos.",
      parameters: {
        type: "object",
        properties: {
          dias: {
            type: "number",
            description:
              "Numero de dias para projetar (default 30, max 60)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerenciar_tarefa",
      description:
        "Gerencia tarefas recorrentes e cobranças de Pedro: criar, listar, concluir, cancelar ou registrar resposta.",
      parameters: {
        type: "object",
        properties: {
          acao: {
            type: "string",
            enum: [
              "criar",
              "listar",
              "concluir",
              "cancelar",
              "registrar_resposta",
            ],
            description: "Acao a executar",
          },
          id: {
            type: "string",
            description: "ID da tarefa",
          },
          descricao: {
            type: "string",
            description: "Descricao da tarefa (para criar)",
          },
          proxima_cobranca: {
            type: "string",
            description: "Data/hora ISO da proxima cobranca",
          },
          recorrente: {
            type: "boolean",
            description: "Se a tarefa e recorrente",
          },
          frequencia: {
            type: "string",
            enum: ["diario", "semanal", "mensal"],
            description: "Frequencia de recorrencia",
          },
          resposta: {
            type: "string",
            description:
              "Resposta de Pedro a registrar no historico (para registrar_resposta)",
          },
        },
        required: ["acao"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerenciar_agenda",
      description:
        "Gerencia a agenda de Pedro no Google Calendar: criar eventos, listar proximos compromissos, verificar disponibilidade ou cancelar eventos.",
      parameters: {
        type: "object",
        properties: {
          acao: {
            type: "string",
            enum: ["criar_evento", "listar_eventos", "ver_disponibilidade", "cancelar_evento"],
            description: "Acao a executar na agenda",
          },
          titulo: {
            type: "string",
            description: "Titulo do evento (para criar_evento)",
          },
          data_hora: {
            type: "string",
            description: "Data e hora do evento em formato ISO 8601 com horario de Brasilia (ex: 2026-07-15T14:00:00). OBRIGATORIO para criar_evento.",
          },
          duracao_minutos: {
            type: "number",
            description: "Duracao do evento em minutos (default 30)",
          },
          descricao: {
            type: "string",
            description: "Descricao ou notas do evento (opcional)",
          },
          google_meet: {
            type: "boolean",
            description: "Se true, gera um link do Google Meet automaticamente (default false)",
          },
          dias: {
            type: "number",
            description: "Numero de dias futuros para listar eventos (default 7, para listar_eventos)",
          },
          quantidade: {
            type: "number",
            description: "Quantidade de slots disponiveis para retornar (default 5, para ver_disponibilidade)",
          },
          id: {
            type: "string",
            description: "ID do evento (para cancelar_evento)",
          },
        },
        required: ["acao"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_crm",
      description:
        "Consulta dados do CRM da Vendedoria: vendas, leads, clientes, qualidade dos leads e metricas de negocio.",
      parameters: {
        type: "object",
        properties: {
          pergunta: {
            type: "string",
            description:
              "Pergunta sobre o CRM em texto livre (ex: 'quantas vendas hoje?', 'resumo de leads')",
          },
        },
        required: ["pergunta"],
      },
    },
  },
];
