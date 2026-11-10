import io
import json
import queue
import socket
import threading
import time
import wave
from concurrent.futures import Future, TimeoutError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from validation import validate


class Synthesizer:
    def __init__(self, synthesize, waiting=2):
        self.jobs = queue.Queue(maxsize=waiting)
        self.synthesize = synthesize
        threading.Thread(target=self.work, daemon=True).start()

    def submit(self, text, voice="aidar"):
        result = Future()
        self.jobs.put_nowait((text, voice, result))
        return result

    def work(self):
        while True:
            text, voice, result = self.jobs.get()
            try:
                if result.set_running_or_notify_cancel():
                    try:
                        result.set_result(self.synthesize(text, voice))
                    except Exception:
                        print("TTS_SYNTHESIS_FAILED", flush=True)
                        result.set_exception(RuntimeError("TTS_SYNTHESIS_FAILED"))
            finally:
                self.jobs.task_done()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, synthesize, read_timeout=5):
        self.read_timeout = read_timeout
        self.slots = threading.BoundedSemaphore(8)
        self.synthesizer = Synthesizer(synthesize)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                print("TTS_CLIENT_DISCONNECTED", flush=True)
            finally:
                self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        print("TTS_REQUEST_FAILED", flush=True)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(self.server.read_timeout)
        self.read_deadline = time.monotonic() + self.server.read_timeout
        self.read_finished = threading.Event()
        super().setup()
        self.read_timer = threading.Timer(self.server.read_timeout, self.expire_read)
        self.read_timer.daemon = True
        self.read_timer.start()

    def expire_read(self):
        if self.read_finished.is_set():
            return
        try:
            # Wake up buffered header/body reads even if bytes keep arriving.
            self.request.shutdown(socket.SHUT_RD)
        except OSError:
            return  # The peer may have closed the connection at the deadline.

    def stop_read(self):
        self.read_finished.set()
        self.read_timer.cancel()

    def complete_read(self):
        self.stop_read()
        if time.monotonic() >= self.read_deadline:
            raise TimeoutError("TTS_READ_DEADLINE")

    def finish(self):
        self.stop_read()
        super().finish()

    def log_message(self, *_):
        pass

    def reply(self, status, body=b"", content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            self.complete_read()
        except TimeoutError:
            self.reply(400)
            return
        self.reply(200 if self.path == "/health" else 404, b'{}')

    def do_POST(self):
        try:
            if self.path != "/synthesize":
                self.reply(404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get("Transfer-Encoding"):
                self.reply(413)
                return
            if self.headers.get_content_type() != "application/json":
                self.reply(415)
                return
            body = self.rfile.read(length)
            self.complete_read()
            if len(body) != length:
                raise ValueError("TTS_BODY_INCOMPLETE")
            text, voice = validate(json.loads(body))
        except Exception:
            self.reply(400)
            return
        finally:
            self.stop_read()
        job = None
        try:
            job = self.server.synthesizer.submit(text, voice)
            self.reply(200, job.result(timeout=12), "audio/wav")
        except (queue.Full, TimeoutError, RuntimeError):
            if job is not None:
                job.cancel()
            self.reply(503)


def load_model():
    import torch
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    model = torch.package.PackageImporter("/opt/model/v5_5_ru.pt").load_pickle("tts_models", "model")
    model.to(torch.device("cpu"))

    def synthesize(text, voice):
        with torch.inference_mode():
            audio = model.apply_tts(text=text, speaker=voice, sample_rate=24000, put_accent=True, put_yo=True)
        pcm = (audio.clamp(-1, 1) * 32767).to(torch.int16).tolist()
        import array
        import sys
        samples = array.array("h", pcm)
        if sys.byteorder != "little":
            samples.byteswap()
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(samples.tobytes())
        return output.getvalue()
    return synthesize


if __name__ == "__main__":
    Server(("0.0.0.0", 8000), load_model()).serve_forever()
