import express from "express";
import fs from "node:fs";
import os from "node:os";

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

// ---------- Apple Wallet : .pkpass signé ----------
app.post("/api/apple", async (req, res) => {
  try {
    const { PKPass } = await import("passkit-generator");
    const d = clean(req.body);
    const certs = {
      wwdr: fs.readFileSync("certs/wwdr.pem"),
      signerCert: fs.readFileSync("certs/signerCert.pem"),
      signerKey: fs.readFileSync("certs/signerKey.pem"),
      signerKeyPassphrase: process.env.APPLE_SIGNER_PASSPHRASE || undefined,
    };
    const pass = await PKPass.from(
      {
        model: "./model/fidelite.pass",
        certificates: certs,
      },
      {
        passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
        teamIdentifier: process.env.APPLE_TEAM_ID,
        serialNumber: d.num,
        organizationName: d.ens,
        description: `Carte de fidélité ${d.ens}`,
        backgroundColor: rgb(d.col),
        foregroundColor: "rgb(255, 255, 255)",
        labelColor: "rgb(255, 255, 255)",
      }
    );
    pass.type = "storeCard";
    pass.setBarcodes({ message: d.num, format: "PKBarcodeFormatCode128", altText: d.num });
    pass.primaryFields.push({ key: "points", label: "Points", value: d.pts });
    pass.secondaryFields.push(
      { key: "nom", label: "Titulaire", value: d.nom },
      { key: "tickets", label: "Tickets digitaux", value: d.tk }
    );
    res.type("application/vnd.apple.pkpass")
      .set("Content-Disposition", `attachment; filename="${d.num}.pkpass"`)
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
    const issuer = process.env.GOOGLE_ISSUER_ID;
    const classId = `${issuer}.fidelite_${d.ens.toLowerCase().replace(/\W+/g, "_")}`;
    const claims = {
      iss: sa.client_email,
      aud: "google",
      typ: "savetowallet",
      origins: [],
      payload: {
        loyaltyClasses: [{ id: classId, issuerName: d.ens, programName: `Carte ${d.ens}`,
          reviewStatus: "UNDER_REVIEW", hexBackgroundColor: d.col,
          programLogo: { sourceUri: { uri: "https://exemple.fr/logo.png" } } }],
        loyaltyObjects: [{
          id: `${issuer}.${d.num}`, classId, state: "ACTIVE",
          accountId: d.num, accountName: d.nom,
          loyaltyPoints: { label: "Points", balance: { int: d.pts } },
          barcode: { type: "CODE_128", value: d.num, alternateText: d.num },
          textModulesData: [{ id: "tickets", header: "Tickets digitaux", body: String(d.tk) }],
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
const brands = JSON.parse(fs.readFileSync(new URL('./brands.json', import.meta.url), 'utf8'));
app.get('/api/brands', (req, res) => res.json(brands));
const cards = new Map();
const streams = new Map(); // num -> Set<res>
const seed = (num, nom, ens, col) =>
  cards.set(num, { num, nom, ens, col, pts: 1240, reward: brands[0].reward, ptsPerEuro: 1, ecoG: 2, brand: brands[0].id, receipts: [
    { date: "12/10", magasin: "Courses", montant: 42.8 },
    { date: "08/10", magasin: "Boulangerie", montant: 6.4 }] });
seed("3012345678905", "Camille Dupont", "Super Marché Nord", "#2aa6a0");

app.get("/api/info", (req, res) => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  res.json({ port, ips });
});
app.post("/api/cards", (req, res) => {
  try {
    const d = clean(req.body);
    const old = cards.get(d.num);
    const b = brands.find((x) => x.id === d.brand) ?? brands[0];
    cards.set(d.num, { ...(old ?? { receipts: [] }), num: d.num, nom: d.nom, ens: d.ens, col: d.col, pts: d.pts,
      reward: b.reward, ptsPerEuro: b.ptsPerEuro, ecoG: b.ecoG, brand: b.id });
    res.json(cards.get(d.num));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/cards/:num", (req, res) => {
  const c = cards.get(req.params.num);
  c ? res.json(c) : res.status(404).json({ error: "Carte inconnue. Créez-la depuis le studio." });
});
app.get("/api/cards/:num/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": ok\n\n");
  const set = streams.get(req.params.num) ?? new Set();
  set.add(res); streams.set(req.params.num, set);
  req.on("close", () => set.delete(res));
});
app.post("/api/cards/:num/receipt", (req, res) => {
  const c = cards.get(req.params.num);
  if (!c) return res.status(404).json({ error: "Carte inconnue." });
  const montant = Math.round((parseFloat(req.body?.montant) || 0) * 100) / 100;
  if (montant <= 0 || montant > 5000) return res.status(400).json({ error: "Montant invalide." });
  const receipt = {
    date: new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
    magasin: String(req.body?.magasin ?? "Magasin").slice(0, 30), montant };
  c.receipts.unshift(receipt); c.receipts = c.receipts.slice(0, 20);
  const gain = Math.floor(montant * (c.ptsPerEuro ?? 1));
  c.pts += gain;
  const msg = `data: ${JSON.stringify({ card: c, receipt, gain })}\n\n`;
  (streams.get(c.num) ?? []).forEach((r) => r.write(msg));
  res.json({ ok: true, card: c });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`\nPasserelle     : http://localhost:${port}`);
  Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .forEach((i) => console.log(`Sur ton iPhone : http://${i.address}:${port}/carte.html?n=3012345678905`));
  console.log(`Caisse (démo)  : http://localhost:${port}/caisse.html\n`);
});
