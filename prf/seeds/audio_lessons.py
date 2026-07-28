"""
Audio lesson scripts for commute/audiobook mode.

Each entry is a spoken-word study summary written for text-to-speech playback:
short sentences, explicit article citations, no visual references. Durations are
estimated at ~150 words per minute of Brazilian Portuguese narration.
"""
from __future__ import annotations

AUDIO_LESSONS = [
    # ── Legislação de Trânsito (peso 3.0 — Bloco II inteiro) ──────────────────
    {
        "subject_slug": "legislacao-transito",
        "title": "CTB: princípios e o direito ao trânsito seguro",
        "description": "Artigos 1º ao 4º do Código de Trânsito Brasileiro",
        "lesson_type": "summary",
        "difficulty": "easy",
        "display_order": 1,
        "duration_secs": 200,
        "script": (
            "Vamos começar pelos fundamentos do Código de Trânsito Brasileiro, a Lei nove mil "
            "quinhentos e três, de mil novecentos e noventa e sete. "
            "O artigo primeiro estabelece que o trânsito de qualquer natureza nas vias terrestres "
            "do território nacional é regido por este Código. "
            "Atenção ao parágrafo segundo: o trânsito em condições seguras é um direito de todos "
            "e um dever dos órgãos do Sistema Nacional de Trânsito. Essa expressão, direito de todos "
            "e dever dos órgãos, cai muito em prova. "
            "O parágrafo terceiro é ainda mais cobrado. Ele diz que os órgãos e entidades do Sistema "
            "Nacional de Trânsito respondem objetivamente por danos causados aos cidadãos em virtude "
            "de ação, omissão ou erro na execução e manutenção de programas, projetos e serviços que "
            "garantam o exercício do direito do trânsito seguro. Repare: responsabilidade objetiva. "
            "Não se discute culpa. "
            "O artigo segundo define via como a superfície por onde transitam veículos, pessoas e animais. "
            "Compreende a pista, a calçada, o acostamento, a ilha e o canteiro central. "
            "O parágrafo único equipara às vias terrestres as praias abertas à circulação pública, "
            "as vias internas dos condomínios e as vias e áreas de estacionamento de estabelecimentos "
            "privados de uso coletivo. Esse ponto é clássico em questões. "
            "O artigo terceiro trata da abrangência do Sistema Nacional de Trânsito em todo o território nacional. "
            "E o artigo quarto determina que os conceitos e definições estabelecidos no Anexo Um "
            "são de uso obrigatório em todo o território nacional."
        ),
    },
    {
        "subject_slug": "legislacao-transito",
        "title": "Infrações de trânsito: natureza, gravidade e penalidades",
        "description": "Artigos 161 a 259 — classificação e pontuação",
        "lesson_type": "deep_dive",
        "difficulty": "medium",
        "display_order": 2,
        "duration_secs": 240,
        "script": (
            "Agora vamos às infrações de trânsito. O artigo cento e sessenta e um define infração "
            "como a inobservância a qualquer preceito do Código, da legislação complementar ou das "
            "resoluções do CONTRAN. O infrator fica sujeito às penalidades e medidas administrativas indicadas. "
            "As infrações classificam-se em quatro graus, conforme o artigo cento e sessenta e dois "
            "e seguintes. Grave a pontuação, porque isso é cobrado direto. "
            "Infração leve: três pontos. Multa no valor de oitenta e oito reais e trinta e oito centavos. "
            "Infração média: quatro pontos. Multa de cento e trinta reais e dezesseis centavos. "
            "Infração grave: cinco pontos. Multa de cento e noventa e cinco reais e vinte e três centavos. "
            "Infração gravíssima: sete pontos. Multa de duzentos e noventa e três reais e quarenta e sete centavos. "
            "Memorize a sequência três, quatro, cinco, sete. "
            "As penalidades estão no artigo duzentos e cinquenta e seis: advertência por escrito, multa, "
            "suspensão do direito de dirigir, cassação da Carteira Nacional de Habilitação, cassação da "
            "permissão para dirigir e frequência obrigatória em curso de reciclagem. "
            "Cuidado com uma pegadinha comum. Apreensão do veículo e remoção do veículo não são penalidades. "
            "São medidas administrativas, previstas no artigo duzentos e sessenta e nove. "
            "A banca troca esses conceitos com frequência. "
            "Sobre a suspensão do direito de dirigir, o artigo duzentos e sessenta e um estabelece que ela "
            "se aplica quando o infrator atingir vinte pontos no período de doze meses, ou quando houver "
            "previsão específica de suspensão para aquela infração."
        ),
    },
    {
        "subject_slug": "legislacao-transito",
        "title": "Crimes de trânsito: embriaguez, homicídio culposo e fuga",
        "description": "Artigos 291 a 312 do CTB",
        "lesson_type": "deep_dive",
        "difficulty": "hard",
        "display_order": 3,
        "duration_secs": 230,
        "script": (
            "Vamos aos crimes de trânsito, capítulo dezenove do Código, artigos duzentos e noventa e um "
            "em diante. Esse tema é decisivo para a prova da PRF. "
            "O artigo trezentos e dois trata do homicídio culposo na direção de veículo automotor. "
            "Pena: detenção de dois a quatro anos, e suspensão ou proibição de se obter a permissão ou "
            "habilitação para dirigir. "
            "O parágrafo terceiro é qualificado: se o agente conduzir sob influência de álcool ou de "
            "qualquer outra substância psicoativa que determine dependência, a pena é de reclusão de "
            "cinco a oito anos. Note a mudança: de detenção para reclusão, e a pena praticamente dobra. "
            "O artigo trezentos e três trata da lesão corporal culposa na direção. Pena de detenção de "
            "seis meses a dois anos. Se houver embriaguez e a lesão for grave ou gravíssima, a pena passa "
            "a reclusão de dois a cinco anos. "
            "O artigo trezentos e cinco trata do afastamento do local do acidente para fugir à "
            "responsabilidade civil ou penal. Pena: detenção de seis meses a um ano. "
            "O artigo trezentos e seis é a embriaguez ao volante. Conduzir com capacidade psicomotora "
            "alterada em razão da influência de álcool ou outra substância psicoativa. "
            "Pena: detenção de seis meses a três anos, multa e suspensão ou proibição de obter a habilitação. "
            "O parágrafo primeiro define as duas formas de comprovação. Primeira: concentração igual ou "
            "superior a seis decigramas de álcool por litro de sangue, ou zero vírgula três miligramas por "
            "litro de ar alveolar. Segunda: sinais que indiquem alteração da capacidade psicomotora. "
            "E atenção ao parágrafo segundo: a verificação pode ser obtida por teste de alcoolemia, exame "
            "clínico, perícia, vídeo, prova testemunhal ou outros meios de prova em direito admitidos. "
            "Ou seja, a recusa ao bafômetro não impede a caracterização do crime."
        ),
    },
    # ── Direito Constitucional ────────────────────────────────────────────────
    {
        "subject_slug": "direito-constitucional",
        "title": "Direitos e garantias fundamentais: artigo 5º essencial",
        "description": "Principais incisos do artigo 5º da CF/88",
        "lesson_type": "summary",
        "difficulty": "medium",
        "display_order": 10,
        "duration_secs": 250,
        "script": (
            "Vamos revisar o artigo quinto da Constituição Federal, o coração dos direitos fundamentais. "
            "O caput garante a todos, brasileiros e estrangeiros residentes no País, a inviolabilidade do "
            "direito à vida, à liberdade, à igualdade, à segurança e à propriedade. "
            "O inciso segundo traz o princípio da legalidade: ninguém será obrigado a fazer ou deixar de "
            "fazer alguma coisa senão em virtude de lei. "
            "O inciso terceiro veda a tortura e o tratamento desumano ou degradante. "
            "O inciso décimo primeiro é crucial para a atividade policial. A casa é asilo inviolável do "
            "indivíduo. Ninguém nela pode penetrar sem consentimento do morador. As exceções são apenas quatro: "
            "flagrante delito, desastre, para prestar socorro, ou, durante o dia, por determinação judicial. "
            "Repare que flagrante, desastre e socorro valem a qualquer hora. Só a ordem judicial exige que "
            "seja durante o dia. "
            "O inciso décimo segundo trata do sigilo das comunicações. É inviolável o sigilo da correspondência "
            "e das comunicações telegráficas, de dados e das comunicações telefônicas. A exceção é a última "
            "hipótese: por ordem judicial, nas hipóteses e na forma que a lei estabelecer, para fins de "
            "investigação criminal ou instrução processual penal. "
            "O inciso quinquagésimo sétimo consagra a presunção de inocência. Ninguém será considerado culpado "
            "até o trânsito em julgado de sentença penal condenatória. "
            "O inciso sexagésimo terceiro traz o direito ao silêncio. O preso será informado de seus direitos, "
            "entre os quais o de permanecer calado, sendo-lhe assegurada a assistência da família e de advogado. "
            "E o inciso sexagésimo primeiro: ninguém será preso senão em flagrante delito ou por ordem escrita "
            "e fundamentada de autoridade judiciária competente, salvo nos casos de transgressão militar ou "
            "crime propriamente militar."
        ),
    },
    {
        "subject_slug": "direito-constitucional",
        "title": "Segurança pública e a competência da PRF",
        "description": "Artigo 144 da Constituição Federal",
        "lesson_type": "summary",
        "difficulty": "easy",
        "display_order": 11,
        "duration_secs": 180,
        "script": (
            "O artigo cento e quarenta e quatro da Constituição é obrigatório para quem presta concurso da PRF. "
            "A segurança pública, dever do Estado, direito e responsabilidade de todos, é exercida para a "
            "preservação da ordem pública e da incolumidade das pessoas e do patrimônio. "
            "São órgãos de segurança pública: polícia federal, polícia rodoviária federal, polícia ferroviária "
            "federal, polícias civis, polícias militares e corpos de bombeiros militares, e as polícias penais "
            "federal, estaduais e distrital. "
            "Guarde o parágrafo segundo, que é o dispositivo específico da PRF. A polícia rodoviária federal, "
            "órgão permanente, organizado e mantido pela União e estruturado em carreira, destina-se, na forma "
            "da lei, ao patrulhamento ostensivo das rodovias federais. "
            "Três palavras merecem destaque: órgão permanente, estruturado em carreira, e patrulhamento ostensivo. "
            "A banca costuma trocar patrulhamento ostensivo por policiamento investigativo, ou trocar rodovias "
            "federais por rodovias em geral. Fique atento. "
            "O parágrafo terceiro trata da polícia ferroviária federal, também órgão permanente, destinada ao "
            "patrulhamento ostensivo das ferrovias federais. "
            "E o parágrafo quinto estabelece que às polícias militares cabem a polícia ostensiva e a preservação "
            "da ordem pública, enquanto aos corpos de bombeiros militares cabe a execução de atividades de defesa civil."
        ),
    },
    # ── Direito Penal ─────────────────────────────────────────────────────────
    {
        "subject_slug": "direito-penal",
        "title": "Aplicação da lei penal e teoria do crime",
        "description": "Artigos 1º a 21 do Código Penal",
        "lesson_type": "summary",
        "difficulty": "medium",
        "display_order": 20,
        "duration_secs": 220,
        "script": (
            "Vamos revisar a parte geral do Código Penal. "
            "O artigo primeiro traz o princípio da legalidade: não há crime sem lei anterior que o defina, "
            "nem pena sem prévia cominação legal. É o princípio da anterioridade da lei penal. "
            "O artigo segundo trata da lei penal no tempo. Ninguém pode ser punido por fato que lei posterior "
            "deixa de considerar crime, cessando em virtude dela a execução e os efeitos penais da sentença "
            "condenatória. É a abolitio criminis. "
            "O parágrafo único consagra a retroatividade da lei mais benéfica: a lei posterior que de qualquer "
            "modo favorecer o agente aplica-se aos fatos anteriores, ainda que decididos por sentença "
            "condenatória transitada em julgado. "
            "O artigo quarto adota a teoria da atividade: considera-se praticado o crime no momento da ação ou "
            "omissão, ainda que outro seja o momento do resultado. "
            "Já o artigo sexto adota a teoria da ubiquidade para o lugar do crime: considera-se praticado o "
            "crime no lugar em que ocorreu a ação ou omissão, no todo ou em parte, bem como onde se produziu "
            "ou deveria produzir-se o resultado. Não confunda: tempo é atividade, lugar é ubiquidade. "
            "O artigo décimo terceiro trata do nexo causal. O resultado de que depende a existência do crime "
            "somente é imputável a quem lhe deu causa. Considera-se causa a ação ou omissão sem a qual o "
            "resultado não teria ocorrido. "
            "O artigo vigésimo trata do erro de tipo. O erro sobre elemento constitutivo do tipo legal de crime "
            "exclui o dolo, mas permite a punição por crime culposo se previsto em lei. "
            "E o artigo vigésimo primeiro trata do erro de proibição. O desconhecimento da lei é inescusável. "
            "Mas o erro sobre a ilicitude do fato, se inevitável, isenta de pena; se evitável, poderá diminuí-la "
            "de um sexto a um terço."
        ),
    },
    {
        "subject_slug": "direito-penal",
        "title": "Excludentes de ilicitude na atividade policial",
        "description": "Artigos 23 a 25 do Código Penal",
        "lesson_type": "deep_dive",
        "difficulty": "medium",
        "display_order": 21,
        "duration_secs": 190,
        "script": (
            "As excludentes de ilicitude são fundamentais para o policial rodoviário federal. "
            "O artigo vinte e três do Código Penal estabelece que não há crime quando o agente pratica o fato: "
            "primeiro, em estado de necessidade; segundo, em legítima defesa; terceiro, em estrito cumprimento "
            "de dever legal ou no exercício regular de direito. "
            "O parágrafo único é importante: o agente, em qualquer dessas hipóteses, responderá pelo excesso "
            "doloso ou culposo. "
            "O artigo vinte e quatro define o estado de necessidade. Considera-se em estado de necessidade quem "
            "pratica o fato para salvar de perigo atual, que não provocou por sua vontade nem podia de outro "
            "modo evitar, direito próprio ou alheio, cujo sacrifício, nas circunstâncias, não era razoável exigir-se. "
            "Guarde os elementos: perigo atual, não provocado voluntariamente, inevitável por outro modo, e "
            "proporcionalidade. "
            "O artigo vinte e cinco define a legítima defesa. Entende-se em legítima defesa quem, usando "
            "moderadamente dos meios necessários, repele injusta agressão, atual ou iminente, a direito seu ou de outrem. "
            "Compare com o estado de necessidade: na legítima defesa há agressão injusta e humana. No estado de "
            "necessidade há perigo, que pode vir de qualquer fonte, inclusive da natureza. "
            "Repare também que a legítima defesa admite agressão atual ou iminente, enquanto o estado de "
            "necessidade exige perigo atual. Essa diferença é cobrada com frequência. "
            "O parágrafo único, incluído pelo pacote anticrime, prevê que também age em legítima defesa o agente "
            "de segurança pública que repele agressão ou risco de agressão a vítima mantida refém durante a "
            "prática de crimes."
        ),
    },
    # ── Legislação Especial ───────────────────────────────────────────────────
    {
        "subject_slug": "legislacao-especial",
        "title": "Lei de Drogas: tráfico versus porte para consumo",
        "description": "Lei 11.343/06 — artigos 28 e 33",
        "lesson_type": "deep_dive",
        "difficulty": "medium",
        "display_order": 30,
        "duration_secs": 210,
        "script": (
            "A Lei onze mil trezentos e quarenta e três, de dois mil e seis, é a Lei de Drogas. "
            "Para a PRF, o ponto central é distinguir o artigo vinte e oito do artigo trinta e três. "
            "O artigo vinte e oito trata de quem adquire, guarda, tem em depósito, transporta ou traz consigo, "
            "para consumo pessoal, drogas sem autorização ou em desacordo com determinação legal. "
            "As penas são: advertência sobre os efeitos das drogas, prestação de serviços à comunidade, e medida "
            "educativa de comparecimento a programa ou curso educativo. Repare: não há pena privativa de liberdade. "
            "O parágrafo segundo estabelece os critérios para determinar se a droga destinava-se a consumo pessoal. "
            "O juiz atenderá à natureza e à quantidade da substância, ao local e às condições em que se desenvolveu "
            "a ação, às circunstâncias sociais e pessoais, bem como à conduta e aos antecedentes do agente. "
            "O artigo trinta e três é o tráfico. Importar, exportar, remeter, preparar, produzir, fabricar, adquirir, "
            "vender, expor à venda, oferecer, ter em depósito, transportar, trazer consigo, guardar, prescrever, "
            "ministrar, entregar a consumo ou fornecer drogas, ainda que gratuitamente, sem autorização. "
            "Pena: reclusão de cinco a quinze anos e pagamento de quinhentos a mil e quinhentos dias-multa. "
            "O parágrafo quarto traz o tráfico privilegiado. Nos delitos definidos no caput, as penas poderão ser "
            "reduzidas de um sexto a dois terços desde que o agente seja primário, de bons antecedentes, não se "
            "dedique às atividades criminosas nem integre organização criminosa. "
            "O artigo quarenta traz as majorantes. Aumenta de um sexto a dois terços se a natureza, a procedência "
            "da substância e as circunstâncias do fato evidenciarem a transnacionalidade do delito. Também aumenta "
            "se o crime for praticado nas dependências de estabelecimentos prisionais, de ensino, ou em transportes públicos. "
            "Essa majorante do inciso terceiro é muito relevante para abordagens em rodovias federais."
        ),
    },
    {
        "subject_slug": "legislacao-especial",
        "title": "Estatuto do Desarmamento: porte e posse ilegal",
        "description": "Lei 10.826/03 — artigos 12 a 16",
        "lesson_type": "summary",
        "difficulty": "medium",
        "display_order": 31,
        "duration_secs": 185,
        "script": (
            "A Lei dez mil oitocentos e vinte e seis, de dois mil e três, é o Estatuto do Desarmamento. "
            "A distinção fundamental é entre posse e porte. "
            "Posse é manter a arma dentro de casa ou no local de trabalho, quando o agente é o titular ou o "
            "responsável legal pelo estabelecimento. Porte é trazer a arma consigo fora desses locais. "
            "O artigo doze trata da posse irregular de arma de fogo de uso permitido. Pena: detenção de um a três "
            "anos e multa. "
            "O artigo quatorze trata do porte ilegal de arma de fogo de uso permitido. Pena: reclusão de dois a "
            "quatro anos e multa. Repare o salto: de detenção para reclusão. "
            "O parágrafo único do artigo quatorze estabelece que o crime é inafiançável, salvo quando a arma de "
            "fogo estiver registrada em nome do agente. "
            "O artigo quinze trata do disparo de arma de fogo em lugar habitado ou em suas adjacências, em via "
            "pública ou em direção a ela. Pena: reclusão de dois a quatro anos e multa. "
            "O artigo dezesseis trata da posse ou porte ilegal de arma de fogo de uso restrito. Pena: reclusão de "
            "três a seis anos e multa. Note que aqui a lei equipara posse e porte no mesmo tipo penal. "
            "O parágrafo primeiro do artigo dezesseis equipara à mesma pena condutas como suprimir ou alterar "
            "marca, numeração ou sinal de identificação de arma de fogo, modificar as características da arma, "
            "possuir arma de fogo com numeração raspada, e vender ou entregar arma de fogo a criança ou adolescente. "
            "Esse rol é bastante cobrado em prova."
        ),
    },
    # ── Direito Administrativo ────────────────────────────────────────────────
    {
        "subject_slug": "direito-administrativo",
        "title": "Princípios da Administração Pública",
        "description": "LIMPE e princípios implícitos",
        "lesson_type": "summary",
        "difficulty": "easy",
        "display_order": 40,
        "duration_secs": 195,
        "script": (
            "Os princípios da Administração Pública estão no artigo trinta e sete, caput, da Constituição. "
            "A administração pública direta e indireta de qualquer dos Poderes da União, dos Estados, do Distrito "
            "Federal e dos Municípios obedecerá aos princípios de legalidade, impessoalidade, moralidade, "
            "publicidade e eficiência. É o famoso acrônimo LIMPE. "
            "Legalidade, para o administrador público, significa que ele só pode fazer o que a lei autoriza. "
            "Isso é diferente do particular, que pode fazer tudo o que a lei não proíbe. "
            "Impessoalidade tem duas faces. A primeira é a finalidade pública: o ato deve visar ao interesse "
            "público, não a interesses pessoais. A segunda é a vedação à promoção pessoal, prevista no parágrafo "
            "primeiro do artigo trinta e sete. "
            "Moralidade exige atuação ética, honesta e leal, além da mera legalidade formal. "
            "Publicidade é a regra da transparência. As exceções estão na própria Constituição, como o sigilo "
            "imprescindível à segurança da sociedade e do Estado. "
            "Eficiência foi acrescentado pela Emenda Constitucional dezenove, de mil novecentos e noventa e oito. "
            "Exige atuação com presteza, rendimento e economicidade. "
            "Há ainda princípios implícitos importantes. Supremacia do interesse público sobre o privado. "
            "Indisponibilidade do interesse público. Autotutela, consagrada na Súmula quatrocentos e setenta e "
            "três do Supremo Tribunal Federal: a administração pode anular seus próprios atos quando eivados de "
            "vícios, e revogá-los por motivo de conveniência ou oportunidade. "
            "E o princípio da razoabilidade e proporcionalidade, que limita a discricionariedade administrativa."
        ),
    },
    # ── Direitos Humanos ──────────────────────────────────────────────────────
    {
        "subject_slug": "direitos-humanos",
        "title": "Uso da força e direitos humanos na abordagem policial",
        "description": "Princípios da ONU e normas nacionais",
        "lesson_type": "deep_dive",
        "difficulty": "medium",
        "display_order": 50,
        "duration_secs": 200,
        "script": (
            "O uso da força pela polícia é regido por princípios internacionais e nacionais que caem com "
            "frequência na prova da PRF. "
            "Os documentos de referência são o Código de Conduta para os Funcionários Responsáveis pela Aplicação "
            "da Lei, de mil novecentos e setenta e nove, e os Princípios Básicos sobre o Uso da Força e Armas de "
            "Fogo, de mil novecentos e noventa, ambos da Organização das Nações Unidas. "
            "São quatro os princípios centrais do uso da força. "
            "Primeiro, legalidade: o uso da força deve ter amparo legal e buscar objetivo legítimo. "
            "Segundo, necessidade: a força só deve ser usada quando outros meios se mostrarem ineficazes ou não "
            "prometerem alcançar o resultado pretendido. "
            "Terceiro, proporcionalidade: o nível de força deve ser proporcional à resistência oferecida e à "
            "gravidade da ameaça. "
            "Quarto, moderação: a força empregada deve ser a mínima necessária, buscando reduzir danos e preservar vidas. "
            "No Brasil, a Portaria Interministerial quatro mil, duzentos e vinte e seis, de dois mil e dez, "
            "estabelece diretrizes sobre o uso da força pelos agentes de segurança pública. "
            "Ela consagra que os agentes não deverão disparar arma de fogo contra pessoas, exceto em casos de "
            "legítima defesa própria ou de terceiro contra perigo iminente de morte ou lesão grave. "
            "A diretriz também estabelece que não é legítimo o uso de arma de fogo contra pessoa em fuga que esteja "
            "desarmada ou que, mesmo armada, não represente risco imediato de morte ou lesão grave. "
            "Guarde essa regra. Ela contraria a intuição de muitos candidatos e por isso é cobrada."
        ),
    },
    # ── Língua Portuguesa ─────────────────────────────────────────────────────
    {
        "subject_slug": "lingua-portuguesa",
        "title": "Concordância verbal: as regras que mais caem",
        "description": "Casos especiais de concordância no CEBRASPE",
        "lesson_type": "summary",
        "difficulty": "medium",
        "display_order": 60,
        "duration_secs": 190,
        "script": (
            "A concordância verbal é campeã de incidência nas provas do CEBRASPE. Vamos aos casos que mais caem. "
            "Primeiro caso: sujeito composto anteposto ao verbo. O verbo vai para o plural. "
            "Exemplo: o delegado e o escrivão assinaram o termo. "
            "Segundo caso: sujeito composto posposto ao verbo. O verbo pode concordar com o mais próximo ou ir "
            "para o plural. Ambas as formas são corretas. "
            "Terceiro caso: expressões partitivas como a maioria de, grande parte de, metade de. O verbo pode ficar "
            "no singular, concordando com o núcleo, ou no plural, concordando com o especificador. "
            "Exemplo: a maioria dos condutores respeitou o limite. Ou: a maioria dos condutores respeitaram o limite. "
            "Quarto caso: o verbo haver no sentido de existir é impessoal. Fica sempre na terceira pessoa do singular. "
            "Havia muitos veículos na pista. Nunca haviam muitos veículos. "
            "Mas atenção: se o verbo for existir, ele é pessoal e concorda normalmente. Existiam muitos veículos. "
            "Quinto caso: o verbo fazer indicando tempo decorrido também é impessoal. Faz dois anos que ele foi aprovado. "
            "Nunca fazem dois anos. "
            "Sexto caso: a partícula se. Quando é índice de indeterminação do sujeito, com verbo intransitivo ou "
            "transitivo indireto, o verbo fica no singular. Precisa-se de agentes. "
            "Quando é partícula apassivadora, com verbo transitivo direto, o verbo concorda com o sujeito paciente. "
            "Vendem-se veículos. Repare: veículos é o sujeito, então o verbo vai para o plural. "
            "Esse último caso é o que mais gera erro em prova. Teste sempre transformando para a voz passiva analítica: "
            "veículos são vendidos. Se a frase fizer sentido, é partícula apassivadora e o verbo concorda."
        ),
    },
    # ── Raciocínio Lógico ─────────────────────────────────────────────────────
    {
        "subject_slug": "raciocinio-logico",
        "title": "Proposições, conectivos e tabelas-verdade",
        "description": "Fundamentos da lógica proposicional",
        "lesson_type": "summary",
        "difficulty": "medium",
        "display_order": 70,
        "duration_secs": 205,
        "script": (
            "Vamos revisar lógica proposicional, tema constante nas provas do CEBRASPE. "
            "Uma proposição é uma sentença declarativa à qual se pode atribuir valor verdadeiro ou falso. "
            "Frases interrogativas, exclamativas, imperativas e optativas não são proposições. "
            "Agora os conectivos. São cinco. "
            "Primeiro, a conjunção, representada pelo e. Ela só é verdadeira quando ambas as proposições são "
            "verdadeiras. Em todos os outros casos, é falsa. "
            "Segundo, a disjunção inclusiva, representada pelo ou. Ela só é falsa quando ambas são falsas. "
            "Em todos os outros casos, é verdadeira. "
            "Terceiro, a disjunção exclusiva, representada por ou exclusivo, na forma ou p ou q. Ela é verdadeira "
            "quando as proposições têm valores diferentes. É falsa quando têm valores iguais. "
            "Quarto, o condicional, representado por se então. Este é o mais cobrado. O condicional só é falso "
            "em um único caso: quando o antecedente é verdadeiro e o consequente é falso. Verdadeiro implica falso "
            "resulta em falso. Todos os demais casos são verdadeiros. Memorize essa única linha falsa. "
            "Quinto, o bicondicional, representado por se e somente se. Ele é verdadeiro quando ambas têm o mesmo "
            "valor lógico. É falso quando têm valores diferentes. "
            "Agora as equivalências mais cobradas. "
            "A negação de uma conjunção é a disjunção das negações. Não p e q equivale a não p ou não q. É a Lei de Morgan. "
            "A negação de uma disjunção é a conjunção das negações. Não p ou q equivale a não p e não q. "
            "A negação do condicional se p então q é p e não q. Repare: mantém o antecedente e nega o consequente. "
            "Esse ponto é o mais cobrado de toda a matéria. "
            "E a equivalência do condicional: se p então q equivale a se não q então não p. É a contrapositiva. "
            "Também equivale a não p ou q."
        ),
    },
    # ── Ética ─────────────────────────────────────────────────────────────────
    {
        "subject_slug": "etica-servico-publico",
        "title": "Código de Ética do servidor público federal",
        "description": "Decreto 1.171/94 — deveres e vedações",
        "lesson_type": "summary",
        "difficulty": "easy",
        "display_order": 80,
        "duration_secs": 175,
        "script": (
            "O Decreto mil cento e setenta e um, de mil novecentos e noventa e quatro, aprova o Código de Ética "
            "Profissional do Servidor Público Civil do Poder Executivo Federal. "
            "As regras deontológicas trazem conceitos importantes. "
            "A dignidade, o decoro, o zelo, a eficácia e a consciência dos princípios morais são primados maiores "
            "que devem nortear o servidor público. "
            "O item segundo estabelece que o servidor deve decidir não somente entre o legal e o ilegal, mas "
            "principalmente entre o honesto e o desonesto. Essa distinção cai bastante. "
            "O item quinto afirma que o trabalho desenvolvido pelo servidor perante a comunidade deve ser entendido "
            "como acréscimo ao seu próprio bem-estar, já que, como cidadão, integrante da sociedade, o êxito desse "
            "trabalho pode ser considerado como seu maior patrimônio. "
            "Entre os deveres fundamentais, destaco alguns bastante cobrados. "
            "Ser probo, reto, leal e justo, demonstrando toda a integridade do seu caráter. "
            "Exercer suas atribuições com rapidez, perfeição e rendimento, pondo fim ou procurando prioritariamente "
            "resolver situações procrastinatórias. "
            "Tratar cuidadosamente os usuários dos serviços, aperfeiçoando o processo de comunicação e contato com o público. "
            "Ser assíduo e frequente ao serviço, na certeza de que sua ausência provoca danos ao trabalho ordenado. "
            "Entre as vedações, destaco: usar o cargo ou função para obter qualquer favorecimento para si ou para outrem. "
            "Prejudicar deliberadamente a reputação de outros servidores ou de cidadãos. "
            "E deixar de utilizar os avanços técnicos e científicos ao seu alcance para o atendimento do seu mister. "
            "Por fim, cada órgão deve constituir uma Comissão de Ética, encarregada de orientar e aconselhar sobre "
            "a ética profissional do servidor."
        ),
    },
]
