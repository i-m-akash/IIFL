const ITER = 100_000

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltB64 = toB64(salt.buffer)
  const enc = new TextEncoder().encode(password)
  const keyMaterial = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: ITER },
    keyMaterial,
    256
  )
  return `pbkdf2$${ITER}$${saltB64}$${toB64(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations < 1) return false
  const salt = new Uint8Array(fromB64(parts[2]!))
  const want = fromB64(parts[3]!)
  const enc = new TextEncoder().encode(password)
  const keyMaterial = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    want.length * 8
  )
  const got = new Uint8Array(bits)
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!
  return diff === 0
}
