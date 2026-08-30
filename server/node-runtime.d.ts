declare const process: {
  env: Record<string, string | undefined>
}

declare const console: {
  error(...args: any[]): void
}

declare const Buffer: {
  from(value: string, encoding?: string): any
}

declare module 'node:crypto' {
  export function createHash(...args: any[]): any
  export function randomBytes(...args: any[]): any
  export function scryptSync(...args: any[]): any
  export function timingSafeEqual(...args: any[]): any
}
