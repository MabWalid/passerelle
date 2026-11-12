import express from "express";
import fs from "node:fs";
import os from "node:os";
import { presentCard } from "./lib/reward.js";
import { openStore, seedIfEmpty } from "./lib/store.js";
import { applePassAuthorized, cashierAuth } from "./lib/auth.js";
import { notifyPassUpdated } from "./lib/apns.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ---------- validation ----------
function clean(b = {}) {
  const num = String(b.num ?? "").replace(/\s/g, "");
  if (!/^\d{8,19}$/.test(num)) throw new Error("Numéro de carte invalide (8 à 19 chiffres).");
  const col = /^#[0-9a-fA-F]{6}$/.test(b.col) ? b.col : "#2aa6a0";
  return {
    num, col,
    nom: String(b.nom ?? "").slice(0, 60),
    ens: String(b.ens ?? "Enseigne").slice(0, 40),
    brand: String(b.brand ?? '').slice(0, 30),
    pts: Math.max(0, parseInt(b.pts) || 0),
    tk: Math.max(0, parseInt(b.tk) || 0),
  };
}
const rgb = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
const brandById = (id) => brands.find((x) => x.id === id) ?? brands[0];

function appleCerts() {
  return {
    wwdr: fs.readFileSync("certs/wwdr.pem"),
    signerCert: fs.readFileSync("certs/signerCert.pem"),
    signerKey: fs.readFileSync("certs/signerKey.pem"),
    signerKeyPassphrase: process.env.APPLE_SIGNER_PASSPHRASE || undefined,
  };
}

async function signedPass(card) {
  const { PKPass } = await import("passkit-generator");
  const web = process.env.APPLE_WEB_SERVICE_URL?.trim();
  const props = {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
    teamIdentifier: process.env.APPLE_TEAM_ID,
    serialNumber: card.num,
    organizationName: card.ens,
    description: `Carte de fidélité ${card.ens}`,
    backgroundColor: rgb(card.col),
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(255, 255, 255)",
  };
  if (web && card.authToken) {
    props.webServiceURL = web.endsWith("/") ? web : `${web}/`;
    props.authenticationToken = card.authToken;
  }
  const pass = await PKPass.from({ model: "./model/fidelite.pass", certificates: appleCerts() }, props);
  pass.type = "storeCard";
  pass.setBarcodes({ message: card.num, format: "PKBarcodeFormatCode128", altText: card.num });
  const shown = presentCard(card);
  const lines = card.receipts.map((r) => `${r.date} ${r.magasin} ${Number(r.montant).toFixed(2).replace(".", ",")} €`);
  pass.primaryFields.push({ key: "points", label: "Points", value: card.pts });
  pass.secondaryFields.push(
    { key: "nom", label: "Titulaire", value: card.nom },
    { key: "tickets", label: "Tickets digitaux", value: card.receipts.length }
  );
  pass.backFields.push(
    { key: "last", label: "Dernier ticket", value: lines[0] || "Aucun ticket enregistré.", changeMessage: "Nouveau ticket : %@" },
    { key: "rewards", label: "Récompenses atteintes", value: shown.rewardsEarned },
    { key: "tickets_dos", label: "Derniers tickets", value: lines.join("\n") || "Aucun ticket enregistré." }
  );
  if (card.location?.latitude != null) {
    pass.setLocations({
      latitude: card.location.latitude,
      longitude: card.location.longitude,
      relevantText: card.location.relevantText || card.ens,
    });
  }
  return pass;
}

function walletCard(req) {
  const card = store.getCard(req.params.serialNumber);
  if (!card || !applePassAuthorized(req.get("authorization"), card.authToken)) return null;
  return card;
}

// ---------- Apple Wallet : .pkpass signé ----------
app.post("/api/apple", cashierAuth, async (req, res) => {
  try {
    const d = clean(req.body);
    const b = brandById(d.brand);
    const card = store.saveCard({
      num: d.num, nom: d.nom, ens: d.ens, col: d.col, pts: d.pts,
      reward: b.reward, ptsPerEuro: b.ptsPerEuro, ecoG: b.ecoG, brand: b.id,
      location: b.location ?? null,
    });
    const pass = await signedPass(card);
    res.type("application/vnd.apple.pkpass")
      .set("Content-Disposition", `attachment; filename="${d.num}.pkpass"`)
      .set("Last-Modified", new Date(card.updatedAt).toUTCString())
      .send(pass.getAsBuffer());
  } catch (e) {
    const manque = e.code === "ENOENT";
    res.status(manque ? 501 : 400).json({
      error: manque
        ? "Certificats Apple manquants dans ./certs (voir README)."
        : e.message,
    });
  }
});

// ---------- Google Wallet : lien "Ajouter à Google Wallet" ----------
app.post("/api/google", async (req, res) => {
  try {
    const jwt = (await import("jsonwebtoken")).default;
    const d = clean(req.body);
    const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_SA_FILE, "utf8"));
    const b = brandById(d.brand);
    const logo = b.logoUrl || process.env.GOOGLE_LOGO_URL || "";
    if (!/^https:\/\//.test(logo)) {
      return res.status(400).json({ error: "Logo Google manquant : définissez GOOGLE_LOGO_URL (URL https publique)." });
    }
    const issuer = process.env.GOOGLE_ISSUER_ID;
    const classId = `${issuer}.fidelite_${d.ens.toLowerCase().replace(/\W+/g, "_")}`;
    const shown = presentCard({ pts: d.pts, reward: b.reward });
    const stored = store.getCard(d.num);
    const claims = {
      iss: sa.client_email,
      aud: "google",
      typ: "savetowallet",
      origins: [],
      payload: {
        loyaltyClasses: [{ id: classId, issuerName: d.ens, programName: `Carte ${d.ens}`,
          reviewStatus: "UNDER_REVIEW", hexBackgroundColor: d.col,
          programLogo: { sourceUri: { uri: logo } } }],
        loyaltyObjects: [{
          id: `${issuer}.${d.num}`, classId, state: "ACTIVE",
          accountId: d.num, accountName: d.nom,
          loyaltyPoints: { label: "Points", balance: { int: d.pts } },
          barcode: { type: "CODE_128", value: d.num, alternateText: d.num },
          textModulesData: [
            { id: "tickets", header: "Tickets digitaux", body: String(stored ? stored.receipts.length : d.tk) },
            { id: "rewards", header: "Récompenses atteintes", body: String(shown.rewardsEarned) },
          ],
        }],
      },
    };
    const token = jwt.sign(claims, sa.private_key, { algorithm: "RS256" });
    res.json({ url: `https://pay.google.com/gp/v/save/${token}` });
  } catch (e) {
    const manque = e.code === "ENOENT" || e instanceof TypeError;
    res.status(manque ? 501 : 400).json({
      error: manque ? "Compte de service Google manquant (voir README)." : e.message,
    });
  }
});



const port = process.env.PORT || 3000;

// ================= MODE DÉMO (0 €, sans certificat) =================
// Simule le cœur du produit : une caisse enregistre un ticket digital,
// la carte du client (ouverte sur son téléphone) se met à jour en direct.
const brands = JSON.parse(fs.readFileSync(new URL("./brands.json", import.meta.url), "utf8"));
app.get("/api/brands", (req, res) => res.json(brands));
const store = openStore(process.env.STORE_PATH || "./data/passerelle.sqlite");
seedIfEmpty(store, brands);
const streams = new Map(); // num -> Set<res>

function lanIps() {
  try {
    return Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i.address);
  } catch {
    return [];
  }
}

app.get("/api/info", (req, res) => {
  res.json({ port, ips: lanIps() });
});
app.post("/api/cards", cashierAuth, (req, res) => {
  try {
    const d = clean(req.body);
    const b = brandById(d.brand);
    const saved = store.saveCard({
      num: d.num, nom: d.nom, ens: d.ens, col: d.col, pts: d.pts,
      reward: b.reward, ptsPerEuro: b.ptsPerEuro, ecoG: b.ecoG, brand: b.id,
      location: b.location ?? null,
    });
    res.json(presentCard(saved));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/cards/:num", (req, res) => {
  const c = store.getCard(req.params.num);
  c ? res.json(presentCard(c)) : res.status(404).json({ error: "Carte inconnue. Créez-la depuis le studio." });
});
app.get("/api/cards/:num/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": ok\n\n");
  const set = streams.get(req.params.num) ?? new Set();
  set.add(res); streams.set(req.params.num, set);
  req.on("close", () => set.delete(res));
});
app.post("/api/cards/:num/receipt", cashierAuth, (req, res) => {
  if (!store.getCard(req.params.num)) return res.status(404).json({ error: "Carte inconnue." });
  const montant = Math.round((parseFloat(req.body?.montant) || 0) * 100) / 100;
  if (montant <= 0 || montant > 5000) return res.status(400).json({ error: "Montant invalide." });
  const receipt = {
    date: new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
    magasin: String(req.body?.magasin ?? "Magasin").slice(0, 30),
    montant,
  };
  const result = store.addReceipt(req.params.num, receipt);
  const shown = presentCard(result.card);
  const msg = `data: ${JSON.stringify({ card: shown, receipt, gain: result.gain })}\n\n`;
  (streams.get(req.params.num) ?? []).forEach((r) => r.write(msg));
  notifyPassUpdated(store.pushTokens(req.params.num), process.env.APPLE_PASS_TYPE_ID).catch((error) => {
    console.error("APNs :", error.message);
  });
  res.json({ ok: true, card: shown });
});

// ---------- Web service Apple (mise à jour des passes déjà installés) ----------
app.post("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber", (req, res) => {
  const card = walletCard(req);
  if (!card) return res.sendStatus(401);
  const pushToken = String(req.body?.pushToken || "").trim();
  if (!pushToken) return res.sendStatus(400);
  const created = store.registerDevice({
    deviceId: req.params.deviceLibraryIdentifier,
    pushToken,
    passTypeId: req.params.passTypeIdentifier,
    serial: req.params.serialNumber,
  });
  res.sendStatus(created ? 201 : 200);
});
app.delete("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber", (req, res) => {
  if (!walletCard(req)) return res.sendStatus(401);
  store.unregisterDevice({
    deviceId: req.params.deviceLibraryIdentifier,
    passTypeId: req.params.passTypeIdentifier,
    serial: req.params.serialNumber,
  });
  res.sendStatus(200);
});
app.get("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier", (req, res) => {
  const found = store.updatedSerials(
    req.params.deviceLibraryIdentifier,
    req.params.passTypeIdentifier,
    req.query.passesUpdatedSince
  );
  if (!found) return res.sendStatus(204);
  res.json(found);
});
app.get("/v1/passes/:passTypeIdentifier/:serialNumber", async (req, res) => {
  const card = walletCard(req);
  if (!card) return res.sendStatus(401);
  const since = Date.parse(req.get("if-modified-since") || "");
  const updated = Date.parse(card.updatedAt);
  if (!Number.isNaN(since) && !Number.isNaN(updated) && updated <= since) return res.sendStatus(304);
  try {
    const pass = await signedPass(card);
    res.type("application/vnd.apple.pkpass")
      .set("Last-Modified", new Date(card.updatedAt).toUTCString())
      .send(pass.getAsBuffer());
  } catch (e) {
    const manque = e.code === "ENOENT";
    res.status(manque ? 501 : 400).json({
      error: manque ? "Certificats Apple manquants dans ./certs (voir README)." : e.message,
    });
  }
});
app.post("/v1/log", (req, res) => {
  const logs = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 20) : [];
  for (const line of logs) console.log("passkit:", String(line).slice(0, 300));
  res.sendStatus(200);
});

app.listen(port, "0.0.0.0", () => {
  if (!process.env.PASSE_API_KEY?.trim()) {
    console.warn("PASSE_API_KEY absente : créer une carte ou passer en caisse n'exige aucune clé.");
  }
  console.log(`\nPasserelle     : http://localhost:${port}`);
  lanIps().forEach((ip) => console.log(`Sur ton iPhone : http://${ip}:${port}/carte.html?n=3012345678905`));
  console.log(`Caisse (démo)  : http://localhost:${port}/caisse.html\n`);
});
