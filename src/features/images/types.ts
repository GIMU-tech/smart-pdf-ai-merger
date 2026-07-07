export type ImageToolMode = 'resize' | 'stitch' | 'split' | 'html';

export type ResizeMode = 'width' | 'height' | 'force' | 'contain';

export type OutputFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff';

export type ResizeOptions = {
  mode: ResizeMode;
  targetWidth?: number;
  targetHeight?: number;
  background?: string;
  position?: 'top' | 'center' | 'bottom';
  outputFormat: OutputFormat;
  quality?: number;
  preventUpscale?: boolean;
};

export type StitchDirection = 'vertical' | 'horizontal';

export type StitchMatchPolicy = 'strict' | 'resize-to-first' | 'resize-to-target';

export type StitchOptions = {
  direction: StitchDirection;
  matchPolicy: StitchMatchPolicy;
  targetWidth?: number;
  targetHeight?: number;
  tolerancePx?: number;
  gap?: number;
  background?: string;
  outputFormat: OutputFormat;
  quality?: number;
  groupByDimension?: boolean;
};

export type SplitAxis = 'vertical' | 'horizontal';

export type SplitStrategy = 'flow' | 'fixed' | 'manual';

export type SplitOptions = {
  axis: SplitAxis;
  strategy?: SplitStrategy;
  maxPixels: number;
  overlap?: number;
  minLastChunkPixels?: number;
  searchWindow?: number;
  manualCuts?: number[];
  fileNameTemplate?: string;
  fileNameStartIndex?: number;
  fileNamePadding?: number;
  outputFormat: OutputFormat;
  quality?: number;
};

export type HtmlCollectorOptions = {
  baseUrl?: string;
  downloadOriginalImages: boolean;
  createCombinedImage: boolean;
  combinedTargetWidth?: number;
  outputFormat: OutputFormat;
  quality?: number;
  includeManifest: boolean;
};
