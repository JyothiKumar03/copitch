"""Private OpenAI adapter for host-controlled interview audio."""

import asyncio
import json
import os
import secrets
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

MAX_AUDIO_BYTES = 8 * 1024 * 1024
AUDIO_EXTENSIONS = {
    "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
}
NO_STORE = {"Cache-Control": "no-store"}
LANGUAGE_MANIFEST = json.loads((Path(__file__).resolve().parent.parent / "shared/languages.json").read_text())
LANGUAGES = LANGUAGE_MANIFEST["languages"]


def requested_language(request: Request) -> str:
    return request.headers.get("x-interview-language", LANGUAGE_MANIFEST["default_language"])


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
    if requested_language(request) not in LANGUAGES:
        return error_response("Unsupported interview language", 400)
    return None


async def provider_request(request: Request, path: str, **kwargs) -> httpx.Response | Response:
    try:
        result = await request.app.state.provider.post(
            path, headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
            **kwargs,
        )
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


async def connect(request: Request) -> Response:
    denied = check_access(request)
    if denied is not None:
        return denied
    offer = await bounded_body(request, 65536)
    if not offer or not offer.startswith(b"v=0") or b"m=audio " not in offer:
        return error_response("Invalid audio offer", 400)
    model = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe")
    language = requested_language(request)
    config = {"type": "transcription", "audio": {"input": {
        "transcription": {"model": model, "language": language, "prompt": LANGUAGES[language]["transcription_prompt"]},
        "noise_reduction": {"type": "near_field"},
        "turn_detection": {"type": "server_vad", "silence_duration_ms": 550},
    }}}
    secret = await provider_request(request, "realtime/client_secrets", json={
        "expires_after": {"anchor": "created_at", "seconds": 60}, "session": config,
    })
    if isinstance(secret, Response):
        return secret
    try:
        token = secret.json()["value"]
        if not isinstance(token, str) or not token:
            raise ValueError()
        answer = await request.app.state.provider.post("realtime/calls", content=offer,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/sdp"})
    except (ValueError, KeyError, TypeError, httpx.RequestError):
        return error_response("Voice connection unavailable", 502)
    if not answer.is_success or not answer.content.startswith(b"v=0") or len(answer.content) > 65536:
        return error_response("Voice connection unavailable", 502)
    return Response(answer.content, media_type="application/sdp", headers=NO_STORE)


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
    language = requested_language(request)
    result = await provider_request(
        request, "audio/transcriptions",
        data={"model": os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"), "response_format": "json",
              "language": language, "prompt": LANGUAGES[language]["transcription_prompt"]},
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
    letters = [unicodedata.name(char, "") for char in text if char.isalpha()]
    if letters and not any("LATIN" in name or "DEVANAGARI" in name for name in letters):
        return error_response("Please repeat your message in English or Hindi", 422)
    return JSONResponse({"text": text.strip()}, headers=NO_STORE)


async def speech(request: Request) -> Response:
    denied = check_access(request)
    if denied is not None:
        return denied
    raw = await bounded_body(request, 16384)
    if raw is None:
        return error_response("Question exceeds the turn limit", 413)
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeError):
        return error_response("Invalid question", 400)
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1600:
        return error_response("Invalid question", 400)
    preparing = asyncio.create_task(prepare_speech(request, text))

    async def wait_for_disconnect():
        while (await request.receive())["type"] != "http.disconnect":
            pass

    disconnected = asyncio.create_task(wait_for_disconnect())
    try:
        done, _ = await asyncio.wait((preparing, disconnected), return_when=asyncio.FIRST_COMPLETED)
        if preparing in done:
            return await preparing
        return error_response("Playback ended", 499)
    finally:
        disconnected.cancel()
        preparing.cancel()
        await asyncio.gather(disconnected, preparing, return_exceptions=True)


async def prepare_speech(request: Request, text: str) -> Response:
    client = request.app.state.provider
    upstream = client.build_request(
        "POST", "audio/speech", headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}, json={
            "model": os.getenv("OPENAI_SPEECH_MODEL", "gpt-4o-mini-tts"),
            "voice": os.getenv("OPENAI_SPEECH_VOICE", "alloy"),
            "instructions": LANGUAGES[requested_language(request)]["speech_instructions"],
            "input": text, "response_format": "mp3",
        },
    )
    try:
        result = await client.send(upstream, stream=True)
    except httpx.RequestError:
        return error_response("Voice provider is unavailable", 503)
    if not result.is_success:
        await result.aclose()
        return error_response("Voice provider capacity exceeded" if result.status_code == 429 else "Voice provider request failed",
                              429 if result.status_code == 429 else 502)
    if result.headers.get("content-type", "").split(";")[0] not in {"audio/mpeg", "audio/mp3", "application/octet-stream"}:
        await result.aclose()
        return error_response("Voice provider returned invalid audio", 502)
    chunks = result.aiter_bytes()
    try:
        first = await anext(chunks, b"")
    except asyncio.CancelledError:
        await result.aclose()
        raise
    except httpx.RequestError:
        first = b""
    if not first or len(first) > MAX_AUDIO_BYTES:
        await result.aclose()
        return error_response("Voice provider returned invalid audio", 502)

    async def audio_stream():
        size = len(first)
        try:
            yield first
            async for chunk in chunks:
                size += len(chunk)
                if size > MAX_AUDIO_BYTES:
                    raise ValueError("Voice output exceeds the audio limit")
                yield chunk
        finally:
            await result.aclose()

    return StreamingResponse(audio_stream(), media_type="audio/mpeg", headers=NO_STORE)


def create_app(transport: httpx.AsyncBaseTransport | None = None) -> Starlette:
    @asynccontextmanager
    async def lifespan(instance: Starlette):
        async with httpx.AsyncClient(base_url="https://api.openai.com/v1/", timeout=40, transport=transport) as provider:
            instance.state.provider = provider
            yield

    return Starlette(
        lifespan=lifespan,
        routes=[Route("/connect", connect, methods=["POST"]), Route("/transcribe", transcribe, methods=["POST"]), Route("/speech", speech, methods=["POST"])],
    )


app = create_app()
