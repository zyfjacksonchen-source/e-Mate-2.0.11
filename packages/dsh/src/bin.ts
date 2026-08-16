#!/usr/bin/env node

import { main } from './e-mate.js'

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  console.error(`e-mate: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
