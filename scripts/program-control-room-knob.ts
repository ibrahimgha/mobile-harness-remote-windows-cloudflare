import { devices, HID } from "node-hid";

const expectedSerialNumber = "267E01678182";
const activeLayer = 0;
const reportLength = 65;
const macroSlots = 16;
const macroDirectoryBytes = 64;
const verifyOnly = process.argv.includes("--verify-only");

type MacroEvent = { code: number; down: boolean };

const chord = (...codes: number[]): MacroEvent[] => [
  ...codes.map((code) => ({ code, down: true })),
  ...[...codes].reverse().map((code) => ({ code, down: false }))
];

const macros = [
  { name: "Ctrl+B+1", events: chord(224, 5, 30) },
  { name: "Ctrl+B+2", events: chord(224, 5, 31) },
  { name: "Ctrl+B+3", events: chord(224, 5, 32) },
  { name: "Ctrl+2+ArrowRight", events: chord(224, 31, 79) },
  { name: "Ctrl+2+ArrowLeft", events: chord(224, 31, 80) },
  { name: "Ctrl+3+ArrowRight", events: chord(224, 32, 79) },
  { name: "Ctrl+3+ArrowLeft", events: chord(224, 32, 80) }
] as const;

const mappings = [
  { index: 17, gesture: "counter-clockwise", shortcut: "Ctrl+Alt+Right", bytes: [32, 5, 79, 0] },
  { index: 18, gesture: "clockwise", shortcut: "Ctrl+Alt+Left", bytes: [32, 5, 80, 0] },
  { index: 16, gesture: "knob 1 press", shortcut: "Ctrl+B+1", bytes: [96, 0, 0, 0] },
  { index: 20, gesture: "knob 2 rotate left", shortcut: "Ctrl+2+ArrowRight", bytes: [96, 3, 0, 0] },
  { index: 21, gesture: "knob 2 rotate right", shortcut: "Ctrl+2+ArrowLeft", bytes: [96, 4, 0, 0] },
  { index: 19, gesture: "knob 2 press", shortcut: "Ctrl+B+2", bytes: [96, 1, 0, 0] },
  { index: 23, gesture: "knob 3 rotate left", shortcut: "Ctrl+3+ArrowRight", bytes: [96, 5, 0, 0] },
  { index: 24, gesture: "knob 3 rotate right", shortcut: "Ctrl+3+ArrowLeft", bytes: [96, 6, 0, 0] },
  { index: 22, gesture: "knob 3 press", shortcut: "Ctrl+B+3", bytes: [96, 2, 0, 0] },
  { index: 0, gesture: "bottom-left key", shortcut: "Left Ctrl", bytes: [32, 1, 0, 0] },
  { index: 12, gesture: "bottom-right key", shortcut: "Enter", bytes: [32, 0, 40, 0] },
  { index: 3, gesture: "top-left key", shortcut: "Ctrl+Alt+0", bytes: [32, 5, 39, 0] },
  { index: 15, gesture: "top-right key", shortcut: "Ctrl+Alt+9", bytes: [32, 5, 38, 0] }
] as const;

const info = devices().find((candidate) =>
  candidate.vendorId === 0x0816 &&
  candidate.productId === 0x2475 &&
  candidate.usagePage === 0xff00 &&
  candidate.usage === 2 &&
  candidate.serialNumber === expectedSerialNumber &&
  typeof candidate.path === "string"
);

if (!info?.path) throw new Error(`Expected SIDE-KEYBOARD ${expectedSerialNumber} is not connected`);

const device = new HID(info.path);

function command(payload: readonly number[]): number[] {
  const report = Buffer.alloc(reportLength);
  report[0] = 0;
  report[1] = 6;
  payload.forEach((value, index) => { report[index + 2] = value; });
  device.write([...report]);
  const deadline = Date.now() + 1_500;
  const readCommand = payload[0] === 8 || payload[0] === 12;
  do {
    const response = device.readTimeout(Math.max(1, deadline - Date.now()));
    if (!response.length) break;
    if (readCommand) return response;
    if (!readCommand && response[0] === 0xaa && response[1] === payload[0]) return response;
  } while (Date.now() < deadline);
  throw new Error(`SIDE-KEYBOARD did not answer command ${payload[0]}`);
}

function readMapping(index: number): number[] {
  const offset = index * 4;
  const response = command([8, 58, offset & 0xff, (offset >> 8) & 0xff, 0, activeLayer]);
  return response.slice(8, 12);
}

function readAllMappings(): number[][] {
  return Array.from({ length: 25 }, (_, index) => readMapping(index));
}

function readMacroData(): number[] {
  const bytes: number[] = [];
  for (let offset = 0; offset < 4096; offset += 56) {
    const length = Math.min(56, 4096 - offset);
    bytes.push(...command([12, length, offset & 0xff, (offset >> 8) & 0xff]).slice(8, 8 + length));
  }
  return bytes;
}

function existingMacroBytes(data: number[], slot: number): number[] {
  const offset = data[slot * 2] + (data[slot * 2 + 1] << 8);
  if (!offset || offset === 0xffff || offset < macroDirectoryBytes || offset >= data.length) return [];
  const bytes: number[] = [];
  for (let cursor = offset; cursor + 3 < data.length; cursor += 4) {
    const event = data.slice(cursor, cursor + 4);
    if (event[2] === 0) return [];
    bytes.push(...event);
    if ((event[2] & 0x80) !== 0) return bytes;
  }
  throw new Error(`Macro ${slot} has no terminating event`);
}

function encodeMacro(events: readonly MacroEvent[]): number[] {
  return events.flatMap((event, index) => [
    index === 0 ? 0 : 1,
    0,
    2 | (event.down ? 0x40 : 0) | (index === events.length - 1 ? 0x80 : 0),
    event.code
  ]);
}

function buildMacroData(current: number[]): number[] {
  const preserved = Array.from({ length: macroSlots }, (_, slot) => existingMacroBytes(current, slot));
  macros.forEach((macro, slot) => { preserved[slot] = encodeMacro(macro.events); });
  const next = Array(64).fill(0xff).concat(Array(4032).fill(0));
  let offset = macroDirectoryBytes;
  preserved.forEach((bytes, slot) => {
    if (!bytes.length) return;
    if (offset + bytes.length > next.length) throw new Error("Macro data exceeds SIDE-KEYBOARD storage");
    next[slot * 2] = offset & 0xff;
    next[slot * 2 + 1] = (offset >> 8) & 0xff;
    bytes.forEach((value, index) => { next[offset + index] = value; });
    offset += bytes.length;
  });
  return next;
}

function writeMacroData(data: number[]): void {
  for (let offset = 0; offset < data.length; offset += 59) {
    const chunk = data.slice(offset, offset + 59);
    command([13, chunk.length, offset & 0xff, (offset >> 8) & 0xff, ...chunk]);
  }
}

try {
  const targetIndexes = new Set(mappings.map(({ index }) => index));
  const allMappings = readAllMappings();
  const conflictingMacroKey = allMappings.findIndex((mapping, index) =>
    !targetIndexes.has(index) && mapping[0] === 96 && mapping[1] < macros.length
  );
  if (conflictingMacroKey >= 0) {
    throw new Error(`Key index ${conflictingMacroKey} already uses reserved macro M${allMappings[conflictingMacroKey][1]}`);
  }

  const before = Object.fromEntries(mappings.map(({ gesture, index }) => [gesture, readMapping(index)]));
  if (verifyOnly) {
    console.log(JSON.stringify({
      product: info.product,
      serialNumber: info.serialNumber,
      layer: activeLayer,
      mappings: before
    }, null, 2));
    process.exitCode = mappings.every((mapping) => before[mapping.gesture].join(",") === mapping.bytes.join(",")) ? 0 : 2;
  } else {
  const macroData = buildMacroData(readMacroData());
  writeMacroData(macroData);

  for (const mapping of mappings) {
    const offset = mapping.index * 4;
    const response = command([
      16, 7, offset & 0xff, (offset >> 8) & 0xff, 0, activeLayer, 0, ...mapping.bytes
    ]);
    if (response[0] !== 0xaa || response[1] !== 16) {
      throw new Error(`Unexpected response while programming ${mapping.gesture}: ${response.slice(0, 8).join(",")}`);
    }
  }

  const after = Object.fromEntries(mappings.map(({ gesture, index }) => [gesture, readMapping(index)]));
  for (const mapping of mappings) {
    if (after[mapping.gesture].join(",") !== mapping.bytes.join(",")) {
      throw new Error(`Read-back failed for ${mapping.gesture}: ${after[mapping.gesture].join(",")}`);
    }
  }
  const verifiedMacroData = readMacroData();
  macros.forEach((macro, slot) => {
    const expected = encodeMacro(macro.events);
    const actual = existingMacroBytes(verifiedMacroData, slot);
    if (actual.join(",") !== expected.join(",")) throw new Error(`Read-back failed for macro M${slot} (${macro.name})`);
  });

  console.log(JSON.stringify({
    product: info.product,
    serialNumber: info.serialNumber,
    layer: activeLayer,
    before,
    after,
    macros: Object.fromEntries(macros.map((macro, slot) => [`M${slot}`, macro.name])),
    shortcuts: Object.fromEntries(mappings.map(({ gesture, shortcut }) => [gesture, shortcut]))
  }, null, 2));
  }
} finally {
  device.close();
}
