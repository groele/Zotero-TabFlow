export type TabDisplayMode = 'original' | 'note' | 'both';
export type MultiCollectionStrategy = 'active' | 'existing' | 'first';
export type HorizontalTabCompactMode = 'inactive' | 'auto' | 'off';
export type VerticalTitleMode = 'title' | 'shortTitle' | 'filename';
export type VerticalSubtitleMode = 'source' | 'creatorYear' | 'collection' | 'lastViewed' | 'none';
export type SidebarViewMode = 'groups' | 'collection' | 'recent';
export type TabLifecycleStatus = 'active' | 'sleeping' | 'virtual';
export type SessionSnapshotKind = 'manual' | 'pre-replace' | 'rolling' | 'template';

export interface TabCloseOptions {
	preserveVirtual?: boolean;
	protectPinned?: boolean;
	protectSelected?: boolean;
	protectMedia?: boolean;
}

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

export type SessionVirtualMember = Omit<VirtualMemberMeta, 'itemID' | 'parentItemID'>;

export interface TabSessionSnapshot {
	id: string;
	name: string;
	createdAt: number;
	groups: TabGroup[];
	assignments: Record<string, string>;
	pinned: string[];
	openKeys: string[];
	virtualMembers?: SessionVirtualMember[];
	order?: string[];
	collapsed?: string[];
	remarks?: Record<string, TabRemark>;
	ungroupedName?: string;
	ungroupedColor?: string;
	ungroupedHeadingHidden?: boolean;
	kind?: SessionSnapshotKind;
	scopedGroupId?: string;
}

export interface TabFlowState {
	version: 1;
	groups: TabGroup[];
	assignments: Record<string, string>;
	ungroupedColor: string;
	ungroupedHeadingHidden?: boolean;
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
	rollingSessions?: TabSessionSnapshot[];
}

export function createEmptyState(): TabFlowState {
	return {
		version: 1,
		groups: [],
		assignments: {},
		ungroupedColor: '#737373',
		collapsed: [],
		order: [''],
		history: {},
		remarks: {},
		groupDisplay: {},
		pinned: [],
		sleeping: [],
		virtualMembers: {},
		sessions: [],
		rollingSessions: [],
	};
}

export interface NativeTabLike {
	id: string;
	type: string;
	title?: string;
	audioStatus?: { active?: boolean; paused?: boolean };
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
