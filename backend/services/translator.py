"""
Tradutor de títulos para português.
- Se GOOGLE_API_KEY existir: usa Gemini API
- Caso contrário: dicionário de substituição com termos comuns
"""
import os, re, asyncio, logging
from typing import List

logger = logging.getLogger(__name__)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

# Dicionário de termos mais comuns (inglês → português)
DICT = {
    "portable": "portátil", "electric": "elétrico", "electric ": "elétrica ",
    "wireless": "sem fio", "massage": "massagem", "massager": "massageador",
    "hair": "cabelo", "face": "facial", "facial": "facial",
    "mini": "mini", "automatic": "automático", "smart": "inteligente",
    "led": "LED", "brush": "escova", "blender": "mixer",
    "holder": "suporte", "charger": "carregador", "charging": "carregamento",
    "fast": "rápido", "quick": "rápido", "ultra": "ultra",
    "professional": "profissional", "pro": "pro",
    "rechargeable": "recarregável", "waterproof": "impermeável",
    "bluetooth": "bluetooth", "usb": "USB", "usb-c": "USB-C",
    "rgb": "RGB", "hd": "HD", "4k": "4K", "wifi": "WiFi",
    "phone": "celular", "mobile": "celular", "magnetic": "magnético",
    "car": "carro", "home": "casa", "kitchen": "cozinha",
    "skin": "pele", "beauty": "beleza", "care": "cuidado",
    "cat": "gato", "dog": "cachorro", "pet": "pet",
    "toy": "brinquedo", "game": "jogo", "gaming": "gamer",
    "sport": "esporte", "gym": "academia", "fitness": "fitness",
    "muscle": "muscular", "neck": "cervical", "back": "costas",
    "knee": "joelho", "shoulder": "ombro",
    "water": "água", "bottle": "garrafa", "cup": "copo",
    "bag": "bolsa", "case": "capa", "cover": "capa",
    "light": "luz", "lamp": "lâmpada", "ring": "ring",
    "stand": "suporte", "mount": "suporte",
    "fan": "ventilador", "air": "ar",
    "nail": "unhas", "uv": "UV", "gel": "gel",
    "eyelash": "cílios", "eyebrow": "sobrancelha",
    "lipstick": "batom", "foundation": "base", "powder": "pó",
    "glove": "luva", "mat": "tapete", "pad": "almofada",
    "organizer": "organizador", "storage": "organizador",
    "diffuser": "difusor", "humidifier": "umidificador",
    "heater": "aquecedor", "cooler": "resfriador",
    "monitor": "monitor", "keyboard": "teclado", "mouse": "mouse",
    "camera": "câmera", "tripod": "tripé",
    "watch": "relógio", "band": "pulseira",
    "posture": "postura", "corrector": "corretor",
    "anti": "anti", "with": "com", "for": "para",
    "adjustable": "ajustável", "foldable": "dobrável",
    "silicone": "silicone", "stainless": "inox",
    "set": "kit", "kit": "kit", "pack": "kit",
    "new": "novo", "upgrade": "atualizado",
    "original": "original", "high": "alta", "quality": "qualidade",
    "multifunction": "multifuncional", "multifunctional": "multifuncional",
    "dual": "duplo", "double": "duplo",
    "360": "360°", "degrees": "graus",
    "steamer": "vaporizador", "steam": "vapor",
    "vacuum": "aspirador", "cleaner": "limpador",
    "laser": "laser", "ipl": "IPL",
    "thermometer": "termômetro", "infrared": "infravermelho",
    "printer": "impressora", "projector": "projetor",
    "earphone": "fone", "headphone": "headphone", "earbuds": "fone",
    "speaker": "caixa de som",
    "cable": "cabo", "adapter": "adaptador",
    "power": "potência", "bank": "banco",
    "solar": "solar", "energy": "energia",
}


def translate_title(title: str) -> str:
    """Traduz título usando dicionário de substituição."""
    if not title:
        return title
    t = title.lower()
    for en, pt in DICT.items():
        t = re.sub(r'\b' + re.escape(en) + r'\b', pt, t, flags=re.IGNORECASE)
    # Capitaliza corretamente
    words = t.split()
    result = []
    for i, w in enumerate(words):
        if i == 0:
            result.append(w.capitalize())
        elif w.upper() in ("LED", "USB", "USB-C", "RGB", "HD", "4K", "WIFI", "IPL", "UV", "EMS", "GPS", "NFC"):
            result.append(w.upper())
        elif w in ("de", "da", "do", "das", "dos", "e", "com", "para", "em", "no", "na", "nos", "nas"):
            result.append(w.lower())
        else:
            result.append(w.capitalize())
    return " ".join(result)


async def translate_with_gemini(titles: List[str]) -> List[str]:
    """Traduz usando Gemini API."""
    try:
        import google.generativeai as genai
        genai.configure(api_key=GOOGLE_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = f"""Traduza os seguintes títulos de produtos do inglês para português brasileiro.
Mantenha termos técnicos em inglês quando apropriado (LED, WiFi, USB, etc).
Capitalize corretamente. Retorne apenas as traduções, uma por linha, na mesma ordem.

Títulos:
{chr(10).join(f'{i+1}. {t}' for i, t in enumerate(titles))}"""
        response = await asyncio.to_thread(model.generate_content, prompt)
        lines = [l.strip() for l in response.text.strip().split("\n") if l.strip()]
        translated = []
        for line in lines:
            # Remove numeração no início
            clean = re.sub(r'^\d+\.\s*', '', line)
            translated.append(clean)
        if len(translated) == len(titles):
            return translated
    except Exception as e:
        logger.warning(f"Gemini translate falhou: {e}")
    return [translate_title(t) for t in titles]


async def translate_titles(titles: List[str]) -> List[str]:
    """Ponto de entrada principal — usa Gemini se disponível, senão dicionário."""
    if GOOGLE_API_KEY:
        return await translate_with_gemini(titles)
    return [translate_title(t) for t in titles]
