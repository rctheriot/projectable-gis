declare module 'js-aruco2' {
  export interface ArucoCorner {
    x: number;
    y: number;
  }

  export interface ArucoMarker {
    id: number;
    /** Four corners in image pixels, in marker order. */
    corners: ArucoCorner[];
    hammingDistance: number;
  }

  export class Dictionary {
    constructor(name: string);
    codeList: unknown[];
    nBits: number;
    tau: number;
    markSize: number;
    generateSVG(id: number): string;
  }

  export class Detector {
    constructor(config?: { dictionaryName?: string; maxHammingDistance?: number });
    detectImage(width: number, height: number, data: Uint8ClampedArray): ArucoMarker[];
  }

  export const AR: {
    DICTIONARIES: Record<string, unknown>;
    Dictionary: typeof Dictionary;
    Detector: typeof Detector;
  };
}
