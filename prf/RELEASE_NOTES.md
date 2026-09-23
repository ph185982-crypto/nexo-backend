# Atualização de setembro de 2026

- Progresso do navegador conectado a histórico, caderno de erros, revisão espaçada, trilha, calendário e sessões de estudo.
- Backup JSON, prévia da restauração, cópia anterior para desfazer e rascunhos de redação.
- Áudio com roteiro e partes concluídas salvos em IndexedDB para retomar a geração; alerta se o armazenamento falhar.
- Interface responsiva, navegação lateral, busca de matérias, foco por teclado e zoom permitido.
- Rotas locais iniciam sem tentar conectar ao banco suspenso. Lembrete exportado para calendário; não depende de notificações do servidor.
- JWT sem segredo público padrão, limitação de geração por instância, autenticação e limites de tamanho nos endpoints de áudio, erros sem detalhes do provedor e remoção de senhas dos scripts atuais.
- Painel mostra acertos observados em vez de previsão de aprovação. Matérias complementares identificadas; missão e trilha seguem o modelo do simulado.
- Referência de prova: PMGO Soldado 002/2022, tabela 8.1 e item 8.5; redação na tabela 11.2 (cinco critérios de 5 pontos). Fonte: https://goias.gov.br/escoladegoverno/wp-content/uploads/sites/28/2022/04/171122-EdPM002Retificado-61c.pdf

## Validação

`python -m unittest prf.local.test_tools prf.local.test_entrypoint -v`

`node --test prf/static/study-state.test.cjs`

Teste visual em computador e celular (390 px): navegação, filtro, resposta, histórico persistido após recarregar, revisão e tela de backup.

## Limites que continuam explícitos

- O progresso não sincroniza automaticamente. O backup é necessário para transferir entre aparelhos; áudios não entram no JSON.
- Verificação estrutural do banco de questões não é revisão humana de cada enunciado, gabarito ou atualização legislativa.
- A escala de treino não confirma aprovação, classificação, aptidão física nem adequação a um novo edital.
- A limitação de IA é por instância em execução. Uma abertura ampla ao público requer limite distribuído e orçamento no provedor.
- A remoção de senhas não apaga cópias no histórico público. A credencial de banco exposta precisa ser revogada/rotacionada pelo responsável pela conta.
- A integração real com a chave local retornou HTTP 429 `credit_balance_exhausted` em 23/09/2026. As chamadas de IA precisam de saldo; uma chave nova na Vercel exige nova implantação para entrar em vigor.
