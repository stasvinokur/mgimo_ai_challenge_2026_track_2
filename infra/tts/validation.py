import re

MAX_TEXT = 600
ALPHABET = re.compile(r"[А-Яа-яЁё .,!?;:\-–—]+")


def validate(payload):
    if not isinstance(payload, dict) or set(payload) - {"text", "voice"}:
        raise ValueError("Некорректный запрос.")
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise ValueError("Нужна фраза от одного до шестисот символов.")
    if not ALPHABET.fullmatch(text) or not re.search(r"[А-Яа-яЁё]", text):
        raise ValueError("Фраза должна содержать русские слова без цифр и служебных знаков.")
    voice = payload.get("voice", "aidar")
    if not isinstance(voice, str) or voice not in ("aidar", "xenia"):
        raise ValueError("Неизвестный голос.")
    return text.strip(), voice
