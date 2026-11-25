// Connexion au projet Firebase du studio (forfait gratuit Spark : Firestore,
// Authentication et Hosting ; pas de Cloud Functions).
// La configuration vient de : Console Firebase → Paramètres du projet → Vos applications → Web.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBIrjOoXsXqJh5_Dh2LrfFfT-132VFFW5I",
  authDomain: "sponsorhichem.firebaseapp.com",
  projectId: "sponsorhichem",
  storageBucket: "sponsorhichem.firebasestorage.app",
  messagingSenderId: "499965988228",
  appId: "1:499965988228:web:21f6a573fd08767e5c61d1",
};

// ?emulateur=1 dans l'adresse : travaille sur l'émulateur local (essais), jamais sur la vraie base.
const local = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulateur");

export const app = initializeApp(local ? { ...firebaseConfig, projectId: "demo-studio" } : firebaseConfig);
export const db = getFirestore(app);
export const usingEmulator = local;
if (local) connectFirestoreEmulator(db, "127.0.0.1", 8080);

/** Adresse de la page de suivi pour un jeton, sur le site actuel. */
export const trackingUrl = (token) => new URL(`suivi.html?t=${token}`, new URL("../", import.meta.url)).href;
