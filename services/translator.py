"""
Tradutor de títulos para português.
- Se GOOGLE_API_KEY existir: usa Gemini API
- Caso contrário: dicionário de substituição com termos comuns
"""
import os, re, asyncio, logging
from typing import List

logger = logging.getLogger(__name__)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

DICT = {
    "portable": "portátil", "electric": "elétrico",
    "wireless": "sem fio", "massage": "massagem", "massager": "massageador",
    "hair": "cabelo", "face": "facial", "mini": "mini",
    "automatic": "automático", "smart": "inteligente", "led": "LED",
    "brush": "escova", "blender": "mixer", "holder": "suporte",
    "charger": "carregador", "fast": "rápido", "quick": "rápido",
    "rechargeable": "recarregável", "waterproof": "impermeável",
    "bluetooth": "bluetooth", "usb": "USB", "usb-c": "USB-C",
    "rgb": "RGB", "hd": "HD", "4k": "4K", "wifi": "WiFi",
    "phone": "celular", "magnetic": "magnético", "car": "carro",
    "skin": "pele", "beauty": "beleza", "care": "cuidado",
    "cat": "gato", "dog": "cachorro", "pet": "pet",
    "toy": "brinquedo", "sport": "esporte", "gym": "academia",
    "muscle": "muscular", "neck": "cervical", "back": "costas",
    "knee": "joelho", "water": "água", "bottle": "garrafa",
    "bag": "bolsa", "case": "capa", "light": "luz", "lamp": "lâmpada",
    "stand": "suporte", "mount": "suporte", "fan": "ventilador",
    "nail": "unhas", "uv": "UV", "gel": "gel",
    "glove": "luva", "mat": "tapete", "pad": "almofada",
    "organizer": "organizador", "diffuser": "difusor",
    "monitor": "monitor", "keyboard": "teclado", "camera": "câmera",
    "watch": "relógio", "band": "pulseira",
    "posture": "postura", "corrector": "corretor",
    "adjustable": "ajustável", "foldable": "dobrável",
    "set": "kit", "kit": "kit", "new": "novo",
    "professional": "profissional", "pro": "pro",
    "multifunction": "multifuncional", "dual": "duplo",
    "steamer": "vaporizador", "vacuum": "aspirador",
    "laser": "laser", "thermometer": "termômetro",
    "printer": "impressora", "projector": "projetor",
    "earphone": "fone", "headphone": "headphone",
    "speaker": "caixa de som", "cable": "cabo",
    "power": "potência", "solar": "solar",
}


def translate_title(title: str) -> str:
    if not title:
        return title
    t = title.lower()
    for en, pt in DICT.items():
        t = re.sub(r'\b' + re.escape(en) + r'\b', pt, t, flags=re.IGNORECASE)
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


async def translate_titles(titles: List[str]) -> List[str]:
    if GOOGLE_API_KEY:
        try:
            import google.generativeai as genai
            genai.configure(api_key=GOOGLE_API_KEY)
            model = genai.GenerativeModel("gemini-1.5-flash")
            prompt = f"""Traduza os títulos do inglês para português brasileiro.
Mantenha termos técnicos (LED, WiFi, USB). Capitalize corretamente.
Retorne apenas as traduções, uma por linha.

Títulos:
{chr(10).join(f'{i+1}. {t}' for i, t in enumerate(titles))}"""
            response = await asyncio.to_thread(model.generate_content, prompt)
            lines = [re.sub(r'^\d+\.\s*', '', l.strip()) for l in response.text.strip().split("\n") if l.strip()]
            if len(lines) == len(titles):
                return lines
        except Exception as e:
            logger.warning(f"Gemini translate falhou: {e}")
    return [translate_title(t) for t in titles]
