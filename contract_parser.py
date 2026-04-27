"""
contract_parser.py — Hybrid parser for IEL/GO Logística Reversa contracts.

Exported API (do not change — consumed by agente_bastao.py and gerar.py):
    parse_contract(text, sec_contratante, log) -> dict

Internal routing:
    is_structured_format(text)          -> bool
    parse_structured_contract(...)      -> dict   (legacy, existing logic)
    parse_unstructured_contract(text)   -> dict   (new, AI-assisted)
"""

import json
import logging
import os
import re
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

CNPJ_IEL = "01.647.296/0001-08"

DOMINIOS_BLOQUEADOS = {
    "fieg.com.br", "ielgoias.com.br", "clicksign.com",
    "iel.org.br", "linhaetica.com.br",
}
USUARIOS_BLOQUEADOS = {
    "linhaetica", "contratos.iel", "leandra.iel", "humberto.iel",
    "pedrohms.iel", "victorleite.iel", "comunicacao.iel",
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

ERRO = "[ERRO - VERIFICAR]"
NAO_ENCONTRADO = "[A CONFIRMAR]"

# Structured format requires at least this many markers to be present
_STRUCTURED_MARKERS = [
    "CONTRATANTE", "CONTRATADO", "MODALIDADE", "PARCELAMENTO",
    "Razão Social", "CLÁUSULA",
]
_STRUCTURED_THRESHOLD = 4

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def normalizar(texto: str) -> str:
    if not texto:
        return ""
    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r" \n", "\n", texto)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    return texto.strip()


def _m(padrao: str, texto: str, flags: int = re.IGNORECASE) -> str:
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


def _normalizar_cnpj(raw: str) -> str:
    d = re.sub(r"\D", "", raw)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"
    return raw


def _data_extenso(texto: str) -> str:
    m = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", texto, re.IGNORECASE)
    if not m:
        return ""
    dia, mes_str, ano = m.group(1), m.group(2).lower(), m.group(3)
    mes = MESES_PT.get(mes_str)
    return f"{int(dia):02d}/{mes}/{ano}" if mes else ""


def _data_abrev(texto: str) -> str:
    m = re.search(r"(\d{1,2})\s+([a-z]{3})\w*\s+(\d{4})", texto, re.IGNORECASE)
    if not m:
        return ""
    dia, abrev, ano = m.group(1), m.group(2).lower(), m.group(3)
    mes = MESES_ABREV.get(abrev)
    return f"{int(dia):02d}/{mes}/{ano}" if mes else ""


def _moeda_para_float(valor_str: str) -> Optional[float]:
    """'R$ 1.798,80' or '1.798,80' → 1798.80"""
    clean = re.sub(r"[R$\s]", "", valor_str).replace(".", "").replace(",", ".")
    try:
        return float(clean)
    except ValueError:
        return None

# ---------------------------------------------------------------------------
# FORMAT DETECTION
# ---------------------------------------------------------------------------

def is_structured_format(text: str) -> bool:
    """
    Returns True when text looks like the known IEL/GO structured template.
    Structured = has CONTRATANTE/CONTRATADO tables + MODALIDADE/PARCELAMENTO rows.
    """
    found = sum(
        1 for m in _STRUCTURED_MARKERS
        if re.search(re.escape(m), text, re.IGNORECASE)
    )
    logger.debug("Structured marker count: %d / %d", found, _STRUCTURED_THRESHOLD)
    return found >= _STRUCTURED_THRESHOLD

# ---------------------------------------------------------------------------
# ── LEGACY PARSER (structured contracts) ──────────────────────────────────
# ---------------------------------------------------------------------------

def _sc_razao_social(sec: str) -> str:
    v = _m(r"Raz[aã]o\s+Social:\s*([^\n]+)", sec)
    if v:
        v = v.rstrip(".,;:")
        if "INSTITUTO EUVALDO LODI" not in v.upper():
            return v
    return ""


def _sc_cnpj(sec: str) -> str:
    v = _m(r"CNPJ:\s*(\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})", sec)
    if v:
        fmt = _normalizar_cnpj(v)
        if fmt != CNPJ_IEL:
            return fmt
    for raw in re.findall(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}", sec):
        fmt = _normalizar_cnpj(raw)
        if fmt != CNPJ_IEL:
            return fmt
    return ""


def _sc_endereco(sec: str) -> str:
    v = _m(
        r"Endere[çc]o:\s*(.+?)(?=\n(?:Representante|Cargo|E-?mail|CNPJ|CPF)|$)",
        sec, re.IGNORECASE | re.DOTALL,
    )
    return " ".join(v.split()) if v else ""


def _sc_representante(sec: str) -> str:
    v = _m(r"Representante:\s*([^\n]+)", sec)
    return v.rstrip(".,;:") if v else ""


def _sc_telefone(sec: str) -> str:
    v = _m(r"(?:Telefone|Tel|Celular|Fone)[:\s]+(\(?\d{2}\)?\s*[\d\s\-]{8,13})", sec)
    if v:
        return re.sub(r"\s+", " ", v).strip()
    m = re.search(r"\((\d{2})\)\s*(\d{4,5})[-\s]?(\d{4})", sec)
    if m:
        return f"({m.group(1)}) {m.group(2)}-{m.group(3)}"
    return ""


def _sc_email(texto: str, log: str, representante: str) -> str:
    # Priority 1: main signer — "assinou." without "como"/"para" before the dot
    signatarios = re.findall(
        r"\bassinou\.\s+Pontos\s+de\s+autentica[çc][aã]o.*?Token\s+via\s+E-?mail\s+([\w.+\-]+@[\w.\-]+\.\w+)",
        log, re.IGNORECASE,
    )
    externos = [e.lower() for e in signatarios if _email_permitido(e)]

    if externos and representante:
        primeiro_nome = representante.strip().split()[0].lower()
        for trecho in re.split(r"\n{2,}", log):
            if primeiro_nome in trecho.lower():
                for email in re.findall(
                    r"\bassinou\.\s+Pontos.*?Token\s+via\s+E-?mail\s+([\w.+\-]+@[\w.\-]+\.\w+)",
                    trecho, re.IGNORECASE,
                ):
                    if _email_permitido(email):
                        return email.lower()

    if externos:
        return externos[0]

    for email in re.findall(r"Token\s+via\s+E-?mail\s+([\w.+\-]+@[\w.\-]+\.\w+)", log, re.IGNORECASE):
        if _email_permitido(email):
            return email.lower()

    for email in re.findall(r"[\w.+\-]+@[\w.\-]+\.\w+", log):
        if _email_permitido(email):
            return email.lower()

    for email in re.findall(r"[\w.+\-]+@[\w.\-]+\.\w+", texto):
        if _email_permitido(email):
            return email.lower()

    return ""


def _sc_valor(texto: str) -> str:
    bloco = re.search(r"VALOR(.{1,80}?)MODALIDADE", texto, re.DOTALL | re.IGNORECASE)
    if bloco:
        val = re.search(r"R\$\s*([\d.,]+)", bloco.group(1))
        if val:
            return f"R$ {val.group(1).strip()}"
    for p in [r"VALOR\s+R\$\s*([\d.,]+)", r"VALOR\s*\n\s*R\$\s*([\d.,]+)", r"VALOR\s+R\$([\d.,]+)"]:
        v = _m(p, texto)
        if v:
            return f"R$ {v}"
    m = re.search(r"VALOR[^\n]{0,30}(\d{1,3}(?:\.\d{3})*,\d{2})", texto)
    if m:
        return f"R$ {m.group(1)}"
    return ""


def _sc_modalidade(texto: str) -> str:
    bloco = re.search(r"MODALIDADE(.{1,100}?)PARCELAMENTO", texto, re.DOTALL | re.IGNORECASE)
    conteudo = " ".join(bloco.group(1).split()).lower() if bloco else ""
    if "boleto" in conteudo:
        return "Boleto bancário"
    if "cart" in conteudo:
        return "Cartão de crédito"
    if "pix" in conteudo:
        return "PIX"
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


def _sc_parcelamento(texto: str) -> str:
    v = _m(r"PARCELAMENTO\s*\n?\s*(\d+\s*(?:x|vez(?:es)?)|[àÀ]\s*vista[^\n]*)", texto, re.IGNORECASE)
    if v:
        m = re.match(r"(\d+)\s*(?:x|vez(?:es)?)", v, re.IGNORECASE)
        if m:
            n = int(m.group(1))
            return "À vista" if n <= 1 else f"Parcelado em {n}x"
        return "À vista"
    m = re.search(r"(\d+)\s*(?:x\b|vez(?:es)?)", texto, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        return "À vista" if n <= 1 else f"Parcelado em {n}x"
    if re.search(r"\b[àa]\s*vista\b", texto, re.IGNORECASE):
        return "À vista"
    return ""


def _sc_vencimento(texto: str) -> str:
    v = _m(
        r"(?:primeiro\s+vencimento|vencimento\s+da\s+primeira\s+parcela)[:\s]+(\d{2}/\d{2}/\d{4})",
        texto,
    )
    return v if v else NAO_ENCONTRADO


def _sc_data_assinatura(texto: str, log: str) -> str:
    v = _m(r"Goi[aâ]nia,?\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})", texto)
    if v:
        d = _data_extenso(v)
        if re.match(r"\d{2}/\d{2}/\d{4}", d):
            return d
    datas = re.findall(
        r"\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\s+\d{4}",
        log, re.IGNORECASE,
    )
    if datas:
        d = _data_abrev(datas[-1])
        if d:
            return d
    datas = re.findall(r"\d{2}/\d{2}/\d{4}", texto)
    return datas[0] if datas else datetime.today().strftime("%d/%m/%Y")


def _validar(dados: dict) -> dict:
    if not dados["razao_social"] or "INSTITUTO EUVALDO LODI" in dados["razao_social"].upper():
        dados["razao_social"] = ERRO
    cnpj = dados["cnpj"]
    if not re.match(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$", cnpj) or cnpj == CNPJ_IEL:
        dados["cnpj"] = ERRO
    email = dados["email_financeiro"]
    if email and not _email_permitido(email):
        dados["email_financeiro"] = ERRO
    return dados


def parse_structured_contract(texto: str, sec_contratante: str, log: str) -> dict:
    """
    Legacy parser — handles known structured IEL/GO contract layout.
    Extracts data using label-anchored regex against fixed sections.
    """
    logger.info("[parser] mode=structured")

    dados = {
        "razao_social":        _sc_razao_social(sec_contratante),
        "cnpj":                _sc_cnpj(sec_contratante),
        "endereco":            _sc_endereco(sec_contratante),
        "representante":       _sc_representante(sec_contratante),
        "nome_contato":        _sc_representante(sec_contratante),
        "telefone":            _sc_telefone(sec_contratante),
        "email_financeiro":    "",
        "valor_total":         _sc_valor(texto),
        "forma_pagamento":     _sc_modalidade(texto),
        "parcelamento":        _sc_parcelamento(texto),
        "primeiro_vencimento": _sc_vencimento(texto),
        "data_assinatura":     _sc_data_assinatura(texto, log),
    }
    dados["email_financeiro"] = _sc_email(texto, log, dados["representante"])

    for k, v in dados.items():
        if not v:
            dados[k] = NAO_ENCONTRADO

    return _validar(dados)

# ---------------------------------------------------------------------------
# ── NEW PARSER (unstructured contracts) ───────────────────────────────────
# ---------------------------------------------------------------------------

# ── Step 1: text normalization ────────────────────────────────────────────

def _normalize_text(raw: str) -> str:
    text = raw
    # encoding artefacts
    text = text.replace("\x00", "").replace("�", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" \n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ── Step 2: best-effort regex extraction ─────────────────────────────────

def _uc_cnpj(text: str) -> str:
    for raw in re.findall(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}", text):
        fmt = _normalizar_cnpj(raw)
        if fmt != CNPJ_IEL:
            return fmt
    return ""


def _uc_razao_social(text: str) -> str:
    # Try common labels
    for padrao in [
        r"Raz[aã]o\s+Social[:\s]+([^\n]{3,80})",
        r"empresa[:\s]+([^\n]{3,80})",
        r"CONTRATANTE[:\s\n]+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇÜ][^\n]{3,80}(?:LTDA|S\.A\.|EIRELI|ME|EPP|SA\b))",
    ]:
        v = _m(padrao, text, re.IGNORECASE)
        if v and "INSTITUTO EUVALDO LODI" not in v.upper():
            return v.rstrip(".,;:")

    # Fallback: any company-sounding line near a CNPJ
    cnpjs = list(re.finditer(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}", text))
    for match in cnpjs:
        start = max(0, match.start() - 200)
        neighborhood = text[start: match.start()]
        for line in reversed(neighborhood.splitlines()):
            line = line.strip()
            if re.search(r"(?:LTDA|S\.A\.|EIRELI|ME|EPP)", line, re.IGNORECASE):
                if "INSTITUTO EUVALDO LODI" not in line.upper():
                    return line.rstrip(".,;:")
    return ""


def _uc_emails(text: str) -> list[str]:
    return [
        e.lower() for e in re.findall(r"[\w.+\-]+@[\w.\-]+\.\w+", text)
        if _email_permitido(e)
    ]


def _uc_telefones(text: str) -> list[str]:
    found = []
    for m in re.finditer(r"\((\d{2})\)\s*(\d{4,5})[-\s]?(\d{4})", text):
        found.append(f"({m.group(1)}) {m.group(2)}-{m.group(3)}")
    return found


def _uc_valores(text: str) -> list[str]:
    return re.findall(r"R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}", text)


# ── Step 3: year + value detection ───────────────────────────────────────

def extract_year_values(text: str) -> list[dict]:
    """
    Detect (year, value) pairs in various formats:
      "2022 - 958,80"
      "Ano 2023 R$ 958,80"
      "2024: R$958,80"
    Returns list of {year, value, status} sorted by year.
    """
    current_year = datetime.today().year
    results: dict[int, float] = {}

    patterns = [
        r"(?:Ano\s+)?(\d{4})\s*[-:]\s*R?\$?\s*([\d.,]+)",
        r"(\d{4})\s+R\$\s*([\d.,]+)",
        r"(\d{4}).*?R\$\s*([\d.,]+)",
    ]

    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            year = int(m.group(1))
            if not (2000 <= year <= current_year + 5):
                continue
            val = _moeda_para_float(m.group(2))
            if val and val > 0:
                # Keep highest value found for each year (avoids unit prices)
                results[year] = max(results.get(year, 0), val)

    def classify(year: int) -> str:
        if year < current_year:
            return "overdue"
        if year == current_year:
            return "current"
        return "future"

    return [
        {"year": y, "value": v, "status": classify(y)}
        for y, v in sorted(results.items())
    ]


# ── Step 4: AI fallback ───────────────────────────────────────────────────

_AI_PROMPT = """\
You are a contract data extractor. Given the raw text of a Brazilian service contract,
extract the following fields and return ONLY valid JSON. If a field cannot be determined,
use null.

Fields to extract:
- razao_social: legal company name of the CLIENT (not Instituto Euvaldo Lodi)
- cnpj: CNPJ of the CLIENT in format XX.XXX.XXX/XXXX-XX (not 01.647.296/0001-08)
- endereco: full address of the CLIENT
- representante: legal representative name of the CLIENT
- telefone: phone number of the CLIENT
- email_financeiro: financial contact email of the CLIENT
- valor_total: total contract value as string "R$ X.XXX,XX"
- forma_pagamento: "Boleto bancário", "Cartão de crédito", or "PIX"
- parcelamento: e.g. "Parcelado em 12x" or "À vista"
- data_assinatura: contract signature date DD/MM/YYYY
- primeiro_vencimento: first payment due date DD/MM/YYYY or null

Return ONLY a JSON object. No explanation, no markdown.

CONTRACT TEXT:
{text}
"""


def _ai_fallback(text: str, missing_fields: list[str]) -> dict:
    """
    Calls Gemini to extract missing fields. Returns partial dict.
    Silently returns {} if GEMINI_API_KEY is absent or call fails.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        logger.warning("[parser] AI fallback skipped — GEMINI_API_KEY not set")
        return {}

    try:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash-lite")

        # Truncate to ~8000 chars to stay within token budget
        truncated = text[:8000]
        prompt = _AI_PROMPT.format(text=truncated)

        logger.info("[parser] AI fallback called for fields: %s", missing_fields)
        response = model.generate_content(prompt)
        raw = response.text.strip()

        # Strip markdown fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        data = json.loads(raw)
        logger.info("[parser] AI fallback succeeded")
        return {k: v for k, v in data.items() if v is not None}

    except Exception as exc:
        logger.warning("[parser] AI fallback failed: %s", exc)
        return {}


# ── Step 5: data normalization ────────────────────────────────────────────

def _normalize_output(dados: dict) -> dict:
    """Normalize types and formats before returning."""
    # Phone: ensure consistent format
    tel = dados.get("telefone", "")
    if tel and not re.match(r"\(\d{2}\)", tel):
        m = re.search(r"(\d{2})\D*(\d{4,5})\D*(\d{4})", tel)
        if m:
            dados["telefone"] = f"({m.group(1)}) {m.group(2)}-{m.group(3)}"

    # CNPJ: normalize
    cnpj = dados.get("cnpj", "")
    if cnpj and cnpj != ERRO:
        dados["cnpj"] = _normalizar_cnpj(cnpj)

    # Valor: ensure "R$ " prefix
    valor = dados.get("valor_total", "")
    if valor and valor != ERRO and not valor.startswith("R$"):
        dados["valor_total"] = f"R$ {valor}"

    return dados


# ── Full unstructured pipeline ────────────────────────────────────────────

def parse_unstructured_contract(raw_text: str) -> dict:
    """
    New parser for variable-format contracts.
    Steps: normalize → regex best-effort → AI fallback → normalize output.
    """
    logger.info("[parser] mode=unstructured")

    text = _normalize_text(raw_text)

    # Detect Clicksign log boundary
    idx_click = text.lower().find("clicksign")
    log = text[idx_click:] if idx_click >= 0 else text[-3000:]

    # Step 2 — best-effort extraction
    emails = _uc_emails(text)
    telefones = _uc_telefones(text)
    valores = _uc_valores(text)

    dados: dict = {
        "razao_social":        _uc_razao_social(text),
        "cnpj":                _uc_cnpj(text),
        "endereco":            _sc_endereco(text),          # label-based, works broadly
        "representante":       _sc_representante(text),
        "nome_contato":        _sc_representante(text),
        "telefone":            telefones[0] if telefones else "",
        "email_financeiro":    _sc_email(text, log, _sc_representante(text)),
        "valor_total":         valores[-1].strip() if valores else "",
        "forma_pagamento":     _sc_modalidade(text),
        "parcelamento":        _sc_parcelamento(text),
        "primeiro_vencimento": _sc_vencimento(text),
        "data_assinatura":     _sc_data_assinatura(text, log),
    }

    # Step 4 — AI fallback for missing fields
    missing = [k for k, v in dados.items() if not v and k != "primeiro_vencimento"]
    if missing:
        ai_data = _ai_fallback(text, missing)
        for field in missing:
            if ai_data.get(field):
                dados[field] = str(ai_data[field])
                logger.info("[parser] AI filled field '%s'", field)

    # Step 3 — attach year-value intelligence (informational, not in email template)
    dados["_anos"] = extract_year_values(text)

    # Fill blanks
    for k, v in dados.items():
        if k.startswith("_"):
            continue
        if not v:
            dados[k] = NAO_ENCONTRADO if k != "primeiro_vencimento" else NAO_ENCONTRADO

    # Step 5 — normalize
    dados = _normalize_output(dados)

    return _validar(dados)

# ---------------------------------------------------------------------------
# ── ORCHESTRATOR ───────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def parse_contract(
    texto: str,
    sec_contratante: str = "",
    log: str = "",
) -> dict:
    """
    Main entry point.

    Routes to:
      parseStructuredContract()   — for known IEL/GO template
      parseUnstructuredContract() — for variable/messy contracts

    Output schema is identical in both cases (safe for email generator).
    """
    if is_structured_format(texto):
        return parse_structured_contract(
            texto,
            sec_contratante or texto,
            log or texto[-3000:],
        )
    else:
        # sec_contratante / log not reliable on unstructured input — re-derive inside
        return parse_unstructured_contract(texto)
