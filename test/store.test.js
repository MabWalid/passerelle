import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore, seedIfEmpty } from "../lib/store.js";

const brands = [{
  id: "supermarche",
  name: "Super Marché Nord",
  color: "#2aa6a0",
  ptsPerEuro: 1,
  ecoG: 2,
  reward: { at: 150, label: "15 € offerts" },
  location: { latitude: 50.63, longitude: 3.02, relevantText: "Lille" },
}];

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "passerelle-"));
  return { dir, store: openStore(path.join(dir, "cards.sqlite")) };
}

test("une base vide reçoit la carte de démo, un redémarrage la conserve", () => {
  const { dir, store } = tempStore();
  try {
    seedIfEmpty(store, brands);
    seedIfEmpty(store, brands);
    const card = store.getCard("3012345678905");
    assert.equal(card.nom, "Camille Dupont");
    assert.equal(card.pts, 1240);
    assert.equal(card.receipts.length, 2);
    assert.equal(card.receipts[0].magasin, "Courses");
    store.close();

    const again = openStore(path.join(dir, "cards.sqlite"));
    assert.equal(again.getCard("3012345678905").pts, 1240);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("le jeton du pass reste stable et un appareil ne revoit que les cartes modifiées", async () => {
  const { dir, store } = tempStore();
  try {
    seedIfEmpty(store, brands);
    const first = store.getCard("3012345678905");
    const again = store.saveCard({ ...first, nom: "Camille D." });
    assert.equal(again.authToken, first.authToken);
    assert.equal(again.nom, "Camille D.");
    assert.equal(store.registerDevice({
      deviceId: "device-1", pushToken: "push-1", passTypeId: "pass.demo", serial: "3012345678905",
    }), true);
    assert.equal(store.registerDevice({
      deviceId: "device-1", pushToken: "push-2", passTypeId: "pass.demo", serial: "3012345678905",
    }), false);
    const all = store.updatedSerials("device-1", "pass.demo");
    assert.deepEqual(all.serialNumbers, ["3012345678905"]);
    assert.equal(store.updatedSerials("device-1", "pass.demo", again.updatedAt), null);
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.addReceipt("3012345678905", { date: "12/11", magasin: "Caisse", montant: 2 });
    const fresh = store.updatedSerials("device-1", "pass.demo", again.updatedAt);
    assert.deepEqual(fresh.serialNumbers, ["3012345678905"]);
    assert.deepEqual(store.pushTokens("3012345678905"), ["push-2"]);
    store.unregisterDevice({ deviceId: "device-1", passTypeId: "pass.demo", serial: "3012345678905" });
    assert.deepEqual(store.pushTokens("3012345678905"), []);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("un ticket crédite les points et ne garde que 20 reçus", () => {
  const { dir, store } = tempStore();
  try {
    seedIfEmpty(store, brands);
    const first = store.addReceipt("3012345678905", { date: "12/11", magasin: "Caisse", montant: 23.4 });
    assert.equal(first.gain, 23);
    assert.equal(first.card.pts, 1263);
    assert.equal(first.card.receipts[0].montant, 23.4);
    for (let i = 0; i < 20; i++) {
      store.addReceipt("3012345678905", { date: "01/01", magasin: "Caisse", montant: 1 });
    }
    const card = store.getCard("3012345678905");
    assert.equal(card.receipts.length, 20);
    assert.equal(card.pts, 1263 + 20);
    assert.equal(store.addReceipt("00000000", { date: "01/01", magasin: "X", montant: 1 }), null);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
