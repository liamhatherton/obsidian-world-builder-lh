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
	/** Custom manual order for the flat (non-Characters) tabs, keyed by tab id -> ordered note paths. */
	sectionOrder: Partial<Record<WBTab, string[]>>;
}
const DEFAULT_SETTINGS: WorldBuilderSettings = {
	worldFolder: "World",
	characterOrder: {},
	collapsedEmployers: [],
	sectionOrder: {},
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string) {
	return s.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim();
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

type CardFn = (fm: Record<string, string>) => { title: string; meta: string; badge: string; search?: string };

type WBTab = "characters" | "locations" | "employers" | "lore" | "timeline";

/** Search bar wording per tab. Characters match on four properties; every other tab matches the note's name and text. */
const SEARCH_HINTS: Record<WBTab, { noun: string; tip: string }> = {
	characters: { noun: "characters", tip: "Matches name, employer, ship and home" },
	locations: { noun: "locations", tip: "Matches the name and the text of the note" },
	employers: { noun: "employers", tip: "Matches the name and the text of the note" },
	lore: { noun: "lore", tip: "Matches the title and the text of the note" },
	timeline: { noun: "timeline", tip: "Matches the title and the text of the note" },
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
	searchQueries: Record<WBTab, string> = { characters: "", locations: "", employers: "", lore: "", timeline: "" };
	private searchTargets: Partial<Record<WBTab, HTMLElement>> = {};
	/** Normalised text each card is matched against. */
	private searchIndex = new WeakMap<HTMLElement, string>();
	/** Every note currently drawn in the sidebar, keyed by path, so a wiki-link click can find its entry. */
	private entryByPath = new Map<string, NoteEntry>();
	/** Tabs whose lists nest child entries under their parent (see renderHierarchicalGroup). */
	private readonly hierarchicalTabs = new Set<WBTab>(["locations"]);

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
		this.navButtons = [];

		// Fixed region: title, tabs, the active tab's section header (Reload / + New) and the search bar.
		// It never scrolls; the lists below it live in their own scrolling region.
		const fixed = containerEl.createDiv("wb-fixed");
		const scroll = containerEl.createDiv("wb-scroll");

		const header = fixed.createDiv("wb-header");
		header.createEl("h2", { text: "Hatherton's World Builder" });

		const tabBar = fixed.createDiv("wb-tabs");
		const tabs: { id: WBTab; label: string }[] = [
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
			btn.onclick = () => {
				if (id === this.activeTab) return;
				this.switchTab(id);
				this.recordNav(id, null);
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
				meta: `${fm.type ?? ""} ${fm.parent ? `· in ${fm.parent}` : ""}`.trim(),
				badge: fm.type ?? "",
			}),
			{
				thumbs: true,
				expandable: true,
				hierarchical: true,
				getParentName: (fm) => fm.parent ?? "",
				getOwnName: (fm) => fm.name ?? "",
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
			{ thumbs: true, expandable: true }
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
					if (show) anyVisible = true;
				});
				return anyVisible;
			};
			const topList = body.querySelector<HTMLElement>(":scope > .wb-list");
			if (topList) evalGroup(topList);
		} else {
			body.querySelectorAll<HTMLElement>(".wb-group-header").forEach((header) => {
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
		tab: WBTab,
		pane: TabPane,
		folderPath: string,
		label: string,
		onCreate: () => void,
		getCard: (fm: Record<string, string>) => { title: string; meta: string; badge: string },
		opts: {
			thumbs?: boolean;
			reload?: boolean;
			employerGroups?: boolean;
			stackBadge?: boolean;
			/** Clicking a card expands an in-sidebar, text-only preview instead of opening the note. */
			expandable?: boolean;
			/** Nest entries under their detected parent (see renderHierarchicalGroup); requires getParentName/getOwnName. */
			hierarchical?: boolean;
			getParentName?: (fm: Record<string, string>) => string;
			getOwnName?: (fm: Record<string, string>) => string;
		} = {}
	) {
		const container = pane.body;
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
		if (opts.reload ?? true) {
			const reloadBtn = actions.createEl("button", { cls: "wb-btn-secondary" });
			setIcon(reloadBtn.createEl("span", { cls: "wb-btn-icon" }), "refresh-cw");
			reloadBtn.createEl("span", { text: "Reload" });
			reloadBtn.onclick = async () => {
				await this.render();
				new Notice("World Builder reloaded.");
			};
		}
		const btn = actions.createEl("button", { text: "+ New", cls: "wb-btn-primary" });
		btn.onclick = onCreate;

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
			this.renderHierarchicalGroup(
				tab, container, roots, entries, childrenOf, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable
			);
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

		// Alphabetical by employer, with characters who have no employer last.
		const orderedGroups = [...groups.entries()].sort(
			([a], [b]) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)
		);

		for (const [key, group] of orderedGroups) {
			const header = container.createDiv("wb-group-header");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			setIcon(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
			header.createEl("span", { cls: "wb-group-title", text: group.label });
			const list = container.createDiv("wb-list");

			const applyCollapsed = (collapsed: boolean) => {
				header.classList.toggle("is-collapsed", collapsed);
				list.classList.toggle("is-collapsed", collapsed);
				header.setAttribute("aria-expanded", String(!collapsed));
			};
			applyCollapsed(this.plugin.settings.collapsedEmployers.includes(key));

			const toggleCollapsed = async () => {
				// While searching, matching sections are shown open regardless; leave the saved state alone.
				if (normalizeForSearch(this.searchQueries.characters).trim()) return;
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
			this.renderCard(tab, list, entry, getCard, thumbs, stackBadge, expandable);
			const kids = childrenOf.get(entry.file.path);
			if (kids && kids.length) {
				const childHost = list.createDiv("wb-child-group");
				this.renderHierarchicalGroup(tab, childHost, kids, allEntries, childrenOf, getCard, thumbs, stackBadge, expandable);
			}
		}
		this.enableReorder(list, async (order) => {
			const settings = this.plugin.settings;
			const baseline = this.orderEntries(allEntries, settings.sectionOrder[tab] ?? []).map((e) => e.file.path);
			const groupPaths = ordered.map((e) => e.file.path);
			settings.sectionOrder[tab] = mergeGroupOrder(baseline, groupPaths, order);
			await this.plugin.saveSettings();
		});
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
		const { title, meta, badge, search } = getCard(fm);

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
				img.onerror = () => img.remove();
			}
			body = row.createDiv("wb-card-body");
		}
		const titleEl = body.createDiv("wb-card-title");
		titleEl.createSpan({ text: title });
		if (expandable) titleEl.addClass("wb-card-title-row");
		if (badge) {
			// stackBadge: badge on its own line under the name; otherwise inline beside it
			const badgeHost = stackBadge ? body.createDiv("wb-card-badge-row") : titleEl;
			const b = badgeHost.createSpan({ cls: `wb-badge wb-badge-${badge.toLowerCase()}` });
			b.setText(badge);
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

		// Edit button sits at the bottom, under its own divider, so it doesn't compete with the text.
		const footer = expand.createDiv("wb-card-expand-footer");
		const editBtn = footer.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
		setIcon(editBtn.createEl("span", { cls: "wb-btn-icon" }), "pencil");
		editBtn.createEl("span", { text: "Edit" });
		editBtn.onclick = () => this.app.workspace.getLeaf().openFile(entry.file);

		this.recordNav(tab, entry.file.path);
	}

	/** The section folder a tab's notes live in, e.g. "World/Characters". */
	private tabFolder(tab: WBTab): string {
		const folder = this.plugin.settings.worldFolder;
		const names: Record<WBTab, string> = {
			characters: "Characters",
			locations: "Locations",
			employers: "Employers",
			lore: "Lore",
			timeline: "Timeline",
		};
		return `${folder}/${names[tab]}`;
	}

	/** Which tab (if any) a given file's own card lives on. */
	private findEntryTab(file: TFile): WBTab | null {
		const tabs: WBTab[] = ["characters", "locations", "employers", "lore", "timeline"];
		for (const tab of tabs) {
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
		this.tabBarEl?.querySelectorAll<HTMLElement>(".wb-tab").forEach((b) => b.removeClass("active"));
		this.tabBarEl?.querySelector<HTMLElement>(`.wb-tab[data-tab="${id}"]`)?.addClass("active");
		Object.values(this.tabContents).forEach((c) => { c?.head.removeClass("active"); c?.body.removeClass("active"); });
		this.tabContents[id]?.head.addClass("active");
		this.tabContents[id]?.body.addClass("active");
		this.showTabSearchFn?.();
		this.updateShadowFn?.();
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

		const list = card.closest<HTMLElement>(".wb-list");
		if (list?.classList.contains("is-collapsed")) {
			list.removeClass("is-collapsed");
			const header = list.previousElementSibling;
			if (header instanceof HTMLElement && header.classList.contains("wb-group-header")) {
				header.removeClass("is-collapsed");
				header.setAttribute("aria-expanded", "true");
			}
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
		const clearMarks = () => {
			list.querySelectorAll(":scope > .wb-card.wb-drop-before, :scope > .wb-card.wb-drop-after").forEach((el) =>
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
			target.classList.add(dropAfter ? "wb-drop-after" : "wb-drop-before");
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
				list.insertBefore(moving, dropAfter ? dropTarget.nextSibling : dropTarget);
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
		name: "", type: "city", parent: "", description: "",
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
			["planet", "moon", "station", "asteroid", "ship", "city", "region", "building", "landmark", "other"].forEach((o) =>
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
			);
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
		name: "", alignment: "neutral", goals: "", enemies: "", allies: "", description: ""
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
		new Setting(contentEl).setName("Alignment").addDropdown((d) => {
			["lawful", "neutral", "chaotic"].forEach((o) =>
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
			);
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
			`alignment: ${this.data.alignment}`,
			`goals: "${this.data.goals.replace(/"/g, "'")}"`,
			`entry_type: employer`,
			"---",
			"",
			`# ${this.data.name}`,
			"",
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
				if (changed) await this.saveSettings();
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
		this.settings.sectionOrder = data?.sectionOrder ?? {};
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}
