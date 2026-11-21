FROM maven:3.9-eclipse-temurin-21-alpine AS ppt-reader
WORKDIR /reader
COPY backend/ppt-reader/pom.xml ./
RUN mvn -q org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy-dependencies -DoutputDirectory=/reader/lib
COPY backend/ppt-reader/SlideText.java ./
RUN mkdir classes && javac -cp 'lib/*' -d classes SlideText.java && \
    jlink --add-modules java.desktop,java.logging,java.naming,jdk.charsets --strip-debug --no-man-pages --no-header-files --compress=2 --output /reader/runtime

FROM oven/bun:1.3-alpine

WORKDIR /app
RUN apk add --no-cache chromium font-noto && \
    ln -s "$(command -v chromium || command -v chromium-browser)" /usr/local/bin/copitch-chromium
COPY --from=ppt-reader /reader/runtime /opt/copitch/ppt
COPY --from=ppt-reader /reader/lib /opt/copitch/ppt/lib
COPY --from=ppt-reader /reader/classes /opt/copitch/ppt/classes

COPY package.json bun.lock tsconfig.base.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN bun install --frozen-lockfile --production --filter @equal-ai/api

COPY shared ./shared
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/tsconfig.json

ENV NODE_ENV=production
ENV PORT=3001
ENV CORS_ORIGIN=http://localhost:3000
ENV DECK_RENDER_CHROMIUM=/usr/local/bin/copitch-chromium

EXPOSE 3001

CMD ["bun", "run", "backend/src/index.ts"]
