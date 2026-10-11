import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { KOCHI_COMMAND, decodeKochiModeAck, decodeKochiModeQuery, decodeKochiName, encodeKochiCommand, kochiReplyPayload } from "./index.ts";

const captures: { command: number; request: string; reply: string }[] = JSON.parse(readFileSync(new URL("./fixtures/macos-mode.json", import.meta.url), "utf8"));
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

test("requests and replies match sanitized physical HB68 mode captures", () => {
  for (const capture of captures) {
    const command = capture.command as Parameters<typeof encodeKochiCommand>[0];
    assert.deepEqual(encodeKochiCommand(command), bytes(capture.request));
    assert.ok(kochiReplyPayload(bytes(capture.reply), command));
    if (command === KOCHI_COMMAND.queryWin || command === KOCHI_COMMAND.queryMac) {
      assert.equal(decodeKochiModeQuery(bytes(capture.reply), command === KOCHI_COMMAND.queryWin ? "win" : "mac"), bytes(capture.reply)[6] === 1);
    } else {
      assert.equal(decodeKochiModeAck(bytes(capture.reply), command === KOCHI_COMMAND.setWin ? "win" : "mac"), true);
    }
  }
});

test("name is decoded from the physical KOCHI68 reply", () => {
  assert.equal(decodeKochiName(bytes("5c22803300264b4f4348493638000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000")), "KOCHI68");
});

test("malformed, unrelated and unsupported replies cannot report an applied mode", () => {
  const valid = bytes(captures[0]!.reply);
  assert.equal(decodeKochiModeQuery(valid, "win"), null);
  for (const length of [0, 1, 3, 6, 7]) assert.equal(decodeKochiModeQuery(valid.slice(0, length), "mac"), null);
  for (const at of [0, 1, 2, 3, 5, 7]) {
    const corrupt = valid.slice(); corrupt[at] ^= 1;
    assert.equal(decodeKochiModeQuery(corrupt, "mac"), null);
  }
  const unsupported = valid.slice(); unsupported[6] = 0xff;
  assert.equal(decodeKochiModeQuery(unsupported, "mac"), null);
  assert.throws(() => encodeKochiCommand(12 as never), /Unsupported/);
});
