"""
Tradutor de títulos para português comercial brasileiro.
Dicionário completo + capitalização inteligente.
"""
import os, re, asyncio, logging
from typing import List

logger = logging.getLogger(__name__)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

DICT = {
    "portable": "portátil", "electric": "elétrico", "wireless": "sem fio",
    "massage": "massagem", "massager": "massageador", "hair": "cabelo",
    "face": "facial", "mini": "mini", "automatic": "automático",
    "smart": "inteligente", "led": "LED", "brush": "escova",
    "blender": "mixer", "holder": "suporte", "car": "veicular",
    "professional": "profissional", "rechargeable": "recarregável",
    "waterproof": "à prova d'água", "foldable": "dobrável",
    "adjustable": "ajustável", "heating": "aquecimento",
    "vibration": "vibração", "rotating": "rotativo",
    "set": "kit", "kit": "kit", "device": "aparelho",
    "beauty": "beleza", "skin": "pele", "body": "corporal",
    "neck": "pescoço", "back": "costas", "knee": "joelho",
    "eye": "ocular", "scalp": "couro cabeludo",
    "muscle": "muscular", "posture": "postura",
    "corrector": "corretor", "support": "suporte",
    "workout": "treino", "resistance": "resistência",
    "bands": "elásticos", "roller": "rolo",
    "whitening": "clareamento", "teeth": "dentes",
    "plant": "planta", "grow": "crescimento", "light": "luminária",
    "indoor": "indoor", "baby": "bebê", "nasal": "nasal",
    "aspirator": "aspirador", "coffee": "café",
    "frother": "espumador", "compression": "compressão",
    "socks": "meias", "running": "corrida", "sport": "esporte",
    "dog": "cachorro", "cat": "gato", "pet": "pet",
    "water": "água", "bottle": "garrafa", "feather": "pena",
    "toy": "brinquedo", "nail": "unhas", "lamp": "lâmpada",
    "uv": "UV", "gel": "gel", "cellulite": "celulite",
    "foam": "espuma", "gun": "pistola", "straightener": "alisador",
    "shampoo": "shampoo", "heat": "aquecimento",
    "band": "faixa", "magnetic": "magnético", "phone": "celular",
    "charger": "carregador", "fast": "rápido", "quick": "rápido",
    "bluetooth": "bluetooth", "usb": "USB",
    "rgb": "RGB", "hd": "HD", "4k": "4K", "wifi": "WiFi",
    "stand": "suporte", "mount": "suporte", "fan": "ventilador",
    "glove": "luva", "mat": "tapete", "pad": "almofada",
    "organizer": "organizador", "diffuser": "difusor",
    "watch": "relógio", "dual": "duplo",
    "steamer": "vaporizador", "vacuum": "aspirador",
    "laser": "laser", "thermometer": "termômetro",
    "earphone": "fone", "headphone": "headphone",
    "speaker": "caixa de som", "cable": "cabo",
    "power": "potência", "solar": "solar",
    "new": "novo", "pro": "pro", "multifunction": "multifuncional",
}

UPPERCASE_KEEP = {"LED", "USB", "USB-C", "RGB", "HD", "4K", "WIFI", "IPL", "UV", "EMS", "GPS", "NFC"}
LOWERCASE_WORDS = {"de", "da", "do", "das", "dos", "e", "com", "para", "em", "no", "na", "nos", "nas"}


def translate_title(title: str) -> str:
    if not title:
        return title
    t = title.lower()
    for en, pt in DICT.items():
        t = re.sub(r'\b' + re.escape(en) + r'\b', pt, t, flags=re.IGNORECASE)
    words = t.split()
    result = []
    for i, w in enumerate(words):
        if w.upper() in UPPERCASE_KEEP:
            result.append(w.upper())
        elif i == 0:
            result.append(w.capitalize())
        elif w in LOWERCASE_WORDS:
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
            prompt = (
                "Traduza os títulos do inglês para português brasileiro. "
                "Mantenha termos técnicos (LED, WiFi, USB). Capitalize corretamente. "
                "Retorne apenas as traduções, uma por linha.\n\nTítulos:\n"
                + "\n".join(f"{i+1}. {t}" for i, t in enumerate(titles))
            )
            response = await asyncio.to_thread(model.generate_content, prompt)
            lines = [re.sub(r'^\d+\.\s*', '', l.strip())
                     for l in response.text.strip().split("\n") if l.strip()]
            if len(lines) == len(titles):
                return lines
        except Exception as e:
            logger.warning(f"Gemini translate falhou: {e}")
    return [translate_title(t) for t in titles]
