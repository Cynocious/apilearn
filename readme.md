# Firestore API

A small Express API that inserts and deletes documents in a Firestore
collection, deployed on Google Cloud Run.

- Collection: `firestoreCollection`
- Document fields: `title`, `uid`, `documentId` (the generated Firestore
  document ID, also stored as a field)
- Stack: Node.js + Express + Firebase Admin SDK, containerized with Docker
- Auth: Firebase ID tokens (Bearer) required on every data route — see
  *Access model* below

---

## Part 1 — Set up Firebase

### 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   and sign in with the Google account that will own this API.
2. Click **Add project** (or select an existing project).
3. Enter a name (e.g. `apilearn`) and click **Continue**.
4. Google Analytics is optional — toggle either way, then **Continue**.
5. Click **Create project**.

### 2. Enable billing (Blaze plan)

Firestore and Cloud Run both require billing. If prompted when enabling
Firestore, upgrade the project to the **Blaze** pay-as-you-go plan. You get a
free monthly allowance — at this scale it costs nothing.

### 3. Create the Firestore database

1. In the Firebase console, open **Build → Firestore Database**.
2. Click **Create database**.
3. Choose a location (e.g. `nam5 (us-central)`) and click **Next**.
4. Security rules: pick either mode — the Admin SDK used by this API bypasses
   security rules entirely, so this setting doesn't affect it.

### 4. Download a service account key (local development only)

1. Click the gear icon → **Project settings** → **Service accounts**.
2. Click **Generate new private key** and download the JSON file.
3. Save it as `serviceAccountKey.json` in the project root of this repo.
   The file is gitignored — never commit it.

### 5. Enable Firebase Auth

1. In the Firebase console, open **Build → Authentication → Get started**.
2. Enable the **Email/Password** provider (or Anonymous).
   This initializes Identity Toolkit — without it no ID tokens can be
   issued and every data-route call fails.

Optional but useful: register a web app (**Project settings → General →
Your apps → `</>`**) to get the **web API key** used by the token script
and client apps. Without a registered app the key isn't shown in the
Firebase console — it can also be found in the GCP console under
**APIs & Services → Credentials** ("Browser key (auto created by
Firebase)").

---

## Part 2 — Run locally

1. Install dependencies:

   ```
   npm install
   ```

2. Make sure `serviceAccountKey.json` from Part 1 is in the project root.

3. Start the server:

   ```
   npm start
   ```

   Interactive API docs (Swagger UI) are then at
   http://localhost:3000/api-docs.

4. Test it — every data route needs a Firebase ID token. Get one with the
   token script (see *App-level auth* below; it prints the token and the
   `uid`):

   ```
   # $env:FIREBASE_WEB_API_KEY = "<your-web-api-key>"
   # node scripts/get-token.mjs you@example.com yourpassword
   TOKEN=<printed-token>
   UID=<printed-uid>

   curl -X POST http://localhost:3000/firestoreCollection \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"title": "Hello world"}'          # uid defaults to yours

   curl -X DELETE http://localhost:3000/firestoreCollection/$UID \
     -H "Authorization: Bearer $TOKEN"

   curl http://localhost:3000/firestoreCollection \
     -H "Authorization: Bearer $TOKEN"
   ```

   Inserts land in your Firebase project's `firestoreCollection` — you can
   see them in the Firebase console under **Build → Firestore Database**.

---

## Part 3 — Deploy to Cloud Run

The service runs as a container. In Cloud Run it does **not** need a key
file — it uses the service account attached to the Cloud Run service
(Application Default Credentials). You only need to grant that service
account Firestore access (shared step below).

Pick one of the two deploy options:

### Option A: Continuously deploy from a GitHub repository

Cloud Build builds the image on Google's side and deploys on every push to
`main`. No local Docker needed.

1. Push the code:

   ```
   git add .
   git commit -m "Firestore API + Cloud Run Dockerfile"
   git push
   ```

2. Open [console.cloud.google.com/run](https://console.cloud.google.com/run)
   and make sure the project picker (top bar) shows the Firebase project from
   Part 1.
3. Click **Create service**.
4. Choose **Continuously deploy from a repository (source or function)**
   → **Set up with Cloud Build**.
5. Authenticate GitHub when prompted, then select this repo and the `main`
   branch.
6. Build type: **Dockerfile** (it's at the repo root).
7. Service name: `apilearn`. Region: `us-central1`.
8. Authentication: **Allow unauthenticated invocations** — the API itself
   checks Firebase ID tokens (see *Access model* below).
9. Leave CPU/memory defaults; container port is 8080 (auto-detected from the
   Dockerfile). Click **Create**.

Cloud Build now builds the image and deploys it. Every push to `main`
redeploys automatically.

### Option B: Deploy a locally-built Docker image

Build and push the image yourself, then point Cloud Run at it. (Tradeoff: no
automatic redeploys — to update the service you rebuild, push, and deploy a
new revision.)

1. Start **Docker Desktop** and build the image:

   ```
   docker build -t apilearn .
   ```

2. Push the image to a registry. Either:

   **Docker Hub** (simplest — no Google CLI needed; the image is public by
   default, make the repo private if you'd rather not expose it):

   ```
   docker login
   docker tag apilearn <your-dockerhub-user>/apilearn
   docker push <your-dockerhub-user>/apilearn
   ```

   **Artifact Registry** (GCP-native, private by default; requires the gcloud
   CLI). One-time: create a Docker-format repository named `apilearn` in the
   console (Artifact Registry → **Create repository**), then:

   ```
   gcloud auth configure-docker us-central1-docker.pkg.dev
   docker tag apilearn us-central1-docker.pkg.dev/<project-id>/apilearn/apilearn
   docker push us-central1-docker.pkg.dev/<project-id>/apilearn/apilearn
   ```

3. In [console.cloud.google.com/run](https://console.cloud.google.com/run):
   click **Create service** → **Deploy one revision from an existing
   container image** → paste the image URL you pushed → service name
   `apilearn`, region `us-central1` → **Allow unauthenticated invocations**
   → **Create**.

### Grant Firestore access to the service (required for both options)

Without this, every request returns a 500 (permission denied on Firestore).

1. In the Cloud Run service, open the **Revisions** details to find the
   service account (looks like `123456789-compute@developer.gserviceaccount.com`).
2. Open **IAM & Admin → IAM** → **Grant access**.
3. New principals: that `-compute@developer.gserviceaccount.com` address.
4. Role: **Cloud Datastore User** (grants Firestore read/write). Save.

### Test the deployed API

```
curl https://<your-service-url>/
```

The health check returns `{"status":"ok"}` (open), and the Swagger UI is at
`https://<your-service-url>/api-docs`. For the data routes, first get a
token and use it like in Part 2:

```
TOKEN=<printed-token>
UID=<printed-uid>

curl -X POST https://<your-service-url>/firestoreCollection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title": "Hello from Cloud Run"}'   # uid defaults to yours

curl -X DELETE https://<your-service-url>/firestoreCollection/$UID \
  -H "Authorization: Bearer $TOKEN"
```

Writes appear in the same Firebase console Firestore viewer as local
writes.

---

## Make targets

A [Makefile](Makefile) bundles the build & deploy commands:

| Command | What it does |
| ------- | ------------ |
| `make build` | Builds via Cloud Build ([deploy/cloudbuild.yaml](deploy/cloudbuild.yaml)) and pushes to Artifact Registry — no local Docker needed |
| `make build-local` | Builds and pushes locally with `docker buildx` (needs Docker Desktop) |
| `make deploy` | Deploys the `latest` image to Cloud Run (public URL — Firebase ID tokens gate the data routes) |
| `make publish` | `make build` + `make deploy` |
| `make run` | Runs the image on http://localhost:3000, mounting your service account key |
| `make clean` | Removes the local image |

The image tag comes from `package.json` (read by [scripts/version.cjs](scripts/version.cjs)).

Requires: GNU Make, the gcloud CLI authenticated for `build` / `deploy`, and
an Artifact Registry repository named `apilearn` in `us-central1`.
`build-local` additionally needs Docker Desktop running and Docker logged in
to the registry (`gcloud auth configure-docker us-central1-docker.pkg.dev`).

---

## Endpoints

| Method | Path | Body / Params | Result |
| ------ | ---- | ------------- | ------ |
| `GET` | `/` | — | Health check: `{"status":"ok"}` |
| `POST` | `/firestoreCollection` | token + `{ "title": "..." }` | Inserts a doc, returns `201` with the generated doc id (`uid` optional — defaults to the token's uid; if provided it must match) |
| `DELETE` | `/firestoreCollection/:uid` | token + uid in URL | Deletes the caller's docs with that `uid` (`403` if not yours, `404` if none) |
| `GET` | `/firestoreCollection` | token | Lists the caller's own docs |
| `GET` | `/api-docs` | — | Interactive Swagger UI |
| `GET` | `/api-docs/swagger.json` | — | The OpenAPI spec as JSON |

Every data route requires `Authorization: Bearer <firebase-id-token>`;
missing/invalid token → `401`, uid mismatch → `403`.

---

## Access model

The Cloud Run URL is public (`--allow-unauthenticated` in the Makefile) —
Cloud Run's IAM layer is switched off so the `Authorization` header reaches
the app intact. Access control happens per request inside the API: every
data route requires a Firebase ID token (see *App-level auth* below), and
unauthenticated requests get a `401` before touching Firestore.

---

## App-level auth (Firebase Auth)

On every data route — `POST`, `GET`, and `DELETE /firestoreCollection` — the
request must carry a **Firebase ID token**:

```
Authorization: Bearer <firebase-id-token>
```

The token is verified with the Firebase Admin SDK, and authorization is
enforced per user:

- missing/invalid token → `401`
- `POST` omitting `uid` defaults it to your uid; `POST` with a `uid` that
  isn't yours, or `DELETE /firestoreCollection/:uid` for someone else's
  uid → `403`
- `GET /firestoreCollection` returns only your own documents
- `/` (health) and `/api-docs` are open; everything else requires a token

### Set up

Firebase console → **Build → Authentication → Get started** and enable at
least one sign-in provider (e.g. Anonymous or Email/Password). This
initializes Identity Toolkit — without it no ID tokens can be issued.

### Getting a token manually (for curl/testing)

The quickest way to get a token without building a client:

```
# PowerShell:
$env:FIREBASE_WEB_API_KEY = "<your-web-api-key>"
node scripts/get-token.mjs you@example.com yourpassword
```

[scripts/get-token.mjs](scripts/get-token.mjs) signs in (or signs up if the
email is new) and prints the ID token. Your web API key is in the Firebase
console → **Project settings → General → Web API Key** (it's a public
browser key, not a secret). Then use the printed token:

```
curl -H "Authorization: Bearer <token>" https://<your-service-url>/firestoreCollection
```

Or raw, with the Identity Toolkit REST API (the response's `idToken` field
is the bearer):

```
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<your-web-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword","returnSecureToken":true}'
```

(Use `signInWithPassword` for existing accounts.)

### Clients (web / mobile)

Sign in with the Firebase SDK, then attach the user's ID token to every
request:

```js
import { getAuth } from 'firebase/auth';

const user = getAuth().currentUser;
const token = await user.getIdToken();
const res = await fetch('https://<your-service-url>/firestoreCollection', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ title: 'hello', uid: user.uid }),
});
```

Admin-style access for selected users can be added later by checking custom
claims in the `requireAuth` middleware in [index.js](index.js).

---

## Troubleshooting

### 401 Unauthorized on data routes

Expected without a token — every `/firestoreCollection` route requires
`Authorization: Bearer <firebase-id-token>` (see *App-level auth*). If
tokens can't be issued at all (identitytoolkit returns
`CONFIGURATION_NOT_FOUND`), Firebase Auth hasn't been initialized — see
Part 1 step 5.

### `Failed to parse service account json file` on startup

This happens when the `GOOGLE_APPLICATION_CREDENTIALS` environment variable
contains the key's **JSON content** instead of a file **path**. The variable
must be a path (or unset — the code then looks for `serviceAccountKey.json`
in the project root).

Fix it in the offending terminal:

```
Remove-Item Env:\GOOGLE_APPLICATION_CREDENTIALS
```

then `npm start` again. (Setting it deliberately would look like
`$env:GOOGLE_APPLICATION_CREDENTIALS = "D:\testingground\apilearn\serviceAccountKey.json"`.)

### Every request returns 500

First, read the 500 response body — it now contains the actual error message.

- **Stale server on port 3000:** an older `npm start` can keep holding the
  port (on Windows two Node processes can even bind it at once), so requests
  hit the old process instead of the new one. Find and kill it:

  ```
  netstat -ano | findstr ":3000"
  taskkill /PID <pid> /F
  ```

- **`no such file or directory` / missing credentials:** the server started
  without a key file (or with a broken `GOOGLE_APPLICATION_CREDENTIALS`).
  See the section above.

### My service account key was exposed

If you ever paste the key's contents into a chat, terminal, or repo by
mistake, regenerate it: Firebase console → **Project settings** →
**Service accounts** → **Generate new private key**, then replace
`serviceAccountKey.json` with the new download.
