// The SDK surface used by our imperative adapter. The loader still verifies
// constructors at runtime; these types do not claim to validate a remote SDK.
export interface YandexLocation {
  bounds?: number[][];
  center?: number[];
  zoom?: number;
  duration?: number;
}
export interface YandexMap {
  zoom: number;
  center: number[];
  addChild(child: unknown): void;
  removeChild(child: unknown): void;
  destroy(): void;
  setLocation(location: YandexLocation): void;
}
export interface YandexApi {
  ready: PromiseLike<unknown>;
  YMap: new (
    container: HTMLElement,
    props: {
      location: YandexLocation;
      margin?: number[];
      mode: string;
      zoomRange: { min: number; max: number };
      behaviors: string[];
    },
  ) => YandexMap;
  YMapDefaultSchemeLayer: new (props: {
    layers: { ground: { id: string } };
  }) => unknown;
  YMapDefaultFeaturesLayer: new (props: Record<string, never>) => unknown;
  YMapFeature: new (props: {
    id: string;
    geometry: { type: string; coordinates: number[][] | number[][][] };
    style: {
      stroke: { color: string; width: number; opacity?: number }[];
      fill?: string;
      fillOpacity?: number;
    };
  }) => unknown;
  YMapMarker: new (
    props: { coordinates: number[] },
    element: HTMLElement,
  ) => unknown;
  YMapListener: new (props: {
    layer?: string;
    onClick?: (object: unknown, event: { coordinates?: number[] }) => void;
    onStateChanged?: (state: {
      getLayerState: (
        id: string,
        type: string,
        mode: string,
      ) => { tilesReady: number } | undefined;
    }) => void;
  }) => unknown;
}
