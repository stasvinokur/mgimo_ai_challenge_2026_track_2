# syntax=docker/dockerfile:1
FROM python:3.12.16-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
WORKDIR /opt/tts
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --require-hashes --no-deps --only-binary=:all: -r requirements.txt
COPY download_model.py ./
RUN python download_model.py
COPY validation.py server.py smoke.py ./
RUN groupadd --gid 1001 tts && useradd --uid 1001 --gid tts --no-create-home tts
USER 1001:1001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).read()"
CMD ["python", "server.py"]
