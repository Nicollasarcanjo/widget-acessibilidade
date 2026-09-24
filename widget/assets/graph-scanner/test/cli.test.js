import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the CLI skill installer copies the screen graph skill into an agent directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-scanner-skill-'))
  const destination = path.join(temp, '.agents', 'skills', 'skip-screen-graph')
  const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin', 'graph-scanner.js'), 'skill', 'install', `--dir=${destination}`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(fs.readFileSync(path.join(destination, 'SKILL.md'), 'utf8'), /NAVIGATES_TO/)
  fs.rmSync(temp, { recursive: true, force: true })
})

test('the package contains Graphify source and attribution files', () => {
  assert.ok(fs.existsSync(path.join(packageRoot, 'vendor', 'graphify', 'graphify', 'build.py')))
  assert.ok(fs.existsSync(path.join(packageRoot, 'vendor', 'graphify', 'LICENSE')))
  assert.ok(fs.existsSync(path.join(packageRoot, 'vendor', 'graphify', 'LICENSE-MIT')))
  assert.ok(fs.existsSync(path.join(packageRoot, 'vendor', 'graphify', 'NOTICE')))
})
