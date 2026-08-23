import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
} from '@tauri-apps/plugin-notification';
import { Err, tryAsync } from 'wellcrafted/result';

export const osNotify = (title: string, body: string | undefined) => {
	void tryAsync({
		try: async () => {
			let permissionGranted = await isPermissionGranted();
			if (!permissionGranted) {
				const permission = await requestPermission();
				permissionGranted = permission === 'granted';
			}
			if (permissionGranted) sendNotification({ title, body });
		},
		catch: (cause) => Err(cause),
	});
};
