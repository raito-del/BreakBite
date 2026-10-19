// firebase.js: the only place where the Firebase settings live.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDCRkMrlBTqziE-zHiSd2vS-UpV2g9tKmg",
  authDomain: "breakbyte-4c823.firebaseapp.com",
  projectId: "breakbyte-4c823",
  storageBucket: "breakbyte-4c823.firebasestorage.app",
  messagingSenderId: "273984767540",
  appId: "1:273984767540:web:34e0563be291ad5fc52c61"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);