# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:24 AS web
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
ENV NODE_ENV=production
RUN cd apps/web && bun run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS server
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/server/ ./
COPY --from=web /app/apps/web/dist ./internal/static/dist
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
    && mkdir /out/data

FROM gcr.io/distroless/static:nonroot
COPY --from=server /out/server /server
COPY --from=server --chown=65532:65532 /out/data /data
ENV GIN_MODE=release
EXPOSE 8080
VOLUME /data
USER 65532:65532
ENTRYPOINT ["/server"]
