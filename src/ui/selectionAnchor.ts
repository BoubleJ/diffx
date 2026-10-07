export interface Point {
  x: number
  y: number
}

export interface ScrollOffset {
  top: number
  left: number
}

export interface ClipRect {
  top: number
  bottom: number
  left: number
  right: number
}

export function scrolledPoint(point: Point, origin: ScrollOffset[], current: ScrollOffset[]): Point {
  let dx = 0
  let dy = 0
  origin.forEach((o, i) => {
    dx += current[i].left - o.left
    dy += current[i].top - o.top
  })
  return { x: point.x - dx, y: point.y - dy }
}

export function pointVisible(point: Point, clips: ClipRect[]): boolean {
  return clips.every((r) => point.y >= r.top && point.y <= r.bottom && point.x >= r.left && point.x <= r.right)
}
