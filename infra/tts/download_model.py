import hashlib
import pathlib
import urllib.request

url = "https://models.silero.ai/models/tts/ru/v5_5_ru.pt"
expected = "50081637b602126ee06cb3bc8a744d25651d2da149ee8864b9a379bfdd934437"
path = pathlib.Path("/opt/model/v5_5_ru.pt")
path.parent.mkdir(parents=True, exist_ok=True)
with urllib.request.urlopen(url, timeout=120) as source, path.open("wb") as target:
    digest = hashlib.sha256()
    while chunk := source.read(1024 * 1024):
        digest.update(chunk)
        target.write(chunk)
if digest.hexdigest() != expected:
    path.unlink()
    raise RuntimeError("TTS_MODEL_CHECKSUM_MISMATCH")
