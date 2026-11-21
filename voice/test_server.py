import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from server import create_app


class InterviewVoiceTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict("os.environ", {"VOICE_WORKER_TOKEN": "fixture-worker", "OPENAI_API_KEY": "fixture-provider"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.calls = []
        self.auth = {"Authorization": "Bearer fixture-worker"}

    def provider(self, request):
        self.calls.append(request)
        self.assertEqual(request.headers["authorization"], "Bearer fixture-provider")
        if request.url.path == "/v1/audio/transcriptions":
            self.assertIn(b'filename="turn.webm"', request.content)
            self.assertIn(b"fixture recording", request.content)
            return httpx.Response(200, json={"text": "  Enterprise buyers  "})
        self.assertEqual(request.url.path, "/v1/audio/speech")
        self.assertEqual(json.loads(request.content)["input"], "Who will decide?")
        return httpx.Response(200, content=b"fixture mp3", headers={"Content-Type": "audio/mpeg"})

    def test_two_provider_contracts(self):
        with TestClient(create_app(httpx.MockTransport(self.provider))) as client:
            text = client.post("/transcribe", headers={**self.auth, "Content-Type": "audio/webm"}, content=b"fixture recording")
            self.assertEqual(text.json(), {"text": "Enterprise buyers"})
            audio = client.post("/speech", headers=self.auth, json={"text": "Who will decide?"})
            self.assertEqual(audio.status_code, 200)
            self.assertEqual(audio.content, b"fixture mp3")
            self.assertEqual(audio.headers["cache-control"], "no-store")

    def test_authenticated_transcription_signaling(self):
        offer = b"v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
        answer = b"v=0\r\ns=fixture answer\r\n"
        def realtime(request):
            self.calls.append(request.url.path)
            if request.url.path.endswith("/client_secrets"):
                self.assertEqual(request.headers["authorization"], "Bearer fixture-provider")
                session = json.loads(request.content)["session"]
                self.assertEqual(session["type"], "transcription")
                self.assertEqual(session["audio"]["input"]["turn_detection"]["type"], "server_vad")
                return httpx.Response(200, json={"value": "temporary-fixture"})
            self.assertEqual(request.headers["authorization"], "Bearer temporary-fixture")
            self.assertEqual(request.content, offer)
            return httpx.Response(201, content=answer, headers={"Content-Type": "application/sdp"})
        with TestClient(create_app(httpx.MockTransport(realtime))) as client:
            self.assertEqual(client.post("/connect", content=offer).status_code, 401)
            self.assertEqual(client.post("/connect", headers=self.auth, content=b"invalid").status_code, 400)
            self.assertEqual(self.calls, [])
            response = client.post("/connect", headers=self.auth, content=offer)
            self.assertEqual(response.content, answer)
            self.assertEqual(self.calls, ["/v1/realtime/client_secrets", "/v1/realtime/calls"])

    def test_invalid_requests_never_reach_provider(self):
        with TestClient(create_app(httpx.MockTransport(self.provider))) as client:
            self.assertEqual(client.post("/speech", json={"text": "Hello"}).status_code, 401)
            self.assertEqual(client.post("/speech", headers=self.auth, json={"text": ""}).status_code, 400)
            self.assertEqual(client.post("/transcribe", headers=self.auth, content=b"invalid").status_code, 415)
            self.assertEqual(self.calls, [])

    def test_provider_failure_is_sanitized(self):
        provider = httpx.MockTransport(lambda _: httpx.Response(429, text="private provider details"))
        with TestClient(create_app(provider)) as client:
            reply = client.post("/speech", headers=self.auth, json={"text": "Question"})
            self.assertEqual(reply.status_code, 429)
            self.assertNotIn("private", reply.text)

    def test_early_disconnect_cancels_upstream_speech_before_headers(self):
        async def rehearse():
            started = asyncio.Event()
            stopped = asyncio.Event()

            async def synthesize(_request):
                started.set()
                try:
                    await asyncio.Future()
                finally:
                    stopped.set()

            app = create_app(httpx.MockTransport(synthesize))
            received_body = False

            async def receive():
                nonlocal received_body
                if not received_body:
                    received_body = True
                    return {"type": "http.request", "body": b'{"text":"Hello"}', "more_body": False}
                await started.wait()
                return {"type": "http.disconnect"}

            async def send(_message):
                pass

            scope = {"type": "http", "asgi": {"version": "3.0"}, "method": "POST", "path": "/speech",
                     "query_string": b"", "headers": [(b"authorization", b"Bearer fixture-worker")]}
            async with app.router.lifespan_context(app):
                await asyncio.wait_for(app(scope, receive, send), 2)
            self.assertTrue(stopped.is_set())

        asyncio.run(rehearse())
