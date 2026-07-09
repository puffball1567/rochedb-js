# RocheDB JavaScript / TypeScript Driver

JavaScript / TypeScript driver for RocheDB.

This package currently targets Node.js through Node-API. Bun can load the same Node-API module in the local verification path, but Bun support should remain experimental until it is covered by CI.

## Status

- Package: `rochedb`
- Runtime target: Node.js 20+
- Source language: TypeScript
- Native boundary: Node-API, no `node-addon-api` dependency
- RocheDB core: local C ABI shared library
- Bun: experimental, local demo/test path available

## Install

This driver is a Node-API addon over the RocheDB C ABI. Install the JavaScript
package and make the RocheDB shared library available before running your app.

Prerequisites:

- Node.js 20+
- Nim 2.2.x to build RocheDB core. Install Nim: <https://nim-lang.org/install.html>. Nimble is included with the standard Nim installation.
- `libsodium` development headers, required by RocheDB core. Install libsodium with your OS package manager or from <https://libsodium.org>.
- a C/C++ build toolchain for `node-gyp`

### Install From npm

Build RocheDB core first:

```sh
git clone https://github.com/puffball1567/rochedb.git
cd rochedb
nimble install -y
nim c --app:lib -d:release --nimcache:/tmp/nimcache_roche_capi -o:lib/librochedb.so src/rochedb_capi.nim
```

Install the package in your application with `ROCHEDB_CORE_DIR` set:

```sh
cd /path/to/your-app
ROCHEDB_CORE_DIR=/path/to/rochedb npm install rochedb
```

If you installed the package before building RocheDB core, rebuild the native addon:

```sh
ROCHEDB_CORE_DIR=/path/to/rochedb npm rebuild rochedb
```

Run your app with the RocheDB shared library on the dynamic loader path:

```sh
LD_LIBRARY_PATH=/path/to/rochedb/lib node app.mjs
```

On macOS, use `DYLD_LIBRARY_PATH`:

```sh
DYLD_LIBRARY_PATH=/path/to/rochedb/lib node app.mjs
```

### Smoke Demo

Clone this driver repository if you want to run the included demo:

```sh
git clone https://github.com/puffball1567/rochedb-js.git
cd rochedb-js
ROCHEDB_CORE_DIR=/path/to/rochedb npm install
ROCHEDB_CORE_DIR=/path/to/rochedb npm run build
LD_LIBRARY_PATH=/path/to/rochedb/lib node examples/embedded.mjs
```

For Bun compatibility:

```sh
LD_LIBRARY_PATH=/path/to/rochedb/lib bun examples/embedded.mjs
```

### Development From Source

For local driver development, keep the RocheDB core repository next to this repository:

```text
oss/
  rochedb/
  rochedb-js/
```

Build the RocheDB C ABI shared library first:

```sh
cd ../rochedb
nim c --app:lib -d:release --nimcache:/tmp/nimcache_roche_capi -o:lib/librochedb.so src/rochedb_capi.nim
```

Then build this driver:

```sh
cd ../rochedb-js
ROCHEDB_CORE_DIR=../rochedb npm install
ROCHEDB_CORE_DIR=../rochedb npm run build
```

If the core repository is in a different location, set:

- `ROCHEDB_CORE_DIR`: RocheDB repository path. The build expects `include/rochedb.h` and `lib/librochedb.so` below it.
- `ROCHEDB_LIB_DIR`: optional library directory override.
- `ROCHEDB_NATIVE_PATH`: optional runtime override for the built `.node` file.

At runtime, make sure the dynamic loader can find `librochedb.so`:

```sh
LD_LIBRARY_PATH=../rochedb/lib node examples/embedded.mjs
```

## Quick Start

```ts
import { RocheDb } from "rochedb";

const db = RocheDb.open(4);

try {
  const id = db.putJson("users/42/profile", {
    name: "Ada",
    role: "admin",
  });

  console.log(db.getString(id));

  const docId = db.putVec(
    "docs/nim",
    "RocheDB stores explicit rings and vectors together.",
    [1, 0, 0],
  );

  const result = db.retrieve([1, 0, 0], {
    ring: "docs/nim",
    budget: 4,
  });

  console.log(docId, result.stats);
} finally {
  db.close();
}
```

## API Coverage

Implemented in this driver:

- Embedded open: `RocheDb.open(nodes)`
- Persistent embedded open: `RocheDb.openDir(nodes, dir)`
- TCP connect: `RocheDb.connect(peers, options?)`
- Auth connect: username, password, auth token, secret key, galaxy
- Write: `put`, `putJson`, `putVec`
- Read: `get`, `getString`, `batchGet`, `batchGetStrings`
- ID helpers: `parseRocheId`, `formatRocheId`
- Typed errors: `RocheDbError`, `isRocheDbError`
- Selection query: `query`, `queryString`
- Vector retrieval: `retrieve`
- Atlas / map output: `atlas`
- Orbit helpers: `locate`, `now`, `advance`, `nextVisit`, `nextJoin`
- Metadata: `configureRing`, `setGalaxyDescription`, `setRingDescription`

Still pending:

- Native JavaScript transaction helpers
- Dump/import helpers
- Metrics helpers
- Stronger Bun CI coverage
- Browser / React Native support through a future Wasm package

## Verification

Run the Node.js verification path:

```sh
ROCHEDB_CORE_DIR=../rochedb npm run build
LD_LIBRARY_PATH=../rochedb/lib npm run test:node
```

Run the Bun compatibility path:

```sh
LD_LIBRARY_PATH=../rochedb/lib npm run test:bun
LD_LIBRARY_PATH=../rochedb/lib bun examples/embedded.mjs
```

Check package contents before publishing:

```sh
ROCHEDB_CORE_DIR=../rochedb LD_LIBRARY_PATH=../rochedb/lib npm pack --dry-run
```

Run the embedded demo:

```sh
LD_LIBRARY_PATH=../rochedb/lib node examples/embedded.mjs
```

## Notes on Binary Data

The JavaScript API accepts payloads as `string` or `Uint8Array`.

Vectors are passed as `Float32Array` or `number[]`. At the C ABI boundary this uses host-native `float32` arrays. RocheDB's TCP wire protocol has its own canonical little-endian float32 vector representation.
