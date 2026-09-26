import { Config } from "@remotion/cli/config";

// Los recursos de marca (logo, fuentes, música) viven en /assets.
Config.setPublicDir("./assets");
Config.setVideoImageFormat("jpeg");
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
