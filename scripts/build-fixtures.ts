// Regenera los timelines de ejemplo que usa Remotion Studio como defaultProps.
import { readFileSync, writeFileSync } from "node:fs";
import { Storyboard } from "../src/schemas/storyboard";
import { compose } from "../src/stages/compose";

for (const name of ["promo-sin-costos-ocultos", "plantillas"]) {
  const sb = Storyboard.parse(JSON.parse(readFileSync(`fixtures/${name}.storyboard.json`, "utf8")));
  writeFileSync(`fixtures/${name}.timeline.json`, JSON.stringify(compose(sb), null, 2) + "\n");
  console.log(`fixtures/${name}.timeline.json`);
}
