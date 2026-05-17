import { type LocalOwner } from '@epicenter/workspace';
import { openZhongwenWorkspace } from '@epicenter/zhongwen';

export function openZhongwenBrowser({ owner }: { owner: LocalOwner }) {
	const workspace = openZhongwenWorkspace(owner.attachEncryption);
	const { ydoc, tables, kv, encryption } = workspace;
	const idb = owner.attachLocal(ydoc);

	return {
		ydoc,
		tables,
		kv,
		encryption,
		batch: workspace.batch,
		idb,
		async wipe() {
			ydoc.destroy();
			await idb.whenDisposed;
			await owner.wipeLocalYjsData([ydoc.guid]);
		},
		[Symbol.dispose]() {
			ydoc.destroy();
		},
	};
}

export type ZhongwenBrowser = ReturnType<typeof openZhongwenBrowser>;
