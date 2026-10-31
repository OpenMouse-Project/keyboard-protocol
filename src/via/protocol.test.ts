import assert from "node:assert/strict";
import test from "node:test";

import {
  viaEventCodeFromKeycode,
  viaKeycodeFromEventCode,
  viaKeycodeFromLayoutName,
  viaKeycodeToLayoutName,
  VIA_MOD,
  viaComposeKeycode,
  viaLightingKeycodes,
  VIA_BASIC_KEYCODES,
  VIA_COMMAND,
  VIA_KEYBOARD_VALUE,
  VIA_REPORT_LENGTH,
  ViaMacroExpressionError,
  decodeViaKeyboardValue,
  decodeViaKeymap,
  decodeViaMacro,
  decodeViaProtocolVersion,
  describeViaKeycode,
  encodeViaCommand,
  encodeViaCustomSet,
  encodeViaGetKeyboardValue,
  encodeViaGetKeymapBuffer,
  encodeViaKeymap,
  encodeViaMacro,
  encodeViaSetKeycode,
  evaluateViaCondition,
  joinViaMacros,
  parseViaDefinition,
  parseViaMacroExpression,
  parseViaMenus,
  splitViaMacros,
  viaActiveKeys,
  viaBufferChunks,
  viaIsUnhandled,
  viaKeycodeFromName,
  viaKeycodeName,
  viaKeycodePicker,
  viaLayoutChoices,
  viaMacroToExpression,
  viaNumberToBytes,
  viaPackLayoutChoices,
  viaReplyMatches,
  viaUint32,
  viaUint32Bytes,
  viaValueToNumber,
  viaVendorProductId,
} from "@openmouse/keyboard-protocol/via";

test("commands are 32-byte zero padded frames and reject bad bytes", () => {
  const frame = encodeViaCommand(VIA_COMMAND.getKeycode, [1, 2, 3]);
  assert.equal(frame.length, VIA_REPORT_LENGTH);
  assert.deepEqual([...frame.slice(0, 6)], [0x04, 1, 2, 3, 0, 0]);
  assert.throws(() => encodeViaCommand(VIA_COMMAND.getKeycode, [256]), RangeError);
  assert.throws(() => encodeViaCommand(VIA_COMMAND.getKeycode, new Array(32).fill(0)), RangeError);
  assert.throws(() => encodeViaSetKeycode(0, 0, 0, 0x10000), RangeError);
});

test("keycodes are big-endian and keymaps round-trip through the byte buffer", () => {
  assert.deepEqual([...encodeViaSetKeycode(1, 2, 3, 0x1234).slice(0, 6)], [0x05, 1, 2, 3, 0x12, 0x34]);
  const layers = [[0x0004, 0x0005, 0x0006, 0x0007], [0x5100, 0x0000, 0x00ff, 0x7c00]];
  const bytes = encodeViaKeymap(layers);
  assert.equal(bytes.length, 16);
  assert.deepEqual(decodeViaKeymap(bytes, 2, 2, 2), layers);
  assert.throws(() => decodeViaKeymap(bytes.slice(0, 15), 2, 2, 2), RangeError);
});

test("buffer transfers are chunked 28 bytes at a time", () => {
  assert.deepEqual(viaBufferChunks(60), [{ offset: 0, size: 28 }, { offset: 28, size: 28 }, { offset: 56, size: 4 }]);
  assert.deepEqual([...encodeViaGetKeymapBuffer(0x0102, 28).slice(0, 4)], [0x12, 0x01, 0x02, 28]);
  assert.throws(() => encodeViaGetKeymapBuffer(0, 29), RangeError);
});

test("replies pair with requests by command and echoed header, and flag unknown commands", () => {
  const request = encodeViaGetKeyboardValue(VIA_KEYBOARD_VALUE.firmwareVersion);
  const reply = new Uint8Array(VIA_REPORT_LENGTH);
  reply.set([0x02, VIA_KEYBOARD_VALUE.firmwareVersion, 0x00, 0x00, 0x01, 0x02]);
  assert.ok(viaReplyMatches(reply, request, 1));
  assert.deepEqual(decodeViaKeyboardValue(reply, 0, 4), [0, 0, 1, 2]);
  assert.equal(viaUint32([0xff, 0xff, 0xff, 0xff]), 0xffffffff);
  reply[1] = 0x06;
  assert.equal(viaReplyMatches(reply, request, 1), false);
  assert.equal(viaIsUnhandled(Uint8Array.of(0xff, 0x04)), true);
  assert.equal(decodeViaProtocolVersion(Uint8Array.of(0x01, 0x00, 0x09)), 9);
});

test("custom values carry the channel and value id ahead of the payload", () => {
  assert.deepEqual([...encodeViaCustomSet([3, 4], [10, 200]).slice(0, 5)], [0x07, 3, 4, 10, 200]);
});

test("macros split on 0x00 and rejoin zero padded to the buffer size", () => {
  const buffer = [0x61, 0x62, 0, 0x63, 0, 0, 0, 0];
  assert.deepEqual(splitViaMacros(buffer, 3), [[0x61, 0x62], [0x63], []]);
  assert.deepEqual(joinViaMacros([[0x61, 0x62], [0x63], []], 8), buffer);
  assert.throws(() => joinViaMacros([[1, 2, 3]], 3), RangeError);
  assert.throws(() => joinViaMacros([[1, 0, 2]], 8), RangeError);
});

const SERVED = {
  name: "Served Board",
  vendorProductId: 0xfeed0001,
  firmwareVersion: 0,
  menus: [],
  keycodes: ["qmk_rgb_matrix_keycodes"],
  matrix: { rows: 2, cols: 3 },
  layouts: {
    labels: ["Split"],
    width: 3,
    height: 2,
    optionKeys: {
      0: {
        0: [{ row: 1, col: 2, x: 2, y: 1, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1 }],
        1: [{ row: 1, col: 2, x: 2, y: 1, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 2 }],
      },
    },
    keys: [
      { row: 0, col: 0, x: 0, y: 0, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1 },
      { row: 0, col: 1, x: 1, y: 0, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1 },
      { row: -1, col: -1, x: 0, y: 1, r: 0, rx: 0, ry: 0, d: true, h: 1, w: 1 },
    ],
  },
};

test("a served (processed) definition parses and its layout options select keys", () => {
  const def = parseViaDefinition(SERVED);
  assert.deepEqual([def.vendorId, def.productId], [0xfeed, 1]);
  assert.equal(def.keys.length, 2);
  assert.deepEqual(def.keycodeModules, ["qmk_rgb_matrix_keycodes"]);
  assert.equal(viaActiveKeys(def, [0]).at(-1)!.w, 1);
  assert.equal(viaActiveKeys(def, [1]).at(-1)!.w, 2);
  assert.equal(viaActiveKeys(def, []).length, 3);
  assert.throws(() => parseViaDefinition({ ...SERVED, matrix: { rows: 1, cols: 1 } }), /outside/);
});

test("layout choices unpack from the board's bitfield, last label in the low bits", () => {
  assert.deepEqual(viaLayoutChoices(["Split"], 1), [1]);
  assert.deepEqual(viaLayoutChoices(["A", ["Layer", "x", "y", "z"]], 0b110), [1, 2]);
  assert.deepEqual(viaLayoutChoices(["A", ["Layer", "x", "y", "z"]], 0b011), [0, 0]);
});

test("layout choices pack back into the bitfield and round-trip", () => {
  const labels = ["A", ["Layer", "x", "y", "z"], "C"];
  assert.equal(viaPackLayoutChoices(["Split"], [1]), 1);
  for (const choices of [[0, 0, 0], [1, 2, 1], [1, 1, 0], [0, 2, 1]]) {
    assert.deepEqual(viaLayoutChoices(labels, viaPackLayoutChoices(labels, choices)), choices);
  }
  assert.equal(viaPackLayoutChoices(["A", ["Layer", "x", "y", "z"]], [99, 99]), 0b110);
  assert.equal(viaPackLayoutChoices(["A"], []), 0);
  assert.deepEqual(viaUint32Bytes(0x01020304), [1, 2, 3, 4]);
});

test("a v2 definition names its lighting instead of listing menus, and the QMK names become controls", () => {
  const v2 = (lighting: unknown) => parseViaDefinition({ ...SERVED, menus: undefined, lighting });
  const glow = parseViaMenus(v2("qmk_rgblight").menus)[0]!.sections[0]!.items;
  assert.deepEqual(glow.map((item) => item.ids), [[2, 1], [2, 2], [2, 3], [2, 4]]);
  assert.equal(glow[1]!.control.type === "dropdown" && glow[1]!.control.options.length, 43);
  assert.deepEqual(parseViaMenus(v2("qmk_backlight").menus)[0]!.sections.map((section) => section.label), ["Backlight"]);
  assert.deepEqual(parseViaMenus(v2("qmk_backlight_rgblight").menus)[0]!.sections.map((section) => section.label), ["Backlight", "Underglow"]);
  for (const lighting of ["none", { extends: "none" }, undefined]) assert.deepEqual(v2(lighting).menus, []);
});

test("a definition keeps encoders and rotated keys, and malformed ones are rejected", () => {
  const encoder = { row: -1, col: -1, ei: 0, x: 3, y: 0, r: 15, rx: 3, ry: 0, d: false, h: 1, w: 1 };
  const def = parseViaDefinition({ ...SERVED, layouts: { ...SERVED.layouts, keys: [...SERVED.layouts.keys, encoder] } });
  assert.equal(def.keys.length, 3);
  assert.deepEqual(def.keys.find((key) => key.encoder === 0), { row: -1, col: -1, x: 3, y: 0, w: 1, h: 1, r: 15, rx: 3, ry: 0, encoder: 0 });
  assert.throws(() => parseViaDefinition("nope"), /must be an object/);
  assert.throws(() => parseViaDefinition({ ...SERVED, vendorProductId: "0xFEED" }), /vendorProductId/);
  assert.throws(() => parseViaDefinition({ ...SERVED, layouts: {} }), /layouts\.keys/);
  assert.throws(() => parseViaDefinition({ ...SERVED, layouts: { ...SERVED.layouts, keys: [], optionKeys: {} } }), /no keys/);
  assert.throws(() => parseViaDefinition({ ...SERVED, matrix: { rows: 0, cols: 3 } }), /matrix/);
});

const label = (code: number, protocol: number): string => describeViaKeycode(code, protocol).label;

test("basic keycodes keep their names across protocol generations", () => {
  for (const protocol of [9, 12]) {
    assert.equal(label(0x04, protocol), "A");
    assert.equal(label(0x27, protocol), "0");
    assert.equal(label(0x28, protocol), "Enter");
    assert.equal(label(0xe1, protocol), "LShift");
    assert.equal(label(0x0001, protocol), "▽");
    assert.equal(label(0x00f0, protocol), "0x00F0");
  }
});

test("modifier combinations and mod-tap follow each generation's base", () => {
  assert.equal(label(0x0204, 9), "Shift+A");
  assert.equal(label(0x1104, 12), "RCtrl+A");
  assert.equal(label(0x6104, 9), "A · Ctrl");
  assert.equal(label(0x2104, 12), "A · Ctrl");
  assert.equal(label(0x2104, 9), "0x2104");
  assert.equal(label(0x4204, 9), "LT(2) A");
});

test("layer keys resolve only in the generation that defines them", () => {
  assert.equal(label(0x5102, 9), "MO(2)");
  assert.equal(label(0x5222, 12), "MO(2)");
  assert.equal(label(0x5222, 9), "0x5222");
  assert.equal(label(0x5012, 9), "TO(2)");
  assert.equal(label(0x5002, 10), "TO(2)");
  assert.equal(label(0x5002, 9), "0x5002");
  assert.equal(label(0x5262, 12), "TG(2)");
  assert.equal(label(0x52a2, 12), "OSM Shift");
});

test("macro keys sit at each generation's own base and the picker offers one per macro slot", () => {
  assert.equal(label(0x7702, 11), "M0");
  assert.equal(label(0x7700, 12), "M0");
  assert.equal(label(0x7711, 11), "M15");
  assert.equal(label(0x770f, 12), "M15");
  assert.equal(label(0x7712, 11), "0x7712");
  assert.equal(label(0x5f12, 9), "M0");
  assert.equal(label(0x5f12, 12), "0x5F12");
  const macros = viaKeycodePicker(12, 3, 4).find((group) => group.id === "macros")!;
  assert.deepEqual(macros.keycodes, [0x7700, 0x7701, 0x7702, 0x7703]);
  assert.deepEqual(viaKeycodePicker(11, 3, 2).find((group) => group.id === "macros")!.keycodes, [0x7702, 0x7703]);
  assert.equal(viaKeycodePicker(9, 3, 40).find((group) => group.id === "macros")!.keycodes.length, 16);
  assert.equal(viaKeycodePicker(12, 3).find((group) => group.id === "macros")!.keycodes.length, 0);
});

test("every picker keycode has a real name and layer keys follow the layer count", () => {
  for (const protocol of [9, 12]) {
    const groups = viaKeycodePicker(protocol, 3);
    for (const group of groups) {
      for (const code of group.keycodes) {
        assert.ok(!describeViaKeycode(code, protocol).label.startsWith("0x"), `${group.id} 0x${code.toString(16)} at protocol ${protocol}`);
      }
    }
    assert.equal(groups.find((group) => group.id === "letters")!.keycodes.length, 26);
    assert.equal(groups.find((group) => group.id === "layers")!.keycodes.length, 15);
  }
  assert.equal(viaKeycodePicker(12, 0).find((group) => group.id === "layers")!.keycodes.length, 0);
  assert.equal(viaKeycodePicker(12, 40).find((group) => group.id === "layers")!.keycodes.length, 160);
});

const bytes = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

test("a macro decodes into text, key actions and delays", () => {
  const stream = [...bytes("hi"), 1, 1, 0x28, 1, 2, 0xe1, ...bytes("a"), 1, 3, 0xe1, 1, 4, ...bytes("100"), 0x7c];
  assert.deepEqual(decodeViaMacro(stream), [
    { type: "text", text: "hi" },
    { type: "tap", keycode: 0x28 },
    { type: "down", keycode: 0xe1 },
    { type: "text", text: "a" },
    { type: "up", keycode: 0xe1 },
    { type: "delay", ms: 100 },
  ]);
});

test("encoding gives back the same bytes, and anything unknown survives untouched", () => {
  const streams = [
    [...bytes("hello world"), 1, 1, 0x28],
    [1, 4, ...bytes("0"), 0x7c, ...bytes("x")],
    [...bytes("ab"), 0x80, 0x81, ...bytes("cd")],
    [1, 5, 0x04, 0x07, ...bytes("tail")],
    [1, 4, ...bytes("0100"), 0x7c],
    [1, 4, ...bytes("12"), ...bytes("ab")],
    [],
  ];
  for (const stream of streams) assert.deepEqual(encodeViaMacro(decodeViaMacro(stream), 11), stream);
  assert.deepEqual(decodeViaMacro([1, 5, 4, 3, 7]), [{ type: "raw", bytes: [1, 5, 4, 3, 7] }]);
});

test("encoding validates what the board can store", () => {
  assert.deepEqual(encodeViaMacro([{ type: "delay", ms: 250 }], 11), [1, 4, 0x32, 0x35, 0x30, 0x7c]);
  assert.throws(() => encodeViaMacro([{ type: "delay", ms: 250 }], 10), /protocol 11/);
  assert.throws(() => encodeViaMacro([{ type: "delay", ms: 10000 }], 11), RangeError);
  assert.throws(() => encodeViaMacro([{ type: "delay", ms: -1 }], 11), RangeError);
  assert.throws(() => encodeViaMacro([{ type: "tap", keycode: 0x100 }], 11), RangeError);
  assert.throws(() => encodeViaMacro([{ type: "tap", keycode: 0 }], 11), RangeError);
  assert.throws(() => encodeViaMacro([{ type: "text", text: "café" }], 11), /ASCII/);
  assert.throws(() => encodeViaMacro([{ type: "raw", bytes: [0] }], 11), RangeError);
  assert.deepEqual(encodeViaMacro([{ type: "text", text: "a\tb\n" }], 9), [0x61, 9, 0x62, 10]);
  assert.deepEqual(encodeViaMacro([{ type: "tap", keycode: 4 }], 9), [1, 4]);
});

test("QMK names map to keycodes, with aliases and any letter case", () => {
  assert.equal(viaKeycodeFromName("KC_A"), 0x04);
  assert.equal(viaKeycodeFromName("kc_0"), 0x27);
  assert.equal(viaKeycodeFromName("KC_ENT"), 0x28);
  assert.equal(viaKeycodeFromName("KC_ENTER"), 0x28);
  assert.equal(viaKeycodeFromName("KC_F24"), 0x73);
  assert.equal(viaKeycodeFromName("KC_LCTL"), 0xe0);
  assert.equal(viaKeycodeFromName("KC_LOPT"), 0xe2);
  assert.equal(viaKeycodeFromName("KC_MUTE"), 0xa8);
  assert.equal(viaKeycodeFromName("KC_P0"), 0x62);
  assert.equal(viaKeycodeFromName("KC_PEQL"), 0x67);
  assert.equal(viaKeycodeFromName("KC_INT9"), 0x8f);
  assert.equal(viaKeycodeFromName("KC_LNG1"), 0x90);
  assert.equal(viaKeycodeFromName("KC_NOPE"), null);
  assert.equal(viaKeycodeName(0x28), "KC_ENT");
  assert.equal(viaKeycodeName(0xf0), null);
});

test("every keycode row has a unique code and names, all within one byte", () => {
  const codes = new Set<number>();
  const names = new Set<string>();
  for (const { code, title, label, names: spellings } of VIA_BASIC_KEYCODES) {
    assert.ok(code >= 1 && code <= 0xff, `code ${code}`);
    assert.ok(!codes.has(code), `duplicate code ${code}`);
    assert.ok(title && label, `code ${code} needs a title and a label`);
    codes.add(code);
    for (const name of spellings) {
      assert.ok(!names.has(name), `duplicate name ${name}`);
      names.add(name);
      assert.equal(viaKeycodeFromName(name), code);
    }
  }
  assert.equal(codes.size, VIA_BASIC_KEYCODES.length);
});

test("an expression reads as text, key presses, chords, holds and waits", () => {
  assert.deepEqual(parseViaMacroExpression("hi{KC_ENT}", 11), [{ type: "text", text: "hi" }, { type: "tap", keycode: 0x28 }]);
  assert.deepEqual(parseViaMacroExpression("{KC_LCTL,KC_C}", 11), [
    { type: "down", keycode: 0xe0 }, { type: "down", keycode: 0x06 }, { type: "up", keycode: 0x06 }, { type: "up", keycode: 0xe0 },
  ]);
  assert.deepEqual(parseViaMacroExpression("{+KC_LSFT}ab{-KC_LSFT}{ 250 }", 11), [
    { type: "down", keycode: 0xe1 }, { type: "text", text: "ab" }, { type: "up", keycode: 0xe1 }, { type: "delay", ms: 250 },
  ]);
  assert.deepEqual(parseViaMacroExpression("a\\{b\\\\c}d", 11), [{ type: "text", text: "a{b\\c}d" }]);
  assert.deepEqual(parseViaMacroExpression("{raw:1,5,4}", 11), [{ type: "raw", bytes: [1, 5, 4] }]);
  assert.deepEqual(encodeViaMacro(parseViaMacroExpression("hi{KC_ENT}", 11), 11), [0x68, 0x69, 1, 1, 0x28]);
});

test("mistakes in an expression name what is wrong and where", () => {
  const problem = (expression: string, protocol = 11): ViaMacroExpressionError => {
    try { parseViaMacroExpression(expression, protocol); } catch (error) { return error as ViaMacroExpressionError; }
    throw new Error(`"${expression}" was accepted`);
  };
  assert.match(problem("ab{KC_FOO}").message, /Unknown keycode "KC_FOO"/);
  assert.equal(problem("ab{KC_FOO}").index, 2);
  assert.match(problem("ab{KC_A").message, /no closing/);
  assert.match(problem("{}").message, /empty/);
  assert.match(problem("{10000}").message, /0 to 9999/);
  assert.match(problem("{100}", 10).message, /protocol 11/);
  assert.match(problem("café").message, /ASCII/);
  assert.equal(problem("café").index, 3);
  assert.match(problem("{raw:0}").message, /1 to 255/);
});

test("actions written as an expression read back to the same actions", () => {
  const sequences = [
    parseViaMacroExpression("Hello, world!{KC_ENT}", 11),
    parseViaMacroExpression("{KC_LCTL,KC_LSFT,KC_ESC}", 11),
    parseViaMacroExpression("{+KC_LSFT}abc{-KC_LSFT}{500}{KC_TAB}", 11),
    parseViaMacroExpression("brace \\{ and slash \\\\ and \\n", 11),
    parseViaMacroExpression("{raw:1,5,4,7}text", 11),
  ];
  for (const actions of sequences) assert.deepEqual(parseViaMacroExpression(viaMacroToExpression(actions), 11), actions);
  assert.equal(viaMacroToExpression([{ type: "down", keycode: 0x04 }, { type: "up", keycode: 0x04 }]), "{KC_A}");
  assert.equal(viaMacroToExpression([{ type: "tap", keycode: 0xf0 }]), "{raw:1,1,240}");
  assert.equal(viaMacroToExpression([{ type: "down", keycode: 0xe0 }, { type: "down", keycode: 0x06 }, { type: "up", keycode: 0xe0 }]), "{+KC_LCTL}{+KC_C}{-KC_LCTL}");
  assert.equal(viaMacroToExpression([{ type: "text", text: "a{b\\" }]), "a\\{b\\\\");
});

const MENUS = [
  {
    label: "Lighting",
    content: [
      {
        label: "Backlight",
        content: [
          { label: "Brightness", type: "range", options: [0, 255], content: ["id_brightness", 3, 1] },
          { label: "Effect", type: "dropdown", options: ["All Off", "Solid", ["Wave", 5]], content: ["id_effect", 3, 2] },
          { label: "Speed", type: "range", showIf: "{id_effect} != 0", content: ["id_speed", 3, 3] , options: [0, 255] },
          { label: "Color", type: "color", showIf: "{id_effect} != 0 && {id_effect} != 24", content: ["id_color", 3, 4] },
          { label: "Static text", content: "just words" },
          { showIf: "{id_effect} == 1", content: [{ label: "Pulse", type: "toggle", content: ["id_pulse", 3, 5] }] },
          { label: "Reset", type: "button", options: [7], content: ["id_reset", 3, 6] },
          { label: "Pick", type: "keycode", content: ["id_pick", 3, 7] },
        ],
      },
    ],
  },
  { label: "Empty", content: [{ label: "Nothing", content: [{ label: "Words", content: "x" }] }] },
];

test("menus parse into typed controls, folding group conditions and dropping what cannot be driven", () => {
  const menus = parseViaMenus(MENUS);
  assert.equal(menus.length, 1);
  const [section] = menus[0]!.sections;
  assert.equal(section!.label, "Backlight");
  assert.deepEqual(section!.items.map((item) => [item.label, item.control.type]), [
    ["Brightness", "range"], ["Effect", "dropdown"], ["Speed", "range"], ["Color", "color"], ["Pulse", "toggle"], ["Reset", "button"],
  ]);
  const effect = section!.items[1]!;
  assert.deepEqual(effect.ids, [3, 2]);
  assert.deepEqual(effect.control, { type: "dropdown", options: [{ label: "All Off", value: 0 }, { label: "Solid", value: 1 }, { label: "Wave", value: 5 }] });
  assert.equal(section!.items[4]!.showIf, "{id_effect} == 1");
  assert.deepEqual(section!.items[4]!.control, { type: "toggle", off: 0, on: 1 });
  assert.deepEqual(section!.items[5]!.control, { type: "button", value: 7 });
});

test("showIf expressions follow the definition's current values", () => {
  const values = (effect: number) => (token: string): number | undefined => (token === "id_effect" ? effect : undefined);
  assert.equal(evaluateViaCondition("{id_effect} != 0", values(0)), false);
  assert.equal(evaluateViaCondition("{id_effect} != 0", values(3)), true);
  assert.equal(evaluateViaCondition("{id_effect} != 0 && {id_effect} != 24", values(24)), false);
  assert.equal(evaluateViaCondition("({id_effect} == 1 || {id_effect} == 2) && !({id_effect} == 2)", values(1)), true);
  assert.equal(evaluateViaCondition("{id_effect} >= 2", values(1)), false);
  assert.equal(evaluateViaCondition("{unknown} == 0", values(1)), true);
});

test("an expression that cannot be parsed shows the control", () => {
  assert.equal(evaluateViaCondition("{a} ===", () => 1), true);
  assert.equal(evaluateViaCondition("{a} != 0 )", () => 0), true);
  assert.equal(evaluateViaCondition("window.alert(1)", () => 0), true);
});

test("values convert between bytes and numbers big-endian", () => {
  assert.equal(viaValueToNumber([1, 2]), 258);
  assert.deepEqual(viaNumberToBytes(258, 2), [1, 2]);
  assert.deepEqual(viaNumberToBytes(7, 1), [7]);
  assert.throws(() => viaNumberToBytes(256, 1), RangeError);
});

test("lighting keycodes follow the protocol generation and the definition modules", () => {
  assert.deepEqual(viaLightingKeycodes(11, ["qmk_rgblight_keycodes"]).slice(0, 2), [0x7820, 0x7821]);
  assert.equal(describeViaKeycode(0x7820, 11).title, "RGB toggle");
  assert.equal(describeViaKeycode(0x5cc2, 9).title, "RGB toggle");
  assert.equal(describeViaKeycode(0x7840, 12).title, "Matrix on");
  assert.equal(describeViaKeycode(0x7820, 13).title, "Underglow toggle");
  assert.equal(describeViaKeycode(0x7802, 11).title, "Backlight toggle");
  assert.deepEqual(viaLightingKeycodes(11, ["qmk_rgb_matrix_keycodes"]).length, 20);
  assert.equal(viaLightingKeycodes(12, ["qmk_rgb_matrix_keycodes"]).length, 20);
  assert.equal(viaLightingKeycodes(13, ["qmk_rgb_matrix_keycodes"]).length, 13);
  assert.deepEqual(viaLightingKeycodes(11, []), []);
});

test("custom keycodes start where the protocol puts them and show in the picker", () => {
  const custom = [{ name: "MY_KEY", title: "Does a thing", shortName: "MK" }];
  assert.equal(describeViaKeycode(0x7f00, 11, custom).label, "MK");
  assert.equal(describeViaKeycode(0x7e00, 12, custom).title, "Does a thing");
  assert.equal(describeViaKeycode(0x5f80, 9, custom).label, "MK");
  assert.equal(describeViaKeycode(0x7f01, 11, custom).label, "0x7F01");
  const ids = viaKeycodePicker(11, 4, 0, { custom }).map((group) => group.id);
  assert.ok(ids.includes("custom"));
  assert.ok(!viaKeycodePicker(11, 4).some((group) => group.id === "custom" || group.id === "lighting"));
});

test("composed keycodes round-trip through the describer", () => {
  assert.equal(viaComposeKeycode({ kind: "layerTap", layer: 2, key: 0x2c }, 11), 0x422c);
  assert.equal(viaComposeKeycode({ kind: "modTap", mods: VIA_MOD.ctrl, key: 0x04 }, 11), 0x2104);
  assert.equal(viaComposeKeycode({ kind: "modTap", mods: VIA_MOD.ctrl, key: 0x04 }, 9), 0x6104);
  assert.equal(viaComposeKeycode({ kind: "mods", mods: VIA_MOD.ctrl | VIA_MOD.shift, key: 0x06 }, 11), 0x0306);
  assert.equal(describeViaKeycode(0x422c, 11).label, "LT(2) Space");
  assert.throws(() => viaComposeKeycode({ kind: "mods", mods: 0, key: 4 }, 11), RangeError);
  assert.throws(() => viaComposeKeycode({ kind: "layerTap", layer: 16, key: 4 }, 11), RangeError);
});

test("host key events map to basic keycodes and back", () => {
  assert.equal(viaKeycodeFromEventCode("KeyA"), 0x04);
  assert.equal(viaKeycodeFromEventCode("Digit0"), 0x27);
  assert.equal(viaKeycodeFromEventCode("Numpad1"), 0x59);
  assert.equal(viaKeycodeFromEventCode("F12"), 0x45);
  assert.equal(viaKeycodeFromEventCode("F13"), 0x68);
  assert.equal(viaKeycodeFromEventCode("MetaRight"), 0xe7);
  assert.equal(viaKeycodeFromEventCode("MediaPlay"), null);
  assert.equal(viaEventCodeFromKeycode(0x2c), "Space");
});

test("layout-file names round-trip for every keycode family", () => {
  for (const [protocol, code] of [[11, 0x04], [11, 0x5220 + 2], [11, 0x422c], [11, 0x2104], [9, 0x6104], [11, 0x0306], [11, 0x7820], [11, 0x7f01], [11, 0x0000], [11, 0x0a04]] as const) {
    const name = viaKeycodeToLayoutName(code, protocol);
    assert.equal(viaKeycodeFromLayoutName(name, protocol), code, name);
  }
  assert.equal(viaKeycodeToLayoutName(0x5222, 11), "MO(2)");
  assert.equal(viaKeycodeToLayoutName(0x422c, 11), "LT(2,KC_SPC)");
  assert.equal(viaKeycodeToLayoutName(0x0306, 11), "LCTL(LSFT(KC_C))");
  assert.equal(viaKeycodeFromLayoutName("MT(MOD_LCTL | MOD_LSFT,KC_A)", 11), 0x2304);
  assert.equal(viaKeycodeFromLayoutName("NOT_A_KEY", 11), null);
});

test("matrix boards get the shared RGB codes up to protocol 12 and their own RM codes from 13", () => {
  const modules = ["qmk_rgb_matrix_keycodes"];
  assert.ok(viaLightingKeycodes(12, modules).includes(0x7820));
  assert.ok(!viaLightingKeycodes(12, modules).includes(0x7842));
  assert.ok(viaLightingKeycodes(13, modules).includes(0x7842));
});

test("the macro keys start at 0x7702 on protocol 11 and at 0x7700 from protocol 12", () => {
  assert.equal(viaKeycodeFromLayoutName("MACRO(2)", 11), 0x7704);
  assert.equal(viaKeycodeFromLayoutName("MACRO(2)", 12), 0x7702);
  assert.equal(viaKeycodeFromLayoutName("MACRO(16)", 11), null);
  assert.equal(viaKeycodeToLayoutName(0x7700, 12), "MACRO(0)");
  assert.equal(describeViaKeycode(0x7700, 12).label, "M0");
});

test("layout names cover no-op, transparent, macro and custom keys the way VIA files write them", () => {
  for (const protocol of [10, 11, 12]) {
    assert.equal(viaKeycodeFromLayoutName("KC_NO", protocol), 0);
    assert.equal(viaKeycodeFromLayoutName("KC_TRNS", protocol), 1);
    assert.equal(viaKeycodeToLayoutName(0, protocol), "KC_NO");
    assert.equal(viaKeycodeToLayoutName(1, protocol), "KC_TRNS");
    assert.equal(viaKeycodeFromLayoutName(viaKeycodeToLayoutName(viaKeycodeFromLayoutName("MACRO(3)", protocol)!, protocol), protocol), viaKeycodeFromLayoutName("MACRO(3)", protocol));
  }
  assert.equal(viaKeycodeFromLayoutName("CUSTOM(2)", 11), 0x7f02);
  assert.equal(viaKeycodeFromLayoutName("CUSTOM(2)", 12), 0x7e02);
  assert.equal(viaKeycodeFromLayoutName("CUSTOM(2)", 9), 0x5f82);
});

test("protocol 10 and older macros store a key action as two bytes without the prefix", () => {
  const actions = [{ type: "tap", keycode: 4 }, { type: "down", keycode: 0xe1 }, { type: "up", keycode: 0xe1 }] as const;
  assert.deepEqual(encodeViaMacro(actions, 10), [1, 4, 2, 0xe1, 3, 0xe1]);
  assert.deepEqual(decodeViaMacro([1, 4, 2, 0xe1, 3, 0xe1], 10), actions);
  assert.deepEqual(decodeViaMacro([0x68, 0x69, 1, 4], 10), [{ type: "text", text: "hi" }, { type: "tap", keycode: 4 }]);
  assert.deepEqual(encodeViaMacro(actions, 11), [1, 1, 4, 1, 2, 0xe1, 1, 3, 0xe1]);
  assert.equal(viaMacroToExpression([{ type: "tap", keycode: 0xfe }], 10), "{raw:1,254}");
  assert.equal(viaMacroToExpression([{ type: "tap", keycode: 0xfe }]), "{raw:1,1,254}");
});

test("a range or button wider than a byte is read as two bytes when the definition omits the width", () => {
  const item = (entry: Record<string, unknown>) => parseViaMenus([{ label: "M", content: [{ label: "X", content: ["id_x", 3, 1], ...entry }] }])[0]!.sections[0]!.items[0]!;
  assert.equal(item({ type: "range", options: [0, 255] }).bytes, 1);
  assert.equal(item({ type: "range", options: [0, 1000] }).bytes, 2);
  assert.equal(item({ type: "range", options: [0, 1000], bytes: 1 }).bytes, 1);
  assert.equal(item({ type: "button", options: 300 }).bytes, 2);
});

test("layout files from older QMK spell some keys differently and shorten the modifier wrappers", () => {
  assert.equal(viaKeycodeFromLayoutName("KC_SLCK", 11), 0x47);
  assert.equal(viaKeycodeFromLayoutName("KC_NLCK", 11), 0x53);
  assert.deepEqual(["KC_RO", "KC_KANA", "KC_JYEN", "KC_HENK", "KC_MHEN"].map((name) => viaKeycodeFromLayoutName(name, 11)), [0x87, 0x88, 0x89, 0x8a, 0x8b]);
  assert.equal(viaKeycodeFromLayoutName("KC_LANG1", 11), 0x90);
  assert.equal(viaKeycodeToLayoutName(0x87, 11), "KC_INT1");
  assert.equal(viaKeycodeFromLayoutName("C(KC_A)", 11), 0x0104);
  assert.equal(viaKeycodeFromLayoutName("S(KC_1)", 11), 0x021e);
  assert.equal(viaKeycodeFromLayoutName("MEH(KC_A)", 11), 0x0704);
  assert.equal(viaKeycodeFromLayoutName("HYPR(KC_A)", 11), 0x0f04);
  assert.equal(viaKeycodeFromLayoutName("LCTL(KC_A)", 11), 0x0104);
  assert.equal(viaKeycodeFromLayoutName("RALT(KC_A)", 11), 0x1404);
});

test("v2 lighting items carry the single value id old firmware expects", () => {
  const items = parseViaMenus(parseViaDefinition({ ...SERVED, menus: undefined, lighting: "qmk_backlight_rgblight" }).menus).flatMap((menu) => menu.sections.flatMap((section) => section.items));
  assert.deepEqual(items.map((item) => item.legacyId), [0x09, 0x0a, 0x80, 0x81, 0x82, 0x83]);
  assert.deepEqual(items.map((item) => item.ids), [[1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [2, 4]]);
  assert.equal(parseViaMenus([{ label: "M", content: [{ label: "X", type: "toggle", content: ["id_x", 3, 1] }] }])[0]!.sections[0]!.items[0]!.legacyId, undefined);
});

test("a definition whose keys all sit in layout options still loads", () => {
  const layouts = { ...SERVED.layouts, width: undefined, height: undefined, keys: [] };
  const def = parseViaDefinition({ ...SERVED, layouts });
  assert.equal(def.keys.length, 0);
  assert.equal(viaActiveKeys(def, [1]).length, 1);
  assert.equal(def.width, 4);
  assert.throws(() => parseViaDefinition({ ...SERVED, layouts: { ...layouts, optionKeys: {} } }), /no keys/);
});

test("the picker offers every layer a board can have and every macro key of the protocol generation", () => {
  assert.equal(viaKeycodePicker(12, 32).find((group) => group.id === "layers")!.keycodes.length, 32 * 5);
  assert.equal(viaKeycodePicker(12, 3, 40).find((group) => group.id === "macros")!.keycodes.length, 40);
  assert.equal(viaKeycodePicker(11, 3, 40).find((group) => group.id === "macros")!.keycodes.length, 16);
});

test("a v2 definition keeps its customMenus after the lighting menus", () => {
  const custom = [{ label: "Extra", content: [{ label: "Mode", content: [{ label: "Level", type: "range", options: [0, 9], content: ["id_level", 0, 1] }] }] }];
  const menus = parseViaMenus(parseViaDefinition({ ...SERVED, menus: undefined, lighting: "qmk_backlight", customMenus: custom }).menus);
  assert.deepEqual(menus.map((menu) => menu.label), ["Lighting", "Extra"]);
});

test("object-form v2 lighting extends a preset and applies its overrides", () => {
  const lighting = {
    extends: "qmk_backlight_rgblight",
    effects: [["Off", 0], ["On", 0], ["Pulse", 0]],
    underglowEffects: [["All Off", 0], ["Solid", 1], ["Rainbow", 0]],
    supportedLightingValues: [9, 10, 128, 129, 131],
  };
  const sections = parseViaMenus(parseViaDefinition({ ...SERVED, menus: undefined, lighting }).menus)[0]!.sections;
  assert.deepEqual(sections.map((section) => section.label), ["Backlight", "Underglow"]);
  const items = sections.flatMap((section) => section.items);
  assert.deepEqual(items.map((item) => item.legacyId), [0x09, 0x0a, 0x80, 0x81, 0x83]);
  const effect = items.find((item) => item.legacyId === 0x81)!.control;
  assert.deepEqual(effect.type === "dropdown" ? effect.options.map((option) => option.label) : [], ["All Off", "Solid", "Rainbow"]);
  assert.equal(items.find((item) => item.legacyId === 0x83)!.showIf, "{id_qmk_rgblight_effect} != 0 && {id_qmk_rgblight_effect} != 2");
});

test("Wilba Tech lighting names become controls on VIA's own value ids", () => {
  const items = (lighting: unknown) => parseViaMenus(parseViaDefinition({ ...SERVED, menus: undefined, lighting }).menus)[0]!.sections.flatMap((section) => section.items);
  const rgb = items("wt_rgb_backlight");
  assert.deepEqual(rgb.map((item) => item.legacyId), [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x07, 0x08, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15]);
  const effect = rgb[1]!.control;
  assert.deepEqual(effect.type === "dropdown" ? effect.options.length : 0, 11);
  assert.deepEqual(rgb[2]!.control, { type: "range", min: 0, max: 3 });
  // Colour 1 is hidden for effects that use no colour, colour 2 for effects that use fewer than two.
  assert.equal(rgb[3]!.showIf, "{id_wt_backlight_effect} != 0 && {id_wt_backlight_effect} != 5 && {id_wt_backlight_effect} != 6 && {id_wt_backlight_effect} != 7 && {id_wt_backlight_effect} != 8 && {id_wt_backlight_effect} != 9");
  assert.equal(rgb[4]!.showIf!.includes("!= 1 "), true);
  // Row/column indicators are two bytes, off at 255,255 and on at 254,254.
  assert.deepEqual(rgb[8]!.control, { type: "toggle", off: 0xffff, on: 0xfefe, anyOn: true });
  assert.equal(rgb[8]!.bytes, 2);

  const mono = items("wt_mono_backlight");
  assert.deepEqual(mono.map((item) => item.legacyId), [0x09, 0x0a, 0x0b, 0x07, 0x08]);
  assert.equal(mono.some((item) => item.control.type === "color"), false);

  const custom = items({ extends: "wt_rgb_backlight", effects: [["All Off", 0], ["Solid", 1], ["Pair", 2]], supportedLightingValues: [9, 10, 12, 13] });
  assert.deepEqual(custom.map((item) => item.legacyId), [0x09, 0x0a, 0x0c, 0x0d]);
  assert.equal(custom[2]!.showIf, "{id_wt_backlight_effect} != 0");
  assert.equal(custom[3]!.showIf, "{id_wt_backlight_effect} != 0 && {id_wt_backlight_effect} != 1");
  assert.deepEqual(parseViaDefinition({ ...SERVED, menus: undefined, lighting: { extends: "wt_rgb_backlight", supportedLightingValues: [] } }).menus, []);
});

test("a Wilba Tech effect with many colours edits them as custom colour slots", () => {
  const lighting = { extends: "wt_rgb_backlight", effects: [["All Off", 0], ["Solid", 1], ["Custom", 4]], supportedLightingValues: [9, 10, 12, 13, 23] };
  const items = parseViaMenus(parseViaDefinition({ ...SERVED, menus: undefined, lighting }).menus)[0]!.sections.flatMap((section) => section.items);
  assert.deepEqual(items.map((item) => item.legacyId), [0x09, 0x0a, 0x0c, 0x0d, 0x17, 0x17, 0x17, 0x17]);
  // The slot follows the value id on the wire, and the plain colours step aside for the many-colour effect.
  assert.deepEqual(items.slice(4).map((item) => item.ids), [[0, 0x17, 0], [0, 0x17, 1], [0, 0x17, 2], [0, 0x17, 3]]);
  assert.equal(items[2]!.showIf, "{id_wt_backlight_effect} != 0 && {id_wt_backlight_effect} != 2");
  assert.equal(items[4]!.showIf, "{id_wt_backlight_effect} != 0 && {id_wt_backlight_effect} != 1");
  assert.equal(items[7]!.showIf, "{id_wt_backlight_effect} != 0 && {id_wt_backlight_effect} != 1");
  // Without the custom colour id there are no slots.
  const plain = { ...lighting, supportedLightingValues: [9, 10, 12, 13] };
  assert.equal(parseViaMenus(parseViaDefinition({ ...SERVED, menus: undefined, lighting: plain }).menus)[0]!.sections[0]!.items.length, 4);
});

test("a v2 definition's lighting name brings its lighting keycodes", () => {
  const modules = (lighting: unknown) => parseViaDefinition({ ...SERVED, keycodes: undefined, menus: undefined, lighting }).keycodeModules;
  assert.deepEqual(modules("wt_mono_backlight"), ["wt_keycodes"]);
  assert.deepEqual(modules({ extends: "wt_rgb_backlight" }), ["wt_keycodes"]);
  assert.deepEqual(modules("qmk_backlight_rgblight"), ["qmk_backlight_rgblight_keycodes"]);
  assert.deepEqual(modules("none"), []);
  assert.deepEqual(parseViaDefinition({ ...SERVED, keycodes: ["qmk_lighting"] }).keycodeModules, ["qmk_lighting"]);
  const wt = viaLightingKeycodes(9, ["wt_keycodes"]);
  assert.deepEqual([wt[0], wt[1], wt.length], [0x5f00, 0x5f01, 14]);
  assert.equal(viaKeycodeToLayoutName(0x5f00, 9), "BR_INC");
  assert.equal(viaKeycodeFromLayoutName("S2_DEC", 9), 0x5f0d);
  // Newer firmware has no such keys, so they are not offered there.
  assert.deepEqual(viaLightingKeycodes(11, ["wt_keycodes"]), []);
});

test("TO holds 16 layers before protocol 10, so layer 16 and up is not offered, parsed or described as TO", () => {
  const toKeys = (protocol: number, layers: number) => viaKeycodePicker(protocol, layers).find((group) => group.id === "layers")!.keycodes.filter((code) => code >= 0x5000 && code < 0x5100);
  assert.deepEqual(toKeys(9, 20), Array.from({ length: 16 }, (_, index) => 0x5010 + index));
  assert.equal(viaKeycodeFromLayoutName("TO(15)", 9), 0x501f);
  assert.equal(viaKeycodeFromLayoutName("TO(16)", 9), null);
  assert.equal(viaKeycodeToLayoutName(0x5020, 9), "0x5020");
  assert.equal(describeViaKeycode(0x5020, 9).label, "0x5020");
  assert.equal(viaKeycodeFromLayoutName("MO(16)", 9), 0x5110);
  assert.equal(toKeys(10, 20).length, 20);
  assert.equal(viaKeycodeFromLayoutName("TO(31)", 10), 0x501f);
});

test("without a stated size, the board is as wide as its widest layout option", () => {
  const def = parseViaDefinition({ ...SERVED, layouts: { ...SERVED.layouts, width: undefined, height: undefined } });
  assert.equal(def.width, 4);
  assert.equal(def.height, 2);
});

test("a toggle given as byte arrays keeps its off and on values and is two bytes wide", () => {
  const item = (options: unknown) => parseViaMenus([{ label: "M", content: [{ label: "X", type: "toggle", options, content: ["id_x", 3, 1] }] }])[0]!.sections[0]!.items[0]!;
  const wide = item([[0, 0], [0, 1]]);
  assert.deepEqual(wide.control, { type: "toggle", off: 0, on: 1 });
  assert.equal(wide.bytes, 2);
  assert.deepEqual(item([[1, 0], [0, 0]]).control, { type: "toggle", off: 256, on: 0 });
  assert.equal(item([0, 1]).bytes, 1);
  assert.deepEqual(item(undefined).control, { type: "toggle", off: 0, on: 1 });
});

test("one-shot modifiers read and write as OSM(MOD_...)", () => {
  assert.equal(viaKeycodeFromLayoutName("OSM(MOD_LCTL)", 11), 0x52a1);
  assert.equal(viaKeycodeFromLayoutName("OSM(MOD_LCTL | MOD_LSFT)", 11), 0x52a3);
  assert.equal(viaKeycodeFromLayoutName("OSM(MOD_RALT)", 11), 0x52b4);
  assert.equal(viaKeycodeFromLayoutName("OSM(MOD_LCTL)", 9), 0x5501);
  assert.equal(viaKeycodeFromLayoutName("OSM(NOPE)", 11), null);
  for (const [code, protocol] of [[0x52a1, 11], [0x52a3, 12], [0x52b4, 11], [0x5501, 9]] as const) {
    assert.equal(viaKeycodeFromLayoutName(viaKeycodeToLayoutName(code, protocol), protocol), code);
  }
  assert.equal(viaKeycodeToLayoutName(0x52a1, 11), "OSM(MOD_LCTL)");
});

test("a modifier combo needs a real modifier, not only the right-hand selector", () => {
  assert.throws(() => viaComposeKeycode({ kind: "mods", mods: VIA_MOD.right, key: 4 }, 11), RangeError);
  assert.doesNotThrow(() => viaComposeKeycode({ kind: "mods", mods: VIA_MOD.right | VIA_MOD.ctrl, key: 4 }, 11));
});
