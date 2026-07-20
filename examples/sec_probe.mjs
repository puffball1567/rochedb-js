// Parametrized security probe: build a connection from ORBP_* environment
// variables, attempt a put, print SUCCESS or REJECT:<msg>. Used by the
// cross-driver security matrix harness.
import { KoutenDb } from "../dist/index.js";

const E = (k) => process.env[k] || "";
const flag = (k) => process.env[k] === "1";

const opts = {};
if (E("ORBP_USER")) opts.username = E("ORBP_USER");
if (E("ORBP_PASS")) opts.password = E("ORBP_PASS");
if (E("ORBP_SECRET")) opts.secretKey = E("ORBP_SECRET");
if (flag("ORBP_TLS")) opts.tls = true;
if (E("ORBP_CA")) opts.tlsCaFile = E("ORBP_CA");
if (E("ORBP_SNI")) opts.tlsServerName = E("ORBP_SNI");
if (flag("ORBP_INSECURE")) opts.dangerouslyAcceptInvalidCerts = true;

let db;
try {
  db = KoutenDb.connect(E("ORBP_PEERS"), opts);
  db.put("secure/demo", JSON.stringify({ probe: 1 }));
  console.log("SUCCESS");
} catch (e) {
  console.log("REJECT:" + String(e.message).slice(0, 50));
} finally {
  try {
    if (db) db.close();
  } catch {}
}
