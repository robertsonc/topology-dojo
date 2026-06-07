# Deployment

Topology Dojo is a static Vite build (`dist/`) hosted on **Cloudflare Pages**,
deployed from **GitHub Actions** (`.github/workflows/deploy.yml`).

## How it works

| Trigger        | Result                                                         |
| -------------- | -------------------------------------------------------------- |
| Push to `main` | **Production** deployment (branch alias `main`)                |
| Pull request   | **Preview** deployment; the preview URL is commented on the PR |

The workflow runs the same `npm run build` the CI gate validates, then ships
`dist/` via `wrangler pages deploy`. No build logic lives in Cloudflare — the
repo is the single source of truth for how the site is built.

## One-time setup (Cloudflare + GitHub)

These steps require dashboard access and cannot be automated from the repo:

1. **Create the Pages project.** Cloudflare dashboard → Workers & Pages →
   Create → Pages → **Direct Upload**, name it `topology-dojo`. (Direct Upload,
   not Git integration — GitHub Actions does the deploying.)
2. **Create a scoped API token.** My Profile → API Tokens → Create Token →
   custom token with permission **Account → Cloudflare Pages → Edit**.
3. **Find your Account ID.** Shown in the Workers & Pages sidebar.
4. **Add GitHub repo secrets** (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

Until these exist, the Deploy workflow **skips the deploy step and still passes**
(it logs a notice instead of failing), so PRs stay green. CI
(typecheck/test/lint/build) is independent and unaffected either way. Once the
secrets are set, deploys run automatically.

## Notes

- The project name `topology-dojo` is referenced in `deploy.yml`; keep the
  Pages project name in sync if you rename it.
- `GITHUB_TOKEN` is provided automatically by Actions and is only used to post
  the preview URL comment on PRs.
