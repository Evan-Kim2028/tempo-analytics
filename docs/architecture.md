# Architecture

Tempo Explorer is a standalone Next.js application that depends on external TIDX and ClickHouse services.

The current bootstrap commit contains the explorer UI and data-access code only. The repo is intended to own explorer-specific analytics SQL assets and related operational scripts in later tasks, but those assets are not yet part of this bootstrap.
