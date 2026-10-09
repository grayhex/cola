import test from "node:test";
import assert from "node:assert/strict";
import { factoryEntries } from "../lib/factory-components.ts";

test("Russian combined fields retain installation positions when rebuilding a saved specification", () => {
  const entries = factoryEntries({
    components: [
      {
        type: "hub",
        raw: {
          label: "Передняя/ задняя втулка",
          value: "SHIMANO HB-RS470, 12x100mm / SHIMANO FH-RS470, 12x142mm",
        },
      },
      {
        type: "seatpost",
        raw: {
          label: "Подседельный штырь / хомут",
          value: "ONE Carbon, Offset 13mm / Frame Integrated Clamp",
        },
      },
      {
        type: "pedals",
        raw: { label: "Педали", value: "педали не входят в комплект" },
      },
    ],
  });
  assert.deepEqual(
    entries.map((entry) => entry.source.type),
    ["front_hub", "rear_hub", "seatpost", "seat_clamp"],
  );
  assert.match(entries[0].value.name, /HB-RS470/);
  assert.match(entries[1].value.name, /FH-RS470/);
  assert.notEqual(entries[0].value.category, entries[1].value.category);
  assert.equal(entries[3].source.raw?.value, "Frame Integrated Clamp");
});
