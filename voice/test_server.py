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
        self.assertIn(b'filename="turn.webm"', request.content)
        return httpx.Response(200, json={"text": "  Enterprise buyers  "})

    def test_recorded_turn_transcription(self):
        with TestClient(create_app(httpx.MockTransport(self.provider))) as client:
            text = client.post("/transcribe", headers={**self.auth, "Content-Type": "audio/webm"}, content=b"fixture recording")
            self.assertEqual(text.json(), {"text": "Enterprise buyers"})

    def test_signaling_rejects_unauthenticated_offers(self):
        with TestClient(create_app(httpx.MockTransport(self.provider))) as client:
            self.assertEqual(client.post("/connect", json={"sdp": "v=0\r\nm=audio 9\r\n", "session": {}}).status_code, 401)
            self.assertEqual(self.calls, [])

    def test_live_session_pins_model_voice_and_browser_permissions(self):
        sent = []
        def respond(req):
            sent.append(json.loads(req.content))
            self.assertEqual(req.url.path, "/v1/live/sessions")
            self.assertEqual(req.headers["authorization"], "Bearer fixture-provider")
            return httpx.Response(200, json={"session": {"id": "sess_synth"}, "transport": {"type": "webrtc", "sdp": "v=0\r\nanswer"}})
        offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
        setup = {"instructions": "Interview the host.", "input": [], "model": "attacker-model", "client": {"data_channel": {"allowed_client_events": "all"}},
                 "delegation": {"type": "responses", "responses": {"model": "gpt-5.4-mini", "tools": []}}}
        with patch.dict("os.environ", {"OPENAI_LIVE_MODEL": "gpt-live-1.1", "OPENAI_SPEECH_VOICE": "marin"}), \
                TestClient(create_app(httpx.MockTransport(respond))) as client:
            result = client.post("/connect", headers=self.auth, json={"sdp": offer, "session": setup})
            self.assertEqual((result.status_code, result.headers["x-voice-session"], result.text), (200, "sess_synth", "v=0\r\nanswer"))
        session = sent[0]["session"]
        self.assertEqual((session["model"], session["audio"]["output"]["voice"]), ("gpt-live-1.1", "marin"))
        self.assertEqual(session["client"]["data_channel"]["allowed_client_events"], [])
        self.assertEqual(session["instructions"], "Interview the host.")
        self.assertEqual(sent[0]["transport"], {"type": "webrtc", "sdp": offer})

    def test_malformed_offers_never_reach_provider(self):
        with TestClient(create_app(httpx.MockTransport(self.provider))) as client:
            for body in [{"sdp": "invalid", "session": {}}, {"sdp": "v=0\r\nm=video 9\r\n", "session": {}}, {"sdp": "v=0\r\nm=audio 9\r\n"}]:
                self.assertEqual(client.post("/connect", headers=self.auth, json=body).status_code, 400)
            self.assertEqual(self.calls, [])

    def test_invalid_recording_never_reaches_provider(self):
        with TestClient(create_app(httpx.MockTransport(self.provider))) as client:
            self.assertEqual(client.post("/transcribe", headers=self.auth, content=b"invalid").status_code, 415)
            self.assertEqual(self.calls, [])

    def test_provider_failure_is_sanitized(self):
        provider = httpx.MockTransport(lambda _: httpx.Response(429, text="private provider details"))
        with TestClient(create_app(provider)) as client:
            reply = client.post("/transcribe", headers={**self.auth, "Content-Type": "audio/webm"}, content=b"clip")
            self.assertEqual(reply.status_code, 429)
            self.assertNotIn("private", reply.text)

    def test_approved_speech_preserves_input_and_reuses_a_clip(self):
        def respond(request):
            self.calls.append(request)
            self.assertEqual(request.url.path, "/v1/audio/speech")
            self.assertEqual(request.headers["authorization"], "Bearer fixture-provider")
            payload = json.loads(request.content)
            self.assertEqual(payload["input"], "FY 2025–26 exports rose. धन्यवाद।")
            self.assertEqual(payload["voice"], "marin")
            self.assertEqual(payload["response_format"], "mp3")
            return httpx.Response(200, content=b"ID3fixture", headers={"Content-Type": "audio/mpeg"})

        body = {"text": "FY 2025–26 exports rose. धन्यवाद।", "language": "hi-IN"}
        with patch.dict("os.environ", {"OPENAI_SPEECH_MODEL": "gpt-4o-mini-tts", "OPENAI_SPEECH_VOICE": "marin"}), \
                TestClient(create_app(httpx.MockTransport(respond))) as client:
            for _ in range(2):
                reply = client.post("/speech", headers=self.auth, json=body)
                self.assertEqual((reply.status_code, reply.content), (200, b"ID3fixture"))
                self.assertEqual(reply.headers["cache-control"], "no-store")
            self.assertEqual(len(self.calls), 1)

    def test_speech_rejects_invalid_input_before_asking_provider(self):
        with TestClient(create_app(httpx.MockTransport(self.provider))) as client:
            self.assertEqual(client.post("/speech", json={"text": "private"}).status_code, 401)
            for body in ({"text": " "}, {"text": "x" * 4001}, {"text": "say this", "language": "no whitespace"}):
                self.assertEqual(client.post("/speech", json=body, headers=self.auth).status_code, 400)
            self.assertEqual(self.calls, [])
