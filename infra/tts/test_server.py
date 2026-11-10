import io
import json
import queue
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stdout

from server import Server, Synthesizer
from validation import validate


class ValidationTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate({"text": " Через одну минуту — занятие, аудитория сто два. "}), ("Через одну минуту — занятие, аудитория сто два.", "aidar"))
        for voice in ("aidar", "xenia"):
            with self.subTest(voice=voice):
                self.assertEqual(validate({"text": "Тест", "voice": voice}), ("Тест", voice))
        self.assertEqual(len(validate({"text": "а" * 600})[0]), 600)

    def test_invalid(self):
        for payload in [None, [], {}, {"text": ""}, {"text": "   "}, {"text": 1}, {"text": "а" * 601}, {"text": "Через 7 минут"}, {"text": "١"}, {"text": "Тест · завтра"}, {"text": "Тест <speak>"}, {"text": "Hello"}, {"text": "«Тест»"}, {"text": "---"}, {"text": "Тест\n"}, {"text": "Тест", "voice": "other"}, {"text": "Тест", "studentId": "foreign"}]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate(payload)

    def test_unknown_voice(self):
        for voice in ("other", "", "AIDAR", "Xenia", " aidar", "xenia ", None, 1, True, [], {}):
            with self.subTest(voice=voice), self.assertRaises(ValueError):
                validate({"text": "Тест", "voice": voice})

    def test_serial_and_bounded(self):
        started, release = threading.Event(), threading.Event()
        calls = []
        def synthesize(text, voice):
            calls.append((text, voice))
            started.set()
            release.wait(2)
            return b"wav"
        worker = Synthesizer(synthesize, waiting=1)
        first = worker.submit("Первая")
        self.assertTrue(started.wait(1))
        second = worker.submit("Вторая", "xenia")
        with self.assertRaises(queue.Full):
            worker.submit("Третья")
        self.assertEqual(calls, [("Первая", "aidar")])
        release.set()
        self.assertEqual(first.result(2), b"wav")
        self.assertEqual(second.result(2), b"wav")
        self.assertEqual(calls, [("Первая", "aidar"), ("Вторая", "xenia")])

    def test_http_overflow_is_503(self):
        from concurrent.futures import ThreadPoolExecutor
        started, release = threading.Event(), threading.Event()
        def synthesize(_text, _voice):
            started.set()
            release.wait(3)
            return b"wav"
        server = Server(("127.0.0.1", 0), synthesize)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def send():
            request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/synthesize", data=json.dumps({"text": "Фраза"}).encode(), headers={"Content-Type": "application/json"})
            try:
                response = urllib.request.urlopen(request, timeout=5)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                response.read()
                return response.code
        try:
            with ThreadPoolExecutor(max_workers=3) as clients:
                first = clients.submit(send)
                self.assertTrue(started.wait(1))
                second, third = clients.submit(send), clients.submit(send)
                # Queue ownership is observable; do not depend on thread timing.
                import time
                deadline = time.monotonic() + 1
                while server.synthesizer.jobs.qsize() < 2 and time.monotonic() < deadline:
                    time.sleep(0.005)
                self.assertEqual(server.synthesizer.jobs.qsize(), 2)
                self.assertEqual(send(), 503)
                release.set()
                self.assertEqual([first.result(), second.result(), third.result()], [200, 200, 200])
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_absolute_read_deadline(self):
        import socket
        import time
        server = Server(("127.0.0.1", 0), lambda _text, _voice: b"wav", read_timeout=0.2)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        client = socket.create_connection(("127.0.0.1", server.server_port), timeout=2)
        stopped = threading.Event()
        def drip():
            while not stopped.wait(0.05):
                try:
                    client.sendall(b" ")
                except OSError:
                    return
        writer = threading.Thread(target=drip, daemon=True)
        try:
            client.sendall(b"POST /synthesize HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{")
            start = time.monotonic()
            writer.start()
            response = b""
            while b"\r\n\r\n" not in response:
                chunk = client.recv(4096)
                if not chunk:
                    break
                response += chunk
            self.assertIn(b"400", response.split(b"\r\n", 1)[0])
            self.assertLess(time.monotonic() - start, 1.5)
        finally:
            stopped.set()
            writer.join(2)
            client.close()
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_deep_json_is_400(self):
        server = Server(("127.0.0.1", 0), lambda _text, _voice: b"wav")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        body = b"[" * 1500 + b"0" + b"]" * 1500
        try:
            request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/synthesize", data=body, headers={"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as failure:
                urllib.request.urlopen(request, timeout=2)
            self.assertEqual(failure.exception.code, 400)
            failure.exception.read()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_http_voices_without_torch(self):
        calls = []
        def synthesize(text, voice):
            calls.append((text, voice))
            return b"RIFF"
        server = Server(("127.0.0.1", 0), synthesize)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cases = [(None, 200), ("aidar", 200), ("xenia", 200), ("other", 400), ("", 400), ([], 400), ({}, 400), (0, 400)]
        try:
            for voice, status in cases:
                with self.subTest(voice=voice):
                    payload = {"text": "Фраза"}
                    if voice is not None:
                        payload["voice"] = voice
                    request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/synthesize", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
                    try:
                        response = urllib.request.urlopen(request, timeout=3)
                    except urllib.error.HTTPError as error:
                        response = error
                    with response:
                        self.assertEqual(response.code, status)
                        if status == 200:
                            self.assertEqual(response.headers.get_content_type(), "audio/wav")
                        response.read()
            self.assertEqual(calls, [("Фраза", "aidar"), ("Фраза", "aidar"), ("Фраза", "xenia")])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_http_and_logs_without_torch(self):
        captured = io.StringIO()
        server = Server(("127.0.0.1", 0), lambda text, _voice: b"RIFF" + text.encode())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with redirect_stdout(captured):
                with urllib.request.urlopen(base + "/health") as response:
                    self.assertEqual(response.status, 200)
                for text, expected in [("Тестовая фраза", 200), ("Номер 102", 400)]:
                    request = urllib.request.Request(base + "/synthesize", data=json.dumps({"text": text}).encode(), headers={"Content-Type": "application/json"})
                    try:
                        response = urllib.request.urlopen(request)
                    except urllib.error.HTTPError as error:
                        response = error
                    with response:
                        self.assertEqual(response.code, expected)
                        response.read()
            self.assertNotIn("Тестовая фраза", captured.getvalue())
            self.assertNotIn("102", captured.getvalue())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)


if __name__ == "__main__":
    unittest.main()
