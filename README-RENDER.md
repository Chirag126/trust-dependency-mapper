# Render deployment patch

This patch makes the frontend use `VITE_API_URL` so the same build works locally and in production, and adds a Render Blueprint for the API + frontend.

## Render setup

1. Push the complete project to GitHub.
2. In Render, create a **Blueprint** and select the repository containing `render.yaml`.
3. Render creates:
   - `trust-dependency-mapper-api` (Node/Express web service)
   - `trust-dependency-mapper-web` (static site)
4. In the API service, set the required secret values (`CORS_ORIGIN`, RPC URLs, admin credentials/JWT secret, and optional GitHub token).
5. Deploy the API first. Copy its public URL, e.g. `https://trust-dependency-mapper-api.onrender.com`.
6. Set the frontend service's `VITE_API_URL` to that API URL and redeploy the frontend.
7. Set the API service's `CORS_ORIGIN` to the frontend's public URL and redeploy the API.

The API uses `/var/data/tdm.sqlite`, which is mounted on the Render persistent disk defined in the Blueprint. This keeps SQLite data across normal service restarts/deploys on a plan that supports persistent disks.

## Local behavior

If `VITE_API_URL` is empty, the frontend keeps using Vite's existing `/api` development proxy to `http://localhost:4000`.

## Node

The server declares Node 26.8.2 compatibility. Render's runtime should be pinned to Node 26.8.2 through the repository's `.node-version`/`engines` configuration as applicable.
