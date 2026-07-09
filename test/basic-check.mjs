import {
  formatRocheId,
  isRocheDbError,
  parseRocheId,
  RocheDb,
} from "../dist/index.js";

export function runEmbeddedCheck(assert) {
  const db = RocheDb.open(4);

  try {
    db.setGalaxyDescription("Node.js test galaxy");
    db.setRingDescription("docs/nim", "Nim and RocheDB documents");
    db.configureRing("docs/nim", 60);

    const profileId = db.putJson("users/42/profile", {
      name: "Ada",
      role: "admin",
    });
    const docA = db.putVec("docs/nim", "nim database", [1, 0, 0]);
    const docB = db.putVec("docs/js", "javascript driver", [0, 1, 0]);

    assert.equal(db.getString(profileId), '{"name":"Ada","role":"admin"}');
    assert.deepEqual(parseRocheId(formatRocheId(profileId)), profileId);
    assert.deepEqual(db.batchGetStrings([profileId, docA]), [
      '{"name":"Ada","role":"admin"}',
      "nim database",
    ]);

    const selection = db.queryString(profileId, "{ name }");
    assert.match(selection, /Ada/);

    const retrieved = db.retrieve([1, 0, 0], {
      ring: "docs/nim",
      budget: 4,
    });
    assert.ok(retrieved.hits.length >= 1);
    assert.ok(retrieved.stats.scanned >= 1);
    assert.ok(retrieved.stats.candidateReduction >= 0);

    const atlas = db.atlas(undefined, 4);
    assert.equal(typeof atlas, "object");

    const node = db.locate(docA);
    assert.equal(Number.isInteger(node), true);
    assert.ok(db.nextVisit(docA, node) >= db.now());
    assert.ok(db.nextJoin(docA, docB) >= -1);

    db.advance(1);
    assert.ok(db.now() >= 1);
  } finally {
    db.close();
  }
}

export function runApiCheck(assert) {
  const id = parseRocheId("1:2:3:4.5");
  assert.deepEqual(id, {
    parent: 1n,
    epoch: 2,
    seq: 3,
    tWrite: 4.5,
  });
  assert.equal(formatRocheId(id), "1:2:3:4.5");

  assert.throws(
    () => parseRocheId("1:2:3"),
    (error) => isRocheDbError(error) && error.kind === "invalid_id",
  );

  const db = RocheDb.open(2);
  db.close();

  assert.throws(
    () => db.put("closed/test", "payload"),
    (error) => isRocheDbError(error) && error.kind === "closed",
  );
}
