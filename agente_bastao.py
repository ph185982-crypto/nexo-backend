#!/usr/bin/env python3
"""
agente_bastao.py — Gerador de e-mail de passagem de bastão
Logística Reversa | IEL/GO

Uso:
    python agente_bastao.py contrato.pdf
    python agente_bastao.py *.pdf
    python agente_bastao.py contrato.pdf --salvar
    python agente_bastao.py contrato.pdf --sem-revisao --abrir-email
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

DOMINIOS_BLOQUEADOS = {
    "fieg.com.br",
    "ielgoias.com.br",
    "clicksign.com",
    "iel.org.br",
    "linhaetica.com.br",
}

# Prefixos de usuário bloqueados (parte antes do @)
USUARIOS_BLOQUEADOS = {
    "linhaetica",
    "contratos.iel",
    "leandra.iel",
    "humberto.iel",
    "pedrohms.iel",
    "victorleite.iel",
    "comunicacao.iel",
}

MESES_PT = {
    "janeiro": "01", "fevereiro": "02", "março": "03", "marco": "03",
    "abril": "04", "maio": "05", "junho": "06", "julho": "07",
    "agosto": "08", "setembro": "09", "outubro": "10",
    "novembro": "11", "dezembro": "12",
}

MESES_ABREV = {
    "jan": "01", "fev": "02", "mar": "03", "abr": "04",
    "mai": "05", "jun": "06", "jul": "07", "ago": "08",
    "set": "09", "out": "10", "nov": "11", "dez": "12",
}

DESTINATARIOS = "isadora@iel.org.br;frederico@iel.org.br"

ERRO = "[ERRO - VERIFICAR]"
NAO_ENCONTRADO = "[A CONFIRMAR]"

# ---------------------------------------------------------------------------
# Templates de e-mail
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
# Pré-processamento
# ---------------------------------------------------------------------------

def normalizar(texto: str) -> str:
    if not texto:
        return ""
    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r" \n", "\n", texto)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    return texto.strip()


def extrair_texto_pdf(caminho: Path) -> tuple[str, str, str]:
    """Retorna (texto_completo, secao_contratante, log_clicksign)."""
    paginas = []
    with pdfplumber.open(caminho) as pdf:
        for page in pdf.pages:
            paginas.append(normalizar(page.extract_text() or ""))
    texto = "\n".join(paginas)

    # Seção CONTRATANTE: tudo antes de "CONTRATADO"
    idx_contratado = re.search(r"\bCONTRATADO\b", texto)
    secao_contratante = texto[: idx_contratado.start()] if idx_contratado else texto

    # Log Clicksign: tudo a partir de "Clicksign" ou últimas 3000 chars
    idx_click = texto.lower().find("clicksign")
    log = texto[idx_click:] if idx_click >= 0 else texto[-3000:]

    return texto, secao_contratante, log

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _m(padrao: str, texto: str, flags: int = re.IGNORECASE) -> str:
    """Retorna group(1) do primeiro match ou string vazia."""
    m = re.search(padrao, texto, flags)
    return m.group(1).strip() if m else ""


def _email_permitido(email: str) -> bool:
    email = email.lower()
    usuario, dominio = email.rsplit("@", 1) if "@" in email else (email, "")
    if any(dominio == d or dominio.endswith("." + d) for d in DOMINIOS_BLOQUEADOS):
        return False
    if any(usuario == u or usuario.endswith("." + u) for u in USUARIOS_BLOQUEADOS):
        return False
    return True


def _data_extenso_para_numerico(texto: str) -> str:
    """'17 de março de 2026' → '17/03/2026'."""
    m = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", texto, re.IGNORECASE)
    if not m:
        return ""
    dia, mes_str, ano = m.group(1), m.group(2).lower(), m.group(3)
    mes = MESES_PT.get(mes_str)
    return f"{int(dia):02d}/{mes}/{ano}" if mes else ""


def _data_abrev_para_numerico(texto: str) -> str:
    """'17 mar 2026' → '17/03/2026'."""
    m = re.search(r"(\d{1,2})\s+([a-z]{3})\w*\s+(\d{4})", texto, re.IGNORECASE)
    if not m:
        return ""
    dia, abrev, ano = m.group(1), m.group(2).lower(), m.group(3)
    mes = MESES_ABREV.get(abrev)
    return f"{int(dia):02d}/{mes}/{ano}" if mes else ""


def _normalizar_cnpj(raw: str) -> str:
    d = re.sub(r"\D", "", raw)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"
    return raw

# ---------------------------------------------------------------------------
# Extração — campo por campo
# ---------------------------------------------------------------------------

def extrair_razao_social(secao_contratante: str) -> str:
    """Primeira ocorrência de 'Razão Social:' na seção CONTRATANTE."""
    v = _m(r"Raz[aã]o\s+Social:\s*([^\n]+)", secao_contratante)
    if v:
        v = v.rstrip(".,;:")
        if "INSTITUTO EUVALDO LODI" not in v.upper():
            return v
    return ""


def extrair_cnpj(secao_contratante: str) -> str:
    """Primeiro CNPJ na seção CONTRATANTE que não seja do IEL."""
    # Busca com label explícito primeiro
    v = _m(
        r"CNPJ:\s*(\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})",
        secao_contratante
    )
    if v:
        fmt = _normalizar_cnpj(v)
        if fmt != CNPJ_IEL:
            return fmt

    # Fallback: qualquer CNPJ na seção
    for raw in re.findall(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}", secao_contratante):
        fmt = _normalizar_cnpj(raw)
        if fmt != CNPJ_IEL:
            return fmt
    return ""


def extrair_endereco(secao_contratante: str) -> str:
    """Label 'Endereço:' na seção CONTRATANTE."""
    v = _m(
        r"Endere[çc]o:\s*(.+?)(?=\n(?:Representante|Cargo|E-?mail|CNPJ|CPF)|$)",
        secao_contratante,
        re.IGNORECASE | re.DOTALL,
    )
    if v:
        return " ".join(v.split())
    return ""


def extrair_representante(secao_contratante: str) -> str:
    """Label 'Representante:' na seção CONTRATANTE."""
    v = _m(
        r"Representante:\s*([^\n]+)",
        secao_contratante,
    )
    return v.rstrip(".,;:") if v else ""


def extrair_email(texto: str, log: str, representante: str) -> str:
    """
    Prioridade:
    1. Log Clicksign — padrão 'Token via E-mail [email]' próximo ao nome do representante.
    2. Log Clicksign — qualquer 'Token via E-mail [email]' de domínio externo.
    3. Qualquer e-mail externo no texto completo.
    """
    padrao_token = r"Token\s+via\s+E-?mail\s+([\w.+\-]+@[\w.\-]+\.\w+)"

    # Todos os e-mails encontrados após "Token via E-mail"
    emails_token = re.findall(padrao_token, log, re.IGNORECASE)
    externos = [e.lower() for e in emails_token if _email_permitido(e)]

    # Se há representante, priorizar e-mail na mesma vizinhança
    if externos and representante:
        primeiro_nome = representante.strip().split()[0].lower()
        for trecho in re.split(r"\n{2,}", log):
            if primeiro_nome in trecho.lower():
                for email in re.findall(padrao_token, trecho, re.IGNORECASE):
                    if _email_permitido(email):
                        return email.lower()

    if externos:
        return externos[0]

    # Fallback: qualquer e-mail externo no log
    for email in re.findall(r"[\w.+\-]+@[\w.\-]+\.\w+", log):
        if _email_permitido(email):
            return email.lower()

    # Fallback final: corpo do contrato
    for email in re.findall(r"[\w.+\-]+@[\w.\-]+\.\w+", texto):
        if _email_permitido(email):
            return email.lower()

    return ""


def extrair_valor(texto: str) -> str:
    """Tabela VALOR/MODALIDADE/PARCELAMENTO — Cláusula Sexta."""
    # Camada 1: bloco entre VALOR e MODALIDADE
    bloco = re.search(r"VALOR(.{1,80}?)MODALIDADE", texto, re.DOTALL | re.IGNORECASE)
    if bloco:
        val = re.search(r"R\$\s*([\d.,]+)", bloco.group(1))
        if val:
            return f"R$ {val.group(1).strip()}"

    # Camada 2: padrões diretos
    for p in [
        r"VALOR\s+R\$\s*([\d.,]+)",
        r"VALOR\s*\n\s*R\$\s*([\d.,]+)",
        r"VALOR\s+R\$([\d.,]+)",
    ]:
        v = _m(p, texto)
        if v:
            return f"R$ {v}"

    # Camada 3: número monetário próximo à palavra VALOR
    m = re.search(r"VALOR[^\n]{0,30}(\d{1,3}(?:\.\d{3})*,\d{2})", texto)
    if m:
        return f"R$ {m.group(1)}"

    return ""


def extrair_modalidade(texto: str) -> str:
    """Bloco entre MODALIDADE e PARCELAMENTO."""
    bloco = re.search(r"MODALIDADE(.{1,100}?)PARCELAMENTO", texto, re.DOTALL | re.IGNORECASE)
    conteudo = " ".join(bloco.group(1).split()).lower() if bloco else ""

    if "boleto" in conteudo:
        return "Boleto bancário"
    if "cart" in conteudo:
        return "Cartão de crédito"
    if "pix" in conteudo:
        return "PIX"

    # Fallback: linha após MODALIDADE
    v = _m(r"MODALIDADE\s*\n?\s*([^\n]+)", texto)
    if v:
        vl = v.lower()
        if "boleto" in vl:
            return "Boleto bancário"
        if "cart" in vl:
            return "Cartão de crédito"
        if "pix" in vl:
            return "PIX"
        return v

    return ""


def extrair_parcelamento(texto: str) -> str:
    """Linha após PARCELAMENTO."""
    # Tabela estruturada
    v = _m(r"PARCELAMENTO\s*\n?\s*(\d+\s*x|[àÀ]\s*vista[^\n]*)", texto)
    if v:
        m = re.match(r"(\d+)\s*x", v, re.IGNORECASE)
        if m:
            n = int(m.group(1))
            return "À vista" if n <= 1 else f"Parcelado em {n}x"
        return "À vista"

    # Fallback
    m = re.search(r"(\d+)\s*x\b", texto, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        return "À vista" if n <= 1 else f"Parcelado em {n}x"
    if re.search(r"\b[àa]\s*vista\b", texto, re.IGNORECASE):
        return "À vista"
    return ""


def extrair_vencimento(texto: str) -> str:
    """'primeiro vencimento' no corpo ou '[A CONFIRMAR]'."""
    v = _m(
        r"(?:primeiro\s+vencimento|vencimento\s+da\s+primeira\s+parcela)"
        r"[:\s]+(\d{2}/\d{2}/\d{4})",
        texto,
    )
    return v if v else NAO_ENCONTRADO


def extrair_data_assinatura(texto: str, log: str) -> str:
    """'Goiânia, DD de mês de AAAA' ou última data no log Clicksign."""
    # Corpo do contrato
    v = _m(r"Goi[aâ]nia,?\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})", texto)
    if v:
        d = _data_extenso_para_numerico(v)
        if re.match(r"\d{2}/\d{2}/\d{4}", d):
            return d

    # Log Clicksign — última data no formato "DD mes AAAA"
    datas = re.findall(
        r"\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\s+\d{4}",
        log, re.IGNORECASE
    )
    if datas:
        d = _data_abrev_para_numerico(datas[-1])
        if d:
            return d

    # Fallback: primeira data DD/MM/AAAA no texto
    datas = re.findall(r"\d{2}/\d{2}/\d{4}", texto)
    return datas[0] if datas else datetime.today().strftime("%d/%m/%Y")

# ---------------------------------------------------------------------------
# Validação
# ---------------------------------------------------------------------------

def validar(dados: dict) -> dict:
    """Marca campos inválidos com ERRO."""
    if not dados["razao_social"] or "INSTITUTO EUVALDO LODI" in dados["razao_social"].upper():
        dados["razao_social"] = ERRO

    cnpj = dados["cnpj"]
    if not re.match(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$", cnpj) or cnpj == CNPJ_IEL:
        dados["cnpj"] = ERRO

    email = dados["email_financeiro"]
    if email and not _email_permitido(email):
        dados["email_financeiro"] = ERRO

    if not re.match(r"R\$\s*[\d.,]+", dados.get("valor_total", "")):
        dados["valor_total"] = dados.get("valor_total") or NAO_ENCONTRADO

    return dados

# ---------------------------------------------------------------------------
# Orquestração principal
# ---------------------------------------------------------------------------

def processar_contrato(caminho: Path) -> dict:
    texto, sec_contratante, log = extrair_texto_pdf(caminho)

    dados = {
        "razao_social":        extrair_razao_social(sec_contratante),
        "cnpj":                extrair_cnpj(sec_contratante),
        "endereco":            extrair_endereco(sec_contratante),
        "representante":       extrair_representante(sec_contratante),
        "email_financeiro":    "",
        "valor_total":         extrair_valor(texto),
        "forma_pagamento":     extrair_modalidade(texto),
        "parcelamento":        extrair_parcelamento(texto),
        "primeiro_vencimento": extrair_vencimento(texto),
        "data_assinatura":     extrair_data_assinatura(texto, log),
    }
    dados["email_financeiro"] = extrair_email(texto, log, dados["representante"])

    # Preencher vazios
    for k, v in dados.items():
        if not v:
            dados[k] = NAO_ENCONTRADO

    return validar(dados)


def gerar_email(dados: dict) -> tuple[str, str]:
    assunto = ASSUNTO_TEMPLATE.format(**dados)
    corpo = CORPO_TEMPLATE.format(**dados)
    return assunto, corpo

# ---------------------------------------------------------------------------
# Exibição no terminal
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


def exibir_dados(dados: dict, nome_arquivo: str = "") -> None:
    print(f"\n{SEP}")
    if nome_arquivo:
        print(f"  ARQUIVO: {nome_arquivo}")
    print("  DADOS EXTRAÍDOS")
    print(SEP)
    erros = []
    for campo, rotulo in ROTULOS.items():
        valor = dados.get(campo, "")
        if ERRO in valor:
            icone = "🔴"
            erros.append(rotulo)
        elif NAO_ENCONTRADO in valor or "[" in valor:
            icone = "⚠️ "
        else:
            icone = "✅"
        print(f"  {icone} {rotulo:<25} {valor}")
    print(SEP)
    if erros:
        print(f"\n  ❌ Campos com erro: {', '.join(erros)}")
        print("     Preencha manualmente antes de enviar o e-mail.")


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
    print("\n⚠️  Campos pendentes. Enter para manter, ou digite o valor correto:\n")
    for campo in pendentes:
        rotulo = ROTULOS.get(campo, campo)
        novo = input(f"  {rotulo} [{dados[campo]}]: ").strip()
        if novo:
            dados[campo] = novo
    return dados

# ---------------------------------------------------------------------------
# Processamento de um único PDF
# ---------------------------------------------------------------------------

def processar_um(caminho: Path, args: argparse.Namespace) -> None:
    print(f"\n📄  Processando: {caminho.name}")
    try:
        texto_raw = ""
        with pdfplumber.open(caminho) as pdf:
            texto_raw = "\n".join(p.extract_text() or "" for p in pdf.pages)
        if not texto_raw.strip():
            print("❌  PDF sem texto extraível (escaneado/imagem). Ignorando.")
            return
    except Exception as e:
        print(f"❌  Erro ao abrir PDF: {e}")
        return

    dados = processar_contrato(caminho)
    exibir_dados(dados, caminho.name)

    if not args.sem_revisao:
        dados = revisar_campos(dados)

    assunto, corpo = gerar_email(dados)
    exibir_email(assunto, corpo)

    if args.salvar:
        txt = salvar_txt(assunto, corpo, caminho)
        print(f"\n💾  Salvo em: {txt}")

    abrir = args.abrir_email
    if not abrir and not args.sem_revisao:
        abrir = input("\nAbrir cliente de e-mail? [s/N]: ").strip().lower() in ("s", "sim")
    if abrir:
        mailto = (
            f"mailto:{DESTINATARIOS}"
            f"?subject={urllib.parse.quote(assunto)}"
            f"&body={urllib.parse.quote(corpo)}"
        )
        webbrowser.open(mailto)

# ---------------------------------------------------------------------------
# Ponto de entrada
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gera e-mail de passagem de bastão – Logística Reversa IEL/GO",
        epilog=(
            "Exemplos:\n"
            "  python agente_bastao.py contrato.pdf\n"
            "  python agente_bastao.py *.pdf --salvar\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("pdfs", nargs="*", help="Arquivo(s) PDF do contrato")
    parser.add_argument("--salvar",       action="store_true", help="Salvar e-mail em .txt")
    parser.add_argument("--sem-revisao",  action="store_true", help="Pular revisão interativa")
    parser.add_argument("--abrir-email",  action="store_true", help="Abrir cliente de e-mail")
    args = parser.parse_args()

    # Coletar caminhos
    caminhos: list[Path] = []
    if args.pdfs:
        for p in args.pdfs:
            path = Path(p)
            if path.is_file():
                caminhos.append(path)
            else:
                print(f"⚠️  Arquivo não encontrado: {p}")
    else:
        entrada = input("Caminho do PDF: ").strip()
        if not entrada:
            sys.exit("❌ Nenhum arquivo informado.")
        caminhos = [Path(entrada)]

    if not caminhos:
        sys.exit("❌ Nenhum arquivo válido encontrado.")

    for caminho in caminhos:
        processar_um(caminho, args)
        if len(caminhos) > 1:
            print("\n" + "-" * 70)

    print("\n✅  Concluído.\n")


if __name__ == "__main__":
    main()
