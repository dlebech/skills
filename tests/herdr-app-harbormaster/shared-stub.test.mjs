// The herdr stub keeps Herdr's shared state in memory, so code that stores state there can be tested.
// Run: node --import ./loader.mjs --test shared-stub.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { shared, setShared, resetShared } from "herdr";

test("the stub's shared state round-trips and resets", () => {
  resetShared();
  assert.equal(shared("k"), null);
  setShared("k", { a: 1 });
  assert.deepEqual(shared("k"), { a: 1 });
  resetShared();
  assert.equal(shared("k"), null);
});
