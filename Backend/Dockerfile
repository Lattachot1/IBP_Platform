# Multi-stage build for Go backend
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install git and ca-certificates for fetching dependencies
RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o ube-backend main.go

# Production stage
FROM alpine:3.19

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Bangkok

COPY --from=builder /app/ube-backend /app/ube-backend

EXPOSE 8080

CMD ["/app/ube-backend"]
