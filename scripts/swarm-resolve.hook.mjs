// Resolve hook letting plain Node import the repo's extensionless TS modules.
// Node strips erasable TS natively; this hook only adds the missing ".ts".
// Registered by scripts/run-swarm.mjs via node:module register(). No network.
import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (err) {
    if (!specifier.startsWith('.') || context.parentURL === undefined) {
      throw err
    }
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier)
    const candidates = [base + '.ts', base + '.tsx', base + '/index.ts']
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    throw err
  }
}
