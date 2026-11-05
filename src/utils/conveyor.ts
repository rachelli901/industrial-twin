/** Advance once per frame; crossing detection also works after a long frame. */
export function advanceConveyor<T extends { currentZ: number }>(boxes: T[], delta: number) {
  const exited: T[] = [];
  let passes = 0;
  let blocking = false;
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]!;
    const previous = box.currentZ;
    box.currentZ += Math.max(0, delta) * 1.2;
    if (previous < 0.5 && box.currentZ >= 0.5) passes++;
    if (Math.abs(box.currentZ - 0.5) < 0.25) blocking = true;
    if (box.currentZ > 3.8) exited.push(...boxes.splice(i, 1));
  }
  return { exited, passes, blocking };
}
