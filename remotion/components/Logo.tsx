import React from "react";
import { Img, staticFile } from "remotion";
import { brand } from "../brand";

/** Logo de /assets/logo.svg. `height` en px del lienzo. */
export const Logo: React.FC<{ height: number; style?: React.CSSProperties }> = ({ height, style }) => (
  <Img src={staticFile(brand.logo)} style={{ height, width: "auto", display: "block", ...style }} />
);
