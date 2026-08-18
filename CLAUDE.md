# CLAUDE.md

## What this project is

Express API deployed on Google Cloud Run that inserts/deletes documents in a
Firestore collection `firestoreCollection` (fields: `title`, `uid`,
`documentId`). Every data route requires a **Firebase ID token** (`Bearer`);
the Cloud Run URL itself is public (`--allow-unauthenticated`). Swagger UI at
`/api-docs`, spec JSON at `/api-docs/swagger.json`.

## Key files

- `index.js` — the whole server: credential loading, `requireAuth`
  middleware, routes, Swagger spec generated from `@swagger` JSDoc comments
- `Dockerfile` — `node:24-slim`, port 8080 (Cloud Run default)
- `Makefile` — `build` (Cloud Build), `build-local` (docker buildx),
  `deploy`, `publish`, `run`, `clean`. `SHELL := cmd.exe` is intentional —
  see gotchas
- `deploy/cloudbuild.yaml` — Cloud Build config used by `make build`; tags
  `:$(VERSION)` and `:latest`, pushes to Artifact Registry
- `scripts/version.cjs` — prints the package.json version (used by the
  Makefile; make 3.81 cannot handle quoted commands in `$(shell)`)
- `scripts/get-token.mjs` — prints a Firebase ID token for manual API
  testing; reads `FIREBASE_WEB_API_KEY` from env; signs up if the email is
  new (Identity Toolkit returns `INVALID_LOGIN_CREDENTIALS` for unknown
  emails, not `EMAIL_NOT_FOUND`)
- `.dockerignore` / `.gcloudignore` — keep `serviceAccountKey.json` out of
  images and Cloud Build uploads. Do NOT re-add `Dockerfile` to
  `.gcloudignore` (Cloud Build needs it)
- `readme.md` — full setup/deploy/auth guide (Part 1–3 + troubleshooting)

## Commands

```
npm start                       # local server on :3000 (needs serviceAccountKey.json)
make build                      # build image via Cloud Build, push to Artifact Registry
make deploy                     # deploy latest image to Cloud Run
make publish                    # build + deploy
make run                        # run container locally, key mounted
node scripts/get-token.mjs <email> <password>   # needs FIREBASE_WEB_API_KEY
```

## Current live environment

- Firebase/GCP project: `apilearn-512c2` (project number `287625532060`)
- Cloud Run service: `apilearn`, us-central1 →
  `https://apilearn-4dtoz6ygea-uc.a.run.app`
- Artifact Registry repo: `apilearn`
  (`us-central1-docker.pkg.dev/apilearn-512c2/apilearn/apilearn`)
- Browser API key ID: `44ed904e-fb62-47c8-96ad-76ea98badf1b` (displayName
  "Browser key (auto created by Firebase)") — get the key string with
  `gcloud services api-keys get-key-string <id> --format="value(keyString)"`
  (the key itself is public by design, but don't paste it into chat
  transcripts)
- Service account key for local dev: `serviceAccountKey.json` (gitignored)

## Architecture decisions (why — don't "fix" without understanding)

- **firebase-admin v14 dropped the modular helpers** (`addDoc`,
  `collection()`, etc.). The code uses the class-based API
  (`db.collection(...).add/.where/.get/.doc().set()`).
- **Auth model: Firebase Auth only, no Cloud Run IAM layer.** Cloud Run's
  IAM auth consumes the `Authorization` header when it authenticates a
  request, so the app never sees the Firebase bearer token — the two layers
  cannot coexist on the same header. The URL is therefore public and the
  `requireAuth` middleware is the single gate. If someone wants
  defense-in-depth again, the Firebase token must move to a custom header
  (e.g. `x-firebase-token`) before re-enabling IAM.
- Per-user isolation: POST body `uid` is optional and defaults to the token
  uid; if provided it must match (403 otherwise). DELETE only the caller's
  uid (403 otherwise); GET returns only the caller's docs. Admin-style
  access would be custom claims checked in `requireAuth`.
- `documentId` field is stored inside the doc: `doc()` generates the auto-ID
  client-side, then `set()` writes it as a field in one operation.
- Error handler returns `err.message` (fine for a learning API; hide in
  production).
- Swagger `servers` is relative (`/`) so "Try it out" works both locally and
  on the deployed URL.
- Credential loading: local dev uses `serviceAccountKey.json` (or
  `GOOGLE_APPLICATION_CREDENTIALS` pointing at a file path); on Cloud Run it
  falls back to Application Default Credentials (the service identity).

## Recreating this from scratch (new Firebase project)

The repo is self-contained; only these manual Google-side steps are needed:

1. **Firebase project** — console.firebase.google.com → Add project.
2. **Billing (Blaze)** — required for Firestore, Cloud Run, Cloud Build,
   Artifact Registry (all refuse to activate without a linked billing
   account: `FAILED_PRECONDITION: Billing account ... is not found`).
3. **Firestore** — Build → Firestore Database → Create database (location
   and rules mode don't matter; the Admin SDK bypasses rules).
4. **Service account key** — Project settings → Service accounts →
   Generate new private key → save as `serviceAccountKey.json` in repo root
   (gitignored). Never commit.
5. **Firebase Auth** — Build → Authentication → Get started → enable
   Email/Password. Without this, identitytoolkit returns
   `CONFIGURATION_NOT_FOUND` and no ID tokens can be issued.
6. **Web API key** — register a web app (Project settings → General → Your
   apps → `</>`) or reuse the auto-created browser key from GCP
   (APIs & Services → Credentials). Needed for
   `scripts/get-token.mjs` and client SDKs.
7. **gcloud setup** —
   `gcloud auth login` + `gcloud config set project <id>`, then:
   ```
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
   gcloud artifacts repositories create apilearn --repository-format=docker --location=us-central1
   gcloud auth configure-docker us-central1-docker.pkg.dev
   ```
8. **Deploy** — `make build` then `make deploy` (update
   `PROJECT_ID`/`REGION`/`SERVICE_NAME` in the Makefile and the image name
   in `deploy/cloudbuild.yaml`).
9. **Firestore access for Cloud Run (critical)** — grant
   `roles/datastore.user` ("Cloud Datastore User") to the service's compute
   service account (`<project-number>-compute@developer.gserviceaccount.com`,
   shown in the Cloud Run revision details). Without it every request 500s
   with permission-denied:
   ```
   gcloud projects add-iam-policy-binding <project-id> \
     --member serviceAccount:<project-number>-compute@developer.gserviceaccount.com \
     --role roles/datastore.user
   ```
10. **Verify** — health check is open; data routes: get a token with
    `scripts/get-token.mjs` and call with
    `Authorization: Bearer <token>`.

## Gotchas (all learned the hard way)

- **Windows + GnuWin32 make 3.81**: `$(shell ...)` breaks on quoted commands
  → keep shell commands quote-free (hence `scripts/version.cjs`). Recipes run
  under `cmd.exe` (`SHELL := cmd.exe`); recipe lines starting with `#` are
  passed to the shell and error — make comments must be column 0, not
  tab-indented.
- **winget's GnuWin32 make install does not update PATH** — add
  `C:\Program Files (x86)\GnuWin32\bin` to the user PATH manually.
- **Windows allows two Node processes to bind the same port**
  (SO_REUSEADDR) — a stale `npm start` answers while a new server "starts"
  fine. Diagnose with `netstat -ano | findstr ":3000"` and
  `taskkill /PID <pid> /F`.
- **Killing background node from Git Bash**: `kill $!` kills the wrapper
  shell, not node — use `taskkill` on the netstat PID.
- **`GOOGLE_APPLICATION_CREDENTIALS` must be a file path, not JSON
  content** — setting it to the key's contents produces a confusing
  firebase-admin parse error.
- Docker Desktop may not be running; `make build` (Cloud Build) and
  `make deploy` don't need it, only `build-local` / `make run` do.
- IAM changes on Cloud Run take ~30s to propagate — a freshly restricted
  URL may still answer 200 briefly.
