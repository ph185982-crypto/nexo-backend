#!/usr/bin/env python3
"""
agente_bastao.py — Gerador de e-mail de passagem de bastão
Logística Reversa | IEL/GO

Uso:
    python agente_bastao.py [pdf] [--sem-revisao] [--abrir-email]
"""

import argparse
import os
import re
import sys
import urllib.parse
import webbrowser
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit(
        "❌ Dependência ausente. Instale com:\n"
        "   pip install pdfplumber>=0.11.0"
    )

# ---------------------------------------------------------------------------
# Domínios ignorados na busca de e-mail do financeiro
# ---------------------------------------------------------------------------
DOMINIOS_IGNORADOS = {"iel", "senai", "fieg", "sesi", "cni"}

# ---------------------------------------------------------------------------
# Template do e-mail
# ---------------------------------------------------------------------------
ASSUNTO_TEMPLATE = (
    "Faturamento – Logística Reversa | {razao_social} | {data_assinatura}"
)

CORPO_TEMPLATE = """\
Boa tarde, Isadora e Frederico,

Segue abaixo as informações de faturamento referentes à venda do produto
Logística Reversa para o cliente identificado abaixo. A oportunidade já foi
ganha no Néctar e o status no Integrador consta como "Processado".

DADOS DO CLIENTE E FATURAMENTO
  * Razão Social: {razao_social}
  * CNPJ: {cnpj}
  * Endereço: {endereco}
  * E-mail do financeiro: {email_financeiro}

Condições Comerciais
  * Valor total negociado: {valor_total}
  * Forma de pagamento: {forma_pagamento}
  * Condições: {parcelamento}
  * Data do primeiro vencimento: {primeiro_vencimento}

Solicito que, com base nessas informações, seja providenciado:
  * Emissão da Nota Fiscal;
  * Geração do link de pagamento (cartão de crédito) ou emissão do 1º boleto;
  * Retorno por e-mail com os itens acima para que possamos dar continuidade
    ao envio ao cliente.

Atenciosamente,"""

DESTINATARIOS = "isadora@iel.org.br;frederico@iel.org.br"

# ---------------------------------------------------------------------------
# Extração de dados
# ---------------------------------------------------------------------------

def extrair_texto(caminho_pdf: Path) -> tuple[str, str]:
    """Retorna (texto_completo, texto_ultima_secao)."""
    paginas = []
    with pdfplumber.open(caminho_pdf) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            paginas.append(t)
    texto_completo = "\n".join(paginas)
    # Última seção: últimas ~300 linhas ou após "Clicksign"
    linhas = texto_completo.splitlines()
    idx_click = -1
    for i, linha in enumerate(linhas):
        if "clicksign" in linha.lower():
            idx_click = i
    ultima_secao = "\n".join(linhas[idx_click:]) if idx_click >= 0 else "\n".join(linhas[-300:])
    return texto_completo, ultima_secao


def extrair_razao_social(texto: str) -> str | None:
    """Busca o CONTRATANTE no corpo do contrato."""
    padroes = [
        # "CONTRATANTE: NOME DA EMPRESA LTDA"
        r"CONTRATANTE[:\s]+([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][A-Za-záéíóúâêôãõçàü\s\-\.&/,]+(?:LTDA|S\.A\.|SA|EIRELI|ME|EPP|LTDA\.?|S\.A\.?)?\.?)",
        # "I – CONTRATANTE\nNome da Empresa Ltda"
        r"CONTRATANTE\s*[–\-]\s*\n\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][^\n]+)",
        r"(?:empresa|contratante)[:\s]+([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][A-Za-záéíóúâêôãõçàü\s\-\.&/,]+(?:LTDA|S\.A\.|SA|EIRELI|ME|EPP)?)",
    ]
    for padrao in padroes:
        m = re.search(padrao, texto, re.IGNORECASE | re.MULTILINE)
        if m:
            val = m.group(1).strip().rstrip(".,;:")
            if len(val) > 3:
                return val
    return None


def extrair_cnpj(texto: str) -> str | None:
    """Retorna o segundo CNPJ encontrado (o primeiro costuma ser do IEL)."""
    cnpjs = re.findall(r"\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[\/\s]?\d{4}[\-\s]?\d{2}", texto)
    cnpjs_limpos = [re.sub(r"[\s]", "", c) for c in cnpjs]
    if len(cnpjs_limpos) >= 2:
        return cnpjs_limpos[1]
    if cnpjs_limpos:
        return cnpjs_limpos[0]
    return None


def extrair_endereco(texto: str) -> str | None:
    """Busca endereço com logradouro, número, cidade, estado e CEP."""
    padroes = [
        # CEP no final: Rua X, 123, Cidade - GO, 74000-000
        r"(?:Rua|Av\.|Avenida|Alameda|Travessa|Estrada|Rod\.|Rodovia|Praça|Qd\.|Quadra|SN|SQN|SHIN|SHIS)[^\n]{5,120}CEP[:\s]*\d{5}-?\d{3}",
        r"(?:Rua|Av\.|Avenida|Alameda|Travessa|Estrada|Rodovia|Praça)[^\n]{5,120}\d{5}-\d{3}",
        r"(?:Endereço|Endere[çc]o)[:\s]+([^\n]{10,200})",
    ]
    for padrao in padroes:
        m = re.search(padrao, texto, re.IGNORECASE)
        if m:
            val = m.group(0).strip()
            if len(val) > 10:
                return val
    return None


def _dominio_ignorado(email: str) -> bool:
    dominio = email.split("@")[-1].split(".")[0].lower()
    return dominio in DOMINIOS_IGNORADOS


def extrair_email_financeiro(texto_completo: str, ultima_secao: str) -> str | None:
    """Prioriza e-mails da última seção (Clicksign), ignora domínios internos."""
    padrao_email = r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"

    # Prioridade 1: última seção (log Clicksign)
    emails_click = re.findall(padrao_email, ultima_secao)
    for email in emails_click:
        if not _dominio_ignorado(email):
            return email.lower()

    # Prioridade 2: texto completo
    emails = re.findall(padrao_email, texto_completo)
    for email in emails:
        if not _dominio_ignorado(email):
            return email.lower()

    return None


def extrair_valor_total(texto: str) -> str | None:
    """Busca padrão R$ 0.000,00."""
    padroes = [
        r"R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}",
        r"R\$\s*\d+,\d{2}",
    ]
    for padrao in padroes:
        valores = re.findall(padrao, texto)
        if valores:
            return valores[-1].strip()
    return None


def extrair_forma_pagamento(texto: str) -> str | None:
    if re.search(r"cart[aã]o\s+de\s+cr[eé]dito", texto, re.IGNORECASE):
        return "Cartão de crédito"
    if re.search(r"boleto\s+banc[aá]rio", texto, re.IGNORECASE):
        return "Boleto bancário"
    if re.search(r"boleto", texto, re.IGNORECASE):
        return "Boleto bancário"
    return None


def extrair_parcelamento(texto: str) -> str | None:
    padroes = [
        r"(?:parcelado\s+em\s+)(\d+)\s*(?:x|parcelas?|vezes?)",
        r"(\d+)\s*(?:x|parcelas?)\s*(?:de\s+R\$)?",
        r"[àa]\s+vista",
    ]
    for padrao in padroes:
        m = re.search(padrao, texto, re.IGNORECASE)
        if m:
            if "vista" in m.group(0).lower():
                return "À vista"
            n = m.group(1) if m.lastindex and m.lastindex >= 1 else None
            if n:
                return f"Parcelado em {n}x"
    return None


def extrair_data_assinatura(texto: str, ultima_secao: str) -> str | None:
    """Prioriza data do log Clicksign; fallback: primeira data do contrato."""
    padrao_data = r"\d{2}/\d{2}/\d{4}"
    # Clicksign (última seção)
    datas_click = re.findall(padrao_data, ultima_secao)
    if datas_click:
        return datas_click[-1]
    # Fallback: primeira data do contrato
    datas = re.findall(padrao_data, texto)
    if datas:
        return datas[0]
    return None


def extrair_primeiro_vencimento(texto: str) -> str:
    padroes = [
        r"(?:primeiro\s+vencimento|1[°º]\s+vencimento|vencimento\s+da\s+primeira)[:\s]+(\d{2}/\d{2}/\d{4})",
        r"(?:venc(?:e|imento)?)[:\s]+(\d{2}/\d{2}/\d{4})",
    ]
    for padrao in padroes:
        m = re.search(padrao, texto, re.IGNORECASE)
        if m:
            return m.group(1)
    return "[A CONFIRMAR]"


# ---------------------------------------------------------------------------
# Exibição e revisão
# ---------------------------------------------------------------------------

CAMPOS_LABELS = {
    "razao_social": "Razão Social",
    "cnpj": "CNPJ",
    "endereco": "Endereço",
    "email_financeiro": "E-mail do financeiro",
    "valor_total": "Valor total",
    "forma_pagamento": "Forma de pagamento",
    "parcelamento": "Parcelamento",
    "data_assinatura": "Data de assinatura",
    "primeiro_vencimento": "1º vencimento",
}


def exibir_dados(dados: dict) -> None:
    print("\n" + "=" * 60)
    print("  DADOS EXTRAÍDOS DO CONTRATO")
    print("=" * 60)
    for campo, label in CAMPOS_LABELS.items():
        valor = dados.get(campo)
        icone = "✅" if valor and valor != "[A CONFIRMAR]" else "⚠️ "
        print(f"  {icone}  {label}: {valor or '(não encontrado)'}")
    print("=" * 60 + "\n")


def revisar_campos(dados: dict) -> dict:
    """Permite ao usuário corrigir campos não encontrados."""
    campos_revisar = [
        campo for campo, label in CAMPOS_LABELS.items()
        if not dados.get(campo) or dados[campo] == "[A CONFIRMAR]"
    ]
    if not campos_revisar:
        return dados

    print("⚠️  Alguns campos não foram encontrados automaticamente.")
    print("   Pressione Enter para manter em branco ou '[A CONFIRMAR]'.\n")

    for campo in campos_revisar:
        label = CAMPOS_LABELS[campo]
        atual = dados.get(campo) or ""
        valor = input(f"  → {label} [{atual}]: ").strip()
        if valor:
            dados[campo] = valor

    return dados


# ---------------------------------------------------------------------------
# Geração do e-mail
# ---------------------------------------------------------------------------

def gerar_email(dados: dict) -> tuple[str, str]:
    assunto = ASSUNTO_TEMPLATE.format(**dados)
    corpo = CORPO_TEMPLATE.format(**dados)
    return assunto, corpo


def salvar_email(caminho_pdf: Path, assunto: str, corpo: str) -> Path:
    saida = caminho_pdf.with_suffix(".txt")
    conteudo = f"ASSUNTO: {assunto}\n\n{corpo}\n"
    saida.write_text(conteudo, encoding="utf-8")
    return saida


def abrir_mailto(assunto: str, corpo: str) -> None:
    params = urllib.parse.urlencode(
        {"subject": assunto, "body": corpo},
        quote_via=urllib.parse.quote,
    )
    url = f"mailto:{DESTINATARIOS}?{params}"
    webbrowser.open(url)


# ---------------------------------------------------------------------------
# Fluxo principal
# ---------------------------------------------------------------------------

def obter_caminho_pdf(pdf_arg: str | None) -> Path:
    if pdf_arg:
        caminho = Path(pdf_arg)
        if not caminho.exists():
            sys.exit(f"❌ Arquivo não encontrado: {caminho}")
        if caminho.suffix.lower() != ".pdf":
            sys.exit(f"❌ O arquivo informado não é um PDF: {caminho}")
        return caminho

    # Modo interativo
    while True:
        entrada = input("📄 Informe o caminho do PDF do contrato: ").strip().strip('"')
        caminho = Path(entrada)
        if caminho.exists() and caminho.suffix.lower() == ".pdf":
            return caminho
        print(f"  ⚠️  Arquivo inválido ou não encontrado: {entrada}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gera e-mail de passagem de bastão — Logística Reversa IEL/GO"
    )
    parser.add_argument(
        "pdf",
        nargs="?",
        help="Caminho do PDF do contrato",
    )
    parser.add_argument(
        "--sem-revisao",
        action="store_true",
        help="Não solicita revisão interativa dos campos incompletos",
    )
    parser.add_argument(
        "--abrir-email",
        action="store_true",
        help="Abre o cliente de e-mail via mailto: ao finalizar",
    )
    args = parser.parse_args()

    print("\n🔍 Agente de Passagem de Bastão — Logística Reversa | IEL/GO")
    print("-" * 60)

    caminho_pdf = obter_caminho_pdf(args.pdf)

    print(f"\n📂 Processando: {caminho_pdf.name}")
    print("   Extraindo dados do contrato...")

    texto_completo, ultima_secao = extrair_texto(caminho_pdf)

    dados = {
        "razao_social": extrair_razao_social(texto_completo),
        "cnpj": extrair_cnpj(texto_completo),
        "endereco": extrair_endereco(texto_completo),
        "email_financeiro": extrair_email_financeiro(texto_completo, ultima_secao),
        "valor_total": extrair_valor_total(texto_completo),
        "forma_pagamento": extrair_forma_pagamento(texto_completo),
        "parcelamento": extrair_parcelamento(texto_completo),
        "data_assinatura": extrair_data_assinatura(texto_completo, ultima_secao),
        "primeiro_vencimento": extrair_primeiro_vencimento(texto_completo),
    }

    exibir_dados(dados)

    if not args.sem_revisao:
        dados = revisar_campos(dados)

    # Preenche valores ausentes com placeholder legível
    for campo in CAMPOS_LABELS:
        if not dados.get(campo):
            dados[campo] = f"[{CAMPOS_LABELS[campo].upper()} NÃO ENCONTRADO]"

    assunto, corpo = gerar_email(dados)

    print("\n📧 E-MAIL GERADO")
    print("=" * 60)
    print(f"ASSUNTO: {assunto}\n")
    print(corpo)
    print("=" * 60)

    saida = salvar_email(caminho_pdf, assunto, corpo)
    print(f"\n💾 E-mail salvo em: {saida}")

    if args.abrir_email:
        print("📨 Abrindo cliente de e-mail...")
        abrir_mailto(assunto, corpo)

    print("\n✅ Concluído!\n")


if __name__ == "__main__":
    main()
