# OSS Runner (AutoShop staging)

A minimal local automation runner used for staging/testing without touching production.

## Endpoints
- `POST /run` — accepts `{ userId, action, payload, proxy }`
- `GET /status/:jobId` — returns job status/result

## Local run
```sh
cd services/oss-runner
node index.js
```

## Environment variables
- `PORT` (default: 8081)
- `HOST` (default: 0.0.0.0)
- `OSS_PROXY_SERVER` (optional)
- `OSS_PROXY_USERNAME` (optional)
- `OSS_PROXY_PASSWORD` (optional)

Profiles are stored in `services/oss-runner/profiles/<userId>/` and logs in `services/oss-runner/logs/`.
