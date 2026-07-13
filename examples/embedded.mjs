import { RocheDb } from "../dist/index.js";

const db = RocheDb.open(4);

try {
  db.setGalaxyDescription("Local demo galaxy for RocheDB JavaScript / TypeScript.");
  db.setRingDescription("docs/nim", "Nim and RocheDB related documents.");
  db.configureRing("docs/nim", 60);

  const profileId = db.putJson("users/42/profile", {
    name: "Ada",
    role: "admin",
  });

  const docId = db.putJsonVec(
    "docs/nim",
    {
      title: "RocheDB rings",
      lang: "nim",
      body: "RocheDB uses explicit rings to reduce unnecessary reads before retrieval.",
    },
    [1, 0, 0],
  );

  const profile = db.getString(profileId);
  const encoded = db.getEncoded(profileId);
  const batch = db.batchGetStrings([profileId, docId]);
  const page = db.readRing("users/42/profile", {
    filter: { role: "admin" },
    selection: "{ name }",
    limit: 10,
  });
  const retrieved = db.retrieve([1, 0, 0], {
    ring: "docs/nim",
    budget: 4,
  });

  console.log("profile:", profile);
  console.log("profile codec:", encoded?.codec);
  console.log("batch:", batch);
  console.log("readRing:", page);
  console.log("retrieve stats:", retrieved.stats);
  console.log("atlas ringMap:", db.atlas(undefined, 4).ringMap?.length ?? 0);
  console.log("doc node:", db.locate(docId));
  console.log("next visit to node 0:", db.nextVisit(docId, 0));
} finally {
  db.close();
}
