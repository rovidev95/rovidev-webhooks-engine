# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-06-27

### Added
- Idempotent webhook processing that handles at-least-once delivery.
- HMAC and Stripe-style signature verification with replay protection.
- Retries with exponential backoff and a configurable dead-letter sink.
- In-memory and Redis idempotency stores behind a small interface.
