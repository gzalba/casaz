import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Estos valores salen de la consola de Firebase (Configuración del proyecto → Tus apps → Web).
// En local se leen de .env.local; en Vercel, de las Environment Variables del proyecto.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MSG_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
};

// Nombres de las variables que faltaron al momento del build.
// Vite reemplaza import.meta.env.* en tiempo de build: si no estaban cargadas
// en Vercel, quedan undefined y getAuth() explota (auth/invalid-api-key),
// dejando la página en blanco. Por eso chequeamos antes de inicializar.
export const faltantes = Object.entries({
  VITE_FB_API_KEY: firebaseConfig.apiKey,
  VITE_FB_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FB_PROJECT_ID: firebaseConfig.projectId,
  VITE_FB_STORAGE_BUCKET: firebaseConfig.storageBucket,
  VITE_FB_MSG_SENDER_ID: firebaseConfig.messagingSenderId,
  VITE_FB_APP_ID: firebaseConfig.appId,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);

export const configOK = faltantes.length === 0;

let auth = null;
let db = null;
let googleProvider = null;

if (configOK) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
} else {
  console.error("Falta configurar Firebase. Variables ausentes:", faltantes.join(", "));
}

export { auth, db, googleProvider };
