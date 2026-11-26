import packageJson from "../package.json";

/** The version of this build, taken from package.json at build time. */
export const appVersion: string = packageJson.version;
