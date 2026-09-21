import {
	App,
	ItemView,
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
}
const DEFAULT_SETTINGS: WorldBuilderSettings = { worldFolder: "World", characterOrder: {}, collapsedEmployers: [] };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string) {
	return s.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim();
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

/**
 * Everything a note "says", for searching: its frontmatter values (not the keys) plus its body,
 * with markup that isn't visible text removed (embeds, link targets, HTML tags such as the
 * <font color=...> around headings).
 */
function documentSearchText(content: string, fm: Record<string, string>): string {
	const body = content
		.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "")
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

	constructor(leaf: WorkspaceLeaf, plugin: WorldBuilderPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return "World Builder"; }
	getIcon() { return "globe"; }

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

		// Fixed region: title, tabs, the active tab's section header (Reload / + New) and the search bar.
		// It never scrolls; the lists below it live in their own scrolling region.
		const fixed = containerEl.createDiv("wb-fixed");
		const scroll = containerEl.createDiv("wb-scroll");

		const header = fixed.createDiv("wb-header");
		header.createEl("h2", { text: "Hatherton World Builder" });

		const tabBar = fixed.createDiv("wb-tabs");
		const tabs: { id: WBTab; label: string }[] = [
			{ id: "characters", label: "Characters" },
			{ id: "locations", label: "Locations" },
			{ id: "employers", label: "Employers" },
			{ id: "lore", label: "Lore" },
			{ id: "timeline", label: "Timeline" },
		];

		const contents: Partial<Record<WBTab, TabPane>> = {};
		tabs.forEach(({ id, label }) => {
			const btn = tabBar.createEl("button", { text: label, cls: "wb-tab" });
			if (id === this.activeTab) btn.addClass("active");
			btn.onclick = () => {
				this.activeTab = id;
				tabBar.querySelectorAll(".wb-tab").forEach((b) => b.removeClass("active"));
				btn.addClass("active");
				Object.values(contents).forEach((c) => { c?.head.removeClass("active"); c?.body.removeClass("active"); });
				contents[id]?.head.addClass("active");
				contents[id]?.body.addClass("active");
				showTabSearch();
				updateShadow();
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
			{ thumbs: true, employerGroups: true, stackBadge: true }
		);

		await this.renderSection(
			contents.locations!,
			`${folder}/Locations`,
			"Locations",
			() => new LocationModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				meta: `${fm.type ?? ""} ${fm.parent ? `· in ${fm.parent}` : ""}`.trim(),
				badge: fm.type ?? "",
			})
		);

		await this.renderSection(
			contents.employers!,
			`${folder}/Employers`,
			"Employers",
			() => new EmployerModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				meta: fm.goals ?? "",
				badge: fm.alignment ?? "",
			})
		);

		await this.renderSection(
			contents.lore!,
			`${folder}/Lore`,
			"Lore Entries",
			() => new LoreModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.title ?? "Untitled",
				meta: fm.category ?? "",
				badge: fm.category ?? "",
			})
		);

		await this.renderSection(
			contents.timeline!,
			`${folder}/Timeline`,
			"Timeline Events",
			() => new TimelineModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.title ?? "Untitled",
				meta: fm.date ?? "",
				badge: "",
			})
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

		const none = body.querySelector<HTMLElement>(".wb-no-results");
		if (none) {
			none.textContent = `No ${none.getAttribute("data-noun") ?? "entries"} match \u201c${query.trim()}\u201d.`;
			none.classList.toggle("wb-filtered-out", !(searching && matches === 0));
		}
	}

	/** Returns a displayable URL for the first image embedded in a note, or null. */
	findFirstImageSrc(content: string, file: TFile): string | null {
		const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
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
		pane: TabPane,
		folderPath: string,
		label: string,
		onCreate: () => void,
		getCard: (fm: Record<string, string>) => { title: string; meta: string; badge: string },
		opts: { thumbs?: boolean; reload?: boolean; employerGroups?: boolean; stackBadge?: boolean } = {}
	) {
		const container = pane.body;
		const hdr = pane.head.createDiv("wb-section-header");
		hdr.createEl("span", { text: label });
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
			entries.push({ file, content, fm: readFrontmatter(content) });
		}

		if (!opts.employerGroups) {
			const list = container.createDiv("wb-list");
			for (const entry of entries) this.renderCard(list, entry, getCard, !!opts.thumbs, !!opts.stackBadge);
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
			const saved = this.plugin.settings.characterOrder[key] ?? [];
			const rank = (path: string) => {
				const i = saved.indexOf(path);
				return i === -1 ? saved.length : i;
			};
			const items = group.items
				.map((entry, index) => ({ entry, index }))
				.sort((a, b) => rank(a.entry.file.path) - rank(b.entry.file.path) || a.index - b.index)
				.map(({ entry }) => entry);

			for (const entry of items) this.renderCard(list, entry, getCard, !!opts.thumbs, !!opts.stackBadge);
			this.enableReorder(list, key);
		}

		this.createNoResultsLine(container, label);
	}

	/** The "No ... match" line; hidden until applySearch() finds nothing. */
	private createNoResultsLine(container: HTMLElement, label: string) {
		container.createDiv({
			cls: "wb-empty wb-no-results wb-filtered-out",
			attr: { "data-noun": label.toLowerCase() },
		});
	}

	private renderCard(
		parent: HTMLElement,
		entry: NoteEntry,
		getCard: CardFn,
		thumbs: boolean,
		stackBadge: boolean
	): HTMLElement {
		const { file, content, fm } = entry;
		const { title, meta, badge, search } = getCard(fm);

		const card = parent.createDiv("wb-card");
		if (stackBadge) card.addClass("wb-card-stacked");
		card.setAttribute("data-path", file.path);
		// Characters supply their own (four properties); everything else searches name + note text.
		this.searchIndex.set(card, normalizeForSearch(search ?? `${title} ${documentSearchText(content, fm)}`));
		let body: HTMLElement = card;
		if (thumbs) {
			card.addClass("wb-card-with-thumb");
			const thumb = card.createDiv("wb-thumb");
			const src = this.findFirstImageSrc(content, file);
			if (src) {
				const img = thumb.createEl("img", { attr: { src, alt: "", draggable: "false" } });
				img.onerror = () => img.remove();
			}
			body = card.createDiv("wb-card-body");
		}
		const titleEl = body.createDiv("wb-card-title");
		titleEl.setText(title);
		if (badge) {
			// stackBadge: badge on its own line under the name; otherwise inline beside it
			const badgeHost = stackBadge ? body.createDiv("wb-card-badge-row") : titleEl;
			const b = badgeHost.createSpan({ cls: `wb-badge wb-badge-${badge.toLowerCase()}` });
			b.setText(badge);
		}
		if (meta) for (const line of meta.split("\n")) body.createDiv({ cls: "wb-card-meta", text: line });
		card.onclick = () => this.app.workspace.getLeaf().openFile(file);
		return card;
	}

	/**
	 * Makes the cards in one employer's list drag-sortable. Each list only accepts cards
	 * that were picked up from that same list, so characters can't be moved between employers.
	 * The new order is saved to plugin data (notes themselves are never modified).
	 */
	private enableReorder(list: HTMLElement, groupKey: string) {
		let dragged: HTMLElement | null = null;
		let dropTarget: HTMLElement | null = null;
		let dropAfter = false;

		const cardAt = (t: EventTarget | null): HTMLElement | null =>
			t instanceof HTMLElement ? t.closest<HTMLElement>(".wb-card") : null;
		const clearMarks = () => {
			list.querySelectorAll(".wb-drop-before, .wb-drop-after").forEach((el) =>
				el.classList.remove("wb-drop-before", "wb-drop-after")
			);
			dropTarget = null;
		};

		list.querySelectorAll<HTMLElement>(".wb-card").forEach((card) =>
			card.setAttribute("draggable", "true")
		);

		list.addEventListener("dragstart", (e) => {
			const card = cardAt(e.target);
			if (!card || !e.dataTransfer) return;
			dragged = card;
			e.dataTransfer.effectAllowed = "move";
			// Custom type only, so dropping onto a note or editor doesn't paste anything.
			e.dataTransfer.setData("application/x-wb-character", card.getAttribute("data-path") ?? "");
			window.setTimeout(() => card.classList.add("wb-dragging"), 0);
		});

		list.addEventListener("dragend", () => {
			dragged?.classList.remove("wb-dragging");
			dragged = null;
			clearMarks();
		});

		list.addEventListener("dragover", (e) => {
			if (!dragged) return; // not picked up from this employer's list: not a valid drop
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			const target = cardAt(e.target);
			if (!target) return; // in a gap between cards: keep the last indicator
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
			const moving = dragged;
			if (dropTarget && dropTarget !== moving) {
				list.insertBefore(moving, dropAfter ? dropTarget.nextSibling : dropTarget);
				this.plugin.settings.characterOrder[groupKey] = Array.from(
					list.querySelectorAll<HTMLElement>(".wb-card")
				).map((c) => c.getAttribute("data-path") ?? "");
				await this.plugin.saveSettings();
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

		this.addRibbonIcon("globe", "World Builder", () => this.activateSidebar());

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
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}
