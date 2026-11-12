import fs from "node:fs";
import http2 from "node:http2";

/** Préviens les iPhone qu'un pass a changé. Sans certificat, on n'envoie rien. */
export function notifyPassUpdated(tokens, topic) {
  const list = [...new Set(tokens.filter(Boolean))];
  if (!list.length || !topic) return Promise.resolve({ pushed: 0, skipped: "nothing" });
  const certPath = "certs/signerCert.pem";
  const keyPath = "certs/signerKey.pem";
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    return Promise.resolve({ pushed: 0, skipped: "no-cert" });
  }
  return new Promise((resolve) => {
    const client = http2.connect("https://api.push.apple.com", {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      passphrase: process.env.APPLE_SIGNER_PASSPHRASE || undefined,
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { client.close(); } catch { /* connexion déjà fermée */ }
      resolve(result);
    };
    let pending = list.length;
    let pushed = 0;
    client.on("error", () => finish({ pushed, skipped: "unreachable" }));
    for (const token of list) {
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        "apns-topic": topic,
      });
      let ended = false;
      const one = () => {
        if (ended) return;
        ended = true;
        pending -= 1;
        if (pending === 0) finish({ pushed });
      };
      req.on("response", (headers) => {
        if (headers[":status"] === 200) pushed += 1;
      });
      req.on("error", one);
      req.on("end", one);
      req.end("{}");
    }
  });
}
