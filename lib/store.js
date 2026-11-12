import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS cards (
  num TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  ens TEXT NOT NULL,
  col TEXT NOT NULL,
  pts INTEGER NOT NULL,
  reward_at INTEGER NOT NULL,
  reward_label TEXT NOT NULL,
  pts_per_euro REAL NOT NULL,
  eco_g REAL NOT NULL,
  brand TEXT NOT NULL,
  lat REAL,
  lng REAL,
  relevant_text TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_num TEXT NOT NULL REFERENCES cards(num) ON DELETE CASCADE,
  date TEXT NOT NULL,
  magasin TEXT NOT NULL,
  montant REAL NOT NULL,
  created_at TEXT NOT NULL
);
`;

function locationOf(row) {
  if (row.lat == null || row.lng == null) return null;
  return { latitude: row.lat, longitude: row.lng, relevantText: row.relevant_text || "" };
}

export function openStore(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const selectCard = db.prepare("SELECT * FROM cards WHERE num = ?");
  const selectReceipts = db.prepare(
    "SELECT date, magasin, montant FROM receipts WHERE card_num = ? ORDER BY created_at DESC, id DESC LIMIT 20"
  );
  const countCards = db.prepare("SELECT COUNT(*) AS n FROM cards");

  function read(num) {
    const row = selectCard.get(num);
    if (!row) return null;
    return {
      num: row.num,
      nom: row.nom,
      ens: row.ens,
      col: row.col,
      pts: row.pts,
      reward: { at: row.reward_at, label: row.reward_label },
      ptsPerEuro: row.pts_per_euro,
      ecoG: row.eco_g,
      brand: row.brand,
      location: locationOf(row),
      receipts: selectReceipts.all(num).map((r) => ({ date: r.date, magasin: r.magasin, montant: r.montant })),
    };
  }

  function insertReceipts(num, receipts, now) {
    const ins = db.prepare(
      "INSERT INTO receipts (card_num, date, magasin, montant, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    receipts.forEach((r, i) => {
      ins.run(num, r.date, r.magasin, r.montant, new Date(now - i).toISOString());
    });
  }

  return {
    getCard: read,
    count: () => countCards.get().n,
    saveCard(fields) {
      const now = new Date().toISOString();
      const loc = fields.location;
      const existing = selectCard.get(fields.num);
      db.exec("BEGIN");
      try {
        if (!existing) {
          db.prepare(`INSERT INTO cards (
            num, nom, ens, col, pts, reward_at, reward_label, pts_per_euro, eco_g, brand,
            lat, lng, relevant_text, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            fields.num, fields.nom, fields.ens, fields.col, fields.pts,
            fields.reward.at, fields.reward.label, fields.ptsPerEuro, fields.ecoG, fields.brand,
            loc?.latitude ?? null, loc?.longitude ?? null, loc?.relevantText ?? null, now
          );
          if (fields.receipts?.length) insertReceipts(fields.num, fields.receipts, Date.now());
        } else {
          db.prepare(`UPDATE cards SET
            nom = ?, ens = ?, col = ?, pts = ?, reward_at = ?, reward_label = ?,
            pts_per_euro = ?, eco_g = ?, brand = ?, lat = ?, lng = ?, relevant_text = ?, updated_at = ?
            WHERE num = ?`).run(
            fields.nom, fields.ens, fields.col, fields.pts,
            fields.reward.at, fields.reward.label, fields.ptsPerEuro, fields.ecoG, fields.brand,
            loc?.latitude ?? null, loc?.longitude ?? null, loc?.relevantText ?? null, now,
            fields.num
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return read(fields.num);
    },
    addReceipt(num, receipt) {
      const card = read(num);
      if (!card) return null;
      const gain = Math.floor(receipt.montant * (card.ptsPerEuro ?? 1));
      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        db.prepare(
          "INSERT INTO receipts (card_num, date, magasin, montant, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(num, receipt.date, receipt.magasin, receipt.montant, now);
        db.prepare("UPDATE cards SET pts = ?, updated_at = ? WHERE num = ?").run(card.pts + gain, now, num);
        db.prepare(`DELETE FROM receipts WHERE card_num = ? AND id NOT IN (
          SELECT id FROM receipts WHERE card_num = ? ORDER BY created_at DESC, id DESC LIMIT 20
        )`).run(num, num);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { card: read(num), gain, receipt };
    },
    close: () => db.close(),
  };
}

export const DEMO_CARD = "3012345678905";

/** Carte de démonstration, uniquement sur une base vide. */
export function seedIfEmpty(store, brands) {
  if (store.count() > 0) return;
  const b = brands[0];
  store.saveCard({
    num: DEMO_CARD,
    nom: "Camille Dupont",
    ens: b.name,
    col: b.color,
    pts: 1240,
    reward: b.reward,
    ptsPerEuro: b.ptsPerEuro,
    ecoG: b.ecoG,
    brand: b.id,
    location: b.location ?? null,
    receipts: [
      { date: "12/10", magasin: "Courses", montant: 42.8 },
      { date: "08/10", magasin: "Boulangerie", montant: 6.4 },
    ],
  });
}
