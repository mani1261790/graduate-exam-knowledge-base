export type DrawTool = "pen" | "eraser";
export type EraserMode = "pixel" | "object";
export type Point = { x: number; y: number; pressure: number };
export type Stroke = { tool: DrawTool; width: number; points: Point[] };

function distanceToSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(pointX - startX, pointY - startY);
  const projection = Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared));
  return Math.hypot(pointX - (startX + projection * deltaX), pointY - (startY + projection * deltaY));
}

export function strokeIntersectsPoint(
  stroke: Stroke,
  point: Point,
  canvasWidth: number,
  canvasHeight: number,
  radius: number,
) {
  if (stroke.tool !== "pen" || stroke.points.length === 0) return false;
  const pointX = point.x * canvasWidth;
  const pointY = point.y * canvasHeight;
  const hitRadius = radius + stroke.width / 2;
  if (stroke.points.length === 1) {
    const target = stroke.points[0];
    return Math.hypot(pointX - target.x * canvasWidth, pointY - target.y * canvasHeight) <= hitRadius;
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    const start = stroke.points[index - 1];
    const end = stroke.points[index];
    if (distanceToSegment(
      pointX,
      pointY,
      start.x * canvasWidth,
      start.y * canvasHeight,
      end.x * canvasWidth,
      end.y * canvasHeight,
    ) <= hitRadius) return true;
  }
  return false;
}
