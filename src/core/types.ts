export type TabDisplayMode = 'original' | 'note' | 'both';
export type MultiCollectionStrategy = 'active' | 'existing' | 'first';
export type VerticalTitleMode = 'title' | 'shortTitle' | 'filename';
export type VerticalSubtitleMode = 'source' | 'creatorYear' | 'collection' | 'none';
export type SidebarViewMode = 'groups' | 'collection' | 'recent';
export type TabLifecycleStatus = 'active' | 'sleeping' | 'virtual';

export interface TabGroup {
	id: string;
	name: string;
	color: string;
}

export interface TabRemark {
	note: string;
	mode: TabDisplayMode;
}

export interface TabActivity {
	firstSeen: number;
	lastViewed: number | null;
}

export interface VirtualMemberMeta {
	key: string;
	itemID: number;
	parentItemID: number | null;
	title: string;
	shortTitle: string;
	filename: string;
	source: string;
	creatorYear: string;
	collection: string;
	type: string;
}

export interface TabSessionSnapshot {
	id: string;
	name: string;
	createdAt: number;
	groups: TabGroup[];
	assignments: Record<string, string>;
	pinned: string[];
	openKeys: string[];
	order?: string[];
	collapsed?: string[];
}

export interface TabFlowState {
	version: 1;
	groups: TabGroup[];
	assignments: Record<string, string>;
	ungroupedColor: string;
	ungroupedName?: string;
	collapsed: string[];
	order: string[];
	history: Record<string, TabActivity>;
	remarks: Record<string, TabRemark>;
	groupDisplay: Record<string, TabDisplayMode>;
	pinned: string[];
	sleeping: string[];
	virtualMembers: Record<string, VirtualMemberMeta>;
	sessions: TabSessionSnapshot[];
}

export interface NativeTabLike {
	id: string;
	type: string;
	title?: string;
	data?: {
		itemID?: number;
		[key: string]: unknown;
	};
}

export interface TrackedTab {
	tab: NativeTabLike;
	key: string;
	itemID: number | null;
	parentItemID: number | null;
	title: string;
	shortTitle: string;
	filename: string;
	source: string;
	creatorYear: string;
	collection: string;
	groupId: string;
	pinned: boolean;
	status: TabLifecycleStatus;
}

export const DEFAULT_PALETTE: ReadonlyArray<readonly [string, string]> = [
	['蓝色', '#3977d5'],
	['紫色', '#8b5ac7'],
	['绿色', '#21866a'],
	['橙色', '#dc8225'],
	['红色', '#c74646'],
	['青色', '#298c9b'],
	['粉色', '#d064a3'],
	['黄色', '#f5d547'],
	['灰色', '#737373'],
];
