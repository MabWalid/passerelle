import { timingSafeEqual } from "node:crypto";

function sameSecret(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Exige la clé caisse quand PASSE_API_KEY est défini. Sans clé, la démo locale reste ouverte. */
export function cashierAuth(req, res, next) {
  const key = process.env.PASSE_API_KEY?.trim();
  if (!key) return next();
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : (req.get("x-api-key") || "").trim();
  if (token && sameSecret(token, key)) return next();
  res.status(401).json({ error: "Clé caisse requise.", auth: true });
}

/** Jeton que Wallet envoie : Authorization: ApplePass <authenticationToken>. */
export function applePassAuthorized(header, expected) {
  const token = (header || "").startsWith("ApplePass ") ? header.slice("ApplePass ".length).trim() : "";
  if (!expected || !token) return false;
  return sameSecret(token, expected);
}
