# syntax=docker/dockerfile:1.7
#
# Builds the olcrtc server from CANONICAL openlibrecommunity/olcrtc, pinned to
# the same commit the mobile client links (matching protocol). Canonical has no
# Dockerfile of its own, so this vendors the entrypoint/healthcheck (taken from
# the alananisimov fork; the July config schema is identical, verified).
#
# Build + push happens on a dev box, NOT the deploy server:
#   docker build -t <user>/olcrtc:<tag> deploy/olcrtc
#   docker push  <user>/olcrtc:<tag>
# Dokploy then just pulls the image (see docker-compose.yml).

# Canonical olcrtc go.mod requires go >= 1.26.3.
ARG GO_VERSION=1.26
ARG ALPINE_VERSION=3.22
# Pin to the client's olcrtc commit for protocol compatibility.
ARG OLCRTC_REF=1255cf8248ee4a52cb355ceb8cf72281a5f1affd

FROM golang:${GO_VERSION}-alpine${ALPINE_VERSION} AS build
WORKDIR /src
RUN apk add --no-cache ca-certificates git
ARG OLCRTC_REF
RUN git clone https://github.com/openlibrecommunity/olcrtc.git . \
    && git checkout "${OLCRTC_REF}"
RUN --mount=type=cache,target=/go/pkg/mod go mod download
ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/olcrtc ./cmd/olcrtc

FROM alpine:${ALPINE_VERSION} AS runtime
RUN apk add --no-cache ca-certificates ffmpeg tzdata && \
    addgroup -S olcrtc && \
    mkdir -p /usr/share/olcrtc /var/lib/olcrtc && \
    adduser -S -D -h /var/lib/olcrtc -s /sbin/nologin -G olcrtc olcrtc && \
    chown -R olcrtc:olcrtc /usr/share/olcrtc /var/lib/olcrtc

COPY --from=build --chown=olcrtc:olcrtc /src/data /usr/share/olcrtc
COPY --from=build /out/olcrtc /usr/local/bin/olcrtc
COPY olcrtc-entrypoint.sh /usr/local/bin/olcrtc-entrypoint
COPY olcrtc-healthcheck.sh /usr/local/bin/olcrtc-healthcheck
RUN chmod 0755 /usr/local/bin/olcrtc /usr/local/bin/olcrtc-entrypoint /usr/local/bin/olcrtc-healthcheck

USER olcrtc:olcrtc
WORKDIR /var/lib/olcrtc

ENV OLCRTC_MODE=srv \
    OLCRTC_TRANSPORT=vp8channel \
    OLCRTC_DATA_DIR=/usr/share/olcrtc \
    OLCRTC_DNS=8.8.8.8:53 \
    OLCRTC_KEY_FILE=/var/lib/olcrtc/key.hex \
    OLCRTC_SOCKS_HOST=127.0.0.1 \
    OLCRTC_SOCKS_PORT=8808 \
    OLCRTC_FFMPEG=ffmpeg

VOLUME ["/var/lib/olcrtc"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD ["/usr/local/bin/olcrtc-healthcheck"]

ENTRYPOINT ["/usr/local/bin/olcrtc-entrypoint"]
