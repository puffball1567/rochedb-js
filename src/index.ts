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

export type PayloadCodec = "raw" | "json" | "nif" | "bif";

export interface ReadRingOptions {
  filter?: Record<string, unknown>;
  filterJson?: string;
  selection?: string;
  limit?: number;
  cursor?: string;
  pagination?: boolean;
  page?: number;
  pageLimit?: number;
  sort?: "id" | "time" | "write" | string;
  rsort?: "id" | "time" | "write" | string;
}

export interface ReadRingItem {
  id: string;
  rawId: string;
  codec: PayloadCodec;
  encoding: string;
  payload: unknown;
}

export interface ReadRingPage {
  ring: string;
  count: number;
  pagination: "on" | "off";
  page: number;
  pageLimit: number;
  sort: string;
  sortDirection: "asc" | "desc";
  items: ReadRingItem[];
  nextCursor: string;
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

export interface EncodedPayload {
  data: Uint8Array;
  codec: PayloadCodec;
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
  putCodec(
    db: unknown,
    ring: string,
    data: Uint8Array | ArrayBuffer | string,
    codec: number,
    vec?: Float32Array,
  ): RocheId;
  get(db: unknown, id: RocheId): Uint8Array | null;
  getEncoded(db: unknown, id: RocheId): EncodedPayload | null;
  batchGet(db: unknown, ids: RocheId[]): Array<Uint8Array | null>;
  query(db: unknown, id: RocheId, selection: string): Uint8Array;
  readRingJson(
    db: unknown,
    ring: string,
    filterJson: string,
    selection: string,
    limit: number,
    cursor: string,
    pagination: number,
    page: number,
    pageLimit: number,
    sortField: string,
    sortDesc: number,
  ): string;
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

function bytes(data: string | Uint8Array | ArrayBuffer): string | Uint8Array {
  if (typeof data === "string") return Buffer.from(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

function vector(vec: number[] | Float32Array): Float32Array {
  return vec instanceof Float32Array ? vec : new Float32Array(vec);
}

function codecCode(codec: PayloadCodec): number {
  switch (codec) {
    case "raw":
      return 0;
    case "json":
      return 1;
    case "nif":
      return 2;
    case "bif":
      return 3;
    default:
      throw new RocheDbError("type", `unsupported payload codec: ${codec}`);
  }
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

  putCodec(ring: string, data: string | Uint8Array | ArrayBuffer, codec: PayloadCodec): RocheId {
    return wrapNative(() => native.putCodec(this.#handle, ring, bytes(data), codecCode(codec)));
  }

  putJson(ring: string, value: unknown): RocheId {
    return this.putCodec(ring, JSON.stringify(value), "json");
  }

  putNif(ring: string, text: string): RocheId {
    return this.putCodec(ring, text, "nif");
  }

  putBif(ring: string, data: Uint8Array): RocheId {
    return this.putCodec(ring, data, "bif");
  }

  putVec(ring: string, data: string | Uint8Array, vec: number[] | Float32Array): RocheId {
    return wrapNative(() => native.put(this.#handle, ring, bytes(data), vector(vec)));
  }

  putVecCodec(
    ring: string,
    data: string | Uint8Array | ArrayBuffer,
    vec: number[] | Float32Array,
    codec: PayloadCodec,
  ): RocheId {
    return wrapNative(() => native.putCodec(
      this.#handle,
      ring,
      bytes(data),
      codecCode(codec),
      vector(vec),
    ));
  }

  putJsonVec(ring: string, value: unknown, vec: number[] | Float32Array): RocheId {
    return this.putVecCodec(ring, JSON.stringify(value), vec, "json");
  }

  putNifVec(ring: string, text: string, vec: number[] | Float32Array): RocheId {
    return this.putVecCodec(ring, text, vec, "nif");
  }

  putBifVec(ring: string, data: Uint8Array, vec: number[] | Float32Array): RocheId {
    return this.putVecCodec(ring, data, vec, "bif");
  }

  get(id: RocheId): Uint8Array | null {
    return wrapNative(() => native.get(this.#handle, id));
  }

  getEncoded(id: RocheId): EncodedPayload | null {
    return wrapNative(() => native.getEncoded(this.#handle, id));
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

  readRing(ring: string, options: ReadRingOptions = {}): ReadRingPage {
    if (options.sort !== undefined && options.rsort !== undefined) {
      throw new RocheDbError("type", "readRing options cannot set both sort and rsort");
    }
    const filterJson = options.filterJson ?? JSON.stringify(options.filter ?? {});
    const sortField = options.sort ?? options.rsort ?? "";
    const sortDesc = options.sort === undefined ? 1 : 0;
    const raw = wrapNative(() => native.readRingJson(
      this.#handle,
      ring,
      filterJson,
      options.selection ?? "",
      options.limit ?? 100,
      options.cursor ?? "",
      options.pagination === true ? 1 : 0,
      options.page ?? 1,
      options.pageLimit ?? 20,
      sortField,
      sortDesc,
    ));
    try {
      return JSON.parse(raw) as ReadRingPage;
    } catch (error) {
      throw new RocheDbError("utf8", "RocheDB readRing returned invalid JSON", error);
    }
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
