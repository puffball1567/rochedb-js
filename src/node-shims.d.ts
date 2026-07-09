declare const process: {
  env: Record<string, string | undefined>;
};

declare const Buffer: {
  from(value: string | Uint8Array): Uint8Array;
  isBuffer(value: unknown): value is Uint8Array;
};

declare module "node:module" {
  export function createRequire(url: string): (id: string) => unknown;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

interface ImportMeta {
  url: string;
}
