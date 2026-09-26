import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import sample from "../fixtures/promo-sin-costos-ocultos.timeline.json";
import type { Format } from "../src/schemas/storyboard";
import type { Timeline, VideoProps } from "../src/schemas/timeline";
import { Video } from "./Video";

export const DIMENSIONS: Record<Format, { width: number; height: number }> = {
  "16x9": { width: 1920, height: 1080 },
  "9x16": { width: 1080, height: 1920 },
  "1x1": { width: 1080, height: 1080 },
};

const calculateMetadata: CalculateMetadataFunction<VideoProps> = ({ props }) => ({
  durationInFrames: props.timeline.totalFrames,
  fps: props.timeline.fps,
  ...DIMENSIONS[props.format],
});

export const Root: React.FC = () => (
  <>
    {(Object.keys(DIMENSIONS) as Format[]).map((format) => (
      <Composition
        key={format}
        id={`Video-${format}`}
        component={Video}
        defaultProps={{ timeline: sample as unknown as Timeline, format }}
        calculateMetadata={calculateMetadata}
        durationInFrames={300}
        fps={30}
        {...DIMENSIONS[format]}
      />
    ))}
  </>
);
