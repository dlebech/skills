// Checks the committed .glb models with plain Node (no Blender): part names, size limits, materials.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models', 'out')
const PARTS = {
  octopus: ['Body', ...Array.from({ length: 8 }, (_, i) => `Tentacle.${i}`), 'EyeLid.L', 'EyeLid.R'],
  crab: ['Body', 'Claw.L', 'Claw.R', 'Legs'],
  boat: ['Body', 'Captain', 'Sail', 'Anchor'],
  reef: ['Body'], dock: ['Body', 'Lantern.L', 'Lantern.R'], buoy: ['Body', 'Float'], flagpole: ['Body'],
  flag: ['Flag'], lighthouse: ['Body', 'Lamp'], gull: ['Body', 'Wing.L', 'Wing.R'], palm: ['Body'],
  crane: ['Body', 'Arm'], driftwood: ['Body'],
}

// Reads a GLB: 12-byte header, then the JSON chunk.
function readGlb(file) {
  const b = readFileSync(file)
  assert.equal(b.readUInt32LE(0), 0x46546c67, 'glTF magic')
  assert.equal(b.readUInt32LE(4), 2, 'glTF version 2')
  const len = b.readUInt32LE(12)
  assert.equal(b.readUInt32LE(16), 0x4e4f534a, 'first chunk is JSON')
  return { json: JSON.parse(b.subarray(20, 20 + len).toString('utf8')), size: b.length }
}

test('every model is present, within size, and has its named parts', () => {
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.glb')).sort(), Object.keys(PARTS).map((n) => n + '.glb').sort())
  let total = 0
  for (const [name, parts] of Object.entries(PARTS)) {
    const { json, size } = readGlb(path.join(dir, name + '.glb'))
    total += size
    const names = (json.nodes || []).map((n) => n.name)
    for (const p of parts) assert.ok(names.includes(p), `${name}: missing node ${p}`)
    assert.ok(size < 100_000, `${name}: ${size} bytes`)
    assert.ok((json.materials || []).length <= 5, `${name}: too many materials`)
    assert.ok(!json.cameras && !json.animations && !json.textures, `${name}: has cameras, animations or textures`)
    assert.ok(!(json.extensionsUsed || []).includes('KHR_draco_mesh_compression'), `${name}: Draco`)
  }
  assert.ok(total < 600_000, `total ${total} bytes`)
})

test('recoloured parts have their own materials', () => {
  const mats = (n) => readGlb(path.join(dir, n + '.glb')).json.materials.map((m) => m.name)
  assert.ok(mats('buoy').includes('BuoyColor'))
  assert.deepEqual(mats('flag'), ['FlagColor'])
  assert.ok(mats('lighthouse').includes('lamp') && mats('dock').includes('lamp'))
})
