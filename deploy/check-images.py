"""Check production images over loopback HTTPS using disposable SQLite storage."""
import argparse
import json
import secrets
import ssl
import subprocess
import tempfile
import time
import uuid
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.request import HTTPSHandler, HTTPCookieProcessor, Request, build_opener


def wait_ready(action):
    for _ in range(60):
        try:
            return action()
        except (OSError, subprocess.CalledProcessError):
            time.sleep(1)
    return action()


def verify(prefix):
    name = "copitch-smoke-" + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory)
        services = {
            "voice": {"image": prefix + "-voice"},
            "api": {"image": prefix + "-api", "environment": {
                "AI_SESSION_DB": "/data/sessions.sqlite", "TRACE_LOGS": "1",
                "VOICE_WORKER_URL": "http://voice:8900", "CORS_ORIGIN": "https://localhost",
            }, "volumes": ["db:/data"]},
            "web": {"image": prefix + "-web"},
            "gateway": {"image": prefix + "-gateway", "ports": ["127.0.0.1::443"],
                        "environment": {"PUBLIC_HOST": "localhost"}},
        }
        (path / "compose.json").write_text(json.dumps({"services": services, "volumes": {"db": {}}}))
        compose = ["docker", "compose", "--project-directory", directory, "-p", name, "-f", str(path / "compose.json")]

        def command(*args):
            return subprocess.check_output(compose + list(args), text=True)

        try:
            command("up", "-d", "--pull", "never")
            address = command("port", "gateway", "443").strip()
            origin = "https://localhost:" + address.rsplit(":", 1)[1]
            ca = path / "root.crt"
            wait_ready(lambda: command("cp", "gateway:/data/caddy/pki/authorities/local/root.crt", str(ca)))
            tls = ssl.create_default_context(cafile=str(ca))
            client = build_opener(HTTPSHandler(context=tls), HTTPCookieProcessor(CookieJar()))

            def request(route, payload=None):
                body = None if payload is None else json.dumps(payload).encode()
                req = Request(origin + route, data=body, headers={"Content-Type": "application/json", "Origin": origin})
                with client.open(req, timeout=8) as res:
                    return res.read()

            wait_ready(lambda: request("/api/ready"))
            if b"<html" not in wait_ready(lambda: request("/")):
                raise SystemExit("Expected Next.js HTML through the gateway")
            request("/api/account/register", {"email": "fixture@example.invalid", "password": secrets.token_urlsafe(24)})
            project = json.loads(request("/api/projects", {"name": "Restart check"}))
            command("restart", "api")
            wait_ready(lambda: request("/api/ready"))
            saved = json.loads(request("/api/projects"))["projects"]
            if project["session_id"] not in {p["session_id"] for p in saved}:
                raise SystemExit("Private project is missing after API restart")
            logs = command("logs", "--no-log-prefix", "--no-color", "api")
            events = [json.loads(line) for line in logs.splitlines() if line.startswith("{")]
            if not any(event.get("operation") == "http.request" and event.get("trace_id") for event in events):
                raise SystemExit("Missing API trace in the release container")
            if "fixture@example.invalid" in logs or "Restart check" in logs:
                raise SystemExit("Private input appeared in the release container logs")
            print("OK gateway TLS, web HTML, SQLite readiness, authenticated project, API restart and request tracing")
        finally:
            subprocess.run(compose + ["down", "-v"], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", default="copitch-aws-x86")
    verify(parser.parse_args().prefix)
