import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

// --- Firestore setup --------------------------------------------------------
// Local dev: expects a Firebase service account key. Download one from:
// Firebase console > Project settings > Service accounts > Generate new private key
// and save it as serviceAccountKey.json in the project root.
// Cloud Run: no key file — falls back to Application Default Credentials,
// i.e. the service account attached to the Cloud Run service.
const credentialEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const keyPath = credentialEnv || path.join(process.cwd(), 'serviceAccountKey.json');

let credential;
if (fs.existsSync(keyPath)) {
  try {
    // Parse ourselves so a bad file fails with a clear message instead of a
    // firebase-admin stack trace.
    const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    if (!key.private_key) {
      throw new Error('file does not contain a "private_key" field');
    }
    credential = cert(key);
    console.log('Using service account key file:', keyPath);
  } catch (err) {
    console.error(`Could not load service account key from ${keyPath}: ${err.message}`);
    process.exit(1);
  }
} else if (credentialEnv) {
  console.error(`GOOGLE_APPLICATION_CREDENTIALS points to a missing file: ${keyPath}`);
  console.error(
    'It must be a file path, not the JSON content itself. Unset it or fix the path.'
  );
  process.exit(1);
} else {
  credential = applicationDefault();
  console.log(
    'No service account key found — using Application Default Credentials (Cloud Run service identity).'
  );
}

initializeApp({ credential });

const db = getFirestore();
const auth = getAuth();
const COLLECTION = 'firestoreCollection';

const app = express();
app.use(express.json());

// --- App-level auth ----------------------------------------------------------
// Every /firestoreCollection route requires a Firebase ID token (Bearer).
// The token is verified against Firebase Auth, and the caller's uid is
// enforced on writes so users can only touch their own documents.
// (To allow admin-style access later, check custom claims here.)
async function requireAuth(req, res, next) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!match) {
    return res.status(401).json({
      error:
        'missing Authorization header — expected "Authorization: Bearer <firebase-id-token>"',
    });
  }
  try {
    req.user = await auth.verifyIdToken(match[1]);
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: `invalid or expired ID token (${err.message})` });
  }
}

// --- Swagger (interactive API docs at /api-docs) -----------------------------
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Firestore API',
      version: '1.0.0',
      description:
        'Inserts and deletes documents in a Firestore collection. All data routes require a Firebase ID token (Bearer).',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Firebase ID Token',
          description: 'ID token obtained from the Firebase Auth SDK on the client.',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    // Relative so Swagger UI resolves it against wherever it's served
    // (localhost in dev, the .run.app URL on Cloud Run).
    servers: [{ url: '/' }],
  },
  apis: [fileURLToPath(import.meta.url)], // picks up the @swagger comments below
});

// Machine-readable spec, registered before the UI middleware so it wins.
app.get('/api-docs/swagger.json', (_req, res) => res.json(swaggerSpec));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Health check ------------------------------------------------------------
/**
 * @swagger
 * /:
 *   get:
 *     summary: Health check
 *     security: []
 *     responses:
 *       200:
 *         description: Server is up
 */
app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Insert ------------------------------------------------------------------
// POST /firestoreCollection
// Body: { "title": "...", "uid": "..." }
/**
 * @swagger
 * /firestoreCollection:
 *   post:
 *     summary: Insert a document for the authenticated user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:
 *                 type: string
 *               uid:
 *                 type: string
 *                 description: Optional — defaults to the authenticated user's uid; if provided it must match the token's uid
 *     responses:
 *       201:
 *         description: Document created; the generated id is stored as a documentId field too
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 title:
 *                   type: string
 *                 uid:
 *                   type: string
 *       400:
 *         description: Missing or invalid title/uid
 *       401:
 *         description: Missing or invalid Firebase ID token
 *       403:
 *         description: uid does not match the authenticated user
 *       500:
 *         description: Firestore error
 */
app.post('/firestoreCollection', requireAuth, async (req, res) => {
  const { title, uid } = req.body;

  if (typeof title !== 'string' || title.trim() === '') {
    return res
      .status(400)
      .json({ error: 'title is required and must be a non-empty string' });
  }

  // uid defaults to the authenticated user's uid when omitted.
  const effectiveUid = uid === undefined || uid === null ? req.user.uid : uid;
  if (typeof effectiveUid !== 'string' || effectiveUid.trim() === '') {
    return res
      .status(400)
      .json({ error: 'uid must be a non-empty string' });
  }
  if (effectiveUid.trim() !== req.user.uid) {
    return res
      .status(403)
      .json({ error: 'uid does not match the authenticated user' });
  }

  // .doc() generates the auto ID without a network call, so it can be stored
  // as a field in the same single write.
  const docRef = db.collection(COLLECTION).doc();
  await docRef.set({
    title: title.trim(),
    uid: effectiveUid.trim(),
    documentId: docRef.id,
  });

  res
    .status(201)
    .json({ id: docRef.id, title: title.trim(), uid: effectiveUid.trim() });
});

// --- Delete ------------------------------------------------------------------
// DELETE /firestoreCollection/:uid
// Deletes every document in the collection whose uid field matches.
/**
 * @swagger
 * /firestoreCollection/{uid}:
 *   delete:
 *     summary: Delete the authenticated user's documents
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         description: Must match the uid of the authenticated token
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Number of documents deleted
 *       401:
 *         description: Missing or invalid Firebase ID token
 *       403:
 *         description: uid does not match the authenticated user
 *       404:
 *         description: No documents found with that uid
 *       500:
 *         description: Firestore error
 */
app.delete('/firestoreCollection/:uid', requireAuth, async (req, res) => {
  const { uid } = req.params;

  if (uid !== req.user.uid) {
    return res
      .status(403)
      .json({ error: 'you can only delete your own documents' });
  }

  const snapshot = await db
    .collection(COLLECTION)
    .where('uid', '==', uid)
    .get();

  if (snapshot.empty) {
    return res.status(404).json({ error: `no documents found with uid "${uid}"` });
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  res.json({ deleted: snapshot.size });
});

// --- List --------------------------------------------------------------------
// GET /firestoreCollection
// Not part of the spec — handy for checking what's in the collection.
/**
 * @swagger
 * /firestoreCollection:
 *   get:
 *     summary: List the authenticated user's documents
 *     responses:
 *       200:
 *         description: Array of the caller's documents
 *       401:
 *         description: Missing or invalid Firebase ID token
 *       500:
 *         description: Firestore error
 */
app.get('/firestoreCollection', requireAuth, async (req, res) => {
  // Only the caller's own documents.
  const snapshot = await db
    .collection(COLLECTION)
    .where('uid', '==', req.user.uid)
    .get();
  res.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
});

// --- Error handler ------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(err);
  // Return the message for easy local debugging; hide it in production.
  res.status(500).json({ error: err.message || 'internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
