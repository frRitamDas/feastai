## Deploying to Render

This repository is Vercel-first by default. To deploy on Render you must provide compatible replacements for a few Vercel-only services and set environment variables.

Required environment variables for Render (example names):

- STORAGE_PROVIDER - `s3` or `local` (set to `s3` for production)
- If using S3:
  - AWS_S3_BUCKET
  - AWS_REGION
  - AWS_ACCESS_KEY_ID
  - AWS_SECRET_ACCESS_KEY
- AI_GATEWAY_API_KEY - required if you are not running on Vercel (used by the AI Gateway)
- DATABASE_URL - Postgres connection string used by Drizzle
- REDIS_URL - if you provision Redis and the app expects it
- NEXT_PUBLIC_BASE_PATH - optional for base path handling

Render build & start example commands:

Build command:

pnpm install && pnpm build

Start command:

pnpm start

Notes:
- The repository uses `pnpm`. Ensure Render is configured to use pnpm (or install pnpm in the build image).
- The storage adapter is pluggable. For production set STORAGE_PROVIDER=s3 and provide AWS credentials as above. For quick testing you can set STORAGE_PROVIDER=local and uploaded files will be stored under `public/uploads/` and served by Next as static assets.
