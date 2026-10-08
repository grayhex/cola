// Removal of a solid background from a photograph (#370): catalogue and studio
// pictures of a bike on a plain, mostly white backdrop. Pure pixels in, pixels
// out — no model, no network, no native dependency — so the same code runs in
// the tests and on the server, and its cost is a few passes over the picture.
//
// The method, in short:
//  1. the backdrop colour is what most of the picture's border looks like; a
//     border that does not look like one colour means «not a plain backdrop»;
//  2. everything that is connected to the border and close to that colour is
//     background; so are enclosed gaps (inside a frame, between spokes) that
//     are exactly the backdrop — a white frame is spared because its own
//     paint is never *exactly* the backdrop and an outline separates it;
//  3. a soft shadow that fades out of the background is kept as a see-through
//     black, so it lies on any backdrop; a rim of the object that jumps from
//     the backdrop is not a shadow;
//  4. the edge pixels of the object are un-mixed from the backdrop (alpha from
//     the projection on the object's colour, colour decontaminated), so no
//     white halo is left.
// It works in slices and gives control back between them: a long picture never
// holds the event loop, and a deadline or a signal stops it.
export type RawImage = { data: Uint8Array; width: number; height: number };
export type RemovalFailure =
  | "already_transparent"
  | "not_uniform"
  | "nothing_removed"
  | "everything_removed"
  | "too_large"
  | "timeout"
  | "aborted";
export class BackgroundRemovalError extends Error {
  reason: RemovalFailure;
  constructor(reason: RemovalFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}
export const removalMessages: Record<RemovalFailure, string> = {
  already_transparent: "На фото уже есть прозрачные области: фон удалён.",
  not_uniform:
    "Фон не однотонный: по краям фото разные цвета. Способ работает на каталожных и студийных снимках.",
  nothing_removed: "Однотонного фона на фото не нашлось: удалять нечего.",
  everything_removed:
    "Почти всё фото совпало с фоном: велосипед не отделить от него.",
  too_large: "Фото слишком большое для обработки.",
  timeout: "Обработка заняла слишком много времени. Фото не изменилось.",
  aborted: "Обработка остановлена. Фото не изменилось.",
};
export type RemovalOptions = {
  signal?: AbortSignal;
  /** Epoch milliseconds after which the work stops with «timeout». */
  deadline?: number;
  maxPixels?: number;
};
export type Removal = {
  /** RGBA, straight alpha. */
  data: Uint8Array;
  width: number;
  height: number;
  /** The backdrop colour that was taken out. */
  background: [number, number, number];
  /** The share of the picture that became see-through (0…1). */
  removed: number;
};

export const maxRemovalPixels = 6_000_000;
const sliceMs = 12;
const yieldNow = () => new Promise<void>((done) => setImmediate(done));

export async function removeBackground(
  input: RawImage,
  options: RemovalOptions = {},
): Promise<Removal> {
  const { width, height, data } = input;
  const total = width * height;
  if (data.length !== total * 4 || total === 0)
    throw new BackgroundRemovalError(
      "nothing_removed",
      removalMessages.nothing_removed,
    );
  if (total > (options.maxPixels ?? maxRemovalPixels))
    throw new BackgroundRemovalError("too_large", removalMessages.too_large);
  // Control goes back to the loop every slice; the checks run there.
  let mark = performance.now();
  const check = () => {
    if (options.signal?.aborted)
      throw new BackgroundRemovalError("aborted", removalMessages.aborted);
    if (options.deadline !== undefined && Date.now() > options.deadline)
      throw new BackgroundRemovalError("timeout", removalMessages.timeout);
  };
  const pause = async () => {
    if (performance.now() - mark < sliceMs) return;
    check();
    await yieldNow();
    check();
    mark = performance.now();
  };
  check();

  // Already see-through: the background is gone, or never was.
  let see = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) see++;
  if (see / total > 0.02)
    throw new BackgroundRemovalError(
      "already_transparent",
      removalMessages.already_transparent,
    );

  // 1. The backdrop: what the border looks like.
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  const onBorder = (x: number, y: number) =>
    x < band || y < band || x >= width - band || y >= height - band;
  const buckets = new Map<number, number>();
  let borderCount = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!onBorder(x, y)) {
        x = Math.max(x, width - band - 1);
        continue;
      }
      const i = (y * width + x) * 4;
      const key =
        (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
      buckets.set(key, (buckets.get(key) || 0) + 1);
      borderCount++;
    }
  let best = -1,
    bestCount = 0;
  for (const [key, count] of buckets)
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  // A first mean over the top bucket, then over everything close to it.
  const average = (near: (r: number, g: number, b: number) => boolean) => {
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (!onBorder(x, y)) {
          x = Math.max(x, width - band - 1);
          continue;
        }
        const i = (y * width + x) * 4;
        if (!near(data[i], data[i + 1], data[i + 2])) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    return n ? [r / n, g / n, b / n] : [255, 255, 255];
  };
  const [br0, bg0, bb0] = [
    (best >> 8) << 4,
    ((best >> 4) & 15) << 4,
    (best & 15) << 4,
  ];
  const first = average(
    (r, g, b) =>
      Math.max(
        Math.abs(r - br0 - 8),
        Math.abs(g - bg0 - 8),
        Math.abs(b - bb0 - 8),
      ) <= 16,
  );
  const second = average(
    (r, g, b) =>
      Math.max(
        Math.abs(r - first[0]),
        Math.abs(g - first[1]),
        Math.abs(b - first[2]),
      ) <= 20,
  );
  const bgR = Math.round(second[0]),
    bgG = Math.round(second[1]),
    bgB = Math.round(second[2]);
  // How much of the border is that colour, and how noisy it is.
  const noise = new Uint32Array(26);
  let close = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!onBorder(x, y)) {
        x = Math.max(x, width - band - 1);
        continue;
      }
      const i = (y * width + x) * 4;
      const d = Math.max(
        Math.abs(data[i] - bgR),
        Math.abs(data[i + 1] - bgG),
        Math.abs(data[i + 2] - bgB),
      );
      if (d <= 25) {
        noise[d]++;
        close++;
      }
    }
  if (close / borderCount < 0.85)
    throw new BackgroundRemovalError(
      "not_uniform",
      removalMessages.not_uniform,
    );
  let seen = 0,
    spread = 0;
  for (let d = 0; d <= 25; d++) {
    seen += noise[d];
    if (seen >= close * 0.95) {
      spread = d;
      break;
    }
  }
  const low = Math.min(26, Math.max(10, 8 + 2 * spread)), // the backdrop
    high = low + 30, // fully the object
    strict = Math.min(4, spread + 1), // what an enclosed gap must match
    shade = 170; // the darkest a soft shadow gets, as a distance

  // 2. The distance of every pixel from the backdrop.
  const distance = new Uint8Array(total);
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    distance[p] = Math.max(
      Math.abs(data[i] - bgR),
      Math.abs(data[i + 1] - bgG),
      Math.abs(data[i + 2] - bgB),
    );
    if ((p & 0x3ffff) === 0) await pause();
  }
  // 0 object, 1 background, 2 enclosed gap, 3 soft shadow.
  const state = new Uint8Array(total);
  const queue = new Int32Array(total);
  const spread4 = async (start: number, limit: number, mark_: number) => {
    // Takes the queue [0, start) already filled; grows through pixels with a
    // distance up to `limit` that are still the object (state 0).
    let head = 0,
      tail = start,
      steps = 0;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width,
        y = (p - x) / width;
      const next = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ];
      for (const q of next)
        if (q >= 0 && state[q] === 0 && distance[q] <= limit) {
          state[q] = mark_;
          queue[tail++] = q;
        }
      if ((++steps & 0x7fff) === 0) await pause();
    }
  };
  // The backdrop: from the border inwards.
  let seeds = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!onBorder(x, y)) {
        x = Math.max(x, width - band - 1);
        continue;
      }
      const p = y * width + x;
      if (distance[p] <= low && state[p] === 0) {
        state[p] = 1;
        queue[seeds++] = p;
      }
    }
  await spread4(seeds, low, 1);

  // Gaps inside the object that are exactly the backdrop: a component of
  // strict matches, big enough, is a gap; the loose match then grows from it.
  const minGap = Math.max(24, Math.round(total * 0.0001));
  const label = new Uint8Array(total);
  const stack = new Int32Array(total);
  let gapSeeds = 0;
  const gapQueue = new Int32Array(total);
  for (let p = 0; p < total; p++) {
    if (state[p] !== 0 || label[p] || distance[p] > strict) continue;
    let top = 0,
      size = 0;
    stack[top++] = p;
    label[p] = 1;
    const start = gapSeeds;
    while (top) {
      const c = stack[--top];
      gapQueue[gapSeeds++] = c;
      size++;
      const x = c % width,
        y = (c - x) / width;
      const neighbours = [
        x > 0 ? c - 1 : -1,
        x < width - 1 ? c + 1 : -1,
        y > 0 ? c - width : -1,
        y < height - 1 ? c + width : -1,
      ];
      for (const q of neighbours)
        if (q >= 0 && state[q] === 0 && !label[q] && distance[q] <= strict) {
          label[q] = 1;
          stack[top++] = q;
        }
    }
    if (size < minGap) gapSeeds = start;
    if ((p & 0x1ffff) === 0) await pause();
  }
  if (gapSeeds) {
    for (let i = 0; i < gapSeeds; i++) {
      state[gapQueue[i]] = 2;
      queue[i] = gapQueue[i];
    }
    await spread4(gapSeeds, low, 2);
  }

  // 3. Soft shadows: neutral darkening that fades smoothly out of the backdrop.
  const shadowAlpha = new Uint8Array(total);
  const ratioSpread = (p: number) => {
    const i = p * 4;
    const rr = data[i] / Math.max(1, bgR),
      rg = data[i + 1] / Math.max(1, bgG),
      rb = data[i + 2] / Math.max(1, bgB);
    return {
      spread: Math.max(rr, rg, rb) - Math.min(rr, rg, rb),
      mean: (rr + rg + rb) / 3,
    };
  };
  {
    let tail = 0;
    for (let p = 0; p < total; p++)
      if (state[p] === 1 || state[p] === 2) queue[tail++] = p;
    let head = 0,
      steps = 0;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width,
        y = (p - x) / width;
      const next = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ];
      for (const q of next) {
        if (q < 0 || state[q] !== 0) continue;
        const d = distance[q];
        if (d <= low || d > shade) continue;
        // A smooth fall-off, not the edge of an object.
        if (Math.abs(d - distance[p]) > 7 && state[p] === 3) continue;
        if (state[p] !== 3 && d > low + 12) continue;
        const { spread: tone, mean } = ratioSpread(q);
        if (tone > 0.08 || mean >= 1) continue;
        state[q] = 3;
        shadowAlpha[q] = Math.round(255 * Math.min(0.85, 1 - mean));
        queue[tail++] = q;
      }
      if ((++steps & 0x7fff) === 0) await pause();
    }
  }

  // 4. The edge of the object: un-mix it from the backdrop. Ring one touches
  // the removed region, ring two touches ring one.
  const out = new Uint8Array(total * 4);
  const ring = new Uint8Array(total);
  const touches = (p: number, hit: (q: number) => boolean) => {
    const x = p % width,
      y = (p - x) / width;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height)
          continue;
        if (hit(ny * width + nx)) return true;
      }
    return false;
  };
  const ringOne: number[] = [],
    ringTwo: number[] = [];
  for (let p = 0; p < total; p++) {
    if (state[p] === 0 && touches(p, (q) => state[q] >= 1 && state[q] <= 3))
      ringOne.push(p);
    if ((p & 0x1ffff) === 0) await pause();
  }
  for (const p of ringOne) ring[p] = 1;
  for (let p = 0; p < total; p++) {
    if (state[p] === 0 && !ring[p] && touches(p, (q) => ring[q] === 1))
      ringTwo.push(p);
    if ((p & 0x1ffff) === 0) await pause();
  }
  for (const p of ringTwo) ring[p] = 2;
  // The colour of the object near a pixel: the solid part of its 7×7 window.
  const solid = (p: number): [number, number, number] | null => {
    const x = p % width,
      y = (p - x) / width;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (state[q] !== 0 || ring[q] || distance[q] <= high) continue;
        r += data[q * 4];
        g += data[q * 4 + 1];
        b += data[q * 4 + 2];
        n++;
      }
    return n >= 3 ? [r / n, g / n, b / n] : null;
  };
  const back = [bgR, bgG, bgB];
  let step = 0;
  for (const list of [ringOne, ringTwo])
    for (const p of list) {
      const i = p * 4;
      const color = solid(p);
      const ramp = Math.min(1, Math.max(0, (distance[p] - low) / (high - low)));
      let alpha = ramp;
      if (color) {
        const v = [color[0] - bgR, color[1] - bgG, color[2] - bgB];
        const length = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
        // An object about the colour of the backdrop cannot be told by colour.
        if (length >= 625)
          alpha = Math.min(
            1,
            Math.max(
              0,
              ((data[i] - bgR) * v[0] +
                (data[i + 1] - bgG) * v[1] +
                (data[i + 2] - bgB) * v[2]) /
                length,
            ),
          );
      }
      if (ring[p] === 2 && alpha > 0.97) {
        // Not mixed with the backdrop any more: the object itself.
        ring[p] = 0;
        continue;
      }
      if (alpha < 0.12) continue; // 0,0,0,0
      for (let c = 0; c < 3; c++)
        out[i + c] = Math.max(
          0,
          Math.min(
            255,
            Math.round((data[i + c] - (1 - alpha) * back[c]) / alpha),
          ),
        );
      out[i + 3] = Math.round(alpha * 255);
      if ((++step & 0x3fff) === 0) await pause();
    }

  // 5. Out: the object as it was, the edge un-mixed, shadows as see-through
  // black, the background gone.
  let removed = 0;
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    const s = state[p];
    if (s === 1 || s === 2) {
      removed++;
      continue; // 0,0,0,0
    }
    if (s === 3) {
      out[i + 3] = shadowAlpha[p];
      removed += 1 - shadowAlpha[p] / 255;
      continue;
    }
    if (ring[p]) {
      removed += 1 - out[i + 3] / 255;
      continue;
    }
    out[i] = data[i];
    out[i + 1] = data[i + 1];
    out[i + 2] = data[i + 2];
    out[i + 3] = 255;
    if ((p & 0x3ffff) === 0) await pause();
  }
  const share = removed / total;
  if (share < 0.02)
    throw new BackgroundRemovalError(
      "nothing_removed",
      removalMessages.nothing_removed,
    );
  if (share > 0.985)
    throw new BackgroundRemovalError(
      "everything_removed",
      removalMessages.everything_removed,
    );
  return {
    data: out,
    width,
    height,
    background: [bgR, bgG, bgB],
    removed: share,
  };
}
