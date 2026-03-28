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
from datetime import datetime
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit(
        "❌ Dependência ausente. Instale com:\n"
        "   pip install pdfplumber>=0.11.0"
    )

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

CNPJ_IEL = "01.647.296/0001-08"

DOMINIOS_IGNORADOS = {"fieg.com.br", "ielgoias.com.br", "clicksign.com", "iel.org.br"}

MESES_PT = {
    "janeiro": "01", "fevereiro": "02", "março": "03", "marco": "03",
    "abril": "04", "maio": "05", "junho": "06", "julho": "07",
    "agosto": "08", "setembro": "09", "outubro": "10",
    "novembro": "11", "dezembro": "12",
}

DESTINATARIOS = "isadora@iel.org.br;frederico@iel.org.br"

# ---------------------------------------------------------------------------
# Templates
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

# ---------------------------------------------------------------------------
# Extração de texto do PDF
# ---------------------------------------------------------------------------

def extrair_texto(caminho_pdf: Path) -> tuple[str, str]:
    """Retorna (texto_completo, log_clicksign)."""
    paginas = []
    with pdfplumber.open(caminho_pdf) as pdf:
        for page in pdf.pages:
            paginas.append(page.extract_text() or "")
    texto = "\n".join(paginas)

    # Log do Clicksign: tudo após a primeira ocorrência de "clicksign"
    idx = texto.lower().find("clicksign")
    log = texto[idx:] if idx >= 0 else texto[-3000:]
    return texto, log


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _primeiro_match(padrao: str, texto: str, flags: int = re.IGNORECASE) -> str:
    m = re.search(padrao, texto, flags)
    return m.group(1).strip() if m else ""


def _email_valido(email: str) -> bool:
    """Retorna True se o e-mail não pertence a domínio interno."""
    dominio = email.split("@")[-1].lower()
    return not any(dominio == d or dominio.endswith("." + d) for d in DOMINIOS_IGNORADOS)


def _data_extenso_para_numerico(texto_data: str) -> str:
    """Converte 'DD de mês de AAAA' para 'DD/MM/AAAA'."""
    m = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", texto_data, re.IGNORECASE)
    if not m:
        return texto_data
    dia, mes_str, ano = m.group(1), m.group(2).lower(), m.group(3)
    mes = MESES_PT.get(mes_str)
    if not mes:
        return texto_data
    return f"{int(dia):02d}/{mes}/{ano}"


def _data_clicksign_para_numerico(texto: str) -> str:
    """Converte 'DD mes AAAA' do log Clicksign para 'DD/MM/AAAA'.
    Ex: '17 mar 2026' → '17/03/2026'
    """
    MESES_ABREV = {
        "jan": "01", "fev": "02", "mar": "03", "abr": "04",
        "mai": "05", "jun": "06", "jul": "07", "ago": "08",
        "set": "09", "out": "10", "nov": "11", "dez": "12",
    }
    m = re.search(r"(\d{1,2})\s+([a-z]{3})\s+(\d{4})", texto, re.IGNORECASE)
    if m:
        dia, mes_abrev, ano = m.group(1), m.group(2).lower(), m.group(3)
        mes = MESES_ABREV.get(mes_abrev)
        if mes:
            return f"{int(dia):02d}/{mes}/{ano}"
    return ""


# ---------------------------------------------------------------------------
# Extração — campo por campo
# ---------------------------------------------------------------------------

def extrair_razao_social(texto: str) -> str:
    """Seção CONTRATANTE, linha 'Razão Social: ...'"""
    # Padrão primário: label explícito
    v = _primeiro_match(r"Raz[aã]o\s+Social:\s*(.+?)(?:\n|CNPJ|CPF)", texto, re.IGNORECASE | re.DOTALL)
    if v:
        v = re.split(r"\n|CNPJ|CPF", v)[0].strip().rstrip(".,;:")
        if v and v.upper() not in ("INSTITUTO EUVALDO LODI", "IEL"):
            return v

    # Fallback: após "CONTRATANTE" antes de "CONTRATADO"
    bloco = _primeiro_match(
        r"CONTRATANTE\b(.{0,800}?)(?:CONTRATADO\b|Cl[aá]usula\s+Primeira)",
        texto, re.IGNORECASE | re.DOTALL
    )
    if bloco:
        for linha in bloco.splitlines():
            linha = linha.strip()
            if re.search(r"(?:LTDA|S\.A\.|EIRELI|ME|EPP|SA\b)", linha, re.IGNORECASE):
                if "INSTITUTO EUVALDO LODI" not in linha.upper():
                    return linha.rstrip(".,;:")
    return ""


def extrair_cnpj(texto: str) -> str:
    """Seção CONTRATANTE, primeiro CNPJ que não seja o do IEL."""
    padrao = r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}"
    for cnpj in re.findall(padrao, texto):
        # Normaliza para XX.XXX.XXX/XXXX-XX
        d = re.sub(r"\D", "", cnpj)
        if len(d) == 14:
            fmt = f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"
            if fmt != CNPJ_IEL:
                return fmt
    return ""


def extrair_endereco(texto: str) -> str:
    """Seção CONTRATANTE, linha 'Endereço: ...'"""
    v = _primeiro_match(
        r"Endere[çc]o:\s*(.+?)(?:\n(?:Representante|Cargo|CNPJ|CPF|E-?mail)|$)",
        texto, re.IGNORECASE | re.DOTALL
    )
    if v:
        return " ".join(v.split())
    return ""


def extrair_representante(texto: str) -> str:
    """Seção CONTRATANTE, linha 'Representante: ...'"""
    v = _primeiro_match(
        r"Representante:\s*(.+?)(?:\n|Cargo|CPF|$)",
        texto, re.IGNORECASE | re.DOTALL
    )
    return v.split("\n")[0].strip() if v else ""


def extrair_email_financeiro(texto: str, log: str) -> str:
    """
    Prioridade 1: log Clicksign — padrão 'assinou. Pontos de autenticação: Token via E-mail email@...'
    Prioridade 2: qualquer e-mail externo no texto completo.
    """
    # Padrão exato do log Clicksign
    m = re.search(
        r"assinou\.\s*Pontos\s+de\s+autentica[çc][aã]o:.*?Token\s+via\s+E-?mail\s+(\S+@\S+\.\S+)",
        log, re.IGNORECASE | re.DOTALL
    )
    if m:
        email = m.group(1).strip().rstrip(".,;)")
        if _email_valido(email):
            return email.lower()

    # Todos os e-mails do log Clicksign (sem o padrão exato)
    for email in re.findall(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", log):
        if _email_valido(email):
            return email.lower()

    # Fallback: corpo do contrato
    for email in re.findall(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", texto):
        if _email_valido(email):
            return email.lower()

    return ""


def extrair_valor_total(texto: str) -> str:
    """Cláusula Sexta — tabela 'VALOR | R$ X.XXX,XX'"""
    # Padrão da tabela estruturada
    v = _primeiro_match(r"VALOR\s+R\$\s*([\d.,]+)", texto, re.IGNORECASE)
    if v:
        return f"R$ {v}"

    # Fallback: R$ com centavos
    valores = re.findall(r"R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}", texto)
    if valores:
        return valores[-1].strip()
    return ""


def extrair_forma_pagamento(texto: str) -> str:
    """Cláusula Sexta — tabela 'MODALIDADE | ...'"""
    v = _primeiro_match(r"MODALIDADE\s+(Boleto[^\n]*|Cart[aã]o[^\n]*)", texto, re.IGNORECASE)
    if v:
        v_lower = v.lower()
        if "cart" in v_lower:
            return "Cartão de crédito"
        return "Boleto bancário"

    # Fallback por palavra-chave
    if re.search(r"cart[aã]o\s+de\s+cr[eé]dito", texto, re.IGNORECASE):
        return "Cartão de crédito"
    if re.search(r"boleto", texto, re.IGNORECASE):
        return "Boleto bancário"
    return ""


def extrair_parcelamento(texto: str) -> str:
    """Cláusula Sexta — tabela 'PARCELAMENTO | 12x' ou 'À vista'"""
    # Padrão da tabela estruturada
    v = _primeiro_match(r"PARCELAMENTO\s+(\d+x|[Àà]\s*vista[^\n]*)", texto, re.IGNORECASE)
    if v:
        if re.match(r"(\d+)x", v, re.IGNORECASE):
            n = int(re.match(r"(\d+)", v).group(1))
            return "À vista" if n <= 1 else f"Parcelado em {n}x"
        return "À vista"

    # Fallback
    m = re.search(r"(?:parcelado\s+em\s+)?(\d+)\s*x\b", texto, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        return "À vista" if n <= 1 else f"Parcelado em {n}x"
    if re.search(r"\b[àa]\s*vista\b", texto, re.IGNORECASE):
        return "À vista"
    return ""


def extrair_data_assinatura(texto: str, log: str) -> str:
    """
    Prioridade 1: 'Goiânia, DD de mês de AAAA' no corpo.
    Prioridade 2: última data 'DD mes AAAA' do log Clicksign.
    """
    # Corpo do contrato
    v = _primeiro_match(r"Goi[âa]nia,?\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})", texto, re.IGNORECASE)
    if v:
        d = _data_extenso_para_numerico(v)
        if re.match(r"\d{2}/\d{2}/\d{4}", d):
            return d

    # Log Clicksign — última data
    datas_log = re.findall(
        r"(\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\s+\d{4})",
        log, re.IGNORECASE
    )
    if datas_log:
        d = _data_clicksign_para_numerico(datas_log[-1])
        if d:
            return d

    # Fallback: primeira data DD/MM/AAAA do texto
    datas = re.findall(r"\d{2}/\d{2}/\d{4}", texto)
    return datas[0] if datas else datetime.today().strftime("%d/%m/%Y")


def extrair_primeiro_vencimento(texto: str) -> str:
    """
    Busca 'primeiro vencimento' ou 'vencimento da primeira parcela' no contrato.
    Se não encontrado, retorna '[A CONFIRMAR]'.
    """
    v = _primeiro_match(
        r"(?:primeiro\s+vencimento|vencimento\s+da\s+primeira\s+parcela|1[°º]\s+vencimento)[:\s]+(\d{2}/\d{2}/\d{4})",
        texto, re.IGNORECASE
    )
    return v if v else "[A CONFIRMAR]"


# ---------------------------------------------------------------------------
# Validações
# ---------------------------------------------------------------------------

ERRO_EXTRACAO = "[ERRO NA EXTRAÇÃO - VERIFICAR]"


def validar(dados: dict) -> dict:
    """Substitui campos inválidos por ERRO_EXTRACAO."""
    result = dict(dados)

    # Razão Social não pode ser IEL
    if not result["razao_social"] or "INSTITUTO EUVALDO LODI" in result["razao_social"].upper():
        result["razao_social"] = ERRO_EXTRACAO

    # CNPJ deve ter formato correto e não ser do IEL
    cnpj = result["cnpj"]
    if not re.match(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$", cnpj) or cnpj == CNPJ_IEL:
        result["cnpj"] = ERRO_EXTRACAO

    # E-mail não pode ter domínio interno
    email = result["email_financeiro"]
    if email and not _email_valido(email):
        result["email_financeiro"] = ERRO_EXTRACAO

    # Valor deve começar com R$ e ter vírgula decimal
    valor = result["valor_total"]
    if not re.match(r"R\$\s*\d+.*,\d{2}$", valor):
        result["valor_total"] = ERRO_EXTRACAO

    return result


# ---------------------------------------------------------------------------
# Montagem dos dados
# ---------------------------------------------------------------------------

def extrair_dados(texto: str, log: str) -> dict:
    dados = {
        "razao_social":        extrair_razao_social(texto),
        "cnpj":                extrair_cnpj(texto),
        "endereco":            extrair_endereco(texto),
        "representante":       extrair_representante(texto),
        "email_financeiro":    extrair_email_financeiro(texto, log),
        "valor_total":         extrair_valor_total(texto),
        "forma_pagamento":     extrair_forma_pagamento(texto),
        "parcelamento":        extrair_parcelamento(texto),
        "data_assinatura":     extrair_data_assinatura(texto, log),
        "primeiro_vencimento": extrair_primeiro_vencimento(texto),
    }
    # Preenche campos vazios com placeholder
    for k, v in dados.items():
        if not v:
            dados[k] = f"[NÃO ENCONTRADO]"
    return validar(dados)


# ---------------------------------------------------------------------------
# Exibição
# ---------------------------------------------------------------------------

ROTULOS = {
    "razao_social":        "Razão Social",
    "cnpj":                "CNPJ",
    "endereco":            "Endereço",
    "representante":       "Representante",
    "email_financeiro":    "E-mail do financeiro",
    "valor_total":         "Valor total",
    "forma_pagamento":     "Forma de pagamento",
    "parcelamento":        "Parcelamento",
    "data_assinatura":     "Data de assinatura",
    "primeiro_vencimento": "1º vencimento",
}

SEP = "=" * 70


def exibir_dados(dados: dict) -> None:
    print(f"\n{SEP}")
    print("  DADOS EXTRAÍDOS DO CONTRATO")
    print(SEP)
    for campo, rotulo in ROTULOS.items():
        valor = dados.get(campo, "")
        if ERRO_EXTRACAO in valor:
            icone = "🔴"
        elif "[" in valor:
            icone = "⚠️ "
        else:
            icone = "✅"
        print(f"  {icone} {rotulo:<25} {valor}")
    print(SEP)


def exibir_email(assunto: str, corpo: str) -> None:
    print(f"\n{SEP}")
    print("  E-MAIL GERADO")
    print(SEP)
    print(f"  ASSUNTO: {assunto}\n")
    print(corpo)
    print(SEP)


def salvar_txt(assunto: str, corpo: str, caminho_pdf: Path) -> Path:
    saida = caminho_pdf.parent / f"{caminho_pdf.stem}_email_bastao.txt"
    saida.write_text(f"ASSUNTO: {assunto}\n\n{corpo}", encoding="utf-8")
    return saida


# ---------------------------------------------------------------------------
# Revisão interativa
# ---------------------------------------------------------------------------

def revisar_campos(dados: dict) -> dict:
    pendentes = [k for k, v in dados.items() if "[" in v]
    if not pendentes:
        return dados

    print("\n⚠️  Campos pendentes de revisão. Enter para manter, ou digite o valor correto:\n")
    for campo in pendentes:
        rotulo = ROTULOS.get(campo, campo)
        novo = input(f"  {rotulo} [{dados[campo]}]: ").strip()
        if novo:
            dados[campo] = novo
    return dados


# ---------------------------------------------------------------------------
# Ponto de entrada
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gera e-mail de passagem de bastão – Logística Reversa IEL/GO",
        epilog="Exemplo: python agente_bastao.py contrato.pdf",
    )
    parser.add_argument("pdf", nargs="?", help="Caminho do arquivo PDF")
    parser.add_argument("--sem-revisao", action="store_true", help="Pular revisão interativa")
    parser.add_argument("--abrir-email", action="store_true", help="Abrir cliente de e-mail")
    args = parser.parse_args()

    # Obter arquivo
    caminho = args.pdf
    if not caminho:
        caminho = input("Caminho do PDF: ").strip()
    if not caminho:
        sys.exit("❌ Nenhum arquivo informado.")

    pdf = Path(caminho)
    if not pdf.is_file():
        sys.exit(f"❌ Arquivo não encontrado: {caminho}")

    print(f"\n📄  Processando: {pdf.name}")

    # Extrair
    try:
        texto, log = extrair_texto(pdf)
    except Exception as e:
        sys.exit(f"❌ Erro ao ler PDF: {e}")

    if not texto.strip():
        sys.exit("❌ PDF sem texto extraível (pode ser escaneado/imagem).")

    dados = extrair_dados(texto, log)
    exibir_dados(dados)

    # Revisão
    if not args.sem_revisao:
        dados = revisar_campos(dados)

    # Gerar e-mail
    assunto = ASSUNTO_TEMPLATE.format(**dados)
    corpo = CORPO_TEMPLATE.format(**dados)
    exibir_email(assunto, corpo)

    # Salvar
    txt = salvar_txt(assunto, corpo, pdf)
    print(f"\n💾  Salvo em: {txt}")

    # Abrir cliente
    abrir = args.abrir_email
    if not abrir:
        abrir = input("\nAbrir cliente de e-mail? [s/N]: ").strip().lower() in ("s", "sim")
    if abrir:
        mailto = (
            f"mailto:{DESTINATARIOS}"
            f"?subject={urllib.parse.quote(assunto)}"
            f"&body={urllib.parse.quote(corpo)}"
        )
        webbrowser.open(mailto)

    print("\n✅  Concluído.\n")


if __name__ == "__main__":
    main()
