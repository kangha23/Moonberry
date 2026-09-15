#!/usr/bin/env node
/**
 * Synthesises the game's sound set into `public/assets/audio/`.
 *
 * These are placeholders in the same sense as the procedural textures in
 * `createPixelArtTextures.ts`: generated from code so the game is audible out
 * of the box, and so every byte in the repo is ours to license. Recorded CC0
 * samples will sound better; dropping them in is a change to the table in
 * `src/game/audio/soundtrack.ts`, not to any of this.
 *
 * Re-running overwrites the folder, so it is not part of the build:
 *   npm run generate:audio
 *
 * WAV rather than the .ogg/.m4a pair the spec asks for, because encoding
 * either needs a dependency this repo does not have. The manifest holds a
 * list of URLs per sound and Phaser picks the first the browser supports, so
 * real assets arrive as extra entries in that list.
 */
import fs from 'node:fs';
import path from 'node:path';

const SFX_RATE = 22050;
/**
 * Beds are pads and noise, so half the bandwidth costs nothing audible and
 * keeps four eight-second loops near a megabyte rather than two.
 */
const MUSIC_RATE = 16000;

const sfxDir = path.join('public', 'assets', 'audio', 'sfx');
const musicDir = path.join('public', 'assets', 'audio', 'music');

// --- wav ---------------------------------------------------------------------

/** 16-bit mono PCM. Samples outside [-1, 1] are clipped rather than wrapped. */
function encodeWav(samples, rate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clipped * 32767), 44 + i * 2);
  }
  return buffer;
}

// --- synthesis helpers -------------------------------------------------------

/**
 * A deterministic noise source. `Math.random` would make every run produce
 * different files, which turns a re-generate into a diff nobody can review.
 */
function makeNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0x100000000) * 2 - 1;
  };
}

/** One-pole low pass, in place. `cutoff` is in Hz. */
function lowPass(samples, cutoff, rate) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
  let last = 0;
  for (let i = 0; i < samples.length; i += 1) {
    last += a * (samples[i] - last);
    samples[i] = last;
  }
  return samples;
}

/** One-pole high pass, in place, as the difference from the low-passed signal. */
function highPass(samples, cutoff, rate) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
  let last = 0;
  for (let i = 0; i < samples.length; i += 1) {
    last += a * (samples[i] - last);
    samples[i] -= last;
  }
  return samples;
}

/** Both filters in one pass, because a crack is a band and not an edge. */
function bandPass(samples, low, high, rate) {
  highPass(samples, low, rate);
  lowPass(samples, high, rate);
}

function normalise(samples, peak = 0.9) {
  let max = 0;
  for (const sample of samples) max = Math.max(max, Math.abs(sample));
  if (max === 0) return samples;
  const gain = peak / max;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  return samples;
}

/** Attack-decay envelope, 0..1 over the length of the buffer. */
function envelope(index, length, attack, curve = 2.2) {
  const t = index / length;
  if (t < attack) return t / attack;
  return Math.pow(1 - (t - attack) / (1 - attack), curve);
}

function seconds(count, rate) {
  return new Float64Array(Math.round(count * rate));
}

// --- effects -----------------------------------------------------------------
//
// Each returns a Float64Array at SFX_RATE. Short: these are eagerly loaded and
// the spec asks for under 100 kB apiece, which at this rate is about two
// seconds.

/** The hoe: a wooden knock over a dull earth thump. */
function toolHoe() {
  const out = seconds(0.3, SFX_RATE);
  const noise = makeNoise(0x51e3);
  const body = seconds(0.3, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) body[i] = noise() * envelope(i, out.length, 0.004, 7);
  lowPass(body, 900, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    const thump = Math.sin(2 * Math.PI * (92 - t * 120) * t) * Math.exp(-t * 24);
    out[i] = body[i] * 1.6 + thump * 0.7;
  }
  return normalise(out, 0.85);
}

/** The watering can: a hiss that swells and drains away. */
function toolWater() {
  const out = seconds(0.62, SFX_RATE);
  const noise = makeNoise(0x7a11);
  for (let i = 0; i < out.length; i += 1) out[i] = noise() * envelope(i, out.length, 0.22, 1.6);
  lowPass(out, 4200, SFX_RATE);
  highPass(out, 700, SFX_RATE);
  // A trickle under the hiss, so it reads as water rather than as static.
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    out[i] +=
      Math.sin(2 * Math.PI * (620 + Math.sin(t * 41) * 180) * t) * 0.1 * envelope(i, out.length, 0.2, 2);
  }
  return normalise(out, 0.62);
}

/** Planting: a soft pat of soil closing over a seed. */
function toolPlant() {
  const out = seconds(0.2, SFX_RATE);
  const noise = makeNoise(0x2d4c);
  for (let i = 0; i < out.length; i += 1) out[i] = noise() * envelope(i, out.length, 0.01, 5);
  lowPass(out, 1500, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    out[i] += Math.sin(2 * Math.PI * 210 * t) * Math.exp(-t * 32) * 0.35;
  }
  return normalise(out, 0.7);
}

/** Harvest: the little rising pop of something coming free. */
function cropPop() {
  const out = seconds(0.18, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    const pitch = 430 + t * 2600;
    out[i] = Math.sin(2 * Math.PI * pitch * t) * Math.exp(-t * 26);
    out[i] += Math.sin(2 * Math.PI * pitch * 2 * t) * Math.exp(-t * 40) * 0.3;
  }
  return normalise(out, 0.72);
}

/**
 * The axe: a dry wooden crack with a short woody ring under it.
 *
 * Deliberately close to `tool-hoe` in shape and a whole octave above it in
 * pitch, because both are "an implement landing on something" — the two want to
 * sit in the same family and still be told apart with your eyes shut.
 */
function toolChop() {
  const out = seconds(0.26, SFX_RATE);
  const noise = makeNoise(0x3c0b);
  const crack = seconds(0.26, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) crack[i] = noise() * envelope(i, out.length, 0.002, 18);
  bandPass(crack, 600, 2600, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    // Two close partials, which is what makes wood sound hollow rather than flat.
    const ring =
      (Math.sin(2 * Math.PI * 186 * t) + Math.sin(2 * Math.PI * 274 * t) * 0.6) *
      Math.exp(-t * 30);
    out[i] = crack[i] * 1.5 + ring * 0.55;
  }
  return normalise(out, 0.8);
}

/** Something coming down: the crack, and then everything falling into the grass. */
function nodeBreak() {
  const out = seconds(0.62, SFX_RATE);
  const noise = makeNoise(0x7f21);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    // A settling tail rather than a single hit: rubble, leaves, and a low
    // thump underneath that arrives a beat after the break itself.
    out[i] = noise() * Math.exp(-t * 6) * 0.8;
    out[i] += Math.sin(2 * Math.PI * (72 - t * 40) * t) * Math.exp(-Math.abs(t - 0.09) * 26) * 0.9;
  }
  lowPass(out, 2400, SFX_RATE);
  return normalise(out, 0.78);
}

/**
 * The tool bouncing off something it cannot mark.
 *
 * Metal on stone, gone almost before it started, and pitched high so it never
 * gets mistaken for a hit that landed. This is the sound that stops a player
 * swinging at a boulder forty times.
 */
function toolBounce() {
  const out = seconds(0.2, SFX_RATE);
  const noise = makeNoise(0x1abe);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    const clang =
      (Math.sin(2 * Math.PI * 1840 * t) + Math.sin(2 * Math.PI * 2510 * t) * 0.5) *
      Math.exp(-t * 34);
    out[i] = clang * 0.6 + noise() * Math.exp(-t * 60) * 0.5;
  }
  highPass(out, 900, SFX_RATE);
  return normalise(out, 0.6);
}

/** Coins: three inharmonic plinks, close enough together to read as a handful. */
function coins() {
  const out = seconds(0.5, SFX_RATE);
  const strikes = [
    { at: 0.0, freq: 1480 },
    { at: 0.055, freq: 1970 },
    { at: 0.12, freq: 1720 },
  ];
  for (const strike of strikes) {
    const start = Math.round(strike.at * SFX_RATE);
    for (let i = start; i < out.length; i += 1) {
      const t = (i - start) / SFX_RATE;
      const decay = Math.exp(-t * 13);
      out[i] +=
        (Math.sin(2 * Math.PI * strike.freq * t) +
          Math.sin(2 * Math.PI * strike.freq * 2.76 * t) * 0.4 +
          Math.sin(2 * Math.PI * strike.freq * 5.4 * t) * 0.16) *
        decay *
        0.4;
    }
  }
  return normalise(out, 0.66);
}

/** The quest reward: a four-note rise, kept soft with only a faint third harmonic. */
function fanfare() {
  const out = seconds(1.05, SFX_RATE);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, index) => {
    const start = Math.round(index * 0.13 * SFX_RATE);
    for (let i = start; i < out.length; i += 1) {
      const t = (i - start) / SFX_RATE;
      const decay = Math.exp(-t * (index === notes.length - 1 ? 3.2 : 7));
      out[i] +=
        (Math.sin(2 * Math.PI * freq * t) + Math.sin(2 * Math.PI * freq * 3 * t) * 0.11) * decay * 0.34;
    }
  });
  return normalise(out, 0.7);
}

/** Morning: a two-part crow, glide up then break down. */
function rooster() {
  const out = seconds(0.95, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    // Pitch contour of a cock-a-doodle: up, hold, up again, fall off.
    const contour =
      t < 0.18
        ? 420 + t * 1500
        : t < 0.42
          ? 690
          : t < 0.62
            ? 690 + (t - 0.42) * 900
            : 870 - (t - 0.62) * 1100;
    const phase = 2 * Math.PI * contour * t + Math.sin(2 * Math.PI * 7 * t) * 0.8;
    // A sawtooth from stacked harmonics: closer to a bird than a pure tone.
    let value = 0;
    for (let h = 1; h <= 6; h += 1) value += Math.sin(phase * h) / h;
    const gate = t < 0.06 ? t / 0.06 : t > 0.78 ? Math.max(0, (0.95 - t) / 0.17) : 1;
    out[i] = value * gate * 0.3;
  }
  lowPass(out, 4800, SFX_RATE);
  return normalise(out, 0.6);
}

/** A footstep: a short scuff, brighter on packed earth than on grass. */
function footstep(seed, cutoff, length, gain) {
  const out = seconds(length, SFX_RATE);
  const noise = makeNoise(seed);
  for (let i = 0; i < out.length; i += 1) out[i] = noise() * envelope(i, out.length, 0.02, 4);
  lowPass(out, cutoff, SFX_RATE);
  highPass(out, 220, SFX_RATE);
  return normalise(out, gain);
}

/** A UI blip. `freqs` is the sequence of notes, one every 60 ms. */
function blip(freqs, gain) {
  const out = seconds(0.06 * freqs.length + 0.09, SFX_RATE);
  freqs.forEach((freq, index) => {
    const start = Math.round(index * 0.06 * SFX_RATE);
    for (let i = start; i < out.length; i += 1) {
      const t = (i - start) / SFX_RATE;
      out[i] += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 22) * 0.5;
    }
  });
  return normalise(out, gain);
}

/**
 * An animal answering a hand on its back.
 *
 * Deliberately one sound for all four rather than a cluck, a quack, a moo and
 * a bleat: four synthesised animal noises would be four things that are nearly
 * right and obviously fake, where one short warm two-note call reads as
 * contentment and commits to nothing. The day real recorded samples land, this
 * is the entry in `soundtrack.ts` that splits into four.
 */
function animalCall() {
  const out = seconds(0.42, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    // Up a fourth and back down, with a slow wobble on it so it breathes.
    const contour = t < 0.16 ? 330 + t * 900 : 470 - (t - 0.16) * 260;
    const phase = 2 * Math.PI * contour * t + Math.sin(2 * Math.PI * 12 * t) * 0.35;
    let value = 0;
    for (let h = 1; h <= 4; h += 1) value += Math.sin(phase * h) / (h * h);
    out[i] = value * envelope(i, out.length, 0.07, 2.4) * 0.5;
  }
  lowPass(out, 2600, SFX_RATE);
  return normalise(out, 0.5);
}

/** Somebody arrived: a bell, struck softly. */
function chime() {
  const out = seconds(0.9, SFX_RATE);
  const partials = [
    { ratio: 1, gain: 1 },
    { ratio: 2.01, gain: 0.5 },
    { ratio: 2.98, gain: 0.28 },
    { ratio: 4.2, gain: 0.14 },
  ];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    for (const partial of partials) {
      out[i] +=
        Math.sin(2 * Math.PI * 880 * partial.ratio * t) *
        Math.exp(-t * (2.4 + partial.ratio)) *
        partial.gain *
        0.3;
    }
  }
  return normalise(out, 0.55);
}

/** Out of energy: the sound of sitting down harder than you meant to. */
function slump() {
  const out = seconds(0.55, SFX_RATE);
  const noise = makeNoise(0x9c02);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    const tone = Math.sin(2 * Math.PI * (240 - t * 210) * t) * Math.exp(-t * 5);
    out[i] = tone * 0.8 + noise() * Math.exp(-t * 30) * 0.25;
  }
  lowPass(out, 1800, SFX_RATE);
  return normalise(out, 0.6);
}

/**
 * Crops lost to the turn of a season.
 *
 * A minor third falling to its own root, detuned a little flat so it never
 * quite lands, under a dry rustle. The brief is "mournful", and the trick is
 * that every other cue in the game rises.
 */
function wither() {
  const out = seconds(0.9, SFX_RATE);
  const noise = makeNoise(0x5eed);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    const glide = 392 - t * 96;
    const tone = Math.sin(2 * Math.PI * glide * t) * Math.exp(-t * 2.6);
    const under = Math.sin(2 * Math.PI * (glide * 0.501) * t) * Math.exp(-t * 2.2) * 0.5;
    const leaves = noise() * Math.exp(-t * 4) * 0.18;
    out[i] = (tone + under) * 0.55 + leaves;
  }
  lowPass(out, 2400, SFX_RATE);
  return normalise(out, 0.55);
}

// --- music beds --------------------------------------------------------------
//
// Every loop is exactly LOOP_SECONDS long and every component is periodic
// inside it, so the end meets the start without a seam. Partial frequencies
// are snapped to multiples of 1 / LOOP_SECONDS for the same reason.

const LOOP_SECONDS = 8;

function snap(freq) {
  return Math.round(freq * LOOP_SECONDS) / LOOP_SECONDS;
}

/** A chord held for the whole loop, breathing slightly. */
function pad(out, freqs, gain, breathHz = 1 / LOOP_SECONDS) {
  for (let i = 0; i < out.length; i += 1) {
    const t = i / MUSIC_RATE;
    const breath = 0.78 + 0.22 * Math.sin(2 * Math.PI * breathHz * t);
    for (const freq of freqs) {
      const f = snap(freq);
      out[i] += (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2 * t) * 0.16) * gain * breath;
    }
  }
}

/**
 * Plucked notes over the pad.
 *
 * A note late in the loop is still ringing at the loop point, so its tail is
 * written round to the start of the buffer rather than truncated. Its pitch
 * is snapped to the loop grid, so the wrapped tail lines up in phase with
 * where the loop restarts and the seam stays inaudible.
 */
function pluck(out, notes, gain) {
  for (const note of notes) {
    const start = Math.round(note.at * MUSIC_RATE);
    for (let i = start; ; i += 1) {
      const t = (i - start) / MUSIC_RATE;
      const decay = Math.exp(-t * 3.4);
      if (decay < 0.001) break;
      const f = snap(note.freq);
      out[i % out.length] +=
        (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2 * t) * 0.22) * decay * gain;
    }
  }
}

function musicBuffer() {
  return seconds(LOOP_SECONDS, MUSIC_RATE);
}

/** The farm by day: open, major, unhurried. */
function dayFarmLoop() {
  const out = musicBuffer();
  pad(out, [130.81, 196, 261.63, 392], 0.075);
  pluck(
    out,
    [
      { at: 0.0, freq: 523.25 },
      { at: 1.0, freq: 659.25 },
      { at: 2.0, freq: 587.33 },
      { at: 3.0, freq: 392 },
      { at: 4.0, freq: 523.25 },
      { at: 5.0, freq: 783.99 },
      { at: 6.0, freq: 659.25 },
      { at: 6.8, freq: 587.33 },
    ],
    0.1,
  );
  return normalise(out, 0.5);
}

/** The village: the same key, warmer voicing, a busier figure. */
function dayVillageLoop() {
  const out = musicBuffer();
  pad(out, [146.83, 220, 293.66, 440], 0.07);
  pluck(
    out,
    [
      { at: 0.0, freq: 587.33 },
      { at: 0.75, freq: 880 },
      { at: 1.5, freq: 739.99 },
      { at: 2.25, freq: 587.33 },
      { at: 3.0, freq: 493.88 },
      { at: 4.0, freq: 587.33 },
      { at: 4.75, freq: 739.99 },
      { at: 5.5, freq: 880 },
      { at: 6.5, freq: 659.25 },
    ],
    0.085,
  );
  return normalise(out, 0.48);
}

/** Night: lower, slower, and much of the top end gone. */
function nightLoop() {
  const out = musicBuffer();
  pad(out, [98, 146.83, 196, 246.94], 0.085, 1 / (LOOP_SECONDS * 2));
  pluck(
    out,
    [
      { at: 0.5, freq: 392 },
      { at: 3.0, freq: 293.66 },
      { at: 5.5, freq: 329.63 },
    ],
    0.055,
  );
  lowPass(out, 2200, MUSIC_RATE);
  return normalise(out, 0.4);
}

/** Rain: mostly the weather, with just enough pad under it to have a key. */
function rainLoop() {
  const out = musicBuffer();
  const noise = makeNoise(0x4f11);

  // Noise has no period, so the loop cannot simply meet itself. Half a second
  // more of it than the loop needs is synthesised, and that overhang is
  // crossfaded back over the opening: the sample that follows the last one is
  // then the one the loop restarts on, which is exactly what seamless means.
  const fade = Math.round(0.5 * MUSIC_RATE);
  const rain = new Float64Array(out.length + fade);
  for (let i = 0; i < rain.length; i += 1) rain[i] = noise();
  lowPass(rain, 3000, MUSIC_RATE);
  highPass(rain, 400, MUSIC_RATE);
  for (let i = 0; i < fade; i += 1) {
    const mix = i / fade;
    rain[i] = rain[i] * mix + rain[out.length + i] * (1 - mix);
  }

  for (let i = 0; i < out.length; i += 1) {
    const t = i / MUSIC_RATE;
    // Gusts, periodic in the loop so they do not click at the seam either.
    const gust = 0.72 + 0.28 * Math.sin(2 * Math.PI * (2 / LOOP_SECONDS) * t);
    out[i] = rain[i] * 0.5 * gust;
  }
  pad(out, [110, 164.81, 220], 0.045);
  return normalise(out, 0.45);
}


/**
 * The float hitting the water: a short plop with a ring of surface under it.
 *
 * Deliberately close in shape to `tool-water` — both are water, and the two
 * should sound like the same pond — but an eighth of the length, because this
 * one fires every twenty seconds all evening and the watering can does not.
 */
function castSplash() {
  const out = seconds(0.34, SFX_RATE);
  const noise = makeNoise(0x5a17);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    // The plop itself: a pitch that drops away fast, which is what a cavity
    // closing over sounds like.
    out[i] = Math.sin(2 * Math.PI * (900 - t * 1900) * t) * Math.exp(-t * 22) * 0.8;
    // Droplets after it, quieter and higher.
    out[i] += noise() * Math.exp(-t * 14) * 0.35;
  }
  bandPass(out, 300, 5200, SFX_RATE);
  return normalise(out, 0.6);
}

/**
 * The bite.
 *
 * The one sound in the whole set that has a job beyond atmosphere: the player
 * has nine tenths of a second to answer it and may well be looking somewhere
 * else. So it rises rather than falls — every other short effect here falls —
 * and it is two notes rather than one, because a single blip reads as an
 * interface click and this is not one. Nothing else in the game does this.
 */
function fishBite() {
  const out = seconds(0.3, SFX_RATE);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    // Two rising tones a fifth apart, the second entering a beat late, so it
    // reads as a question rather than as a note.
    const first = Math.sin(2 * Math.PI * (740 + t * 520) * t) * Math.exp(-t * 11);
    const second =
      Math.sin(2 * Math.PI * (1108 + t * 700) * t) * Math.exp(-Math.abs(t - 0.09) * 30) * 0.7;
    out[i] = first + second;
  }
  highPass(out, 400, SFX_RATE);
  return normalise(out, 0.85);
}

/**
 * The catch: brighter and longer than the bite, and resolved rather than
 * questioning, so the pair reads as a call and an answer.
 */
function fishCaught() {
  const out = seconds(0.46, SFX_RATE);
  const notes = [659.25, 830.61, 987.77];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SFX_RATE;
    for (let n = 0; n < notes.length; n += 1) {
      const at = n * 0.075;
      if (t < at) continue;
      const since = t - at;
      out[i] += Math.sin(2 * Math.PI * notes[n] * since) * Math.exp(-since * 9) * 0.5;
    }
  }
  return normalise(out, 0.72);
}

// --- write -------------------------------------------------------------------

const effects = {
  'tool-hoe': toolHoe,
  'tool-water': toolWater,
  'tool-plant': toolPlant,
  'crop-pop': cropPop,
  coins,
  fanfare,
  rooster,
  'footstep-grass': () => footstep(0x1337, 1700, 0.13, 0.32),
  'footstep-path': () => footstep(0x2448, 3400, 0.11, 0.36),
  'ui-select': () => blip([880], 0.4),
  'ui-confirm': () => blip([659.25, 987.77], 0.45),
  chime,
  slump,
  wither,
  'animal-call': animalCall,
  'tool-chop': toolChop,
  'node-break': nodeBreak,
  'tool-bounce': toolBounce,
  'cast-splash': castSplash,
  'fish-bite': fishBite,
  'fish-caught': fishCaught,
};

const music = {
  'day-farm-loop': dayFarmLoop,
  'day-village-loop': dayVillageLoop,
  'night-loop': nightLoop,
  'rain-loop': rainLoop,
};

fs.mkdirSync(sfxDir, { recursive: true });
fs.mkdirSync(musicDir, { recursive: true });

let total = 0;
for (const [name, render] of Object.entries(effects)) {
  const file = path.join(sfxDir, `${name}.wav`);
  const bytes = encodeWav(render(), SFX_RATE);
  fs.writeFileSync(file, bytes);
  total += bytes.length;
  console.log(`wrote ${file} (${(bytes.length / 1024).toFixed(1)} kB)`);
}
for (const [name, render] of Object.entries(music)) {
  const file = path.join(musicDir, `${name}.wav`);
  const bytes = encodeWav(render(), MUSIC_RATE);
  fs.writeFileSync(file, bytes);
  total += bytes.length;
  console.log(`wrote ${file} (${(bytes.length / 1024).toFixed(1)} kB)`);
}
console.log(
  `${Object.keys(effects).length + Object.keys(music).length} files, ${(total / 1024 / 1024).toFixed(2)} MB total`,
);
