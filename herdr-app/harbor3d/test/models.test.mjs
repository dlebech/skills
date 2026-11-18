// Checks the committed .glb models with plain Node (no Blender): part names, size limits, materials.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models', 'out')
const PARTS = {
  octopus: ['Body', ...Array.from({ length: 8 }, (_, i) => `Tentacle.${i}`), 'EyeLid.L', 'EyeLid.R'],
  crab: ['Body', 'Claw.L', 'Claw.R', 'Legs'], buoy: ['Body', 'Float'], flag: ['Flag'], gull: ['Body', 'Wing.L', 'Wing.R'],
  driftwood: ['Body'], ship: ['Body', 'Funnel', 'Mast', 'Lights'], container: ['Body'], crane: ['Body', 'Trolley', 'Hook'],
  captain: ['Body', 'arm'], pier: ['Body'], quay: ['Body'], signal: ['Body', 'Red', 'Amber', 'Green'], tug: ['Body', 'Captain', 'Light'],
  office: ['Body', 'Radar', 'Windows'], warehouse: ['Body'], silo: ['Body'], floodlight: ['Body', 'Lamp'],
  marker: ['Body', 'Daymark', 'Lamp'], rock: ['Body'],
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
  assert.ok(total < 700_000, `total ${total} bytes`)
})

test('recoloured and lit parts have their own materials', () => {
  const mats = (n) => readGlb(path.join(dir, n + '.glb')).json.materials.map((m) => m.name)
  assert.ok(mats('buoy').includes('BuoyColor'))
  assert.deepEqual(mats('flag'), ['FlagColor'])
  assert.ok(mats('container').includes('ContainerColor'))
  assert.ok(mats('marker').includes('MarkerColor') && mats('marker').includes('lamp') && mats('marker').includes('steel'))
  assert.ok(mats('ship').includes('ShipLights') && mats('office').includes('OfficeLights'))
  for (const m of ['SignalRed', 'SignalAmber', 'SignalGreen']) assert.ok(mats('signal').includes(m), m)
  assert.ok(mats('tug').includes('lamp') && mats('floodlight').includes('lamp'))
})

test('the trolley carries the hook', () => {
  const { json } = readGlb(path.join(dir, 'crane.glb'))
  const t = json.nodes.findIndex((n) => n.name === 'Trolley')
  assert.ok(json.nodes[t].children.some((c) => json.nodes[c].name === 'Hook'))
})
