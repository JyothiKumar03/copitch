"""Private OpenAI adapter for interview and presentation audio."""

import asyncio
import hashlib
import json
import os
import re
import secrets
from collections import OrderedDict
from contextlib import asynccontextmanager

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route


MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_SPEECH_BYTES = 2 * 1024 * 1024
MAX_CACHED_SPEECH_BYTES = 16 * 1024 * 1024
MAX_CACHED_CLIPS = 64
MAX_PENDING_CLIPS = 16
LANGUAGE_TAG = re.compile(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*")
AUDIO_EXTENSIONS = {
    "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
}
NO_STORE = {"Cache-Control": "no-store"}
# Neutral on purpose: naming example words ("Hi, Hey, Hello") or languages biases what the model writes for unclear audio.
TRANSCRIPTION_HINT = ("Transcribe exactly what is said, in the language and script it is spoken in. "
                      "Keep English words, names and web addresses as spoken. Never translate.")


def error_response(message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status, headers=NO_STORE)


async def bounded_body(request: Request, limit: int) -> bytes | None:
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > limit:
            return None
        data.extend(chunk)
    return bytes(data)


def check_access(request: Request) -> Response | None:
    token = os.getenv("VOICE_WORKER_TOKEN", "")
    if not token:
        return error_response("Voice worker is unconfigured", 503)
    supplied = request.headers.get("Authorization", "").encode()
    if not secrets.compare_digest(supplied, f"Bearer {token}".encode()):
        return error_response("Unauthorized", 401)
    if not os.getenv("OPENAI_API_KEY"):
        return error_response("Voice provider is unconfigured", 503)
    return None


async def provider_request(request: Request, path: str, *, bearer: str | None = None,
                           safety_identifier: str | None = None, content_type: str | None = None,
                           **kwargs) -> httpx.Response | Response:
    headers = {"Authorization": f"Bearer {bearer or os.environ['OPENAI_API_KEY']}"}
    if safety_identifier:
        headers["OpenAI-Safety-Identifier"] = safety_identifier
    if content_type:
        headers["Content-Type"] = content_type
    try:
        result = await request.app.state.provider.post(path, headers=headers, **kwargs)
    except httpx.TimeoutException:
        return error_response("Voice provider timed out", 504)
    except httpx.RequestError:
        return error_response("Voice provider is unavailable", 503)
    if not result.is_success:
        if result.status_code == 429:
            return error_response("Voice provider capacity exceeded", 429)
        if result.status_code == 400 and path == "audio/transcriptions":
            return error_response("Audio could not be transcribed", 422)
        return error_response("Voice provider request failed", 502)
    return result


# The browser only hears and shows captions. Every command goes through the trusted server connection.
BROWSER_EVENTS = [{"type": t} for t in ("session.started", "session.closed", "error",
                                        "session.input_transcript.delta", "session.output_transcript.delta")]
SESSION_KEYS = {"instructions", "input", "delegation"}


async def connect(request: Request) -> Response:
    """Start a Live session for a browser WebRTC offer, using the conversation setup Express supplies."""
    denied = check_access(request)
    if denied is not None:
        return denied
    raw = await bounded_body(request, 262144)
    try:
        payload = json.loads(raw or b"")
        offer, setup = payload["sdp"], payload["session"]
        if not isinstance(offer, str) or not offer.startswith("v=0") or "m=audio " not in offer or not isinstance(setup, dict):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return error_response("Invalid voice offer", 400)
    # Express decides what the agent knows and may do; the model, voice and browser permissions are fixed here.
    session = {key: value for key, value in setup.items() if key in SESSION_KEYS}
    session.update({"model": os.getenv("OPENAI_LIVE_MODEL", "gpt-live-1.1"),
                    "audio": {"output": {"voice": os.getenv("OPENAI_SPEECH_VOICE", "marin")}},
                    "client": {"data_channel": {"allowed_client_events": [], "allowed_server_events": BROWSER_EVENTS}}})
    result = await provider_request(request, "live/sessions", json={"session": session, "transport": {"type": "webrtc", "sdp": offer}})
    if isinstance(result, Response):
        return result
    try:
        created = result.json()
        session_id, answer = created["session"]["id"], created["transport"]["sdp"]
        if not isinstance(session_id, str) or not 1 <= len(session_id) <= 160 or not answer.startswith("v=0"):
            raise ValueError
    except (ValueError, KeyError, TypeError, AttributeError):
        return error_response("Invalid voice provider answer", 502)
    return Response(answer, media_type="application/sdp", headers={**NO_STORE, "X-Voice-Session": session_id})


async def presentation_connect(request: Request) -> Response:
    denied = check_access(request)
    if denied is not None:
        return denied
    raw = await bounded_body(request, 196_608)
    if raw is None:
        return error_response("Microphone offer is too large", 413)
    try:
        payload = json.loads(raw)
        offer, safety_identifier = payload["sdp"], payload["safety_identifier"]
        if (set(payload) != {"sdp", "safety_identifier"} or not isinstance(offer, str) or
                len(offer) > 65_536 or not re.match(r"v=0\r?\n", offer) or not re.search(r"^m=audio ", offer, re.M) or
                not isinstance(safety_identifier, str) or not re.fullmatch(r"[a-f0-9]{64}", safety_identifier)):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return error_response("Invalid presentation microphone offer", 400)

    setup = {"type": "transcription", "audio": {"input": {
        "transcription": {"model": os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe")},
        "turn_detection": {"type": "server_vad", "threshold": 0.5, "prefix_padding_ms": 300, "silence_duration_ms": 500},
    }}}
    created = await provider_request(request, "realtime/client_secrets", safety_identifier=safety_identifier,
                                     json={"expires_after": {"anchor": "created_at", "seconds": 60}, "session": setup})
    if isinstance(created, Response):
        return created
    try:
        payload = created.json()
        secret, effective = payload["value"], payload["session"]
        if not isinstance(secret, str) or not re.fullmatch(r"ek_[\w-]{8,512}", secret) or effective["type"] != "transcription":
            raise ValueError
        vad = effective["audio"]["input"]["turn_detection"]
        if not isinstance(vad, dict) or vad.get("type") != "server_vad":
            return error_response("Realtime microphone is unavailable", 503)
    except (ValueError, KeyError, TypeError):
        return error_response("Invalid realtime microphone setup", 502)
    result = await provider_request(request, "realtime/calls", bearer=secret, safety_identifier=safety_identifier,
                                    content_type="application/sdp", content=offer.encode())
    if isinstance(result, Response):
        return result
    # OpenAI labels the SDP answer text/plain, so validate the body rather than the content type.
    if not 0 < len(result.content) <= 65_536 or not re.match(r"v=0\r?\n", result.text):
        return error_response("Invalid realtime microphone answer", 502)
    return Response(result.text, media_type="application/sdp", headers=NO_STORE)


async def transcribe(request: Request) -> Response:
    denied = check_access(request)
    if denied is not None:
        return denied
    mime = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    extension = AUDIO_EXTENSIONS.get(mime)
    if not extension:
        return error_response("Unsupported audio format", 415)
    recording = await bounded_body(request, MAX_AUDIO_BYTES)
    if recording is None:
        return error_response("Audio exceeds the turn limit", 413)
    if not recording:
        return error_response("Empty recording", 400)
    result = await provider_request(
        request, "audio/transcriptions",
        data={"model": os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"), "response_format": "json",
              "prompt": TRANSCRIPTION_HINT},
        files={"file": (f"turn.{extension}", recording, mime)},
    )
    if isinstance(result, Response):
        return result
    try:
        payload = result.json()
    except ValueError:
        payload = None
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not text.strip():
        return error_response("No speech was recognized", 422)
    if len(text.strip()) > 6000:
        return error_response("Transcript exceeds the brief input limit", 422)
    return JSONResponse({"text": text.strip()}, headers=NO_STORE)


async def render_speech(request: Request, key: str, payload: dict[str, str]) -> bytes | Response:
    state = request.app.state
    try:
        result = await provider_request(request, "audio/speech", json=payload)
        if isinstance(result, Response):
            return result
        content = result.content
        media_type = result.headers.get("content-type", "").partition(";")[0].strip().lower()
        if media_type not in ("audio/mpeg", "audio/mp3") or not 0 < len(content) <= MAX_SPEECH_BYTES:
            return error_response("Invalid speech returned by provider", 502)
        cache = state.speech_cache
        cache[key] = content
        while len(cache) > MAX_CACHED_CLIPS or sum(map(len, cache.values())) > MAX_CACHED_SPEECH_BYTES:
            cache.popitem(last=False)
        return content
    finally:
        state.pending_speech.pop(key, None)


async def speech(request: Request) -> Response:
    denied = check_access(request)
    if denied is not None:
        return denied
    raw = await bounded_body(request, 24_576)
    if raw is None:
        return error_response("Speech request exceeds the turn limit", 413)
    try:
        value = json.loads(raw)
        text = value["text"]
        language = value.get("language", "")
        if (not isinstance(text, str) or not text.strip() or len(text) > 4000 or
                not isinstance(language, str) or len(language) > 35 or
                (language and not LANGUAGE_TAG.fullmatch(language))):
            raise ValueError
    except (ValueError, TypeError, KeyError, AttributeError):
        return error_response("Invalid approved narration", 400)

    model = os.getenv("OPENAI_SPEECH_MODEL", "gpt-4o-mini-tts")
    payload = {"model": model, "voice": os.getenv("OPENAI_SPEECH_VOICE", "marin"), "input": text,
               "response_format": "mp3"}
    if model not in ("tts-1", "tts-1-hd"):
        payload["instructions"] = ("Read the input verbatim as approved presentation narration. Use a calm, natural pace. "
                                   "Preserve the words and language changes. Do not add, paraphrase or translate any text.")
    key = hashlib.sha256(json.dumps([language.lower(), payload], sort_keys=True).encode()).hexdigest()
    state = request.app.state
    if key in state.speech_cache:
        state.speech_cache.move_to_end(key)
        return Response(state.speech_cache[key], media_type="audio/mpeg", headers=NO_STORE)
    if key not in state.pending_speech:
        if len(state.pending_speech) >= MAX_PENDING_CLIPS:
            return error_response("Voice worker is busy", 429)
        state.pending_speech[key] = asyncio.create_task(render_speech(request, key, payload))
    result = await asyncio.shield(state.pending_speech[key])
    return result if isinstance(result, Response) else Response(result, media_type="audio/mpeg", headers=NO_STORE)


def create_app(transport: httpx.AsyncBaseTransport | None = None) -> Starlette:
    @asynccontextmanager
    async def lifespan(instance: Starlette):
        async with httpx.AsyncClient(base_url="https://api.openai.com/v1/", timeout=40, transport=transport) as provider:
            instance.state.provider = provider
            instance.state.speech_cache = OrderedDict()
            instance.state.pending_speech = {}
            try:
                yield
            finally:
                pending = tuple(instance.state.pending_speech.values())
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)

    return Starlette(
        lifespan=lifespan,
        routes=[Route("/connect", connect, methods=["POST"]), Route("/transcribe", transcribe, methods=["POST"]),
                Route("/speech", speech, methods=["POST"]), Route("/presentation-connect", presentation_connect, methods=["POST"])],
    )


app = create_app()
