import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeProtobufFields,
  decodeWootingActuationProfile,
  decodeWootingAkcProfile,
  decodeWootingKeyIndex,
  decodeWootingAnalogProfileMainPart,
  decodeWootingAnalogProfilesCount,
  decodeWootingAnalogReport,
  decodeWootingAnalogSnapshot,
  decodeWootingCount,
  decodeWootingDeviceConfig,
  decodeWootingDksProfile,
  decodeWootingFlashChipConnected,
  decodeWootingFlashStats,
  decodeWootingFunctionMappingProfile,
  decodeWootingGamepadMapping,
  decodeWootingGamepadProfile,
  decodeWootingGlobalSettings,
  decodeWootingKeyboardProfile,
  decodeWootingMainMappingProfile,
  decodeWootingMappingProfile,
  decodeWootingNumberOfKeys,
  decodeWootingProfileFields,
  decodeWootingProfileIndex,
  decodeWootingProfileMetadata,
  decodeWootingRapidTriggerProfile,
  decodeWootingRgbBins,
  decodeWootingRgbLayer,
  decodeWootingRgbProfileColors,
  decodeWootingRgbProfileCore,
  decodeWootingRgbProfileCount,
  decodeWootingVersion,
  encodeWootingCommand,
  encodeWootingProfileCommand,
  encodeWootingProfileSwitch,
  encodeWootingRgbBuffer,
  encodeWootingSaveCommand,
  encodeWootingSingleColor,
  isWootingReply,
  wootingActuationMm,
  wootingFeatureReport,
  wootingProductName,
  wootingMatrixKeyId,
  wootingReplyOk,
  wootingSocdModeLabel,
  WOOTING_COMMAND,
  WOOTING_PROFILE_SWITCH_SETTLE_MS,
  WOOTING_RGB_COLS,
  WOOTING_RGB_ROWS,
  WOOTING_STATUS_ERROR,
  WOOTING_STATUS_OK,
} from "./index.ts";
/** Test-only varint encoder for building profile-blob vectors by hand. */
function testVarint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest !== 0) byte |= 0x80;
    out.push(byte);
  } while (rest !== 0);
  return out;
}

/**
 * Build an ARM profile-blob reply (`d1 da cmd 88 <len:u16> 0a <len> <nested>`)
 * from nested varint `[field, value]` pairs — the wootswitch layout every
 * blob decoder reads.
 */
function testBlobReply(commandId: number, nested: Array<readonly [number, number]>): Uint8Array {
  const inner = nested.flatMap(([field, value]) => [(field << 3) | 0, ...testVarint(value)]);
  const body = [0x0a, inner.length, ...inner];
  return new Uint8Array([0xd1, 0xda, commandId, WOOTING_STATUS_OK, body.length, 0x00, ...body]);
}

test("encodeWootingCommand matches the SDK single-report layout", () => {
  const buffer = encodeWootingCommand(WOOTING_COMMAND.getDeviceConfig);
  // [reportIndex, magic0, magic1, commandId, param3, param2, param1, param0]
  assert.deepEqual([...buffer], [0x00, 0xd0, 0xda, 19, 0x00, 0x00, 0x00, 0x00]);
});

test("encodeWootingCommand reverses parameters and honours multi-report", () => {
  const single = encodeWootingCommand(5, 0x11, 0x22, 0x33, 0x44);
  assert.deepEqual([...single], [0x00, 0xd0, 0xda, 5, 0x44, 0x33, 0x22, 0x11]);

  const multi = encodeWootingCommand(5, 0x11, 0x22, 0x33, 0x44, { multiReport: true });
  assert.equal(multi[0], 0x01);
  assert.equal(multi[1], 0xd1);
  assert.equal(multi[2], 0xda);
});

test("encodeWootingProfileCommand places the slot per firmware variant", () => {
  // ARM: slot in byte 4 (param3). Standard: slot in byte 7 (param0).
  const arm = encodeWootingProfileCommand(WOOTING_COMMAND.getProfileMetadata, 2, { multiReport: true });
  assert.deepEqual([...arm], [0x01, 0xd1, 0xda, 0x37, 0x02, 0x00, 0x00, 0x00]);
  const standard = encodeWootingProfileCommand(WOOTING_COMMAND.getDigitalProfile, 1, { multiReport: false });
  assert.deepEqual([...standard], [0x00, 0xd0, 0xda, 0x0c, 0x00, 0x00, 0x00, 0x01]);
});

test("wootingFeatureReport splits off the hidapi report-index byte", () => {
  const { reportId, data } = wootingFeatureReport(encodeWootingCommand(WOOTING_COMMAND.getDeviceConfig));
  assert.equal(reportId, 0);
  assert.deepEqual([...data], [0xd0, 0xda, 19, 0x00, 0x00, 0x00, 0x00]);
});

test("decodeWootingDeviceConfig reads the layout byte at the WebHID offset (9)", () => {
  // A real 60HE+ reply: header d1 da 13, status/payload, layout byte at index 9.
  const ansi = new Uint8Array([0xd1, 0xda, 0x13, 0x88, 0x07, 0, 0, 0, 0, 0x00, 0x11, 0, 0x0c]);
  assert.deepEqual(decodeWootingDeviceConfig(ansi), { layout: "ANSI", layoutId: 0 });

  const iso = new Uint8Array(64);
  iso[9] = 1;
  assert.deepEqual(decodeWootingDeviceConfig(iso), { layout: "ISO", layoutId: 1 });

  const split = new Uint8Array(64);
  split[9] = 3;
  assert.deepEqual(decodeWootingDeviceConfig(split), { layout: "ANSI Split", layoutId: 3 });

  const other = new Uint8Array(64);
  other[9] = 7;
  assert.deepEqual(decodeWootingDeviceConfig(other), { layout: "Unknown", layoutId: 7 });
});

test("decodeWootingDeviceConfig rejects a response too short to trust", () => {
  assert.equal(decodeWootingDeviceConfig(new Uint8Array(4)), null);
});

test("WOOTING_COMMAND exposes the read-only D0DA command ids", () => {
  assert.equal(WOOTING_COMMAND.getVersion, 0x01);
  assert.equal(WOOTING_COMMAND.getSerial, 0x03);
  assert.equal(WOOTING_COMMAND.getDeviceConfig, 0x13);
  assert.equal(WOOTING_COMMAND.getProfileMetadata, 0x37);
  assert.equal(WOOTING_COMMAND.getSettings, 0x33);
});

test("decodeWootingVersion parses major.minor.patch at offset 6", () => {
  // Real 60HE+ get_version reply — Wootility shows v2.13.0.
  const reply = new Uint8Array([0xd1, 0xda, 0x01, 0x88, 0x03, 0x00, 0x02, 0x0d, 0x00]);
  assert.equal(decodeWootingVersion(reply), "2.13.0");
  // Not a Wooting reply, or an all-zero version, decodes to nothing.
  assert.equal(decodeWootingVersion(new Uint8Array([0x01])), null);
  assert.equal(decodeWootingVersion(new Uint8Array([0xd1, 0xda, 0x01, 0x88, 0, 0, 0, 0, 0])), null);
});

test("decodeWootingVersion rejects an error-status reply", () => {
  // Same version bytes but a 0x66 status: the board refused, there is no version.
  const refused = new Uint8Array([0xd1, 0xda, 0x01, WOOTING_STATUS_ERROR, 0x03, 0x00, 0x02, 0x0d, 0x00]);
  assert.equal(isWootingReply(refused), true);
  assert.equal(wootingReplyOk(refused), false);
  assert.equal(decodeWootingVersion(refused), null);
  assert.equal(WOOTING_STATUS_OK, 0x88);
});

test("isWootingReply accepts a magic-word reply and rejects stubs", () => {
  // The real 60HE+ DEVICE_CONFIG reply seen on hardware.
  assert.equal(isWootingReply(new Uint8Array([0xd1, 0xda, 0x13, 0xff, 0, 0, 0, 0])), true);
  assert.equal(isWootingReply(new Uint8Array([0xd0, 0xda, 0x13, 0x00])), true);
  // A feature GET that echoes only the report id, or an empty buffer, is not a reply.
  assert.equal(isWootingReply(new Uint8Array([0x01])), false);
  assert.equal(isWootingReply(new Uint8Array(32)), false);
});

test("decodeWootingProfileIndex reads ARM bytes: flash default at 4, active at 6", () => {
  // Board booted on slot 0, software switched to slot 2: byte 0 is stale.
  const reply = new Uint8Array([0xd1, 0xda, 0x0b, 0x88, 0x00, 0x00, 0x02]);
  assert.deepEqual(decodeWootingProfileIndex(reply), { flashDefault: 0, active: 2 });
  assert.equal(decodeWootingProfileIndex(new Uint8Array([0xd1, 0xda, 0x0b, WOOTING_STATUS_ERROR, 0, 0, 0])), null);
  assert.equal(decodeWootingProfileIndex(new Uint8Array([0xd1, 0xda])), null);
});

test("decodeWootingProfileMetadata names a slot and spots an empty one", () => {
  // "AB": length 5, padding 0, protobuf 0a 02 41 42.
  const named = new Uint8Array([0xd1, 0xda, 0x37, 0x88, 0x05, 0x00, 0x0a, 0x02, 0x41, 0x42]);
  assert.deepEqual(decodeWootingProfileMetadata(named), { exists: true, name: "AB" });
  const empty = new Uint8Array([0xd1, 0xda, 0x37, 0x88, 0x00, 0x00]);
  assert.deepEqual(decodeWootingProfileMetadata(empty), { exists: false, name: null });
  assert.equal(decodeWootingProfileMetadata(new Uint8Array([0xd1, 0xda])), null);
});

test("decodeWootingCount reads scalar replies and rejects error status", () => {
  const keys = new Uint8Array([0xd1, 0xda, 0x10, 0x88, 0x3d]);
  assert.equal(decodeWootingCount(keys, WOOTING_COMMAND.getNumberOfKeys), 61);
  const refused = new Uint8Array([0xd1, 0xda, 0x09, WOOTING_STATUS_ERROR, 0x00]);
  assert.equal(decodeWootingCount(refused, WOOTING_COMMAND.getDigitalProfilesCount), null);
  assert.equal(decodeWootingCount(keys, WOOTING_COMMAND.getVersion), null);
});

test("decodeWootingProfileFields unwraps the nested actuation value", () => {
  // body: len 4, nested 0a 02 <field1 varint 5>: outer field 1 holds the profile.
  const reply = new Uint8Array([0xd1, 0xda, 0x39, 0x88, 0x04, 0x00, 0x0a, 0x02, 0x08, 0x05]);
  assert.deepEqual(decodeWootingProfileFields(reply), [{ field: 1, value: 5 }]);
  assert.deepEqual(decodeWootingProfileFields(new Uint8Array([0xd1, 0xda])), []);
  assert.equal(wootingActuationMm(20480), 1);
  assert.equal(wootingActuationMm(18432), 0.5);
});

test("decodeProtobufFields extracts fields by wire type", () => {
  // field 1 varint = 150; field 2 length-delimited "ab"; field 3 float32 = 0.2
  const floatBytes = new Uint8Array(new Float32Array([0.2]).buffer);
  const data = new Uint8Array([0x08, 0x96, 0x01, 0x12, 0x02, 0x61, 0x62, (3 << 3) | 5, ...floatBytes]);
  const fields = decodeProtobufFields(data);
  assert.equal(fields[0]?.field, 1);
  assert.equal(fields[0]?.int, 150);
  assert.equal(fields[1]?.field, 2);
  assert.deepEqual([...(fields[1]?.bytes ?? [])], [0x61, 0x62]);
  assert.equal(fields[2]?.field, 3);
  assert.ok(Math.abs((fields[2]?.float ?? 0) - 0.2) < 1e-6);
});

test("decodeWootingAnalogReport parses 3-byte entries in stable usage order", () => {
  // [usageHigh, usage, value] entries: S (0x16) at 200 arrives before A (0x04) at 100,
  // but the result is ordered by usage so rows keep their place as values change.
  const data = new Uint8Array([0x00, 0x16, 0xc8, 0x00, 0x04, 0x64, 0x00, 0x00, 0x00, 0x00]);
  assert.deepEqual(decodeWootingAnalogReport(data), [
    { usage: 0x04, value: 100 },
    { usage: 0x16, value: 200 },
  ]);
  // No keys pressed → empty.
  assert.deepEqual(decodeWootingAnalogReport(new Uint8Array(30)), []);
});

test("decodeWootingAnalogProfileMainPart reads actuation plus rapid-trigger flags", () => {
  // 1.00mm → 20480, RT on, press 20 / release 30, continuous on.
  const reply = testBlobReply(WOOTING_COMMAND.getAnalogProfileMainPart, [[1, 20480], [2, 1], [3, 20], [4, 30], [5, 1]]);
  assert.deepEqual(decodeWootingAnalogProfileMainPart(reply), {
    actuationRaw: 20480,
    actuationMm: 1,
    rapidTriggerEnabled: true,
    pressSensitivityRaw: 20,
    releaseSensitivityRaw: 30,
    continuousRapidTrigger: true,
    fields: [
      { field: 1, value: 20480 },
      { field: 2, value: 1 },
      { field: 3, value: 20 },
      { field: 4, value: 30 },
      { field: 5, value: 1 },
    ],
  });
  assert.equal(
    decodeWootingAnalogProfileMainPart(
      new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getAnalogProfileMainPart, WOOTING_STATUS_ERROR, 0x00, 0x00]),
    ),
    null,
  );
  assert.equal(decodeWootingAnalogProfileMainPart(new Uint8Array([0xd1, 0xda])), null);
});

test("decodeWootingRapidTriggerProfile reads enable and sensitivities", () => {
  const reply = testBlobReply(WOOTING_COMMAND.getRapidTriggerProfile, [[1, 1], [2, 12], [3, 18], [4, 0]]);
  assert.deepEqual(decodeWootingRapidTriggerProfile(reply), {
    enabled: true,
    pressSensitivityRaw: 12,
    releaseSensitivityRaw: 18,
    continuous: false,
    fields: [
      { field: 1, value: 1 },
      { field: 2, value: 12 },
      { field: 3, value: 18 },
      { field: 4, value: 0 },
    ],
  });
  assert.equal(decodeWootingRapidTriggerProfile(testBlobReply(WOOTING_COMMAND.getAnalogProfileMainPart, [[1, 1]])), null);
});

test("decodeWootingActuationProfile converts per-key overrides to millimetres", () => {
  // Key 0 at 1.00mm, key 1 at 0.50mm.
  const reply = testBlobReply(WOOTING_COMMAND.getActuationProfile, [[1, 20480], [2, 18432]]);
  const decoded = decodeWootingActuationProfile(reply);
  assert.deepEqual(decoded?.overrides, [
    { key: 0, actuationRaw: 20480, actuationMm: 1 },
    { key: 1, actuationRaw: 18432, actuationMm: 0.5 },
  ]);
  assert.deepEqual([...(decoded?.raw ?? [])], [...reply.subarray(6, 6 + (reply[4]! | (reply[5]! << 8)))]);
  assert.equal(decodeWootingActuationProfile(new Uint8Array([0xd1, 0xda])), null);
});

test("decodeWootingMappingProfile preserves live 60HE+ row groups", () => {
  // Live 0x30 body (150 bytes): six `0a 17 0a 15 <21 bytes>` groups.
  const row = (fill: number) => new Uint8Array(21).fill(fill);
  const group = (payload: Uint8Array) => [0x0a, 0x17, 0x0a, 0x15, ...payload];
  const body = [...group(row(0xff)), ...group(row(0x26))];
  const reply = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getMappingProfile, WOOTING_STATUS_OK, body.length, 0x00, ...body]);
  const decoded = decodeWootingMappingProfile(reply)!;
  assert.equal(decoded.groups.length, 2);
  assert.deepEqual([...decoded.groups[0]!], [...row(0xff)]);
  assert.deepEqual([...decoded.groups[1]!], [...row(0x26)]);
  assert.ok(decoded.raw.length > 0);
  assert.deepEqual(
    decodeWootingMainMappingProfile(
      new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getMainMappingProfile, WOOTING_STATUS_OK, body.length, 0x00, ...body]),
    )?.groups.length,
    2,
  );
  assert.deepEqual(
    decodeWootingFunctionMappingProfile(
      new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getFunctionMappingProfile, WOOTING_STATUS_OK, body.length, 0x00, ...body]),
    )?.groups.length,
    2,
  );
  // Wrong echo is not a mapping answer.
  assert.equal(decodeWootingMappingProfile(reply, WOOTING_COMMAND.getVersion), null);
  assert.equal(decodeWootingMainMappingProfile(reply), null);
  assert.equal(decodeWootingMappingProfile(new Uint8Array([0xd1, 0xda])), null);
});

test("decodeWootingDksProfile reports the live empty body", () => {
  // Live 60HE+ 0x18 answer: OK status with a zero length prefix (no binds).
  const empty = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getDksProfile, WOOTING_STATUS_OK, 0x00, 0x00]);
  assert.deepEqual(decodeWootingDksProfile(empty), { cellCount: 0, raw: empty.subarray(6, 6) });
  assert.equal(decodeWootingDksProfile(new Uint8Array([0xd1, 0xda])), null);
});

test("decodeWootingAkcProfile names the live A+D Last Input Priority combo", () => {
  // Live 60HE+ 0x34 body (18 bytes): socd entry, primary (3,1) = A,
  // secondary (3,3) = D, socd mode 4 = Last Input Priority, layer 0.
  const body = [0x0a, 0x0c, 0x2a, 0x06, 0x08, 0x63, 0x10, 0x04, 0x18, 0x00, 0x40, 0x61, 0x48, 0x00, 0x10, 0x00, 0x18, 0x01];
  const reply = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getAkcProfile, WOOTING_STATUS_OK, body.length, 0x00, ...body]);
  const decoded = decodeWootingAkcProfile(reply)!;
  assert.equal(decoded.combos.length, 1);
  const combo = decoded.combos[0]!;
  assert.equal(combo.kind, "socd");
  assert.equal(combo.keyIndex, 97);
  assert.deepEqual(combo.key, { row: 3, col: 1 });
  assert.equal(combo.layer, 0);
  assert.equal(combo.secondaryKeyIndex, 99);
  assert.deepEqual(combo.secondaryKey, { row: 3, col: 3 });
  assert.equal(combo.socdMode, 4);
  assert.equal(wootingSocdModeLabel(4), "Last Input Priority");
  assert.equal(combo.inputBothWhenBottomedOut, false);
  assert.deepEqual([...combo.raw], [0x2a, 0x06, 0x08, 0x63, 0x10, 0x04, 0x18, 0x00, 0x40, 0x61, 0x48, 0x00]);
  assert.deepEqual([...decoded.raw], body);
  assert.deepEqual(decodeWootingKeyIndex(97), { row: 3, col: 1 });
  assert.deepEqual(decoded.fields.map((entry) => entry.field), [1]);
  assert.equal(decodeWootingKeyIndex(255), null);
  assert.equal(decodeWootingAkcProfile(new Uint8Array([0xd1, 0xda])), null);
});

test("wootingMatrixKeyId maps firmware matrix to 60% keys", () => {
  // SDK matrix image: row 3 col 1 = A, row 3 col 3 = D (the live combo).
  assert.equal(wootingMatrixKeyId(3, 1), "a");
  assert.equal(wootingMatrixKeyId(3, 3), "d");
  assert.equal(wootingMatrixKeyId(1, 0), "esc");
  assert.equal(wootingMatrixKeyId(4, 2), "z");
  // Function row / gaps have no 60% key — null, never a guess.
  assert.equal(wootingMatrixKeyId(0, 2), null);
  assert.equal(wootingMatrixKeyId(3, 12), null);
});

test("decodeWootingGamepadProfile and decodeWootingGamepadMapping read the live gamepad layer", () => {
  // Live 60HE+ 0x29 body (40 bytes): four rows + field-2 trailer `0800100018012032` (mode 1).
  const profileBody = [0x0a, 0x1c, 0x0a, 0x04, 0x08, 0x00, 0x10, 0x14, 0x0a, 0x04, 0x08, 0x3c, 0x10, 0x3c, 0x0a, 0x06, 0x08, 0xc2, 0x01, 0x10, 0xc3, 0x01, 0x0a, 0x06, 0x08, 0xfd, 0x01, 0x10, 0xff, 0x01, 0x12, 0x08, 0x08, 0x00, 0x10, 0x00, 0x18, 0x01, 0x20, 0x32];
  const profile = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getGamepadProfile, WOOTING_STATUS_OK, profileBody.length, 0x00, ...profileBody]);
  const decodedProfile = decodeWootingGamepadProfile(profile)!;
  assert.equal(decodedProfile.mode, 1);
  assert.equal(decodedProfile.groups.length, 1);
  assert.ok(decodedProfile.raw.length > 0);
  // Live 60HE+ 0x28 answers an empty OK body (no binds on this profile).
  const emptyMapping = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getGamepadMapping, WOOTING_STATUS_OK, 0x00, 0x00]);
  assert.deepEqual(decodeWootingGamepadMapping(emptyMapping), { bindingCount: 0, raw: emptyMapping.subarray(6, 6) });
  assert.equal(decodeWootingGamepadProfile(emptyMapping), null);
});

test("RGB decoders preserve the live core, colours, and bins blocks", () => {
  // Live 60HE+ 0x32 body (31 bytes): field-1 config row + field-4 lighting row.
  const coreBody = [0x0a, 0x13, 0x08, 0xff, 0x01, 0x10, 0xff, 0xff, 0x03, 0x18, 0xff, 0xff, 0x03, 0x20, 0xff, 0xff, 0x03, 0x28, 0xff, 0xff, 0x03, 0x22, 0x08, 0x0a, 0x06, 0x4a, 0x04, 0x08, 0x7f, 0x10, 0x00];
  const coreReply = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getRgbProfileCore, WOOTING_STATUS_OK, coreBody.length, 0x00, ...coreBody]);
  const core = decodeWootingRgbProfileCore(coreReply)!;
  assert.equal(core.commandId, WOOTING_COMMAND.getRgbProfileCore);
  assert.equal(core.groups.length, 1);
  assert.ok(core.trailer);

  // Live 0x23 colour page: repeated field-1 BGR rows.
  const coloursBody = [0x0a, 0x2b, 0x0a, 0x29, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01];
  const coloursReply = (cmd: number) => new Uint8Array([0xd1, 0xda, cmd, WOOTING_STATUS_OK, coloursBody.length, 0x00, ...coloursBody]);
  const colours1 = decodeWootingRgbProfileColors(coloursReply(WOOTING_COMMAND.getRgbProfileColors1))!;
  assert.equal(colours1.part, 1);
  assert.ok(colours1.groups.length >= 1);
  const colours2 = decodeWootingRgbProfileColors(coloursReply(WOOTING_COMMAND.getRgbProfileColors2))!;
  assert.equal(colours2.part, 2);
  assert.equal(decodeWootingRgbProfileColors(coreReply), null);

  // Live 0x39 answers an empty OK body (no layer rows on this profile).
  const emptyLayer = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getRgbLayer, WOOTING_STATUS_OK, 0x00, 0x00]);
  assert.equal(decodeWootingRgbLayer(emptyLayer), null);
  // Live 0x3B bins body (14 bytes): one packed calibration row.
  const binsBody = [0x0a, 0x0c, 0x0a, 0x02, 0x10, 0x03, 0x12, 0x06, 0x08, 0x01, 0x10, 0x02, 0x18, 0x03];
  const binsReply = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getRgbBins, WOOTING_STATUS_OK, binsBody.length, 0x00, ...binsBody]);
  assert.equal(decodeWootingRgbBins(binsReply)?.commandId, WOOTING_COMMAND.getRgbBins);
  assert.equal(decodeWootingRgbBins(new Uint8Array([0xd1, 0xda])), null);
});

test("decodeWootingGlobalSettings preserves the live config bytes", () => {
  // Live 60HE+ 0x33 body (8 bytes): field-1 config row `08 05 10 0a`.
  const body = [0x0a, 0x04, 0x08, 0x05, 0x10, 0x0a, 0x10, 0x00];
  const reply = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getSettings, WOOTING_STATUS_OK, body.length, 0x00, ...body]);
  const decoded = decodeWootingGlobalSettings(reply)!;
  assert.deepEqual([...(decoded.config ?? [])], [0x08, 0x05, 0x10, 0x0a]);
  assert.deepEqual(decoded.fields.map((entry) => entry.field), [1]);
  assert.ok(decoded.raw.length > 0);
  assert.equal(
    decodeWootingGlobalSettings(
      new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getSettings, WOOTING_STATUS_ERROR, 0x00, 0x00]),
    ),
    null,
  );
});

test("decodeWootingKeyboardProfile reads the live actuation and rapid trigger", () => {
  // Live 60HE+ 0x27 body (22 bytes): 17203 raw = 0.20mm, RT on, curve preset 2.
  const body = [0x0a, 0x14, 0x08, 0xb3, 0x86, 0x01, 0x10, 0x01, 0x18, 0x01, 0x20, 0x9a, 0x83, 0x01, 0x28, 0x00, 0x30, 0x02, 0x38, 0x00, 0x48, 0x00];
  const reply = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getKeyboardProfile, WOOTING_STATUS_OK, body.length, 0x00, ...body]);
  const decoded = decodeWootingKeyboardProfile(reply)!;
  assert.equal(decoded.actuationRaw, 17203);
  assert.ok(Math.abs(decoded.actuationMm! - 0.199951171875) < 1e-9);
  assert.equal(decoded.rapidTriggerEnabled, true);
  assert.equal(decoded.pressSensitivityRaw, 1);
  assert.equal(decoded.releaseSensitivityRaw, 16794);
  assert.equal(decoded.curvePreset, 2);
  assert.equal(decoded.continuousRapidTrigger, false);
  assert.equal(
    decodeWootingKeyboardProfile(
      new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getKeyboardProfile, WOOTING_STATUS_ERROR, 0x00, 0x00]),
    ),
    null,
  );
});

test("diagnostic decoders read live key, flash, and snapshot replies", () => {
  // Live 60HE+: 0x10/0x04/0x0A answer 0x66 (unsupported on ARM) — null, never a guess.
  assert.equal(
    decodeWootingNumberOfKeys(new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getNumberOfKeys, WOOTING_STATUS_ERROR, 0x00])),
    null,
  );
  assert.equal(
    decodeWootingAnalogProfilesCount(
      new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getAnalogProfilesCount, WOOTING_STATUS_ERROR, 0x00]),
    ),
    null,
  );
  assert.equal(
    decodeWootingRgbProfileCount(
      new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getRgbProfileCount, WOOTING_STATUS_ERROR, 0x00]),
    ),
    null,
  );
  assert.equal(decodeWootingNumberOfKeys(new Uint8Array([0xd1, 0xda])), null);

  const connected = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.isFlashChipConnected, WOOTING_STATUS_OK, 0x01]);
  assert.equal(decodeWootingFlashChipConnected(connected), true);
  assert.equal(
    decodeWootingFlashChipConnected(
      new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.isFlashChipConnected, WOOTING_STATUS_ERROR, 0x01]),
    ),
    null,
  );

  const stats = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getFlashStats, WOOTING_STATUS_OK, 0x0a, 0x00, 0x40, 0x00]);
  const decodedStats = decodeWootingFlashStats(stats)!;
  assert.equal(decodedStats.usedPages, 10);
  assert.equal(decodedStats.totalPages, 64);
  assert.deepEqual([...decodedStats.raw], [0x0a, 0x00, 0x40, 0x00]);
  assert.equal(decodeWootingFlashStats(new Uint8Array([0xd1, 0xda])), null);

  // Live 60HE+ 0x14 body (150 bytes): six zero rows at rest.
  const row = [0x0a, 0x17, 0x0a, 0x15, ...new Uint8Array(21)];
  const snapBody = [...row, ...row, ...row, ...row, ...row, ...row];
  const snapshot = new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getAnalogValues, WOOTING_STATUS_OK, snapBody.length, 0x00, ...snapBody]);
  const decoded = decodeWootingAnalogSnapshot(snapshot)!;
  assert.equal(decoded.groups.length, 6);
  assert.ok(decoded.groups.every((entry) => entry.length === 21));
  assert.equal(decodeWootingAnalogSnapshot(new Uint8Array([0xd1, 0xda])), null);
});

test("encodeWootingProfileSwitch builds the live-verified RAM-only sequence", () => {
  // ARM: init (no slot) → activate slot at byte 4 → reload slot at byte 4.
  const [init, activate, reload] = encodeWootingProfileSwitch(2);
  assert.deepEqual([...init], [0x01, 0xd1, 0xda, WOOTING_COMMAND.wootDevInit, 0x00, 0x00, 0x00, 0x00]);
  assert.deepEqual([...activate], [0x01, 0xd1, 0xda, WOOTING_COMMAND.activateProfile, 0x02, 0x00, 0x00, 0x00]);
  assert.deepEqual([...reload], [0x01, 0xd1, 0xda, WOOTING_COMMAND.reloadProfile, 0x02, 0x00, 0x00, 0x00]);
  assert.equal(WOOTING_PROFILE_SWITCH_SETTLE_MS, 100);
});

test("encodeWootingSaveCommand gates every flash write on confirmed", () => {
  // Live shape: save_keyboard_profile slot at ARM byte 4.
  const save = encodeWootingSaveCommand(WOOTING_COMMAND.saveKeyboardProfile, 1, { confirmed: true });
  assert.deepEqual([...save], [0x01, 0xd1, 0xda, WOOTING_COMMAND.saveKeyboardProfile, 0x01, 0x00, 0x00, 0x00]);
  assert.throws(() => encodeWootingSaveCommand(WOOTING_COMMAND.saveKeyboardProfile, 1));
  assert.throws(() => encodeWootingSaveCommand(WOOTING_COMMAND.activateProfile, 1, { confirmed: true }));
  assert.throws(() => encodeWootingSaveCommand(WOOTING_COMMAND.getVersion, 0, { confirmed: true }));
});

test("encodeWootingSingleColor and encodeWootingRgbBuffer match the SDK shapes", () => {
  // SDK param order on the wire: [keyIndex, R, G, B] reversed → param3..param0.
  const single = encodeWootingSingleColor(0, 255, 0, 0);
  assert.deepEqual([...single], [0x01, 0xd1, 0xda, WOOTING_COMMAND.wootDevSingleColor, 0x00, 0xff, 0x00, 0x00]);
  // v3 buffer: index 5, D1 DA, report 11, then 6×21×u16.
  const colors = new Uint8Array(WOOTING_RGB_ROWS * WOOTING_RGB_COLS * 2).fill(0x7f);
  const buffer = encodeWootingRgbBuffer(colors);
  assert.equal(buffer[0], 5);
  assert.deepEqual([...buffer.subarray(1, 4)], [0xd1, 0xda, 11]);
  assert.deepEqual([...buffer.subarray(4)], [...colors]);
  assert.throws(() => encodeWootingRgbBuffer(new Uint8Array(10)));
});

test("wootingProductName knows the 60HE+ and falls back otherwise", () => {
  assert.equal(wootingProductName(0x1322), "Wooting 60HE+");
  assert.equal(wootingProductName(0xffff), "Wooting keyboard");
});
