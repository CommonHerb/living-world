// Mulberry32 — fast, seedable, deterministic PRNG
'use strict';

class RNG {
  constructor(seed) {
    this._seed = seed >>> 0;
    this._state = this._seed;
  }

  // Returns float in [0, 1)
  random() {
    let t = (this._state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Returns integer in [min, max] inclusive
  int(min, max) {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  // Returns float in [min, max]
  float(min, max) {
    return min + this.random() * (max - min);
  }

  // Pick random element from array
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }

  // Shuffle array in place (Fisher-Yates)
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  get seed() { return this._seed; }
}

module.exports = { RNG };
