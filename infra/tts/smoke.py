import io
import urllib.error
import urllib.request
import wave

base = "http://127.0.0.1:8000"
with urllib.request.urlopen(base + "/health", timeout=3) as response:
    assert response.status == 200


def request(text, voice=None):
    import json
    payload = {"text": text}
    if voice is not None:
        payload["voice"] = voice
    return urllib.request.Request(base + "/synthesize", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})


for voice in (None, "aidar", "xenia"):
    with urllib.request.urlopen(request("Через одну минуту начинается занятие, аудитория сто два.", voice), timeout=15) as response:
        assert response.headers.get_content_type() == "audio/wav"
        audio = response.read()
    with wave.open(io.BytesIO(audio)) as wav:
        assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
        assert wav.getframerate() == 24000 and wav.getnframes() > 2400
for text, voice in [("Через 7 минут", "aidar"), ("Через 7 минут", "xenia"), ("Тест", "other")]:
    try:
        with urllib.request.urlopen(request(text, voice), timeout=5) as response:
            response.read()
        raise AssertionError("Цифры и неизвестные голоса должны отклоняться")
    except urllib.error.HTTPError as error:
        assert 400 <= error.code < 500
        error.read()
print("TTS_SMOKE_OK")
