// student-auth.js
// Turns a student ID into the login email used by Firebase Authentication.
// Example: 26251037  ->  26251037@breakbite.app

export const STUDENT_EMAIL_DOMAIN = "breakbite.app";

// Returns the cleaned student ID, or null if it is not valid.
// Valid: 4 to 12 letters or numbers, no spaces.
export function cleanStudentId(raw) {
  const id = String(raw || "").trim();
  if (!/^[A-Za-z0-9]{4,12}$/.test(id)) return null;
  return id.toLowerCase();
}

// Returns the login email for a student ID, or null if the ID is not valid.
export function studentEmail(raw) {
  const id = cleanStudentId(raw);
  if (!id) return null;
  return id + "@" + STUDENT_EMAIL_DOMAIN;
}

// True if an email belongs to a student (so the staff page can refuse it).
export function isStudentEmail(email) {
  return String(email || "").toLowerCase().endsWith("@" + STUDENT_EMAIL_DOMAIN);
}

// Returns the student ID from a login email, e.g. 26251037@breakbite.app -> 26251037
export function studentIdFromEmail(email) {
  return String(email || "").split("@")[0];
}