/** The applications compiled into this desktop release. */

import { BUILT_IN_ROUTES } from './routes.ts';

export const WHISPERING_APPLICATION = {
	id: BUILT_IN_ROUTES.whispering.id,
	title: BUILT_IN_ROUTES.whispering.title,
};

/** The host loads one `dist/<id>` asset tree for every declaration here. */
export const COMPILED_APPLICATIONS = [WHISPERING_APPLICATION] as const;
