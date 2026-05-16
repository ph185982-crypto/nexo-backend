import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.META_ACCESS_TOKEN!;
const AD_ACCOUNT = process.env.META_AD_ACCOUNT_ID!;
const BASE_URL = 'https://graph.facebook.com/v19.0';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function api(method: 'get' | 'post', endpoint: string, data?: any) {
  try {
    const response = await axios({
      method,
      url: `${BASE_URL}${endpoint}`,
      params: method === 'get' ? { access_token: TOKEN, ...data } : undefined,
      data: method === 'post' ? { ...data, access_token: TOKEN } : undefined,
      headers: { 'Content-Type': 'application/json' }
    });
    return response.data;
  } catch (err: any) {
    console.error(`[ERRO] ${endpoint}:`, JSON.stringify(err.response?.data, null, 2));
    throw err;
  }
}

async function criarCampanha() {
  console.log('\n[1/6] Criando campanha...');

  const resultado = await api('post', `/${AD_ACCOUNT}/campaigns`, {
    name: 'GPS_CONVERSAS_WHATSAPP_BR',
    objective: 'MESSAGES',
    status: 'PAUSED',
    special_ad_categories: [],
    buying_type: 'AUCTION',
    daily_budget: 15000,
    budget_rebalance_flag: true
  });

  console.log(`✅ Campanha criada: ${resultado.id}`);
  return resultado.id;
}

async function buscarVideos() {
  console.log('\n[2/6] Buscando vídeos da biblioteca...');

  const resultado = await api('get', `/${AD_ACCOUNT}/advideos`, {
    fields: 'id,title,created_time,thumbnails',
    limit: 10
  });

  const videos = resultado.data;
  console.log(`✅ ${videos.length} vídeos encontrados:`);
  videos.forEach((v: any, i: number) => {
    console.log(`  ${i + 1}. ID: ${v.id} | Título: ${v.title} | Criado: ${v.created_time}`);
  });

  const quatroRecentes = videos.slice(0, 4);

  if (quatroRecentes.length < 4) {
    throw new Error(`Apenas ${quatroRecentes.length} vídeos encontrados. Precisa de 4.`);
  }

  return quatroRecentes.map((v: any) => v.id);
}

async function criarConjunto(
  campanhaId: string,
  nome: string,
  publico: any,
  gastoMinimo: number,
  posicionamentos: any
) {
  console.log(`\n  Criando conjunto: ${nome}...`);
  await delay(1000);

  const resultado = await api('post', `/${AD_ACCOUNT}/adsets`, {
    name: nome,
    campaign_id: campanhaId,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'CONVERSATIONS',
    destination_type: 'WHATSAPP',
    targeting: {
      geo_locations: { countries: ['BR'] },
      age_min: publico.idadeMin,
      age_max: publico.idadeMax,
      genders: publico.genero,
      flexible_spec: publico.interesses?.map((interesse: string) => ({
        interests: [{ name: interesse }]
      })) || [],
      publisher_platforms: posicionamentos.plataformas,
      facebook_positions: posicionamentos.facebook || [],
      instagram_positions: posicionamentos.instagram || [],
      device_platforms: ['mobile']
    },
    daily_min_spend_target: gastoMinimo * 100,
    promoted_object: {
      page_id: process.env.META_PAGE_ID
    }
  });

  console.log(`  ✅ Conjunto criado: ${resultado.id}`);
  return resultado.id;
}

async function criarCriativo(
  videoId: string,
  headline: string,
  texto: string,
  pageId: string
) {
  const resultado = await api('post', `/${AD_ACCOUNT}/adcreatives`, {
    name: `Criativo_${videoId}`,
    object_story_spec: {
      page_id: pageId,
      video_data: {
        video_id: videoId,
        message: texto,
        title: headline,
        call_to_action: {
          type: 'WHATSAPP_MESSAGE',
          value: {
            app_destination: 'WHATSAPP'
          }
        }
      }
    }
  });

  return resultado.id;
}

async function criarAnuncio(
  conjuntoId: string,
  nome: string,
  criativoId: string
) {
  await delay(500);

  const resultado = await api('post', `/${AD_ACCOUNT}/ads`, {
    name: nome,
    adset_id: conjuntoId,
    creative: { creative_id: criativoId },
    status: 'PAUSED'
  });

  console.log(`    ✅ Anúncio criado: ${nome}`);
  return resultado.id;
}

const CONJUNTOS = [
  {
    nome: 'GPS_PAIS_FILHOS_ADOLESCENTES',
    gastoMinimo: 20,
    publico: {
      idadeMin: 30,
      idadeMax: 52,
      genero: [1, 2],
      interesses: ['Segurança familiar', 'Controle parental', 'Filhos adolescentes']
    },
    posicionamentos: {
      plataformas: ['facebook', 'instagram'],
      facebook: ['feed', 'reels', 'story'],
      instagram: ['stream', 'reels', 'story']
    },
    anuncios: [
      {
        nome: 'GPS_PAIS_VIDEO1',
        headline: 'Você sabe onde seu filho está agora?',
        texto: `Ele saiu às 22h. Celular caiu na caixa postal.\nEssa angústia acaba hoje.\n\nRastreador GPS discreto no carregador do carro.\nSó plugar — localiza na hora pelo celular.\n\nR$197 | Frete Grátis | Todo o Brasil`
      },
      {
        nome: 'GPS_PAIS_VIDEO2',
        headline: 'Parece um carregador. Não é.',
        texto: `Mães estão usando isso pra saber onde os filhos estão 24h por dia.\n\nPlug and play. Sem instalação. Sem mensalidade.\n\nR$197 com frete grátis pra todo o Brasil.`
      },
      {
        nome: 'GPS_PAIS_VIDEO3',
        headline: 'Seu filho sai e você fica sem dormir?',
        texto: `Seu filho sai e você fica sem dormir?\n\nEsse carregador rastreia o carro em tempo real pelo celular.\nNinguém percebe que está lá.\n\nDevolução em 48h se não gostar — zero risco.`
      },
      {
        nome: 'GPS_PAIS_VIDEO4',
        headline: 'Menor que um isqueiro. Mais útil que um rastreador de R$1.000',
        texto: `Carregador 30W + GPS integrado.\nFunciona com qualquer carro. iOS e Android.\n\nR$197 | Frete Grátis | Entrega em todo o Brasil`
      }
    ]
  },
  {
    nome: 'GPS_MEDO_ROUBO_VEICULO',
    gastoMinimo: 20,
    publico: {
      idadeMin: 28,
      idadeMax: 55,
      genero: [1, 2],
      interesses: ['Seguro de automóvel', 'Rastreador veicular', 'Segurança do veículo']
    },
    posicionamentos: {
      plataformas: ['facebook', 'instagram'],
      facebook: ['feed', 'reels', 'story'],
      instagram: ['stream', 'reels', 'story']
    },
    anuncios: [
      {
        nome: 'GPS_ROUBO_VIDEO1',
        headline: 'Meu carro foi roubado. Encontrei em 4 minutos.',
        texto: `Esse carregador estava plugado no acendedor.\nAbri o app. Via o carro se mover em tempo real.\n\nDiscreto. Ninguém sabe que está lá.\n\nR$197 | Frete Grátis`
      },
      {
        nome: 'GPS_ROUBO_VIDEO2',
        headline: 'Você sabe onde seu carro está agora?',
        texto: `Se não sabe onde está seu carro, você precisa ver isso.\n\nCarregador GPS 2 em 1 — rastreia em tempo real\ne ainda carrega seu celular 3x mais rápido.\n\nSem mensalidade. Sem instalação.`
      },
      {
        nome: 'GPS_ROUBO_VIDEO3',
        headline: 'Ninguém percebe que está lá. Mas ele tá.',
        texto: `O objeto mais útil que você pode ter no carro.\nParece um carregador comum. Rastreia tudo.\n\nR$197 com frete grátis pra todo o Brasil.`
      },
      {
        nome: 'GPS_ROUBO_VIDEO4',
        headline: 'Sem rastreador seu carro some. Com esse você acha.',
        texto: `Plug and play — plugou, abriu o app, localizou.\nFunciona no iOS e Android. Qualquer carro.\n\nDevolução garantida em 48h.`
      }
    ]
  },
  {
    nome: 'GPS_MOTORISTAS_APP_UBER_99',
    gastoMinimo: 15,
    publico: {
      idadeMin: 25,
      idadeMax: 50,
      genero: [1],
      interesses: ['Uber', '99', 'Motorista por aplicativo']
    },
    posicionamentos: {
      plataformas: ['facebook', 'instagram'],
      facebook: ['feed', 'reels'],
      instagram: ['stream', 'reels']
    },
    anuncios: [
      {
        nome: 'GPS_MOTORISTA_VIDEO1',
        headline: 'Motorista: seu carro tá seguro enquanto você trabalha?',
        texto: `Esse carregador rastreia o carro em tempo real\ne ainda carrega o celular 30W enquanto você roda.\n\n2 funções. 1 aparelho. R$197.`
      },
      {
        nome: 'GPS_MOTORISTA_VIDEO2',
        headline: 'O acessório que todo motorista de app deveria ter',
        texto: `Carrega 3x mais rápido que carregador comum.\nE ainda rastreia o carro 24h.\n\nFrete grátis pra todo o Brasil.`
      },
      {
        nome: 'GPS_MOTORISTA_VIDEO3',
        headline: 'Carregador 30W + GPS. Dois problemas resolvidos.',
        texto: `Celular sempre carregado. Carro sempre localizado.\n\nPlug and play — só plugar no acendedor.\n\nR$197 com frete grátis.`
      },
      {
        nome: 'GPS_MOTORISTA_VIDEO4',
        headline: 'Parece um carregador normal. Não é.',
        texto: `Motoristas de app estão usando pra proteger\no carro e carregar o celular ao mesmo tempo.\n\nSem mensalidade. Sem instalação.`
      }
    ]
  },
  {
    nome: 'GPS_BROAD_ALGORITMO',
    gastoMinimo: 10,
    publico: {
      idadeMin: 25,
      idadeMax: 55,
      genero: [1, 2],
      interesses: []
    },
    posicionamentos: {
      plataformas: ['facebook', 'instagram', 'audience_network'],
      facebook: ['feed', 'reels', 'story', 'search'],
      instagram: ['stream', 'reels', 'story', 'explore']
    },
    anuncios: [
      {
        nome: 'GPS_BROAD_VIDEO1',
        headline: 'Parece um carregador. Não é.',
        texto: `Esse objeto está mudando a forma como as pessoas\nprotegem carros e famílias no Brasil.\n\nCarregador 30W + GPS 2 em 1.\n\nR$197 | Frete Grátis | Todo o Brasil`
      },
      {
        nome: 'GPS_BROAD_VIDEO2',
        headline: 'O que esse carregador faz quando você não tá olhando',
        texto: `Localiza em tempo real. Discreto. Plug and play.\nFunciona com qualquer carro. iOS e Android.\n\nSem mensalidade. Sem instalação.`
      },
      {
        nome: 'GPS_BROAD_VIDEO3',
        headline: 'Esse carregador já recuperou carros roubados',
        texto: `Discreto, ninguém percebe que está lá.\nAbre o app e vê o carro em tempo real.\n\nR$197 com frete grátis pra todo o Brasil.`
      },
      {
        nome: 'GPS_BROAD_VIDEO4',
        headline: 'Instalação zero. Proteção total.',
        texto: `Plugou no acendedor. Baixou o app. Localizou.\n\nCarregador 30W + GPS integrado.\n\nDevolução em 48h se não gostar — zero risco.`
      }
    ]
  }
];

async function main() {
  console.log('🚀 Iniciando criação de campanha GPS...\n');

  const varsFaltando = [
    'META_ACCESS_TOKEN',
    'META_AD_ACCOUNT_ID',
    'META_PAGE_ID'
  ].filter(v => !process.env[v] || process.env[v] === 'PREENCHER_ANTES_DE_EXECUTAR');

  if (varsFaltando.length > 0) {
    console.error(`❌ Variáveis de ambiente faltando ou não preenchidas: ${varsFaltando.join(', ')}`);
    process.exit(1);
  }

  const PAGE_ID = process.env.META_PAGE_ID!;

  try {
    const campanhaId = await criarCampanha();
    await delay(2000);

    const videoIds = await buscarVideos();
    console.log(`\n📹 Vídeos que serão usados: ${videoIds.join(', ')}`);
    console.log('Aguarde 3 segundos para continuar...');
    await delay(3000);

    console.log('\n[3/6] Criando conjuntos de anúncios...');

    const resultados = [];

    for (const conjunto of CONJUNTOS) {
      console.log(`\n📦 Processando: ${conjunto.nome}`);

      const conjuntoId = await criarConjunto(
        campanhaId,
        conjunto.nome,
        conjunto.publico,
        conjunto.gastoMinimo,
        conjunto.posicionamentos
      );

      await delay(1500);

      console.log(`  Criando 4 anúncios...`);

      const anunciosCriados = [];

      for (let i = 0; i < conjunto.anuncios.length; i++) {
        const anuncio = conjunto.anuncios[i];
        const videoId = videoIds[i];

        const criativoId = await criarCriativo(
          videoId,
          anuncio.headline,
          anuncio.texto,
          PAGE_ID
        );

        await delay(800);

        const anuncioId = await criarAnuncio(
          conjuntoId,
          anuncio.nome,
          criativoId
        );

        anunciosCriados.push({ nome: anuncio.nome, id: anuncioId });
        await delay(800);
      }

      resultados.push({
        conjunto: conjunto.nome,
        conjuntoId,
        anuncios: anunciosCriados
      });
    }

    console.log('\n\n✅ CAMPANHA CRIADA COM SUCESSO!\n');
    console.log('='.repeat(50));
    console.log(`📊 Campanha ID: ${campanhaId}`);
    console.log(`💰 Orçamento: R$150/dia com CBO`);
    console.log(`📦 Conjuntos criados: ${resultados.length}`);
    console.log(`📢 Anúncios criados: ${resultados.length * 4}`);
    console.log('\nDetalhes por conjunto:');

    resultados.forEach(r => {
      console.log(`\n  ${r.conjunto} (ID: ${r.conjuntoId})`);
      r.anuncios.forEach((a: any) => {
        console.log(`    → ${a.nome} (ID: ${a.id})`);
      });
    });

    console.log('\n⚠️  Todos os itens estão PAUSADOS.');
    console.log('Acesse o Ads Manager para revisar e ativar quando estiver pronto.');
    console.log(`\n🔗 https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${AD_ACCOUNT.replace('act_', '')}`);

  } catch (err: any) {
    console.error('\n❌ Erro durante a criação:', err.message);
    console.error('Verifique os logs acima para mais detalhes.');
    process.exit(1);
  }
}

main();
