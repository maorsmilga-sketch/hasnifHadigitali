/* ============================================================
   הסניף הדיגיטלי — Shared Google sign-in (Firebase Auth)
   Loaded by index.html and contacts.html (same origin, so the
   Firebase session persisted in the browser is shared by both).
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBkDa1HIfs5YYUIR8RCB_EVrkiWVD7HuPY",
  authDomain:        "contacts-d9642.firebaseapp.com",
  databaseURL:       "https://contacts-d9642-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "contacts-d9642",
  storageBucket:     "contacts-d9642.firebasestorage.app",
  messagingSenderId: "468261470442",
  appId:             "1:468261470442:web:175585a08ee95c51e91793"
};

// Must match public.allowed_users (Supabase) and the Realtime Database rules —
// those are what actually enforce access; this list only drives the UI.
const ALLOWED_USERS = {
  'reuvenido@gmail.com':  'ido',
  'maorsmilga@gmail.com': 'maor'
};

if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);

function allowedUserKey(user) {
  if (!user || !user.email || !user.emailVerified) return null;
  return ALLOWED_USERS[user.email.toLowerCase()] || null;
}
