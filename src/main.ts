import {
	App,
	ItemView,
	MarkdownRenderer,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

// ─── Settings ────────────────────────────────────────────────────────────────

interface WorldBuilderSettings {
	worldFolder: string;
	/** Custom character order, keyed by lower-cased employer name -> ordered note paths. */
	characterOrder: Record<string, string[]>;
	/** Lower-cased employer names whose character sub-section is collapsed. */
	collapsedEmployers: string[];
	/** Employer type groups ("corporation", "government", "military", "criminal", "" = unassigned) collapsed on the Employers tab. */
	collapsedEmployerTypes: string[];
	/** Note paths of parent entries on hierarchical tabs (Locations) whose subtree is collapsed. */
	collapsedParents: string[];
	/** Note paths of employers whose nested "Subsidiaries" label is collapsed on the Employers tab. */
	collapsedSubsidiaries: string[];
	/** Custom manual order for the flat (non-Characters) tabs, keyed by tab id -> ordered note paths. */
	sectionOrder: Partial<Record<WBTab, string[]>>;
	/** Bookmarked note paths (any section), in the order they were added or dragged into. */
	bookmarks: string[];
	/** Section groups ("characters", "locations", ...) collapsed on the Bookmarks view. */
	collapsedBookmarkGroups: string[];
}
const DEFAULT_SETTINGS: WorldBuilderSettings = {
	worldFolder: "World",
	characterOrder: {},
	collapsedEmployers: [],
	collapsedEmployerTypes: [],
	collapsedParents: [],
	collapsedSubsidiaries: [],
	sectionOrder: {},
	bookmarks: [],
	collapsedBookmarkGroups: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Employer "type" property values, in the order their groups appear on the Employers tab. */
const EMPLOYER_TYPES: { key: string; label: string }[] = [
	{ key: "corporation", label: "Corporation" },
	{ key: "government", label: "Government" },
	{ key: "military", label: "Military" },
	{ key: "criminal", label: "Criminal" },
];

function slugify(s: string) {
	return s.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim();
}

/** Employer frontmatter key naming the employer this one is a subsidiary of. */
const SUBSIDIARY_OF = "subsidiary-of";

/** Locations whose `type` is "ship": mobile, so they get their own Ships section instead of nesting. */
function isShip(fm: Record<string, string>): boolean {
	return (fm.type ?? "").trim().toLowerCase() === "ship";
}

/** Extensions treated as "graphics" when filtering images out of note text. */
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** Strips a leading YAML frontmatter block, if present, from note content. */
function stripFrontmatterBlock(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
}

/**
 * Strips a leading "# ..." heading, if the note's body starts with one. The character template
 * always opens with "# Name" right after the frontmatter, which just repeats what the card
 * already shows above, so the expanded preview hides it whatever name it carries.
 */
function stripLeadingHeading(markdown: string): string {
	const lines = markdown.replace(/^\s+/, "").split("\n");
	if (!/^#\s+\S/.test(lines[0] ?? "")) return markdown;
	lines.shift();
	while (lines[0] === "") lines.shift();
	return lines.join("\n");
}

/**
 * Removes image embeds and tags from markdown text ("text only" previews).
 * Wiki-embeds of non-image files (e.g. `![[Other Note]]`) are left alone.
 */
function stripGraphics(markdown: string): string {
	return markdown
		.replace(/!\[\[([^\]]+)\]\]/g, (match: string, inner: string) => {
			const target = inner.split("|")[0]!.split("#")[0]!.trim();
			return IMG_EXT.test(target) ? "" : match;
		})
		.replace(/!\[[^\]]*\]\((?:<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g, "") // ![alt](path)
		.replace(/<img\b[^>]*\/?>/gi, ""); // raw <img> tags
}

/**
 * Full-screen image zoom (lightbox), opened by clicking the photo on an expanded card, so a
 * picture can be viewed large straight from the sidebar without opening the note to edit it.
 * The image opens fitted to the window. Scroll to zoom in/out around the cursor, drag to pan
 * once zoomed. A plain click (no drag) or Escape closes it.
 */
function openImageZoom(src: string, alt: string) {
	document.querySelector(".wb-zoom-overlay")?.remove();

	const overlay = document.body.createDiv({ cls: "wb-zoom-overlay", attr: { role: "dialog", "aria-modal": "true", "aria-label": alt || "Image" } });
	const img = overlay.createEl("img", { cls: "wb-zoom-img", attr: { src, alt, draggable: "false" } });

	let scale = 1;
	let x = 0;
	let y = 0;
	const apply = () => {
		img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
		overlay.toggleClass("is-zoomed", scale > 1);
	};

	const close = () => {
		overlay.remove();
		document.removeEventListener("keydown", onKey, true);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	};
	document.addEventListener("keydown", onKey, true);

	overlay.addEventListener("wheel", (e) => {
		e.preventDefault();
		const prev = scale;
		scale = Math.min(10, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
		if (scale === 1) {
			x = 0;
			y = 0;
		} else {
			// Keep the point under the cursor fixed while zooming.
			const cx = e.clientX - window.innerWidth / 2;
			const cy = e.clientY - window.innerHeight / 2;
			x = cx - ((cx - x) * scale) / prev;
			y = cy - ((cy - y) * scale) / prev;
		}
		apply();
	}, { passive: false });

	// Drag to pan; a press that barely moves counts as a click and closes the zoom.
	let dragStart: { mx: number; my: number; x: number; y: number } | null = null;
	let moved = false;
	overlay.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		dragStart = { mx: e.clientX, my: e.clientY, x, y };
		moved = false;
		overlay.setPointerCapture(e.pointerId);
	});
	overlay.addEventListener("pointermove", (e) => {
		if (!dragStart) return;
		const dx = e.clientX - dragStart.mx;
		const dy = e.clientY - dragStart.my;
		if (!moved && Math.hypot(dx, dy) < 4) return;
		moved = true;
		if (scale > 1) {
			overlay.addClass("is-panning");
			x = dragStart.x + dx;
			y = dragStart.y + dy;
			apply();
		}
	});
	overlay.addEventListener("pointerup", () => {
		overlay.removeClass("is-panning");
		const wasClick = dragStart && !moved;
		dragStart = null;
		if (wasClick) close();
	});
	img.onerror = close;
}

async function ensureFolder(app: App, path: string) {
	if (!app.vault.getAbstractFileByPath(path)) {
		await app.vault.createFolder(path);
	}
}

async function createNote(
	app: App,
	folder: string,
	filename: string,
	content: string
): Promise<TFile> {
	await ensureFolder(app, folder);
	const path = `${folder}/${slugify(filename)}.md`;
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return existing;
	}
	return await app.vault.create(path, content);
}

function readFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return {};
	const result: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		let value = line.slice(idx + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		result[line.slice(0, idx).trim()] = value;
	}
	return result;
}

/** "Label: value • Label: value" for the non-empty values. A non-breaking space keeps each label with its value when the line wraps. */
function labeledLine(pairs: ReadonlyArray<readonly [string, string | undefined]>): string {
	return pairs
		.filter(([, value]) => value)
		.map(([label, value]) => `${label}:\u00a0${value}`)
		.join(" • ");
}

/** Lower-cases and strips accents, so "zoe" finds "Zoë" and "desmond" finds "Desmond". */
function normalizeForSearch(s: string): string {
	return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** "[[Name]]", "[[Name|Alias]]", or plain "Name" -> "Name" (trimmed). */
function parseRefName(raw: string): string {
	const trimmed = raw.trim();
	const m = trimmed.match(/^\[\[([^\]]+)\]\]$/);
	const inner = m ? m[1]! : trimmed;
	return inner.split("|")[0]!.split("#")[0]!.trim();
}

/**
 * Everything a note "says", for searching: its frontmatter values (not the keys) plus its body,
 * with markup that isn't visible text removed (embeds, link targets, HTML tags such as the
 * <font color=...> around headings).
 */
function documentSearchText(content: string, fm: Record<string, string>): string {
	const body = stripFrontmatterBlock(content)
		.replace(/!\[\[[^\]]*\]\]/g, " ") // ![[embeds]]
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // ![images](...)
		.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1") // [[target|shown text]] -> shown text
		.replace(/\[\[([^\]]*)\]\]/g, "$1") // [[target]] -> target
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
		.replace(/<[^>]+>/g, " "); // <font color="...">, etc.
	const values = Object.entries(fm)
		.filter(([key]) => key !== "entry_type")
		.map(([, value]) => value);
	return [...values, body].join(" ");
}

interface NoteEntry {
	file: TFile;
	content: string;
	fm: Record<string, string>;
}
/** One tab's two halves: header (fixed region) and body (scrolling region). */
interface TabPane { head: HTMLElement; body: HTMLElement; }

type CardFn = (fm: Record<string, string>) => {
	title: string;
	meta: string;
	badge: string;
	search?: string;
	// Additional small labels drawn after the main badge (e.g. the character POV marker).
	extraBadges?: { text: string; cls: string }[];
};

/** True when a frontmatter value is actually set (not missing, null, or blank). */
const hasValue = (v: unknown): boolean =>
	v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

/** The five entry sections, each with its own tab and folder. */
type SectionTab = "characters" | "locations" | "employers" | "lore" | "timeline";
/** Everything the sidebar can show: a section, or the Bookmarks view (opened from the section header, not the tab bar). */
type WBTab = SectionTab | "bookmarks";
const SECTION_TABS: SectionTab[] = ["characters", "locations", "employers", "lore", "timeline"];
const SECTION_LABELS: Record<SectionTab, string> = {
	characters: "Characters",
	locations: "Locations",
	employers: "Employers",
	lore: "Lore",
	timeline: "Timeline",
};

/** Search bar wording per tab. Characters match on four properties; every other tab matches the note's name and text. */
const SEARCH_HINTS: Record<WBTab, { noun: string; tip: string }> = {
	characters: { noun: "characters", tip: "Matches name, employer, ship and home" },
	locations: { noun: "locations", tip: "Matches the name and the text of the note" },
	employers: { noun: "employers", tip: "Matches the name and the text of the note" },
	lore: { noun: "lore", tip: "Matches the title and the text of the note" },
	timeline: { noun: "timeline", tip: "Matches the title and the text of the note" },
	bookmarks: { noun: "bookmarks", tip: "Matches each bookmark the same way its own tab does" },
};

/**
 * Groups a flat list of notes into a parent/child tree using each note's "parent" frontmatter
 * text, matched (case/accent-insensitively, tolerant of "[[Name]]" wiki-link syntax) against
 * other notes' own names in the same list. A note whose parent text doesn't resolve to another
 * note here - unset, misspelled, or pointing outside this section - is left as a root: nesting
 * only happens where an actual parent/child relationship is detected. Any edge that would create
 * a cycle (A parents B parents A) is dropped so the tree stays walkable.
 */
function buildParentTree(
	entries: NoteEntry[],
	getParentName: (fm: Record<string, string>) => string,
	getOwnName: (fm: Record<string, string>) => string
): { roots: NoteEntry[]; childrenOf: Map<string, NoteEntry[]> } {
	const nameIndex = new Map<string, NoteEntry>();
	for (const entry of entries) {
		const key = normalizeForSearch(parseRefName(getOwnName(entry.fm) || ""));
		if (key && !nameIndex.has(key)) nameIndex.set(key, entry);
	}

	const parentOf = new Map<string, NoteEntry>();
	for (const entry of entries) {
		const raw = parseRefName(getParentName(entry.fm) || "");
		if (!raw) continue;
		const parent = nameIndex.get(normalizeForSearch(raw));
		if (parent && parent.file.path !== entry.file.path) parentOf.set(entry.file.path, parent);
	}

	// Drop any edge whose chain of parents loops back on itself, so the tree stays walkable.
	const isAcyclic = (start: NoteEntry): boolean => {
		const seen = new Set<string>();
		let cur: NoteEntry | undefined = start;
		while (cur) {
			if (seen.has(cur.file.path)) return false;
			seen.add(cur.file.path);
			cur = parentOf.get(cur.file.path);
		}
		return true;
	};
	for (const entry of entries) {
		if (parentOf.has(entry.file.path) && !isAcyclic(entry)) parentOf.delete(entry.file.path);
	}

	const childrenOf = new Map<string, NoteEntry[]>();
	const roots: NoteEntry[] = [];
	for (const entry of entries) {
		const parent = parentOf.get(entry.file.path);
		if (!parent) { roots.push(entry); continue; }
		const list = childrenOf.get(parent.file.path);
		if (list) list.push(entry); else childrenOf.set(parent.file.path, [entry]);
	}
	return { roots, childrenOf };
}

/**
 * Merges a reordered sibling group back into a flat priority order without disturbing anything
 * outside that group: every path in `groupPaths` is replaced, in its new order, at the position
 * of the group's first surviving member; everything else keeps its relative order.
 */
function mergeGroupOrder(overall: string[], groupPaths: string[], newGroupOrder: string[]): string[] {
	const groupSet = new Set(groupPaths);
	const result: string[] = [];
	let inserted = false;
	for (const path of overall) {
		if (groupSet.has(path)) {
			if (!inserted) { result.push(...newGroupOrder); inserted = true; }
		} else {
			result.push(path);
		}
	}
	if (!inserted) result.push(...newGroupOrder);
	return result;
}

// ─── Sidebar View ─────────────────────────────────────────────────────────────

const VIEW_TYPE = "world-builder-sidebar";

class WorldBuilderView extends ItemView {
	plugin: WorldBuilderPlugin;
	activeTab: WBTab = "characters";
	/** What is typed in the search bar for each tab; kept here so it survives a redraw (Reload, new note, ...). */
	searchQueries: Record<WBTab, string> = { characters: "", locations: "", employers: "", lore: "", timeline: "", bookmarks: "" };
	/** The section tab to return to when the Bookmarks button is clicked again while viewing bookmarks. */
	private lastSectionTab: SectionTab = "characters";
	/** How each section draws its cards, captured in renderSection() so the Bookmarks view can draw them the same way. */
	private sectionConfigs: Partial<Record<SectionTab, { getCard: CardFn; thumbs: boolean; stackBadge: boolean }>> = {};
	/** The Bookmarks button in the title row, highlighted while the Bookmarks view is open. */
	private bookmarkHeaderButtons: HTMLButtonElement[] = [];
	private searchTargets: Partial<Record<WBTab, HTMLElement>> = {};
	/** Normalised text each card is matched against. */
	private searchIndex = new WeakMap<HTMLElement, string>();
	/** Every note currently drawn in the sidebar, keyed by path, so a wiki-link click can find its entry. */
	private entryByPath = new Map<string, NoteEntry>();
	/** Tabs whose lists nest child entries under their parent (see renderHierarchicalGroup). */
	private readonly hierarchicalTabs = new Set<WBTab>(["locations"]);
	/** Un-collapses one hierarchical parent's subtree, keyed by the parent's note path (used by revealCard). */
	private treeExpanders = new Map<string, () => Promise<void>>();
	/**
	 * Every collapsible group label drawn in the sidebar, mapped to a function that folds it and
	 * records that in settings (without saving). Used by collapseAllInTab(); weak so old DOM from a
	 * previous render() is simply dropped.
	 */
	private groupCollapsers = new WeakMap<HTMLElement, () => void>();
	/** Whether the click that started the current (possible) double-click landed on the tab that was already active. */
	private tabClickWasOnActive = false;

	// Rebuilt on every render(); let switchTab() and the nav buttons operate without closures.
	private tabBarEl: HTMLElement | null = null;
	private tabContents: Partial<Record<WBTab, TabPane>> = {};
	private showTabSearchFn: (() => void) | null = null;
	private updateShadowFn: (() => void) | null = null;

	/**
	 * Back/forward history across tab switches and card expansions (including ones triggered by
	 * clicking a wiki-link in an expanded card). Persists across render() calls; only the DOM it
	 * points at is rebuilt.
	 */
	private navHistory: { tab: WBTab; cardPath: string | null }[] = [];
	private navIndex = -1;
	/** True while a back/forward navigation is replaying a history entry, so it isn't re-recorded. */
	private restoringNav = false;
	private navButtons: { back: HTMLButtonElement; fwd: HTMLButtonElement }[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: WorldBuilderPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return "World Builder"; }
	getIcon() { return "orbit"; }

	async onOpen() { await this.render(); }
	async onClose() {}

	async render() {
		const { containerEl } = this;
		// Only the list area scrolls, so remember its position across the redraw.
		const scrollTop = containerEl.querySelector<HTMLElement>(".wb-scroll")?.scrollTop ?? 0;
		const oldSearch = containerEl.querySelector<HTMLInputElement>(".wb-search-input");
		const searchHadFocus = !!oldSearch && containerEl.ownerDocument.activeElement === oldSearch;
		containerEl.empty();
		containerEl.addClass("wb-sidebar");
		// Rebuilt below as the lists are (re)drawn.
		this.entryByPath = new Map();
		this.treeExpanders = new Map();
		this.navButtons = [];
		this.bookmarkHeaderButtons = [];
		this.sectionConfigs = {};

		// Fixed region: title, tabs, the active tab's section header (Reload / + New) and the search bar.
		// It never scrolls; the lists below it live in their own scrolling region.
		const fixed = containerEl.createDiv("wb-fixed");
		const scroll = containerEl.createDiv("wb-scroll");

		const header = fixed.createDiv("wb-header");
		header.createEl("h2", { text: "Hatherton's World Builder" });
		// Bookmarks: icon-only, anchored to the right of the title. Highlighted while the Bookmarks view is open.
		const bookmarksBtn = header.createEl("button", {
			cls: "wb-btn-secondary wb-icon-btn wb-bookmarks-btn",
			attr: { type: "button", "aria-label": "Bookmarks" },
		});
		setIcon(bookmarksBtn, "bookmark");
		bookmarksBtn.onclick = () => this.toggleBookmarksView();
		this.bookmarkHeaderButtons.push(bookmarksBtn);

		const tabBar = fixed.createDiv("wb-tabs");
		const tabs: { id: SectionTab; label: string }[] = [
			{ id: "characters", label: "Characters" },
			{ id: "locations", label: "Locations" },
			{ id: "employers", label: "Employers" },
			{ id: "lore", label: "Lore" },
			{ id: "timeline", label: "Timeline" },
		];

		this.tabBarEl = tabBar;
		const contents: Partial<Record<WBTab, TabPane>> = {};
		tabs.forEach(({ id, label }) => {
			const btn = tabBar.createEl("button", { text: label, cls: "wb-tab" });
			btn.setAttribute("data-tab", id);
			if (id === this.activeTab) btn.addClass("active");
			btn.onclick = (e) => {
				// Remember, on the first click of a (possible) double-click, whether this tab was already open,
				// so a double-click that *switches* to a tab doesn't also collapse it.
				if (e.detail <= 1) this.tabClickWasOnActive = id === this.activeTab;
				if (id === this.activeTab) return;
				this.switchTab(id);
				this.recordNav(id, null);
			};
			// Double-clicking the tab you're already on collapses everything in it.
			btn.ondblclick = () => {
				if (!this.tabClickWasOnActive || id !== this.activeTab) return;
				void this.collapseAllInTab(id);
			};
			// Each tab has a header half (fixed region) and a body half (scrolling region).
			const pane: TabPane = {
				head: fixed.createDiv("wb-tab-content wb-tab-head"),
				body: scroll.createDiv("wb-tab-content wb-tab-body"),
			};
			if (id === this.activeTab) { pane.head.addClass("active"); pane.body.addClass("active"); }
			contents[id] = pane;
			this.searchTargets[id] = pane.body;
		});
		// The Bookmarks view has no tab of its own; it's opened from the Bookmarks button in the
		// title row and takes the place of the section's list while it's open.
		const bookmarksPane: TabPane = {
			head: fixed.createDiv("wb-tab-content wb-tab-head"),
			body: scroll.createDiv("wb-tab-content wb-tab-body wb-bookmarks-body"),
		};
		if (this.activeTab === "bookmarks") { bookmarksPane.head.addClass("active"); bookmarksPane.body.addClass("active"); }
		contents.bookmarks = bookmarksPane;
		this.searchTargets.bookmarks = bookmarksPane.body;
		this.tabContents = contents;

		// Search bar: last part of the fixed region, under the section header. Each tab keeps its own text.
		const searchBox = fixed.createDiv("wb-search");
		setIcon(searchBox.createEl("span", { cls: "wb-search-icon" }), "search");
		const searchInput = searchBox.createEl("input", {
			cls: "wb-search-input",
			attr: { type: "text", spellcheck: "false" },
		});
		const clearBtn = searchBox.createEl("button", {
			cls: "wb-search-clear",
			attr: { type: "button", "aria-label": "Clear search" },
		});
		setIcon(clearBtn, "x");
		const syncClear = () => clearBtn.classList.toggle("is-visible", searchInput.value.length > 0);
		const showTabSearch = () => {
			const hint = SEARCH_HINTS[this.activeTab];
			searchInput.value = this.searchQueries[this.activeTab];
			searchInput.setAttribute("placeholder", `Search ${hint.noun}\u2026`);
			searchInput.setAttribute("title", hint.tip);
			searchInput.setAttribute("aria-label", `Search ${hint.noun}`);
			syncClear();
		};
		// Shadow under the fixed region while the list is scrolled, so it reads as sitting on top of it.
		const updateShadow = () => fixed.classList.toggle("is-scrolled", scroll.scrollTop > 0);
		scroll.addEventListener("scroll", updateShadow, { passive: true });
		this.showTabSearchFn = showTabSearch;
		this.updateShadowFn = updateShadow;
		const setQuery = (q: string) => {
			this.searchQueries[this.activeTab] = q;
			syncClear();
			this.applySearch(this.activeTab);
			scroll.scrollTop = 0; // the result set changed: start from the top of it
			updateShadow();
		};
		searchInput.addEventListener("input", () => setQuery(searchInput.value));
		searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && searchInput.value) {
				e.preventDefault();
				e.stopPropagation();
				searchInput.value = "";
				setQuery("");
			}
		});
		clearBtn.addEventListener("click", () => {
			searchInput.value = "";
			setQuery("");
			searchInput.focus();
		});
		showTabSearch();

		const folder = this.plugin.settings.worldFolder;

		await this.renderSection(
			"characters",
			contents.characters!,
			`${folder}/Characters`,
			"Characters",
			() => new CharacterModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				// Two lines: age/home, then employer/ship (a line with no values is dropped).
				meta: [
					labeledLine([["Age", fm.age], ["Home", fm.home]]),
					labeledLine([["Employer", fm.employer], ["Ship", fm.ship]]),
				].filter(Boolean).join("\n"),
				badge: fm.role ?? "",
				// `pov` is set by hand in the note's properties (not in the New Character modal).
				extraBadges: hasValue(fm.pov) ? [{ text: "POV", cls: "wb-badge-pov" }] : [],
				// What the search bar matches against.
				search: [fm.name, fm.employer, fm.ship, fm.home].filter(Boolean).join(" "),
			}),
			{ thumbs: true, employerGroups: true, stackBadge: true, expandable: true }
		);

		await this.renderSection(
			"locations",
			contents.locations!,
			`${folder}/Locations`,
			"Locations",
			() => new LocationModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				// Type already shows as the badge, so the sub-line is just the parent location.
				meta: (fm.parent ?? "").trim(),
				badge: fm.type ?? "",
			}),
			{
				thumbs: true,
				expandable: true,
				hierarchical: true,
				// Ships travel, so their `parent` (where they are right now) never nests them: they
				// always start their own tree, drawn in the separate Ships section below.
				getParentName: (fm) => (isShip(fm) ? "" : fm.parent ?? ""),
				getOwnName: (fm) => fm.name ?? "",
				movableSection: { label: "Ships", isMovable: isShip },
			}
		);

		await this.renderSection(
			"employers",
			contents.employers!,
			`${folder}/Employers`,
			"Employers",
			() => new EmployerModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				meta: fm.goals ?? "",
				badge: fm.alignment ?? "",
			}),
			{ thumbs: true, expandable: true, typeGroups: true }
		);

		await this.renderSection(
			"lore",
			contents.lore!,
			`${folder}/Lore`,
			"Lore Entries",
			() => new LoreModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.title ?? "Untitled",
				meta: fm.category ?? "",
				badge: fm.category ?? "",
			}),
			{ expandable: true }
		);

		await this.renderSection(
			"timeline",
			contents.timeline!,
			`${folder}/Timeline`,
			"Timeline Events",
			() => new TimelineModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.title ?? "Untitled",
				meta: fm.date ?? "",
				badge: "",
			}),
			{ expandable: true }
		);

		// Bookmarks last: it reuses the entries and card styles the sections above just loaded.
		this.renderSectionHeader(bookmarksPane, "Bookmarks", null, true);
		this.renderBookmarks();

		// Redrawing empties the container, which resets its scroll position; restore it.
		scroll.scrollTop = scrollTop;

		// Re-apply each tab's search to the freshly drawn lists, and give the box its focus back.
		for (const { id } of tabs) this.applySearch(id);
		updateShadow();
		if (searchHadFocus) {
			searchInput.focus();
			const end = searchInput.value.length;
			searchInput.setSelectionRange(end, end);
		}

		// Seed a starting point for Back/Forward the first time the sidebar ever renders.
		if (this.navHistory.length === 0) {
			this.navHistory = [{ tab: this.activeTab, cardPath: null }];
			this.navIndex = 0;
		}
		this.updateNavButtonStates();
		this.updateBookmarkHeaderButtons();
	}

	/**
	 * Hides the cards on one tab that don't match its search text (and, on Characters, any employer
	 * section left empty). Every word typed must appear in the card's searchable text, in any order,
	 * ignoring case and accents. Works on the existing cards, so nothing is re-read or re-rendered.
	 * Characters are matched on name, employer, ship and home; other tabs on the name and the note's text.
	 */
	private applySearch(tab: WBTab) {
		const body = this.searchTargets[tab];
		if (!body) return;
		const query = this.searchQueries[tab];
		const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
		const searching = terms.length > 0;
		body.classList.toggle("is-searching", searching);

		const filterList = (list: Element): number => {
			let shown = 0;
			list.querySelectorAll<HTMLElement>(".wb-card").forEach((card) => {
				const haystack = this.searchIndex.get(card) ?? "";
				const match = terms.every((t) => haystack.includes(t));
				card.classList.toggle("wb-filtered-out", !match);
				if (match) shown++;
			});
			return shown;
		};

		let matches = 0;

		if (this.hierarchicalTabs.has(tab)) {
			// A card is kept visible if it matches directly, or if any of its (nested) descendants
			// do, so a matching child's ancestors stay in view to give it context. Evaluated bottom
			// up: a child group's own visibility is resolved before its parent card decides its own.
			const evalGroup = (list: Element): boolean => {
				let anyVisible = false;
				list.querySelectorAll(":scope > .wb-card").forEach((el) => {
					const card = el as HTMLElement;
					const haystack = this.searchIndex.get(card) ?? "";
					const ownMatch = terms.every((t) => haystack.includes(t));
					if (ownMatch) matches++;
					const childGroup = card.nextElementSibling;
					const childList = childGroup?.classList.contains("wb-child-group")
						? childGroup.querySelector<HTMLElement>(":scope > .wb-list")
						: null;
					const descendantMatch = childList ? evalGroup(childList) : false;
					const show = ownMatch || descendantMatch;
					card.classList.toggle("wb-filtered-out", searching && !show);
					const treeHeader = card.previousElementSibling;
					if (treeHeader?.classList.contains("wb-tree-header")) {
						treeHeader.classList.toggle("wb-filtered-out", searching && !show);
					}
					if (show) anyVisible = true;
				});
				return anyVisible;
			};
			body.querySelectorAll<HTMLElement>(":scope > .wb-list").forEach((topList) => {
				const anyVisible = evalGroup(topList);
				const sectionHeader = topList.previousElementSibling;
				if (sectionHeader?.classList.contains("wb-tree-section-header")) {
					sectionHeader.classList.toggle("wb-filtered-out", searching && !anyVisible);
				}
			});
		} else {
			body.querySelectorAll<HTMLElement>(".wb-group-header:not(.wb-subsidiary-header)").forEach((header) => {
				const list = header.nextElementSibling;
				if (!list || !list.classList.contains("wb-list")) return;
				const shown = filterList(list);
				const hideGroup = searching && shown === 0;
				header.classList.toggle("wb-filtered-out", hideGroup);
				list.classList.toggle("wb-filtered-out", hideGroup);
				matches += shown;
			});
			// Tabs without employer sections: plain lists
			body.querySelectorAll<HTMLElement>(":scope > .wb-list").forEach((list) => {
				if (list.previousElementSibling?.classList.contains("wb-group-header")) return;
				matches += filterList(list);
			});
			// Employers: a "Subsidiaries" label stays only while something inside it matches, and
			// keeps its parent's card in view for context. Deepest first (reverse document order),
			// so a nested match has already revealed its own parent card before the level above looks.
			const subGroups = Array.from(body.querySelectorAll<HTMLElement>(".wb-subsidiary-group")).reverse();
			for (const group of subGroups) {
				const anyShown = !!group.querySelector(":scope > .wb-list > .wb-card:not(.wb-filtered-out)");
				group.classList.toggle("wb-filtered-out", searching && !anyShown);
				const owner = group.previousElementSibling;
				if (searching && anyShown && owner?.classList.contains("wb-card")) owner.classList.remove("wb-filtered-out");
			}
		}

		const none = body.querySelector<HTMLElement>(".wb-no-results");
		if (none) {
			none.textContent = `No ${none.getAttribute("data-noun") ?? "entries"} match \u201c${query.trim()}\u201d.`;
			none.classList.toggle("wb-filtered-out", !(searching && matches === 0));
		}
	}

	/** Returns a displayable URL for the first image embedded in a note, or null. */
	findFirstImageSrc(content: string, file: TFile): string | null {
		const re = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			let target: string;
			if (m[1] !== undefined) {
				// Wiki embed: ![[image.png|300]]
				target = m[1].split("|")[0]!.split("#")[0]!.trim();
			} else {
				// Markdown embed: ![alt](path/to/image.png)
				target = (m[2] ?? "").trim();
				if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
				if (/^https?:\/\//i.test(target)) {
					if (IMG_EXT.test(target.split(/[?#]/)[0]!)) return target;
					continue;
				}
				try { target = decodeURIComponent(target); } catch (e) { /* keep as-is */ }
				target = target.split("#")[0]!;
			}
			if (!IMG_EXT.test(target)) continue;
			const dest =
				this.app.metadataCache.getFirstLinkpathDest(target, file.path) ??
				this.app.vault.getAbstractFileByPath(target);
			if (dest instanceof TFile) return this.app.vault.getResourcePath(dest);
		}
		return null;
	}

	async renderSection(
		tab: SectionTab,
		pane: TabPane,
		folderPath: string,
		label: string,
		onCreate: () => void,
		getCard: CardFn,
		opts: {
			thumbs?: boolean;
			reload?: boolean;
			employerGroups?: boolean;
			/** Employers: group entries under collapsible Corporation / Government / Military / Criminal headers by their `type` property. */
			typeGroups?: boolean;
			stackBadge?: boolean;
			/** Clicking a card expands an in-sidebar, text-only preview instead of opening the note. */
			expandable?: boolean;
			/** Nest entries under their detected parent (see renderHierarchicalGroup); requires getParentName/getOwnName. */
			hierarchical?: boolean;
			getParentName?: (fm: Record<string, string>) => string;
			getOwnName?: (fm: Record<string, string>) => string;
			/** Hierarchical tabs: roots matching isMovable (and their children) go in their own collapsible section, drawn last. */
			movableSection?: { label: string; isMovable: (fm: Record<string, string>) => boolean };
		} = {}
	) {
		const container = pane.body;
		this.sectionConfigs[tab] = { getCard, thumbs: !!opts.thumbs, stackBadge: !!opts.stackBadge };
		this.renderSectionHeader(pane, label, onCreate, opts.reload ?? true);

		const files = this.app.vault.getMarkdownFiles().filter((f) =>
			f.path.startsWith(folderPath + "/")
		);

		if (files.length === 0) {
			container.createDiv("wb-list").createDiv({ cls: "wb-empty", text: `No ${label.toLowerCase()} yet.` });
			return;
		}

		const entries: NoteEntry[] = [];
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			const entry: NoteEntry = { file, content, fm: readFrontmatter(content) };
			entries.push(entry);
			this.entryByPath.set(file.path, entry);
		}

		if (opts.hierarchical) {
			const { roots, childrenOf } = buildParentTree(
				entries,
				opts.getParentName ?? (() => ""),
				opts.getOwnName ?? ((fm) => fm.name ?? "")
			);
			const movable = opts.movableSection;
			const fixedRoots = movable ? roots.filter((e) => !movable.isMovable(e.fm)) : roots;
			const movableRoots = movable ? roots.filter((e) => movable.isMovable(e.fm)) : [];
			this.renderHierarchicalGroup(
				tab, container, fixedRoots, entries, childrenOf, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable
			);
			if (movable && movableRoots.length) {
				// Same collapsible label as a parent location, but heading a whole section of its own.
				const header = this.createTreeHeader(container, movable.label);
				header.addClass("wb-tree-section-header");
				this.renderHierarchicalGroup(
					tab, container, movableRoots, entries, childrenOf, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable
				);
				const sectionList = header.nextElementSibling as HTMLElement;
				this.wireTreeCollapse(tab, header, [sectionList], `${tab}:section:${movable.label.toLowerCase()}`);
			}
			this.createNoResultsLine(container, label);
			return;
		}

		if (opts.typeGroups) {
			this.renderTypeGroups(tab, container, entries, getCard, opts);
			this.createNoResultsLine(container, label);
			return;
		}

		if (!opts.employerGroups) {
			const list = container.createDiv("wb-list");
			const ordered = this.orderEntries(entries, this.plugin.settings.sectionOrder[tab] ?? []);
			for (const entry of ordered) this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
			this.enableReorder(list, async (order) => {
				this.plugin.settings.sectionOrder[tab] = order;
				await this.plugin.saveSettings();
			});
			this.createNoResultsLine(container, label);
			return;
		}

		// Characters: one sub-section per employer, each with its own drag-to-reorder list.
		const groups = new Map<string, { label: string; items: NoteEntry[] }>();
		for (const entry of entries) {
			const employer = (entry.fm.employer ?? "").trim();
			const key = employer.toLowerCase();
			let group = groups.get(key);
			if (!group) {
				group = { label: employer || "No Employer", items: [] };
				groups.set(key, group);
			}
			group.items.push(entry);
		}

		// Each employer's logo: the first image in its note under <World>/Employers, matched by
		// the note's `name` property or its file name (case-insensitive).
		const employerLogos = new Map<string, string>();
		const employerFolder = `${this.plugin.settings.worldFolder}/Employers/`;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(employerFolder)) continue;
			const content = await this.app.vault.cachedRead(file);
			const src = this.findFirstImageSrc(content, file);
			if (!src) continue;
			const names = [readFrontmatter(content).name ?? "", file.basename];
			for (const n of names) {
				const k = parseRefName(n).toLowerCase();
				if (k && !employerLogos.has(k)) employerLogos.set(k, src);
			}
		}

		// Alphabetical by employer, with characters who have no employer last.
		const orderedGroups = [...groups.entries()].sort(
			([a], [b]) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)
		);

		for (const [key, group] of orderedGroups) {
			const header = container.createDiv("wb-group-header");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			setIcon(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
			const logoSrc = key ? employerLogos.get(parseRefName(key).toLowerCase()) : undefined;
			if (logoSrc) {
				const logo = header.createEl("img", {
					cls: "wb-group-logo",
					attr: { src: logoSrc, alt: "", draggable: "false" },
				});
				logo.onerror = () => logo.remove();
			}
			header.createEl("span", { cls: "wb-group-title", text: group.label });
			const list = container.createDiv("wb-list");

			const applyCollapsed = (collapsed: boolean) => {
				header.classList.toggle("is-collapsed", collapsed);
				list.classList.toggle("is-collapsed", collapsed);
				header.setAttribute("aria-expanded", String(!collapsed));
			};
			applyCollapsed(this.plugin.settings.collapsedEmployers.includes(key));
			this.groupCollapsers.set(header, () => {
				const settings = this.plugin.settings;
				if (!settings.collapsedEmployers.includes(key)) settings.collapsedEmployers = [...settings.collapsedEmployers, key];
				applyCollapsed(true);
			});

			const toggleCollapsed = async () => {
				// While searching, matching sections are shown open regardless; leave the saved state alone.
				if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
				const settings = this.plugin.settings;
				const collapse = !settings.collapsedEmployers.includes(key);
				settings.collapsedEmployers = collapse
					? [...settings.collapsedEmployers, key]
					: settings.collapsedEmployers.filter((k) => k !== key);
				applyCollapsed(collapse);
				await this.plugin.saveSettings();
			};
			header.onclick = toggleCollapsed;
			header.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					toggleCollapsed();
				}
			};

			// Saved order first; anything not yet ordered keeps its default position after them.
			const items = this.orderEntries(group.items, this.plugin.settings.characterOrder[key] ?? []);

			for (const entry of items) this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
			this.enableReorder(list, async (order) => {
				this.plugin.settings.characterOrder[key] = order;
				await this.plugin.saveSettings();
			});
		}

		this.createNoResultsLine(container, label);
	}

	/**
	 * A tab's section header (fixed region): Back/Forward and the label on the left; Reload and
	 * (for the entry sections) + New on the right. (The Bookmarks button lives in the title row.)
	 */
	private renderSectionHeader(pane: TabPane, label: string, onCreate: (() => void) | null, reload: boolean) {
		const hdr = pane.head.createDiv("wb-section-header");
		// Back/forward, then the label, grouped together at the left edge of the header.
		const titleGroup = hdr.createDiv("wb-section-title");
		const navGroup = titleGroup.createDiv("wb-nav-buttons");
		const backBtn = navGroup.createEl("button", {
			cls: "wb-nav-btn",
			text: "<",
			attr: { type: "button", "aria-label": "Back" },
		});
		const fwdBtn = navGroup.createEl("button", {
			cls: "wb-nav-btn",
			text: ">",
			attr: { type: "button", "aria-label": "Forward" },
		});
		backBtn.onclick = () => this.navigateBack();
		fwdBtn.onclick = () => this.navigateForward();
		this.navButtons.push({ back: backBtn, fwd: fwdBtn });
		titleGroup.createEl("span", { text: label });
		const actions = hdr.createDiv("wb-section-actions");
		if (reload) {
			const reloadBtn = actions.createEl("button", { cls: "wb-btn-secondary" });
			setIcon(reloadBtn.createEl("span", { cls: "wb-btn-icon" }), "refresh-cw");
			reloadBtn.createEl("span", { text: "Reload" });
			reloadBtn.onclick = async () => {
				await this.render();
				new Notice("World Builder reloaded.");
			};
		}
		if (onCreate) {
			const btn = actions.createEl("button", { text: "+ New", cls: "wb-btn-primary" });
			btn.onclick = onCreate;
		}
	}

	/**
	 * Employers: one collapsible sub-section per `type` property (Corporation, Government, Military, then Criminal),
	 * with employers that have no recognised type in an "Unassigned" section last. Headers use the
	 * same chevron as the Characters employer groups, without a logo. Each section is its own
	 * drag-to-reorder list; its order is merged back into the tab's single saved order.
	 *
	 * An employer whose `subsidiary-of` property names another employer on this tab (matched on
	 * that employer's `name`, tolerant of "[[Name]]" syntax, case and accents) is not listed in its
	 * own type section: it is drawn under its parent's card, inside a collapsible "Subsidiaries"
	 * label, whatever its own `type` says. If the parent can't be found (unset, misspelled, not an
	 * employer, or part of a loop), the entry falls back to its `type` section as usual.
	 */
	private renderTypeGroups(
		tab: WBTab,
		container: HTMLElement,
		entries: NoteEntry[],
		getCard: CardFn,
		opts: { thumbs?: boolean; stackBadge?: boolean; expandable?: boolean }
	) {
		const known = new Set(EMPLOYER_TYPES.map((t) => t.key));
		// Only entries whose parent was actually found are nested; everything else is a root.
		const { roots, childrenOf } = buildParentTree(
			entries,
			(fm) => fm[SUBSIDIARY_OF] ?? "",
			(fm) => fm.name ?? ""
		);
		const groups = new Map<string, NoteEntry[]>();
		for (const entry of roots) {
			const raw = (entry.fm.type ?? "").trim().toLowerCase();
			const key = known.has(raw) ? raw : "";
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(entry);
		}

		const sections = [...EMPLOYER_TYPES, { key: "", label: "Unassigned" }].filter((t) => groups.has(t.key));
		for (const { key, label } of sections) {
			const header = container.createDiv("wb-group-header");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			setIcon(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
			header.createEl("span", { cls: "wb-group-title", text: label });
			const list = container.createDiv("wb-list");

			const applyCollapsed = (collapsed: boolean) => {
				header.classList.toggle("is-collapsed", collapsed);
				list.classList.toggle("is-collapsed", collapsed);
				header.setAttribute("aria-expanded", String(!collapsed));
			};
			applyCollapsed(this.plugin.settings.collapsedEmployerTypes.includes(key));
			this.groupCollapsers.set(header, () => {
				const settings = this.plugin.settings;
				if (!settings.collapsedEmployerTypes.includes(key)) settings.collapsedEmployerTypes = [...settings.collapsedEmployerTypes, key];
				applyCollapsed(true);
			});

			const toggleCollapsed = async () => {
				// While searching, matching sections are shown open regardless; leave the saved state alone.
				if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
				const settings = this.plugin.settings;
				const collapse = !settings.collapsedEmployerTypes.includes(key);
				settings.collapsedEmployerTypes = collapse
					? [...settings.collapsedEmployerTypes, key]
					: settings.collapsedEmployerTypes.filter((k) => k !== key);
				applyCollapsed(collapse);
				await this.plugin.saveSettings();
			};
			header.onclick = toggleCollapsed;
			header.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					toggleCollapsed();
				}
			};

			this.renderEmployerList(tab, list, groups.get(key)!, entries, childrenOf, getCard, opts);
		}
	}

	/**
	 * Draws one drag-to-reorder list of employer cards (a type section, or one parent's
	 * subsidiaries). Any card with subsidiaries gets a `.wb-child-group` right after it holding a
	 * collapsible "Subsidiaries" label and their own nested list, drawn the same way (so a
	 * subsidiary's own subsidiaries nest one level further in). The child group follows its card
	 * when it is dragged, and subsidiaries can only be reordered among themselves.
	 */
	private renderEmployerList(
		tab: WBTab,
		list: HTMLElement,
		groupEntries: NoteEntry[],
		allEntries: NoteEntry[],
		childrenOf: Map<string, NoteEntry[]>,
		getCard: CardFn,
		opts: { thumbs?: boolean; stackBadge?: boolean; expandable?: boolean }
	) {
		const items = this.orderEntries(groupEntries, this.plugin.settings.sectionOrder[tab] ?? []);
		for (const entry of items) {
			this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
			const kids = childrenOf.get(entry.file.path);
			if (kids && kids.length) this.renderSubsidiaries(tab, list, entry, kids, allEntries, childrenOf, getCard, opts);
		}
		this.enableReorder(list, async (order) => {
			const settings = this.plugin.settings;
			const baseline = this.orderEntries(allEntries, settings.sectionOrder[tab] ?? []).map((e) => e.file.path);
			settings.sectionOrder[tab] = mergeGroupOrder(baseline, items.map((e) => e.file.path), order);
			await this.plugin.saveSettings();
		});
	}

	/** The collapsible "Subsidiaries" label (and its nested list) drawn right under a parent employer's card. */
	private renderSubsidiaries(
		tab: WBTab,
		list: HTMLElement,
		parent: NoteEntry,
		kids: NoteEntry[],
		allEntries: NoteEntry[],
		childrenOf: Map<string, NoteEntry[]>,
		getCard: CardFn,
		opts: { thumbs?: boolean; stackBadge?: boolean; expandable?: boolean }
	) {
		const path = parent.file.path;
		const group = list.createDiv("wb-child-group wb-subsidiary-group");
		const header = group.createDiv("wb-group-header wb-subsidiary-header");
		header.setAttribute("role", "button");
		header.setAttribute("tabindex", "0");
		setIcon(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
		header.createEl("span", { cls: "wb-group-title", text: "Subsidiaries" });
		header.createEl("span", { cls: "wb-group-count", text: String(kids.length) });
		const subList = group.createDiv("wb-list");

		const applyCollapsed = (collapsed: boolean) => {
			header.classList.toggle("is-collapsed", collapsed);
			subList.classList.toggle("is-collapsed", collapsed);
			header.setAttribute("aria-expanded", String(!collapsed));
		};
		applyCollapsed(this.plugin.settings.collapsedSubsidiaries.includes(path));
		this.groupCollapsers.set(header, () => {
			const settings = this.plugin.settings;
			if (!settings.collapsedSubsidiaries.includes(path)) settings.collapsedSubsidiaries = [...settings.collapsedSubsidiaries, path];
			applyCollapsed(true);
		});

		const toggleCollapsed = async () => {
			// While searching, matching sections are shown open regardless; leave the saved state alone.
			if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
			const settings = this.plugin.settings;
			const collapse = !settings.collapsedSubsidiaries.includes(path);
			settings.collapsedSubsidiaries = collapse
				? [...settings.collapsedSubsidiaries, path]
				: settings.collapsedSubsidiaries.filter((p) => p !== path);
			applyCollapsed(collapse);
			await this.plugin.saveSettings();
		};
		header.onclick = toggleCollapsed;
		header.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleCollapsed();
			}
		};

		this.renderEmployerList(tab, subList, kids, allEntries, childrenOf, getCard, opts);
	}

	/**
	 * Applies a saved manual order (a list of note paths, earliest first) to a set of entries.
	 * Anything not yet present in `saved` keeps its original relative position after the ordered ones.
	 */
	private orderEntries(entries: NoteEntry[], saved: string[]): NoteEntry[] {
		const rank = (path: string) => {
			const i = saved.indexOf(path);
			return i === -1 ? saved.length : i;
		};
		return entries
			.map((entry, index) => ({ entry, index }))
			.sort((a, b) => rank(a.entry.file.path) - rank(b.entry.file.path) || a.index - b.index)
			.map(({ entry }) => entry);
	}

	/**
	 * Draws one sibling group of a hierarchical (parent/child) tab - the roots, or one parent's
	 * children - as its own `.wb-list`, then recurses into each entry's own children (if any)
	 * as a further-indented sibling group nested right after that entry's card. Each group gets
	 * its own enableReorder() call, so a card can only be dragged among its own siblings, and
	 * indentation is pure left-side margin (`.wb-child-group` in styles.css) that shrinks the
	 * nested group in from the left while its right edge stays flush with everything above it.
	 */
	private renderHierarchicalGroup(
		tab: WBTab,
		host: HTMLElement,
		groupEntries: NoteEntry[],
		allEntries: NoteEntry[],
		childrenOf: Map<string, NoteEntry[]>,
		getCard: CardFn,
		thumbs: boolean,
		stackBadge: boolean,
		expandable: boolean
	) {
		const list = host.createDiv("wb-list");
		const ordered = this.orderEntries(groupEntries, this.plugin.settings.sectionOrder[tab] ?? []);
		for (const entry of ordered) {
			const kids = childrenOf.get(entry.file.path);
			// Every entry gets an Employers-style collapsible label right above its card. For a
			// parent it hides the card and its whole subtree; for a leaf it hides just the card.
			const header = this.createTreeHeader(list, getCard(entry.fm).title);
			const card = this.renderCard(tab, list, entry, getCard, thumbs, stackBadge, expandable);
			const parts: HTMLElement[] = [card];
			if (kids && kids.length) {
				const childHost = list.createDiv("wb-child-group");
				this.renderHierarchicalGroup(tab, childHost, kids, allEntries, childrenOf, getCard, thumbs, stackBadge, expandable);
				parts.push(childHost);
			}
			this.wireTreeCollapse(tab, header, parts, entry.file.path);
		}
		this.enableReorder(list, async (order) => {
			const settings = this.plugin.settings;
			const baseline = this.orderEntries(allEntries, settings.sectionOrder[tab] ?? []).map((e) => e.file.path);
			const groupPaths = ordered.map((e) => e.file.path);
			settings.sectionOrder[tab] = mergeGroupOrder(baseline, groupPaths, order);
			await this.plugin.saveSettings();
		});
	}

	/** A collapsible label (chevron + name) drawn above every hierarchical entry's card. */
	private createTreeHeader(list: HTMLElement, title: string): HTMLElement {
		const header = list.createDiv("wb-group-header wb-tree-header");
		header.setAttribute("role", "button");
		header.setAttribute("tabindex", "0");
		setIcon(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
		header.createEl("span", { cls: "wb-group-title", text: title });
		return header;
	}

	/**
	 * Makes a hierarchical parent's label collapse (or expand) the parent's own card together with
	 * its whole nested subtree - e.g. collapsing SOL hides everything in SOL, collapsing Earth hides
	 * Earth, Las Luna and Colonia. Nested labels keep their own saved state, so re-opening SOL shows
	 * Earth still collapsed if it was. The state is saved per note path in plugin data.
	 */
	private wireTreeCollapse(tab: WBTab, header: HTMLElement, parts: HTMLElement[], path: string) {
		for (const p of parts) p.setAttribute("data-tree-owner", path);
		const apply = (collapsed: boolean) => {
			header.classList.toggle("is-collapsed", collapsed);
			header.setAttribute("aria-expanded", String(!collapsed));
			for (const p of parts) p.classList.toggle("wb-tree-hidden", collapsed);
		};
		apply(this.plugin.settings.collapsedParents.includes(path));

		const setCollapsed = async (collapse: boolean) => {
			apply(collapse);
			const settings = this.plugin.settings;
			if (settings.collapsedParents.includes(path) === collapse) return;
			settings.collapsedParents = collapse
				? [...settings.collapsedParents, path]
				: settings.collapsedParents.filter((p) => p !== path);
			await this.plugin.saveSettings();
		};
		this.treeExpanders.set(path, () => setCollapsed(false));
		this.groupCollapsers.set(header, () => {
			const settings = this.plugin.settings;
			if (!settings.collapsedParents.includes(path)) settings.collapsedParents = [...settings.collapsedParents, path];
			apply(true);
		});

		const toggle = () => {
			// While searching, matching entries are shown open regardless; leave the saved state alone.
			if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
			setCollapsed(!header.classList.contains("is-collapsed"));
		};
		header.onclick = toggle;
		header.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggle();
			}
		};
	}

	/** The "No ... match" line; hidden until applySearch() finds nothing. */
	private createNoResultsLine(container: HTMLElement, label: string) {
		container.createDiv({
			cls: "wb-empty wb-no-results wb-filtered-out",
			attr: { "data-noun": label.toLowerCase() },
		});
	}

	private renderCard(
		tab: WBTab,
		parent: HTMLElement,
		entry: NoteEntry,
		getCard: CardFn,
		thumbs: boolean,
		stackBadge: boolean,
		expandable: boolean
	): HTMLElement {
		const { file, content, fm } = entry;
		const { title, meta, badge, search, extraBadges } = getCard(fm);

		const card = parent.createDiv("wb-card");
		if (stackBadge) card.addClass("wb-card-stacked");
		card.setAttribute("data-path", file.path);
		// Characters supply their own (four properties); everything else searches name + note text.
		this.searchIndex.set(card, normalizeForSearch(search ?? `${title} ${documentSearchText(content, fm)}`));
		// Thumbnail + text live in their own row, kept separate from the card itself so that when
		// an expand area is appended below (see toggleCardExpand), it isn't pulled into this row's
		// flex layout as a second column — it stays a full-width block underneath.
		let body: HTMLElement = card;
		if (thumbs) {
			card.addClass("wb-card-with-thumb");
			const row = card.createDiv("wb-card-row");
			const thumb = row.createDiv("wb-thumb");
			const src = this.findFirstImageSrc(content, file);
			if (src) {
				const img = thumb.createEl("img", { attr: { src, alt: "", draggable: "false" } });
				thumb.addClass("wb-thumb-has-img");
				// Magnifier badge in the top-right corner; CSS only reveals it (on hover) while the
				// card is expanded, which is also the only time a click on the photo zooms it.
				const zoomBadge = thumb.createSpan({ cls: "wb-thumb-zoom", attr: { "aria-hidden": "true" } });
				setIcon(zoomBadge, "zoom-in");
				img.onerror = () => {
					img.remove();
					zoomBadge.remove();
					thumb.removeClass("wb-thumb-has-img");
				};
				thumb.addEventListener("click", (e) => {
					// Collapsed: let the click fall through to the card so it expands as usual.
					if (!card.classList.contains("wb-card-expanded") || !thumb.contains(img)) return;
					e.preventDefault();
					e.stopPropagation();
					openImageZoom(src, title);
				});
			}
			body = row.createDiv("wb-card-body");
		}
		const titleEl = body.createDiv("wb-card-title");
		titleEl.createSpan({ text: title });
		if (expandable) titleEl.addClass("wb-card-title-row");
		const extras = extraBadges ?? [];
		if (badge || extras.length) {
			// stackBadge: badge on its own line under the name; otherwise inline beside it
			const badgeHost = stackBadge ? body.createDiv("wb-card-badge-row") : titleEl;
			if (badge) {
				const b = badgeHost.createSpan({ cls: `wb-badge wb-badge-${badge.toLowerCase()}` });
				b.setText(badge);
			}
			for (const extra of extras) badgeHost.createSpan({ cls: `wb-badge ${extra.cls}`, text: extra.text });
		}
		// Added last so it's always the rightmost element in the title row, after any inline badge.
		if (expandable) setIcon(titleEl.createSpan({ cls: "wb-card-chevron" }), "chevron-right");
		if (meta) for (const line of meta.split("\n")) body.createDiv({ cls: "wb-card-meta", text: line });

		if (expandable) {
			card.setAttribute("role", "button");
			card.setAttribute("tabindex", "0");
			card.setAttribute("aria-expanded", "false");
			card.onclick = () => this.toggleCardExpand(tab, card, entry);
			card.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.toggleCardExpand(tab, card, entry);
				}
			};
		} else {
			card.onclick = () => this.app.workspace.getLeaf().openFile(file);
		}
		return card;
	}

	/**
	 * Expands a card in place to show the note's text (no images) instead of opening it in the
	 * editor, so writing in the main pane isn't interrupted. An Edit button in the expanded area
	 * still opens the note the normal way. Clicking the card again (or its chevron) collapses it.
	 */
	private toggleCardExpand(tab: WBTab, card: HTMLElement, entry: NoteEntry) {
		const wasExpanded = card.classList.contains("wb-card-expanded");
		card.querySelector(":scope > .wb-card-expand")?.remove();
		card.removeClass("wb-card-expanded");
		card.setAttribute("aria-expanded", "false");
		if (wasExpanded) {
			this.recordNav(tab, null);
			return;
		}

		card.addClass("wb-card-expanded");
		card.setAttribute("aria-expanded", "true");

		const expand = card.createDiv("wb-card-expand");
		// Cards are drag-sortable (draggable="true"); override that here so selecting text in the
		// preview doesn't get hijacked into a card drag.
		expand.setAttribute("draggable", "false");
		// Clicks inside the expanded area (the Edit button, links, selecting text) shouldn't
		// also toggle the card's own expand/collapse handler.
		expand.onclick = (e) => e.stopPropagation();
		// Same for keys: Enter/Space on the footer buttons shouldn't reach the card's own key handler.
		expand.onkeydown = (e) => e.stopPropagation();

		const body = expand.createDiv("wb-card-expand-body");
		body.addClass("markdown-rendered");
		// Frontmatter (properties already shown on the card above) and images are both stripped,
		// plus the leading "# Name" heading the character template opens with, which just
		// restates the card's own title.
		const bodyText = stripLeadingHeading(stripFrontmatterBlock(entry.content));
		const textOnly = stripGraphics(bodyText);
		MarkdownRenderer.render(this.app, textOnly, body, entry.file.path, this);

		// Wiki-links in the preview (e.g. "Part of: [[Colonia]]") are rendered as clickable text but
		// do nothing on their own; jump to the linked note's own card instead of leaving the sidebar.
		body.addEventListener("click", (e) => {
			const target = e.target as HTMLElement;
			const link = target.closest<HTMLElement>("a.internal-link");
			if (!link) return;
			e.preventDefault();
			e.stopPropagation();
			const href = link.getAttribute("data-href") ?? link.getAttribute("href");
			if (href) this.followWikiLink(href, entry.file.path);
		});

		// Bookmark (left) and Edit (right) sit at the bottom, under their own divider, so they don't compete with the text.
		const footer = expand.createDiv("wb-card-expand-footer");
		const bookmarkBtn = footer.createEl("button", {
			cls: "wb-btn-secondary wb-icon-btn wb-bookmark-toggle",
			attr: { type: "button", "data-bookmark-path": entry.file.path },
		});
		setIcon(bookmarkBtn, "bookmark");
		this.syncBookmarkToggle(bookmarkBtn, this.plugin.settings.bookmarks.includes(entry.file.path));
		bookmarkBtn.onclick = () => this.toggleBookmark(entry.file.path);
		const editBtn = footer.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
		setIcon(editBtn.createEl("span", { cls: "wb-btn-icon" }), "pencil");
		editBtn.createEl("span", { text: "Edit" });
		editBtn.onclick = () => this.app.workspace.getLeaf().openFile(entry.file);

		this.recordNav(tab, entry.file.path);
	}

	/**
	 * "Collapse all" for one section, triggered by double-clicking its (already active) tab button:
	 * closes every expanded card preview and folds every collapsible group label in the section
	 * (employer groups on Characters, type groups and Subsidiaries on Employers, every tree label
	 * and the Ships section on Locations). The folded state is saved like a manual fold. While a
	 * search is active the matching entries still show (as with a manual fold); the saved state
	 * takes over once the search is cleared.
	 */
	private async collapseAllInTab(tab: SectionTab) {
		const pane = this.tabContents[tab];
		if (!pane) return;

		let closedCard = false;
		pane.body.querySelectorAll<HTMLElement>(".wb-card.wb-card-expanded").forEach((card) => {
			card.querySelector(":scope > .wb-card-expand")?.remove();
			card.removeClass("wb-card-expanded");
			card.setAttribute("aria-expanded", "false");
			closedCard = true;
		});
		if (closedCard) this.recordNav(tab, null);

		let folded = false;
		pane.body.querySelectorAll<HTMLElement>(".wb-group-header").forEach((header) => {
			const collapse = this.groupCollapsers.get(header);
			if (!collapse) return;
			collapse();
			folded = true;
		});
		this.refreshCurrentCardHighlight();
		this.updateShadowFn?.();
		if (folded) await this.plugin.saveSettings();
	}

	/** The section folder a tab's notes live in, e.g. "World/Characters". */
	private tabFolder(tab: SectionTab): string {
		return `${this.plugin.settings.worldFolder}/${SECTION_LABELS[tab]}`;
	}

	/** Which tab (if any) a given file's own card lives on. */
	private findEntryTab(file: TFile): SectionTab | null {
		for (const tab of SECTION_TABS) {
			if (file.path.startsWith(this.tabFolder(tab) + "/")) return tab;
		}
		return null;
	}

	/**
	 * Switches the active tab's DOM (fixed header half + scrolling body half) without touching
	 * navigation history — callers that count as a "navigation" record it themselves via recordNav().
	 */
	private switchTab(id: WBTab) {
		this.activeTab = id;
		if (id !== "bookmarks") this.lastSectionTab = id;
		this.tabBarEl?.querySelectorAll<HTMLElement>(".wb-tab").forEach((b) => b.removeClass("active"));
		this.tabBarEl?.querySelector<HTMLElement>(`.wb-tab[data-tab="${id}"]`)?.addClass("active");
		Object.values(this.tabContents).forEach((c) => { c?.head.removeClass("active"); c?.body.removeClass("active"); });
		this.tabContents[id]?.head.addClass("active");
		this.tabContents[id]?.body.addClass("active");
		this.showTabSearchFn?.();
		this.updateShadowFn?.();
		this.updateBookmarkHeaderButtons();
	}

	// ─── Bookmarks ───────────────────────────────────────────────────────────

	/** The title row's Bookmarks button: opens the Bookmarks view, or goes back to the last section if it's already open. */
	private toggleBookmarksView() {
		const target: WBTab = this.activeTab === "bookmarks" ? this.lastSectionTab : "bookmarks";
		this.switchTab(target);
		this.recordNav(target, null);
	}

	private updateBookmarkHeaderButtons() {
		const open = this.activeTab === "bookmarks";
		for (const btn of this.bookmarkHeaderButtons) {
			btn.classList.toggle("is-active", open);
			btn.setAttribute("aria-pressed", String(open));
			btn.setAttribute("aria-label", open ? "Close bookmarks" : "Bookmarks");
		}
	}

	private syncBookmarkToggle(btn: HTMLElement, on: boolean) {
		btn.classList.toggle("is-bookmarked", on);
		btn.setAttribute("aria-pressed", String(on));
		btn.setAttribute("aria-label", on ? "Remove bookmark" : "Add bookmark");
	}

	/** Adds or removes one note from the bookmarks, updating every expanded copy of its card. */
	private async toggleBookmark(path: string) {
		const settings = this.plugin.settings;
		const on = !settings.bookmarks.includes(path);
		settings.bookmarks = on ? [...settings.bookmarks, path] : settings.bookmarks.filter((p) => p !== path);
		this.containerEl.querySelectorAll<HTMLElement>(".wb-bookmark-toggle").forEach((btn) => {
			if (btn.getAttribute("data-bookmark-path") === path) this.syncBookmarkToggle(btn, on);
		});
		// Redraw the Bookmarks list right away, so an entry un-bookmarked from inside the Bookmarks
		// view disappears from it without needing Reload.
		this.renderBookmarks();
		await this.plugin.saveSettings();
	}

	/**
	 * Draws the Bookmarks view's list: bookmarked entries grouped under collapsible section headers
	 * (Characters, Locations, ...), each card drawn exactly as on its own tab. Each group can be
	 * dragged into its own order, saved back into the single bookmarks list.
	 */
	private renderBookmarks() {
		const pane = this.tabContents.bookmarks;
		if (!pane) return;
		const container = pane.body;
		const tab: WBTab = "bookmarks";
		// Keep what the reader had open (expanded cards, scroll position) across the redraw.
		const wasExpanded = new Set(
			Array.from(container.querySelectorAll<HTMLElement>(".wb-card.wb-card-expanded")).map(
				(c) => c.getAttribute("data-path") ?? ""
			)
		);
		const scrollEl = this.activeTab === tab ? container.closest<HTMLElement>(".wb-scroll") : null;
		const scrollTop = scrollEl?.scrollTop ?? 0;
		container.empty();

		const entries = this.plugin.settings.bookmarks
			.map((path) => this.entryByPath.get(path))
			.filter((e): e is NoteEntry => !!e);
		if (entries.length === 0) {
			container.createDiv("wb-list").createDiv({
				cls: "wb-empty",
				text: "No bookmarks yet. Expand an entry and click its bookmark icon to add it here.",
			});
			this.applySearch(tab);
			return;
		}

		for (const section of SECTION_TABS) {
			const cfg = this.sectionConfigs[section];
			const items = entries.filter((e) => this.findEntryTab(e.file) === section);
			if (!cfg || items.length === 0) continue;

			const header = container.createDiv("wb-group-header");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			setIcon(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
			header.createEl("span", { cls: "wb-group-title", text: SECTION_LABELS[section] });
			const list = container.createDiv("wb-list");

			const applyCollapsed = (collapsed: boolean) => {
				header.classList.toggle("is-collapsed", collapsed);
				list.classList.toggle("is-collapsed", collapsed);
				header.setAttribute("aria-expanded", String(!collapsed));
			};
			applyCollapsed(this.plugin.settings.collapsedBookmarkGroups.includes(section));
			const toggleCollapsed = async () => {
				if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
				const settings = this.plugin.settings;
				const collapse = !settings.collapsedBookmarkGroups.includes(section);
				settings.collapsedBookmarkGroups = collapse
					? [...settings.collapsedBookmarkGroups, section]
					: settings.collapsedBookmarkGroups.filter((k) => k !== section);
				applyCollapsed(collapse);
				await this.plugin.saveSettings();
			};
			header.onclick = toggleCollapsed;
			header.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					toggleCollapsed();
				}
			};

			for (const entry of items) this.renderCard(tab, list, entry, cfg.getCard, cfg.thumbs, cfg.stackBadge, true);
			this.enableReorder(list, async (order) => {
				const settings = this.plugin.settings;
				// Skip cards un-bookmarked since the list was drawn, so a drag can't bring them back.
				const kept = order.filter((p) => settings.bookmarks.includes(p));
				settings.bookmarks = mergeGroupOrder(settings.bookmarks, items.map((e) => e.file.path), kept);
				await this.plugin.saveSettings();
			});
		}

		this.createNoResultsLine(container, "Bookmarks");
		this.applySearch(tab);

		// Re-open the cards that were expanded before the redraw, without adding history entries.
		if (wasExpanded.size) {
			this.restoringNav = true;
			try {
				container.querySelectorAll<HTMLElement>(".wb-card").forEach((card) => {
					const path = card.getAttribute("data-path") ?? "";
					const entry = this.entryByPath.get(path);
					if (entry && wasExpanded.has(path)) this.toggleCardExpand(tab, card, entry);
				});
			} finally {
				this.restoringNav = false;
			}
		}
		if (scrollEl) scrollEl.scrollTop = scrollTop;
		this.refreshCurrentCardHighlight();
	}

	/**
	 * Records where the sidebar is now pointed (which tab, and which card - if any - is the one the
	 * user just navigated to) as a Back/Forward history entry. Ignored while a Back/Forward click is
	 * itself replaying a past entry, and skipped if it's identical to the current entry.
	 */
	private recordNav(tab: WBTab, cardPath: string | null) {
		if (this.restoringNav) return;
		const top = this.navHistory[this.navIndex];
		if (top && top.tab === tab && top.cardPath === cardPath) return;
		this.navHistory = this.navHistory.slice(0, this.navIndex + 1);
		this.navHistory.push({ tab, cardPath });
		this.navIndex = this.navHistory.length - 1;
		this.updateNavButtonStates();
	}

	private updateNavButtonStates() {
		const canBack = this.navIndex > 0;
		const canForward = this.navIndex < this.navHistory.length - 1;
		for (const { back, fwd } of this.navButtons) {
			back.toggleAttribute("disabled", !canBack);
			fwd.toggleAttribute("disabled", !canForward);
		}
		this.refreshCurrentCardHighlight();
	}

	/**
	 * Marks the card at the current point in the nav history (if any) as the "current" one, with an
	 * accent-colored border, and makes sure it's the only card so marked. Derived fresh from
	 * navHistory every time rather than tracked separately, so there's never more than one: expanding
	 * or jumping to a different card, collapsing the current one, or stepping Back/Forward all just
	 * change which entry (if any) is at navIndex, and this re-reads that.
	 */
	private refreshCurrentCardHighlight() {
		this.containerEl
			.querySelectorAll<HTMLElement>(".wb-card-current")
			.forEach((el) => el.removeClass("wb-card-current"));
		const current = this.navHistory[this.navIndex];
		if (!current?.cardPath) return;
		const pane = this.tabContents[current.tab];
		const card = pane?.body.querySelector<HTMLElement>(`.wb-card[data-path="${CSS.escape(current.cardPath)}"]`);
		card?.addClass("wb-card-current");
	}

	private navigateBack() {
		if (this.navIndex <= 0) return;
		this.navIndex--;
		this.applyNavEntry(this.navHistory[this.navIndex]);
	}

	private navigateForward() {
		if (this.navIndex >= this.navHistory.length - 1) return;
		this.navIndex++;
		this.applyNavEntry(this.navHistory[this.navIndex]);
	}

	private applyNavEntry(entry: { tab: WBTab; cardPath: string | null }) {
		this.restoringNav = true;
		try {
			this.switchTab(entry.tab);
			if (entry.cardPath) this.revealCard(entry.tab, entry.cardPath);
		} finally {
			this.restoringNav = false;
		}
		this.updateNavButtonStates();
	}

	/**
	 * Follows a wiki-link clicked inside an expanded card's preview: if the target note has its own
	 * card somewhere in the sidebar, switches to that tab, expands its card and scrolls it into view
	 * instead of opening the note in the main editor. Anything outside the tracked sections (or an
	 * unresolved link) falls back to Obsidian's normal "open the note" behavior.
	 */
	private followWikiLink(linktext: string, sourcePath: string) {
		const linkPath = linktext.split("#")[0]!;
		const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
		if (!dest) {
			new Notice(`Couldn't find "${linktext}".`);
			return;
		}
		const tab = this.findEntryTab(dest);
		if (!tab) {
			this.app.workspace.getLeaf().openFile(dest);
			return;
		}
		if (tab !== this.activeTab) this.switchTab(tab);
		this.revealCard(tab, dest.path);
	}

	/**
	 * Brings one tab's card into view: un-collapses its employer group if needed, clears an active
	 * search filter that would otherwise hide it, expands it (recording that as a nav entry, same as
	 * a direct click would), and scrolls it into view.
	 */
	private revealCard(tab: WBTab, path: string) {
		const pane = this.tabContents[tab];
		if (!pane) return;
		const card = pane.body.querySelector<HTMLElement>(`.wb-card[data-path="${CSS.escape(path)}"]`);
		if (!card) return;

		// Open every collapsed list the card sits in (an employer group, and on Employers any
		// "Subsidiaries" labels it is nested under).
		for (let list = card.closest<HTMLElement>(".wb-list"); list && list !== pane.body; list = list.parentElement?.closest<HTMLElement>(".wb-list") ?? null) {
			if (!list.classList.contains("is-collapsed")) continue;
			list.removeClass("is-collapsed");
			const header = list.previousElementSibling;
			if (header instanceof HTMLElement && header.classList.contains("wb-group-header")) {
				header.removeClass("is-collapsed");
				header.setAttribute("aria-expanded", "true");
			}
		}
		// Hierarchical tabs: open every collapsed parent label the card sits under (or belongs to).
		for (let el: HTMLElement | null = card; el && el !== pane.body; el = el.parentElement) {
			if (!el.classList.contains("wb-tree-hidden")) continue;
			const owner = el.getAttribute("data-tree-owner");
			if (owner) void this.treeExpanders.get(owner)?.();
		}

		if (card.classList.contains("wb-filtered-out") && this.searchQueries[tab]) {
			this.searchQueries[tab] = "";
			this.applySearch(tab);
			if (tab === this.activeTab) this.showTabSearchFn?.();
		}

		if (!card.classList.contains("wb-card-expanded")) {
			const entry = this.entryByPath.get(path);
			if (entry) this.toggleCardExpand(tab, card, entry);
		}

		card.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	/**
	 * Makes the cards in one list drag-sortable (an employer's character group, a hierarchical
	 * tab's parent or child group, or a whole flat tab like Lore). Each list only accepts cards
	 * that were picked up from that same list, so entries can't be dragged between employers,
	 * between a parent's children and its siblings, or between tabs. Every DOM query here is
	 * scoped to this list's own direct children (`:scope > .wb-card`) so a hierarchical tab's
	 * nested child-group lists - which live inside this list's DOM subtree - are never touched by
	 * an ancestor list's bookkeeping, and every listener stops propagation so a drag started in a
	 * nested list isn't also seen by the (ancestor) lists it's nested inside. The new order is
	 * handed to `onReorder` to persist to plugin data; notes themselves are never modified.
	 */
	private enableReorder(list: HTMLElement, onReorder: (order: string[]) => Promise<void>) {
		let dragged: HTMLElement | null = null;
		let dropTarget: HTMLElement | null = null;
		let dropAfter = false;

		const cardAt = (t: EventTarget | null): HTMLElement | null =>
			t instanceof HTMLElement ? t.closest<HTMLElement>(".wb-card") : null;
		// A card's "unit": its tree label above it and its nested child group below it (hierarchical
		// tabs), so a parent is always dragged together with its whole subtree.
		const unitOf = (card: HTMLElement): HTMLElement[] => {
			const parts: HTMLElement[] = [];
			const prev = card.previousElementSibling;
			if (prev instanceof HTMLElement && prev.classList.contains("wb-tree-header")) parts.push(prev);
			parts.push(card);
			const next = card.nextElementSibling;
			if (next instanceof HTMLElement && next.classList.contains("wb-child-group")) parts.push(next);
			return parts;
		};
		const clearMarks = () => {
			list.querySelectorAll(":scope > .wb-drop-before, :scope > .wb-drop-after").forEach((el) =>
				el.classList.remove("wb-drop-before", "wb-drop-after")
			);
			dropTarget = null;
		};

		list.querySelectorAll<HTMLElement>(":scope > .wb-card").forEach((card) =>
			card.setAttribute("draggable", "true")
		);

		list.addEventListener("dragstart", (e) => {
			const card = cardAt(e.target);
			if (!card || card.parentElement !== list || !e.dataTransfer) return;
			e.stopPropagation(); // keep an ancestor (hierarchical) list from also seeing this drag
			dragged = card;
			e.dataTransfer.effectAllowed = "move";
			// Custom type only, so dropping onto a note or editor doesn't paste anything.
			e.dataTransfer.setData("application/x-wb-card", card.getAttribute("data-path") ?? "");
			window.setTimeout(() => card.classList.add("wb-dragging"), 0);
		});

		list.addEventListener("dragend", () => {
			dragged?.classList.remove("wb-dragging");
			dragged = null;
			clearMarks();
		});

		list.addEventListener("dragover", (e) => {
			if (!dragged) return; // not picked up from this list: not a valid drop
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			const target = cardAt(e.target);
			if (!target || target.parentElement !== list) return; // in a gap, or over a nested child group: keep the last indicator
			clearMarks();
			if (target === dragged) return;
			const r = target.getBoundingClientRect();
			dropTarget = target;
			dropAfter = e.clientY >= r.top + r.height / 2;
			const unit = unitOf(target);
			(dropAfter ? unit[unit.length - 1]! : unit[0]!).classList.add(dropAfter ? "wb-drop-after" : "wb-drop-before");
		});

		list.addEventListener("dragleave", (e) => {
			if (!list.contains(e.relatedTarget as Node | null)) clearMarks();
		});

		list.addEventListener("drop", async (e) => {
			if (!dragged) return;
			e.preventDefault();
			e.stopPropagation();
			const moving = dragged;
			if (dropTarget && dropTarget !== moving) {
				const movingParts = unitOf(moving);
				const targetParts = unitOf(dropTarget);
				const ref = dropAfter ? targetParts[targetParts.length - 1]!.nextSibling : targetParts[0]!;
				// Dropping right where the unit already sits leaves it in place.
				if (!movingParts.includes(ref as HTMLElement)) {
					for (const part of movingParts) list.insertBefore(part, ref);
				}
				const order = Array.from(list.querySelectorAll<HTMLElement>(":scope > .wb-card")).map(
					(c) => c.getAttribute("data-path") ?? ""
				);
				await onReorder(order);
			}
			clearMarks();
		});
	}
}

// ─── Modals ──────────────────────────────────────────────────────────────────

class CharacterModal extends Modal {
	plugin: WorldBuilderPlugin;
	onDone: () => void;
	data = {
		name: "", role: "protagonist", age: "", employer: "", ship: "", home: "",
		physicalDesc: "", personality: "", goals: ""
	};

	constructor(app: App, plugin: WorldBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Character" });

		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("Character name").onChange((v) => (this.data.name = v));
		});
		new Setting(contentEl).setName("Role").addDropdown((d) => {
			["protagonist", "antagonist", "supporting", "minor"].forEach((o) =>
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
			);
			d.setValue(this.data.role);
			d.onChange((v) => (this.data.role = v));
		});
		new Setting(contentEl).setName("Age").addText((t) => {
			t.setPlaceholder("e.g. 34").onChange((v) => (this.data.age = v));
		});
		new Setting(contentEl).setName("Employer").addText((t) => {
			t.setPlaceholder("Employer name").onChange((v) => (this.data.employer = v));
		});
		new Setting(contentEl).setName("Ship").addText((t) => {
			t.setPlaceholder("Ship name").onChange((v) => (this.data.ship = v));
		});
		new Setting(contentEl).setName("Home").addText((t) => {
			t.setPlaceholder("Home name").onChange((v) => (this.data.home = v));
		});
		new Setting(contentEl).setName("Physical Description").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.physicalDesc = v));
		});
		new Setting(contentEl).setName("Personality").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.personality = v));
		});
		new Setting(contentEl).setName("Goals").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.goals = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => this.submit())
		);
	}

	async submit() {
		if (!this.data.name.trim()) { new Notice("Name is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Characters`;
		// Character note sections, in order. Text entered in the form goes under its heading;
		// the rest are left as empty headings to fill in later.
		const sections: [string, string][] = [
			["Origin", ""],
			["Physical Description", this.data.physicalDesc],
			["Occupation", ""],
			["Resume", ""],
			["Role In Story", ""],
			["Goals", this.data.goals],
			["Personality", this.data.personality],
			["Habits/Mannerisms", ""],
			["Earlier Life", ""],
			["Internal Conflicts", ""],
			["External Conflicts", ""],
		];
		const headingColor = "#fac08f";
		const sectionLines: string[] = [];
		for (const [heading, text] of sections) {
			sectionLines.push(`## <font color="${headingColor}">${heading}</font>`);
			if (text) sectionLines.push(text);
			sectionLines.push("");
		}
		const content = [
			"---",
			`name: "${this.data.name}"`,
			`role: ${this.data.role}`,
			`age: "${this.data.age}"`,
			`employer: "${this.data.employer}"`,
			`ship: "${this.data.ship}"`,
			`home: "${this.data.home}"`,
			`type: character`,
			"---",
			"",
			`# ${this.data.name}`,
			"",
			...sectionLines,
		].join("\n");
		const file = await createNote(this.app, folder, this.data.name, content);
		new Notice(`Character "${this.data.name}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() { this.contentEl.empty(); }
}

class LocationModal extends Modal {
	plugin: WorldBuilderPlugin;
	onDone: () => void;
	data = {
		name: "", type: "planet", parent: "", description: "",
		inhabitants: "", secrets: ""
	};

	constructor(app: App, plugin: WorldBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Location" });

		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("Location name").onChange((v) => (this.data.name = v));
		});
		new Setting(contentEl).setName("Type").addDropdown((d) => {
			["planet", "dwarf planet", "moon", "station", "asteroid", "belt", "ship", "city", "region", "building", "landmark", "other"].forEach((o) =>
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
			);
			d.setValue(this.data.type);
			d.onChange((v) => (this.data.type = v));
		});
		new Setting(contentEl).setName("Parent Location").addText((t) => {
			t.setPlaceholder("e.g. The Northern Kingdom").onChange((v) => (this.data.parent = v));
		});
		new Setting(contentEl).setName("Description").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.description = v));
		});
		new Setting(contentEl).setName("Who Lives Here").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.inhabitants = v));
		});
		new Setting(contentEl).setName("Secrets").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.secrets = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => this.submit())
		);
	}

	async submit() {
		if (!this.data.name.trim()) { new Notice("Name is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Locations`;
		const parentLink = this.data.parent ? `[[${this.data.parent}]]` : "";
		const content = [
			"---",
			`name: "${this.data.name}"`,
			`type: ${this.data.type}`,
			`parent: "${this.data.parent}"`,
			`entry_type: location`,
			"---",
			"",
			`# ${this.data.name}`,
			"",
			...(parentLink ? [`**Part of:** ${parentLink}`, ""] : []),
			"## Description",
			this.data.description || "_None provided._",
			"",
			"## Who Lives Here",
			this.data.inhabitants || "_None provided._",
			"",
			"## Secrets",
			this.data.secrets || "_None provided._",
		].join("\n");
		const file = await createNote(this.app, folder, this.data.name, content);
		new Notice(`Location "${this.data.name}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() { this.contentEl.empty(); }
}

class EmployerModal extends Modal {
	plugin: WorldBuilderPlugin;
	onDone: () => void;
	data = {
		name: "", type: "corporation", subsidiaryOf: "", alignment: "neutral", goals: "", enemies: "", allies: "", description: ""
	};

	constructor(app: App, plugin: WorldBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Employer" });

		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("Employer name").onChange((v) => (this.data.name = v));
		});
		new Setting(contentEl).setName("Type").addDropdown((d) => {
			EMPLOYER_TYPES.forEach(({ key, label }) => d.addOption(key, label));
			d.setValue(this.data.type);
			d.onChange((v) => (this.data.type = v));
		});
		// Existing employers (by their `name` property, else the file name), alphabetically.
		const folder = `${this.plugin.settings.worldFolder}/Employers/`;
		const existing = Array.from(new Set(
			this.app.vault.getMarkdownFiles()
				.filter((f) => f.path.startsWith(folder))
				.map((f) => {
					const name = this.app.metadataCache.getFileCache(f)?.frontmatter?.name;
					return (typeof name === "string" && name.trim()) ? name.trim() : f.basename;
				})
		)).sort((a, b) => a.localeCompare(b));
		new Setting(contentEl)
			.setName("Subsidiary of")
			.setDesc("Nests this employer under its parent's Subsidiaries label instead of its Type section.")
			.addDropdown((d) => {
				d.addOption("", "None");
				existing.forEach((n) => d.addOption(n, n));
				d.setValue(this.data.subsidiaryOf);
				d.onChange((v) => (this.data.subsidiaryOf = v));
			});
		new Setting(contentEl).setName("Alignment").addDropdown((d) => {
			["lawful", "neutral", "chaotic"].forEach((o) =>
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
			);
			d.setValue(this.data.alignment);
			d.onChange((v) => (this.data.alignment = v));
		});
		new Setting(contentEl).setName("Goals").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.goals = v));
		});
		new Setting(contentEl).setName("Enemies").addText((t) => {
			t.setPlaceholder("Comma-separated").onChange((v) => (this.data.enemies = v));
		});
		new Setting(contentEl).setName("Allies").addText((t) => {
			t.setPlaceholder("Comma-separated").onChange((v) => (this.data.allies = v));
		});
		new Setting(contentEl).setName("Description").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.description = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => this.submit())
		);
	}

	async submit() {
		if (!this.data.name.trim()) { new Notice("Name is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Employers`;
		const enemyLinks = this.data.enemies.split(",").filter(Boolean).map((e) => `[[${e.trim()}]]`).join(", ");
		const allyLinks = this.data.allies.split(",").filter(Boolean).map((a) => `[[${a.trim()}]]`).join(", ");
		const lines = [
			"---",
			`name: "${this.data.name}"`,
			`type: ${this.data.type}`,
			`${SUBSIDIARY_OF}: "${this.data.subsidiaryOf.replace(/"/g, "'")}"`,
			`alignment: ${this.data.alignment}`,
			`goals: "${this.data.goals.replace(/"/g, "'")}"`,
			`entry_type: employer`,
			"---",
			"",
			`# ${this.data.name}`,
			"",
			`**Type:** ${EMPLOYER_TYPES.find((t) => t.key === this.data.type)?.label ?? this.data.type}`,
			...(this.data.subsidiaryOf ? [`**Subsidiary of:** [[${this.data.subsidiaryOf}]]`] : []),
			`**Alignment:** ${this.data.alignment}`,
		];
		if (enemyLinks) lines.push(`**Enemies:** ${enemyLinks}`);
		if (allyLinks) lines.push(`**Allies:** ${allyLinks}`);
		lines.push("", "## Goals", this.data.goals || "_None provided._", "", "## Description", this.data.description || "_None provided._");
		const file = await createNote(this.app, folder, this.data.name, lines.join("\n"));
		new Notice(`Employer "${this.data.name}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() { this.contentEl.empty(); }
}

class LoreModal extends Modal {
	plugin: WorldBuilderPlugin;
	onDone: () => void;
	data = { title: "", category: "history", content: "" };

	constructor(app: App, plugin: WorldBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Lore Entry" });

		new Setting(contentEl).setName("Title").addText((t) => {
			t.setPlaceholder("Entry title").onChange((v) => (this.data.title = v));
		});
		new Setting(contentEl).setName("Category").addDropdown((d) => {
			["history", "tech", "religion", "culture", "other"].forEach((o) =>
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
			);
			d.setValue(this.data.category);
			d.onChange((v) => (this.data.category = v));
		});
		new Setting(contentEl).setName("Content").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.inputEl.style.minHeight = "120px";
			t.onChange((v) => (this.data.content = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => this.submit())
		);
	}

	async submit() {
		if (!this.data.title.trim()) { new Notice("Title is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Lore`;
		const content = [
			"---",
			`title: "${this.data.title}"`,
			`category: ${this.data.category}`,
			`entry_type: lore`,
			"---",
			"",
			`# ${this.data.title}`,
			"",
			`*Category: ${this.data.category}*`,
			"",
			this.data.content || "_No content yet._",
		].join("\n");
		const file = await createNote(this.app, folder, this.data.title, content);
		new Notice(`Lore entry "${this.data.title}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() { this.contentEl.empty(); }
}

class TimelineModal extends Modal {
	plugin: WorldBuilderPlugin;
	onDone: () => void;
	data = { date: "", title: "", description: "", characters: "", locations: "" };

	constructor(app: App, plugin: WorldBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Timeline Event" });

		new Setting(contentEl).setName("Date / Era").addText((t) => {
			t.setPlaceholder("e.g. Year 342 AE").onChange((v) => (this.data.date = v));
		});
		new Setting(contentEl).setName("Title").addText((t) => {
			t.setPlaceholder("Event title").onChange((v) => (this.data.title = v));
		});
		new Setting(contentEl).setName("Description").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.description = v));
		});
		new Setting(contentEl).setName("Linked Characters").addText((t) => {
			t.setPlaceholder("Comma-separated names").onChange((v) => (this.data.characters = v));
		});
		new Setting(contentEl).setName("Linked Locations").addText((t) => {
			t.setPlaceholder("Comma-separated names").onChange((v) => (this.data.locations = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => this.submit())
		);
	}

	async submit() {
		if (!this.data.title.trim()) { new Notice("Title is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Timeline`;
		const charLinks = this.data.characters.split(",").filter(Boolean).map((c) => `[[${c.trim()}]]`).join(", ");
		const locLinks = this.data.locations.split(",").filter(Boolean).map((l) => `[[${l.trim()}]]`).join(", ");
		const filename = this.data.date ? `${this.data.date} - ${this.data.title}` : this.data.title;
		const lines = [
			"---",
			`title: "${this.data.title}"`,
			`date: "${this.data.date}"`,
			`entry_type: timeline`,
			"---",
			"",
			`# ${this.data.title}`,
			"",
			`**Date/Era:** ${this.data.date || "_Unknown_"}`,
		];
		if (charLinks) lines.push(`**Characters:** ${charLinks}`);
		if (locLinks) lines.push(`**Locations:** ${locLinks}`);
		lines.push("", "## Description", this.data.description || "_None provided._");
		const file = await createNote(this.app, folder, filename, lines.join("\n"));
		new Notice(`Timeline event "${this.data.title}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() { this.contentEl.empty(); }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class WorldBuilderSettingTab extends PluginSettingTab {
	plugin: WorldBuilderPlugin;
	constructor(app: App, plugin: WorldBuilderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "World Builder Settings" });
		new Setting(containerEl)
			.setName("World Folder")
			.setDesc("Root folder for all world-building notes.")
			.addText((t) =>
				t
					.setPlaceholder("World")
					.setValue(this.plugin.settings.worldFolder)
					.onChange(async (v) => {
						this.plugin.settings.worldFolder = v || "World";
						await this.plugin.saveSettings();
					})
			);
	}
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class WorldBuilderPlugin extends Plugin {
	settings!: WorldBuilderSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new WorldBuilderView(leaf, this));

		this.addRibbonIcon("orbit", "World Builder", () => this.activateSidebar());

		this.addCommand({
			id: "open-sidebar",
			name: "Open World Builder sidebar",
			callback: () => this.activateSidebar(),
		});
		this.addCommand({
			id: "new-character",
			name: "New Character",
			callback: () => new CharacterModal(this.app, this, () => this.refreshSidebar()).open(),
		});
		this.addCommand({
			id: "new-location",
			name: "New Location",
			callback: () => new LocationModal(this.app, this, () => this.refreshSidebar()).open(),
		});
		this.addCommand({
			id: "new-employer",
			name: "New Employer",
			callback: () => new EmployerModal(this.app, this, () => this.refreshSidebar()).open(),
		});
		this.addCommand({
			id: "new-lore",
			name: "New Lore Entry",
			callback: () => new LoreModal(this.app, this, () => this.refreshSidebar()).open(),
		});
		this.addCommand({
			id: "new-timeline-event",
			name: "New Timeline Event",
			callback: () => new TimelineModal(this.app, this, () => this.refreshSidebar()).open(),
		});

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				let changed = false;
				for (const order of Object.values(this.settings.characterOrder)) {
					const i = order.indexOf(oldPath);
					if (i !== -1) { order[i] = file.path; changed = true; }
				}
				for (const order of Object.values(this.settings.sectionOrder)) {
					if (!order) continue;
					const i = order.indexOf(oldPath);
					if (i !== -1) { order[i] = file.path; changed = true; }
				}
				const sub = this.settings.collapsedSubsidiaries.indexOf(oldPath);
				if (sub !== -1) { this.settings.collapsedSubsidiaries[sub] = file.path; changed = true; }
				const b = this.settings.bookmarks.indexOf(oldPath);
				if (b !== -1) { this.settings.bookmarks[b] = file.path; changed = true; }
				if (changed) await this.saveSettings();
			})
		);
		// A deleted note's bookmark goes with it.
		this.registerEvent(
			this.app.vault.on("delete", async (file) => {
				if (!this.settings.bookmarks.includes(file.path)) return;
				this.settings.bookmarks = this.settings.bookmarks.filter((p) => p !== file.path);
				await this.saveSettings();
			})
		);

		this.addSettingTab(new WorldBuilderSettingTab(this.app, this));
	}

	async activateSidebar() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	refreshSidebar() {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (leaf?.view instanceof WorldBuilderView) {
			(leaf.view as WorldBuilderView).render();
		}
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		this.settings.characterOrder = data?.characterOrder ?? {};
		this.settings.collapsedEmployers = data?.collapsedEmployers ?? [];
		this.settings.collapsedEmployerTypes = data?.collapsedEmployerTypes ?? [];
		this.settings.collapsedParents = data?.collapsedParents ?? [];
		this.settings.collapsedSubsidiaries = data?.collapsedSubsidiaries ?? [];
		this.settings.sectionOrder = data?.sectionOrder ?? {};
		this.settings.bookmarks = data?.bookmarks ?? [];
		this.settings.collapsedBookmarkGroups = data?.collapsedBookmarkGroups ?? [];
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}
