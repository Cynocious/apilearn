// Prints a Firebase ID token for manual API testing.
//
// Usage:
//   FIREBASE_WEB_API_KEY=<your-web-api-key> node scripts/get-token.mjs <email> <password>
//
// Signs in (or signs up if the email is new) and prints the idToken.
// The web API key is in: Firebase console → Project settings → General →
// Web API Key. It is a public browser key, not a secret.
// Requires the Email/Password provider enabled in Firebase Auth.

import https from 'node:https';

const API_KEY = process.env.FIREBASE_WEB_API_KEY;
if (!API_KEY) {
  console.error(
    'Set FIREBASE_WEB_API_KEY — find it in the Firebase console under Project settings → General → Web API Key.'
  );
  process.exit(1);
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/get-token.mjs <email> <password>');
  process.exit(1);
}

function call(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'identitytoolkit.googleapis.com',
        path: `/v1/accounts:${endpoint}?key=${API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify({ ...payload, returnSecureToken: true }));
  });
}

let data = await call('signInWithPassword', { email, password });
if (data.error) {
  // Identity Toolkit returns INVALID_LOGIN_CREDENTIALS (not EMAIL_NOT_FOUND)
  // for unknown emails, to prevent user enumeration. Try signing up.
  const signup = await call('signUp', { email, password });
  if (signup.idToken) {
    data = signup;
  } else if (signup.error?.message === 'EMAIL_EXISTS') {
    console.error(`Wrong password for existing account: ${email}`);
    process.exit(1);
  } else {
    console.error(
      'Could not get a token:',
      JSON.stringify(signup.error || signup, null, 2)
    );
    process.exit(1);
  }
}

if (data.idToken) {
  console.log(data.idToken);
  console.error(`(uid: ${data.localId})`);
}
