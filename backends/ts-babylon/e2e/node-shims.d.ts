/** Minimal node shims: this repo has no @types/node. */
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}

declare module 'node:fs' {
  const fs: any;
  export default fs;
}

declare module 'node:path' {
  const path: any;
  export default path;
}

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};
