import assert from "node:assert/strict";
import test from "node:test";

import {
  STEELSERIES_APEX_PRO_2023_SLOTS,
  STEELSERIES_FEATURE_DATA_LENGTH,
  STEELSERIES_KEYBOARD_PRODUCT_IDS,
  STEELSERIES_KEYBOARD_PRODUCTS,
  STEELSERIES_OUTPUT_DATA_LENGTH,
  STEELSERIES_OLED_BITMAP_LENGTH,
  STEELSERIES_RAPID_TAP_PAIR_COUNT,
  STEELSERIES_PROFILE_CHECKSUM_OFFSET,
  STEELSERIES_PROFILE_LENGTH,
  STEELSERIES_PROFILE_OFFSET,
  decodeSteelseriesFirmware,
  decodeSteelseriesProfile,
  encodeSteelseriesFirmwarePoll,
  encodeSteelseriesHallThresholds,
  encodeSteelseriesOledDirect,
  encodeSteelseriesOledDisplay,
  encodeSteelseriesOledResetDirect,
  encodeSteelseriesProfileRead,
  encodeSteelseriesRapidTap,
  encodeSteelseriesRapidTapPairs,
  encodeSteelseriesRapidTriggerSensitivity,
  encodeSteelseriesReleaseMode,
  steelseriesActuationRaw,
  steelseriesActuationTenths,
  steelseriesCrc32,
  steelseriesProfileChecksumValid,
} from "./index.ts";

const text = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "ascii"));

function sealedProfile(): Uint8Array<ArrayBuffer> {
  const blob = new Uint8Array(STEELSERIES_PROFILE_LENGTH);
  blob[STEELSERIES_PROFILE_OFFSET.deviceSchema] = 8;
  blob[STEELSERIES_PROFILE_OFFSET.actuation + 16] = 0x39;
  blob[STEELSERIES_PROFILE_OFFSET.reset + 16] = 0x34;
  blob[STEELSERIES_PROFILE_OFFSET.releaseMode + 16] = 0x02;
  blob[STEELSERIES_PROFILE_OFFSET.rapidTriggerSensitivity + 16] = 0x02;
  blob[STEELSERIES_PROFILE_OFFSET.secondActuation + 16] = 0x15;
  blob[STEELSERIES_PROFILE_OFFSET.secondReset + 16] = 0x12;
  blob.set([0x04, 0x07, 0x81, 0, 0], STEELSERIES_PROFILE_OFFSET.rapidTapPairs);
  blob[STEELSERIES_PROFILE_OFFSET.oled] = 0xa5;
  blob[STEELSERIES_PROFILE_OFFSET.rapidTapEnabled] = 0x01;
  const crc = steelseriesCrc32(blob.slice(0, STEELSERIES_PROFILE_CHECKSUM_OFFSET));
  blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET] = crc & 0xff;
  blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 1] = (crc >>> 8) & 0xff;
  blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 2] = (crc >>> 16) & 0xff;
  blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 3] = (crc >>> 24) & 0xff;
  return blob;
}

test("the STM32 CRC matches ST's reference word", () => {
  assert.equal(steelseriesCrc32(Uint8Array.from([0x78, 0x56, 0x34, 0x12])), 0xdf8a8a2b);
  assert.throws(() => steelseriesCrc32(Uint8Array.from([1, 2, 3])), /whole 32-bit words/);
});

test("the 68-slot analog key table is unique and complete", () => {
  assert.equal(STEELSERIES_APEX_PRO_2023_SLOTS.length, 68);
  assert.equal(new Set(STEELSERIES_APEX_PRO_2023_SLOTS).size, 68);
  assert.equal(STEELSERIES_APEX_PRO_2023_SLOTS[16], 0x1a);
});

test("actuation raw pairs round-trip and reject unknown points", () => {
  assert.deepEqual(steelseriesActuationRaw(1), [5, 5]);
  assert.deepEqual(steelseriesActuationRaw(20), [0x39, 0x34]);
  assert.deepEqual(steelseriesActuationRaw(40), [224, 219]);
  assert.equal(steelseriesActuationRaw(0), null);
  assert.equal(steelseriesActuationRaw(41), null);
  assert.equal(steelseriesActuationTenths(0x39, 0x34), 20);
  assert.equal(steelseriesActuationTenths(1, 1), null);
});

test("a sealed profile decodes per-key actuation, release mode and sensitivity", () => {
  const blob = sealedProfile();
  assert.equal(steelseriesProfileChecksumValid(blob), true);
  const profile = decodeSteelseriesProfile(blob);
  assert.equal(profile?.checksumValid, true);
  assert.equal(profile?.live, false);
  assert.equal(profile?.rapidTapEnabled, true);
  assert.equal(profile?.deviceSchema, 8);
  assert.deepEqual(profile?.secondActuation?.[16], [0x15, 0x12]);
  assert.deepEqual(profile?.rapidTapPairs?.[0], { hid1: 4, hid2: 7, mode: 1, reportBothKeys: true });
  assert.equal(profile?.oled?.[0], 0xa5);
  const key = profile?.keys.find((entry) => entry.usage === 0x1a);
  assert.deepEqual(key, {
    usage: 0x1a,
    actuation: 0x39,
    reset: 0x34,
    tenthsMm: 20,
    releaseMode: 2,
    rapidTriggerSensitivity: 2,
  });
  blob[STEELSERIES_PROFILE_OFFSET.actuation] = 0xff;
  assert.equal(steelseriesProfileChecksumValid(blob), false);
  assert.equal(decodeSteelseriesProfile(blob)?.checksumValid, false);
  assert.equal(decodeSteelseriesProfile(blob.slice(0, 100)), null);
});

test("hall-threshold frames carry every key and the requested layer", () => {
  const frame = encodeSteelseriesHallThresholds(0x02, [[0x1a, 0x39, 0x34], [0x04, 0x15, 0x12]]);
  assert.equal(frame.length, STEELSERIES_FEATURE_DATA_LENGTH);
  assert.deepEqual([...frame.slice(0, 4 + 6)], [0x38, 0x61, 2, 0x02, 0x1a, 0x39, 0x34, 0x04, 0x15, 0x12]);
  assert.throws(() => encodeSteelseriesHallThresholds(0, []), /1-71/);
});

test("release-mode frames reject modes outside GG's set", () => {
  const frame = encodeSteelseriesReleaseMode([[0x1a, 0x02], [0x04, 0x00]]);
  assert.deepEqual([...frame.slice(0, 6)], [0x38, 0x62, 2, 0x1a, 0x02, 0x04]);
  assert.throws(() => encodeSteelseriesReleaseMode([[0x1a, 0x01]]), /release mode/);
});

test("rapid-trigger and rapid-tap frames keep their command bytes", () => {
  const sensitivity = encodeSteelseriesRapidTriggerSensitivity([[0x1a, 0x02]]);
  assert.deepEqual([...sensitivity.slice(0, 5)], [0x38, 0x65, 1, 0x1a, 0x02]);
  const tapOn = encodeSteelseriesRapidTap(true);
  const tapOff = encodeSteelseriesRapidTap(false);
  assert.equal(tapOn.length, STEELSERIES_OUTPUT_DATA_LENGTH);
  assert.deepEqual([...tapOn.slice(0, 3)], [0x38, 0x66, 1]);
  assert.deepEqual([...tapOff.slice(0, 3)], [0x38, 0x66, 0]);
});

test("GG's ten Rapid Tap slots fit the 64-byte output report exactly", () => {
  const pairs = Array.from({ length: STEELSERIES_RAPID_TAP_PAIR_COUNT }, (_, index) => ({
    hid1: index ? 0 : 4, hid2: index ? 0 : 7,
    mode: index ? 0 as const : 3 as const, reportBothKeys: index === 0,
  }));
  const frame = encodeSteelseriesRapidTapPairs(pairs);
  assert.equal(frame.length, STEELSERIES_OUTPUT_DATA_LENGTH);
  assert.deepEqual([...frame.slice(0, 15)], [0x38, 0x67, 10, 0, 4, 7, 0x83, 0, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual([...frame.slice(57)], [9, 0, 0, 0, 0, 0, 0]);
  assert.throws(() => encodeSteelseriesRapidTapPairs(pairs.slice(0, 9)), /exactly 10/);
  assert.throws(() => encodeSteelseriesRapidTapPairs(pairs.map((pair, i) => i === 0
    ? { ...pair, mode: 4 as 3 } : pair)), /mode/);
  assert.throws(() => encodeSteelseriesRapidTapPairs(pairs.map((pair, i) => i === 0
    ? { ...pair, hid2: 0x29 } : pair)), /distinct analog HID/);
});

test("GG's profile and direct OLED commands preserve all 640 bitmap bytes", () => {
  const bitmap = Uint8Array.from({ length: STEELSERIES_OLED_BITMAP_LENGTH }, (_, index) => index & 0xff);
  const profile = encodeSteelseriesOledDisplay(bitmap);
  assert.equal(profile.length, STEELSERIES_FEATURE_DATA_LENGTH);
  assert.deepEqual([...profile.slice(0, 6)], [0x38, 0x83, 0, 0, 1, 2]);
  assert.equal(profile[642], bitmap[639]);
  assert.equal(profile[643], 0);
  const direct = encodeSteelseriesOledDirect(bitmap);
  assert.deepEqual([...direct.slice(0, 5)], [0x1f, 0x81, 0, 1, 2]);
  assert.equal(direct[641], bitmap[639]);
  assert.deepEqual([...encodeSteelseriesOledResetDirect().slice(0, 3)], [0x1f, 0x82, 0]);
  assert.throws(() => encodeSteelseriesOledDisplay(bitmap.slice(1)), /640/);
  assert.throws(() => encodeSteelseriesOledDirect(bitmap.slice(1)), /640/);
});

test("profile reads encode file id, little-endian size and offset", () => {
  const frame = encodeSteelseriesProfileRead(0x80, 500, 0x1234);
  assert.equal(frame.length, STEELSERIES_FEATURE_DATA_LENGTH);
  assert.deepEqual([...frame.slice(0, 9)], [0x83, 0x01, 0x80, 0xf4, 0x01, 0x34, 0x12, 0x00, 0x00]);
  assert.throws(() => encodeSteelseriesProfileRead(0x85, 500, 0), /0x80-0x84/);
  assert.throws(() => encodeSteelseriesProfileRead(0x80, 0, 0), /size/);
});

test("firmware polls and replies use the 0x90 command", () => {
  assert.deepEqual([...encodeSteelseriesFirmwarePoll(0).slice(0, 2)], [0x90, 0x00]);
  assert.deepEqual([...encodeSteelseriesFirmwarePoll(1).slice(0, 2)], [0x90, 0x01]);
  const reply = new Uint8Array(64);
  reply.set([0x90, 0x00, ...text("1.19.7")]);
  assert.equal(decodeSteelseriesFirmware(reply), "1.19.7");
  assert.equal(decodeSteelseriesFirmware(Uint8Array.from([0x91, 0x00])), null);
});

test("the Apex catalog marks nothing verified and carries five profile slots", () => {
  assert.equal(new Set(STEELSERIES_KEYBOARD_PRODUCT_IDS).size, STEELSERIES_KEYBOARD_PRODUCT_IDS.length);
  for (const product of STEELSERIES_KEYBOARD_PRODUCTS.values()) {
    assert.equal(product.verified, false);
    assert.equal(product.profileSlots, 5);
  }
});
