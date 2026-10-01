// Minimal ambient types for the Kakao Maps JavaScript SDK — only what SignalMap.tsx uses.
// Kakao doesn't publish official TS types, so this is a hand-written partial declaration.
declare namespace kakao.maps {
  class LatLng {
    constructor(lat: number, lng: number)
  }

  class Map {
    constructor(container: HTMLElement, options: { center: LatLng; level: number })
    setBounds(bounds: LatLngBounds, padding?: number): void
    setCenter(latlng: LatLng): void
    setLevel(level: number): void
  }

  class LatLngBounds {
    constructor()
    extend(latlng: LatLng): void
  }

  interface PolygonOptions {
    path: LatLng[] | LatLng[][]
    strokeWeight?: number
    strokeColor?: string
    strokeOpacity?: number
    fillColor?: string
    fillOpacity?: number
  }

  class Polygon {
    constructor(options: PolygonOptions)
    setMap(map: Map | null): void
    setOptions(options: Partial<PolygonOptions>): void
  }

  interface MarkerOptions {
    position: LatLng
    map?: Map
  }

  class Marker {
    constructor(options: MarkerOptions)
    setMap(map: Map | null): void
  }

  namespace event {
    function addListener(target: unknown, type: string, handler: () => void): void
  }

  function load(callback: () => void): void
}

interface Window {
  kakao: typeof kakao
}
