import puppeteer from "puppeteer";
import path from "path";
import fs from "fs/promises";
import os from "os";

export interface DadosArte {
  nome: string;
  precoVenda: number;
  precoDesconto: number;
  parcelamento: number;
  fotoUrl: string;
}

function htmlTemplate(dados: DadosArte): string {
  const fmt = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // Escape potential HTML injection from product name
  const nomeSafe = dados.nome
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1080px;
    height: 1080px;
    overflow: hidden;
    font-family: 'Arial Black', 'Arial', sans-serif;
    background: linear-gradient(135deg, #0a0a0f 0%, #111827 60%, #1e1b4b 100%);
    color: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 48px 56px;
  }

  /* ── Header: brand ── */
  .brand {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand-icon {
    width: 48px; height: 48px;
    background: #2563eb;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 26px;
  }
  .brand-name {
    font-size: 28px; font-weight: 900; letter-spacing: 1px;
    text-transform: uppercase; color: #60a5fa;
  }
  .brand-tagline {
    font-size: 13px; color: #94a3b8; letter-spacing: 2px;
    text-transform: uppercase; margin-top: 2px;
  }

  /* ── Product image ── */
  .img-wrap {
    width: 520px; height: 520px;
    border-radius: 24px;
    overflow: hidden;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6);
    border: 2px solid rgba(96,165,250,0.3);
    background: #1e2937;
    display: flex; align-items: center; justify-content: center;
  }
  .img-wrap img {
    width: 100%; height: 100%; object-fit: cover;
  }
  .img-placeholder {
    font-size: 96px;
  }

  /* ── Product name ── */
  .nome {
    font-size: 36px;
    font-weight: 900;
    text-align: center;
    line-height: 1.2;
    max-width: 900px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-shadow: 0 2px 12px rgba(0,0,0,0.5);
  }

  /* ── Prices ── */
  .prices {
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
  }
  .price-main {
    display: flex; flex-direction: column; gap: 4px;
  }
  .price-label {
    font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;
  }
  .price-value-orig {
    font-size: 22px; color: #6b7280; text-decoration: line-through;
  }
  .price-value-desc {
    font-size: 54px; font-weight: 900; color: #34d399;
    line-height: 1; text-shadow: 0 0 24px rgba(52,211,153,0.5);
  }
  .price-parcel {
    text-align: right;
    display: flex; flex-direction: column; gap: 4px;
  }
  .parcel-text {
    font-size: 18px; color: #94a3b8;
  }
  .parcel-value {
    font-size: 28px; font-weight: 900; color: #60a5fa;
  }

  /* ── Bottom CTA ── */
  .cta {
    display: flex; align-items: center; justify-content: center;
    gap: 12px;
    background: linear-gradient(90deg, #2563eb, #7c3aed);
    border-radius: 999px;
    padding: 16px 48px;
    font-size: 22px; font-weight: 900; letter-spacing: 2px;
    text-transform: uppercase;
    box-shadow: 0 8px 32px rgba(37,99,235,0.5);
    width: 100%;
    text-align: center;
  }
</style>
</head>
<body>
  <div class="brand">
    <div class="brand-icon">🔧</div>
    <div>
      <div class="brand-name">Ferramentas Top</div>
      <div class="brand-tagline">Qualidade que você pode confiar</div>
    </div>
  </div>

  <div class="img-wrap">
    ${dados.fotoUrl
      ? `<img src="${dados.fotoUrl}" alt="" onerror="this.style.display='none';document.querySelector('.img-placeholder').style.display='block'">`
      : ""}
    <div class="img-placeholder" ${dados.fotoUrl ? 'style="display:none"' : ""}>🔧</div>
  </div>

  <div class="nome">${nomeSafe}</div>

  <div class="prices">
    <div class="price-main">
      <span class="price-label">De</span>
      <span class="price-value-orig">${fmt(dados.precoVenda)}</span>
      <span class="price-label" style="color:#34d399">Por apenas</span>
      <span class="price-value-desc">${fmt(dados.precoDesconto)}</span>
    </div>
    <div class="price-parcel">
      <span class="parcel-text">ou em até</span>
      <span class="parcel-value" style="font-size:42px">10×</span>
      <span class="parcel-value">${fmt(dados.parcelamento)}</span>
      <span class="parcel-text" style="font-size:14px">sem juros</span>
    </div>
  </div>

  <div class="cta">
    📲 Chame no WhatsApp e garanta já!
  </div>
</body>
</html>`;
}

export async function gerarArte(dados: DadosArte): Promise<string> {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

    const html = htmlTemplate(dados);
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    // Wait for image to load if present
    if (dados.fotoUrl) {
      await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        return Promise.all(
          imgs.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete) resolve();
                else { img.onload = () => resolve(); img.onerror = () => resolve(); }
              })
          )
        );
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }

    // Save to temp file
    const tmpDir = path.join(os.tmpdir(), "vendedoria-artes");
    await fs.mkdir(tmpDir, { recursive: true });
    const filename = `arte-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(tmpDir, filename);

    await page.screenshot({ path: filePath, type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 } });

    console.log(`[gerarArte] Arte gerada: ${filePath}`);
    return filePath;
  } finally {
    await browser.close();
  }
}

/**
 * Read the generated art file as a base64 data URI (for embedding or sending).
 */
export async function arteParaBase64(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}
