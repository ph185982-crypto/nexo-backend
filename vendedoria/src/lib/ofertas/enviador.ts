import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppImage } from "@/lib/whatsapp/send";
import { gerarArte } from "./gerador-arte";
import { gerarTextoOferta } from "./gerador-texto";
import { selecionarProduto } from "./rotacao";
import { uploadToCloudinary, isCloudinaryConfigured } from "@/lib/cloudinary";
import path from "path";
import fs from "fs/promises";

export interface ResultadoEnvio {
  ok: boolean;
  ofertaId?: string;
  produtoId?: string;
  nomeProduto?: string;
  error?: string;
}

/**
 * Full pipeline: select product → generate art → generate caption → upload to Cloudinary → send via WhatsApp → save OfertaGerada.
 */
export async function enviarOferta(): Promise<ResultadoEnvio> {
  // 1. Select product via rotation logic
  const produto = await selecionarProduto();
  if (!produto) {
    console.warn("[enviador] Nenhum produto disponível para oferta");
    return { ok: false, error: "Nenhum produto ativo disponível" };
  }

  // 2. Get WhatsApp provider
  const provider = await prisma.whatsappProviderConfig.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!provider) {
    console.error("[enviador] Nenhum providerConfig encontrado");
    return { ok: false, error: "WhatsApp provider não configurado" };
  }

  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ??
    (await prisma.agentConfig.findFirst()?.then((c) => c?.bastaoNumber)) ??
    "5562984465388";

  let artePath: string | null = null;
  let artePublicUrl: string | null = null;

  try {
    // 3. Generate 1080×1080 art
    artePath = await gerarArte({
      nome: produto.nome,
      precoVenda: produto.precoVenda,
      precoDesconto: produto.precoDesconto,
      parcelamento: produto.parcelamento,
      fotoUrl: produto.fotoUrl,
    });

    // 4. Upload art to Cloudinary (needed for public URL to send via WhatsApp)
    if (isCloudinaryConfigured()) {
      const artBuf = await fs.readFile(artePath);
      const artFile = new File([artBuf], path.basename(artePath), { type: "image/png" });
      const cloudResult = await uploadToCloudinary(artFile, "vendedoria/ofertas");
      artePublicUrl = cloudResult.url;
    } else {
      // Fallback: use original product photo if no Cloudinary
      artePublicUrl = produto.fotoUrl || null;
      console.warn("[enviador] Cloudinary não configurado — usando fotoUrl original");
    }

    // 5. Generate caption text
    const textoOferta = await gerarTextoOferta({
      nome: produto.nome,
      precoVenda: produto.precoVenda,
      precoDesconto: produto.precoDesconto,
      parcelamento: produto.parcelamento,
    });

    // 6. Save OfertaGerada record with status PRONTA
    const oferta = await prisma.ofertaGerada.create({
      data: {
        produtoId: produto.id,
        nomeProduto: produto.nome,
        precoCusto: produto.precoCusto,
        precoVenda: produto.precoVenda,
        precoDesconto: produto.precoDesconto,
        parcelamento: produto.parcelamento,
        fotoOriginalUrl: produto.fotoUrl,
        artePath: artePath,
        textoOferta,
        status: "PRONTA",
      },
    });

    // 7. Send via WhatsApp
    try {
      if (artePublicUrl) {
        await sendWhatsAppImage(
          provider.businessPhoneNumberId,
          ownerNumber,
          artePublicUrl,
          textoOferta,
          provider.accessToken ?? undefined
        );
      } else {
        // Text only fallback
        await sendWhatsAppMessage(
          provider.businessPhoneNumberId,
          ownerNumber,
          textoOferta,
          provider.accessToken ?? undefined
        );
      }

      // 8. Mark as ENVIADA
      await prisma.ofertaGerada.update({
        where: { id: oferta.id },
        data: { status: "ENVIADA", enviadaParaWhatsApp: true, enviadaEm: new Date() },
      });

      // 9. Update product rotation stats
      await prisma.produto.update({
        where: { id: produto.id },
        data: {
          ultimaOfertaEm: new Date(),
          vezesUsadoEmOferta: { increment: 1 },
        },
      });

      console.log(`[enviador] Oferta enviada com sucesso — ${produto.nome} (id=${oferta.id})`);
      return { ok: true, ofertaId: oferta.id, produtoId: produto.id, nomeProduto: produto.nome };
    } catch (sendErr) {
      console.error("[enviador] Falha ao enviar via WhatsApp:", sendErr);
      await prisma.ofertaGerada.update({
        where: { id: oferta.id },
        data: { status: "FALHA" },
      });
      return { ok: false, ofertaId: oferta.id, error: String(sendErr) };
    }
  } catch (err) {
    console.error("[enviador] Erro no pipeline:", err);
    return { ok: false, error: String(err) };
  } finally {
    // Clean up temp art file
    if (artePath) {
      fs.unlink(artePath).catch(() => {});
    }
  }
}
