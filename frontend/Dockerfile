FROM oven/bun:1.3-alpine

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY package.json bun.lock* ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN bun install --frozen-lockfile

COPY frontend ./frontend

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV WEB_PORT=3000
ENV HOSTNAME=0.0.0.0

RUN bun run --cwd frontend build

EXPOSE 3000

CMD ["bun", "run", "--cwd", "frontend", "start"]
