import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RocheId {
  parent: bigint;
  epoch: number;
  seq: number;
  tWrite: number;
}

export type RocheDbErrorKind =
  | "abi"
  | "abi_version_mismatch"
  | "closed"
  | "invalid_id"
  | "not_found"
  | "nul_byte"
  | "utf8"
  | "type"
  | "unknown";

export class RocheDbError extends Error {
  readonly kind: RocheDbErrorKind;
  readonly cause?: unknown;

  constructor(kind: RocheDbErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "RocheDbError";
    this.kind = kind;
    this.cause = cause;
  }
}

export function isRocheDbError(value: unknown): value is RocheDbError {
  return value instanceof RocheDbError;
}

export function formatRocheId(id: RocheId): string {
  return `${id.parent}:${id.epoch}:${id.seq}:${id.tWrite}`;
}

export function parseRocheId(value: string): RocheId {
  const parts = value.split(":");
  if (parts.length !== 4) {
    throw new RocheDbError(
      "invalid_id",
      `invalid RocheDB id '${value}': expected parent:epoch:seq:tWrite`,
    );
  }

  try {
    return {
      parent: BigInt(parts[0]),
      epoch: parseUint32Part(parts[1], "epoch"),
      seq: parseUint32Part(parts[2], "seq"),
      tWrite: parseNumberPart(parts[3], "tWrite"),
    };
  } catch (error) {
    if (error instanceof RocheDbError) throw error;
    throw new RocheDbError("invalid_id", `invalid RocheDB id '${value}'`, error);
  }
}

export interface ConnectOptions {
  username?: string;
  password?: string;
  authToken?: string;
  secretKey?: string;
  galaxy?: string;
}

export interface RetrieveOptions {
  ring?: string;
  budget?: number;
  topRings?: number;
  focus?: number;
}

export interface RetrieveStats {
  totalVectors: number;
  scanned: number;
  skippedVectors: number;
  returned: number;
  ringsTouched: number;
  payloadBytes: number;
  estimatedTokens: number;
  fanoutNodes: number;
  candidateReduction: number;
}

export interface RetrieveHit {
  id: RocheId;
  score: number;
  payload: Uint8Array;
}

export interface RetrieveResult {
  hits: RetrieveHit[];
  stats: RetrieveStats;
}

interface NativeBinding {
  open(nodes: number): unknown;
  openDir(nodes: number, dir: string): unknown;
  connect(peers: string): unknown;
  connectAuth(
    peers: string,
    username: string,
    password: string,
    authToken: string,
    secretKey: string,
    galaxy: string,
  ): unknown;
  close(db: unknown): void;
  put(db: unknown, ring: string, data: Uint8Array | string, vec?: Float32Array): RocheId;
  get(db: unknown, id: RocheId): Uint8Array | null;
  batchGet(db: unknown, ids: RocheId[]): Array<Uint8Array | null>;
  query(db: unknown, id: RocheId, selection: string): Uint8Array;
  retrieve(
    db: unknown,
    vec: Float32Array,
    ring: string,
    budget: number,
    topRings: number,
    focus: number,
  ): RetrieveResult;
  atlas(db: unknown, vec: Float32Array | undefined, maxCentroidDims: number): string;
  locate(db: unknown, id: RocheId, at: number): number;
  now(db: unknown): number;
  advance(db: unknown, dt: number): void;
  nextVisit(db: unknown, id: RocheId, node: number): number;
  nextJoin(db: unknown, a: RocheId, b: RocheId): number;
  configureRing(db: unknown, ring: string, period: number): void;
  setGalaxyDescription(db: unknown, description: string): void;
  setRingDescription(db: unknown, ring: string, description: string): void;
}

function loadNative(): NativeBinding {
  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const nativePath =
    process.env.ROCHEDB_NATIVE_PATH ??
    join(here, "..", "build", "Release", "rochedb_native.node");
  return require(nativePath) as NativeBinding;
}

const native = loadNative();

function parseUint32Part(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new RocheDbError("invalid_id", `invalid RocheDB id field '${name}': ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new RocheDbError("invalid_id", `invalid RocheDB id field '${name}' is out of range`);
  }
  return parsed;
}

function parseNumberPart(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RocheDbError("invalid_id", `invalid RocheDB id field '${name}': ${value}`);
  }
  return parsed;
}

function classifyNativeError(error: unknown): RocheDbErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("abi version")) return "abi_version_mismatch";
  if (lower.includes("closed")) return "closed";
  if (lower.includes("not found")) return "not_found";
  if (lower.includes("nul") || lower.includes("null byte")) return "nul_byte";
  if (lower.includes("utf")) return "utf8";
  if (lower.includes("must be") || lower.includes("requires")) return "type";
  if (lower.includes("abi")) return "abi";
  return "unknown";
}

function wrapNative<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof RocheDbError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RocheDbError(classifyNativeError(error), message, error);
  }
}

function bytes(data: string | Uint8Array): string | Uint8Array {
  return typeof data === "string" ? Buffer.from(data) : data;
}

function vector(vec: number[] | Float32Array): Float32Array {
  return vec instanceof Float32Array ? vec : new Float32Array(vec);
}

export class RocheDb {
  #handle: unknown;
  #closed = false;

  private constructor(handle: unknown) {
    this.#handle = handle;
  }

  static open(nodes = 8): RocheDb {
    return wrapNative(() => new RocheDb(native.open(nodes)));
  }

  static openDir(nodes: number, dir: string): RocheDb {
    return wrapNative(() => new RocheDb(native.openDir(nodes, dir)));
  }

  static connect(peers: string, options: ConnectOptions = {}): RocheDb {
    const hasAuth =
      options.username !== undefined ||
      options.password !== undefined ||
      options.authToken !== undefined ||
      options.secretKey !== undefined ||
      options.galaxy !== undefined;
    if (!hasAuth) {
      return wrapNative(() => new RocheDb(native.connect(peers)));
    }
    return wrapNative(
      () => new RocheDb(native.connectAuth(
        peers,
        options.username ?? "",
        options.password ?? "",
        options.authToken ?? "",
        options.secretKey ?? "",
        options.galaxy ?? "",
      )),
    );
  }

  close(): void {
    if (!this.#closed) {
      wrapNative(() => native.close(this.#handle));
      this.#closed = true;
    }
  }

  put(ring: string, data: string | Uint8Array): RocheId {
    return wrapNative(() => native.put(this.#handle, ring, bytes(data)));
  }

  putJson(ring: string, value: unknown): RocheId {
    return this.put(ring, JSON.stringify(value));
  }

  putVec(ring: string, data: string | Uint8Array, vec: number[] | Float32Array): RocheId {
    return wrapNative(() => native.put(this.#handle, ring, bytes(data), vector(vec)));
  }

  get(id: RocheId): Uint8Array | null {
    return wrapNative(() => native.get(this.#handle, id));
  }

  getString(id: RocheId): string | null {
    const value = this.get(id);
    return value === null ? null : new TextDecoder().decode(value);
  }

  batchGet(ids: RocheId[]): Array<Uint8Array | null> {
    return wrapNative(() => native.batchGet(this.#handle, ids));
  }

  batchGetStrings(ids: RocheId[]): Array<string | null> {
    const decoder = new TextDecoder();
    return this.batchGet(ids).map((value) => (value === null ? null : decoder.decode(value)));
  }

  query(id: RocheId, selection: string): Uint8Array {
    return wrapNative(() => native.query(this.#handle, id, selection));
  }

  queryString(id: RocheId, selection: string): string {
    return new TextDecoder().decode(this.query(id, selection));
  }

  retrieve(vec: number[] | Float32Array, options: RetrieveOptions = {}): RetrieveResult {
    return wrapNative(() => native.retrieve(
      this.#handle,
      vector(vec),
      options.ring ?? "",
      options.budget ?? 8,
      options.topRings ?? 0,
      options.focus ?? 0,
    ));
  }

  atlas(vec?: number[] | Float32Array, maxCentroidDims = 8): unknown {
    const raw = wrapNative(() => native.atlas(
      this.#handle,
      vec === undefined ? undefined : vector(vec),
      maxCentroidDims,
    ));
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new RocheDbError("utf8", "RocheDB atlas returned invalid JSON", error);
    }
  }

  locate(id: RocheId, at = -1): number {
    return wrapNative(() => native.locate(this.#handle, id, at));
  }

  now(): number {
    return wrapNative(() => native.now(this.#handle));
  }

  advance(dt: number): void {
    wrapNative(() => native.advance(this.#handle, dt));
  }

  nextVisit(id: RocheId, node: number): number {
    return wrapNative(() => native.nextVisit(this.#handle, id, node));
  }

  nextJoin(a: RocheId, b: RocheId): number {
    return wrapNative(() => native.nextJoin(this.#handle, a, b));
  }

  configureRing(ring: string, period: number): void {
    wrapNative(() => native.configureRing(this.#handle, ring, period));
  }

  setGalaxyDescription(description: string): void {
    wrapNative(() => native.setGalaxyDescription(this.#handle, description));
  }

  setRingDescription(ring: string, description: string): void {
    wrapNative(() => native.setRingDescription(this.#handle, ring, description));
  }
}
