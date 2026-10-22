// The build version the shell reports and the release it tags error reports with: VITE_APP_VERSION
// when it is a commit SHA, else "dev" (spec §9.3). Same rule as the version file in dist/.
import { resolveVersion } from '@trace/shared';

export const APP_VERSION: string = resolveVersion(import.meta.env.VITE_APP_VERSION);
