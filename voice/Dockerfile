FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.22 /uv /usr/local/bin/uv
WORKDIR /app/voice
COPY voice/pyproject.toml voice/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY voice/server.py ./
USER nobody
CMD ["/app/voice/.venv/bin/uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8900", "--no-access-log"]
