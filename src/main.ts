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

interface NoteEntry {
	file: TFile;
	content: string;
	fm: Record<string, string>;
}
type CardFn = (fm: Record<string, string>) => { title: string; meta: string; badge: string };

type WBTab = "characters" | "locations" | "employers" | "lore" | "timeline";

// ─── Sidebar View ─────────────────────────────────────────────────────────────

const VIEW_TYPE = "world-builder-sidebar";

class WorldBuilderView extends ItemView {
	plugin: WorldBuilderPlugin;
	activeTab: WBTab = "characters";

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
		containerEl.empty();
		containerEl.addClass("wb-sidebar");

		const header = containerEl.createDiv("wb-header");
		header.createEl("h2", { text: "Hatherton World Builder" });

		const tabBar = containerEl.createDiv("wb-tabs");
		const tabs: { id: WBTab; label: string }[] = [
			{ id: "characters", label: "Characters" },
			{ id: "locations", label: "Locations" },
			{ id: "employers", label: "Employers" },
			{ id: "lore", label: "Lore" },
			{ id: "timeline", label: "Timeline" },
		];

		const contents: Partial<Record<WBTab, HTMLElement>> = {};
		tabs.forEach(({ id, label }) => {
			const btn = tabBar.createEl("button", { text: label, cls: "wb-tab" });
			if (id === this.activeTab) btn.addClass("active");
			btn.onclick = () => {
				this.activeTab = id;
				tabBar.querySelectorAll(".wb-tab").forEach((b) => b.removeClass("active"));
				btn.addClass("active");
				Object.values(contents).forEach((c) => c?.removeClass("active"));
				contents[id]?.addClass("active");
			};
			const pane = containerEl.createDiv("wb-tab-content");
			if (id === this.activeTab) pane.addClass("active");
			contents[id] = pane;
		});

		const folder = this.plugin.settings.worldFolder;

		await this.renderSection(
			contents.characters!,
			`${folder}/Characters`,
			"Characters",
			() => new CharacterModal(this.app, this.plugin, () => this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				meta: [fm.employer, fm.ship].filter(Boolean).join(" · "),
				badge: fm.role ?? "",
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
		container: HTMLElement,
		folderPath: string,
		label: string,
		onCreate: () => void,
		getCard: (fm: Record<string, string>) => { title: string; meta: string; badge: string },
		opts: { thumbs?: boolean; reload?: boolean; employerGroups?: boolean; stackBadge?: boolean } = {}
	) {
		const hdr = container.createDiv("wb-section-header");
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
	}

	private renderCard(
		parent: HTMLElement,
		entry: NoteEntry,
		getCard: CardFn,
		thumbs: boolean,
		stackBadge: boolean
	): HTMLElement {
		const { file, content, fm } = entry;
		const { title, meta, badge } = getCard(fm);

		const card = parent.createDiv("wb-card");
		card.setAttribute("data-path", file.path);
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
		if (meta) body.createDiv({ cls: "wb-card-meta", text: meta });
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
		name: "", role: "protagonist", age: "", employer: "", ship: "",
		physicalDesc: "", personality: "", goals: "", secrets: ""
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
		const folder = `${this.plugin.settings.worldFolder}/Characters`;
		const content = [
			"---",
			`name: "${this.data.name}"`,
			`role: ${this.data.role}`,
			`age: "${this.data.age}"`,
			`employer: "${this.data.employer}"`,
			`ship: "${this.data.ship}"`,
			`type: character`,
			"---",
			"",
			`# ${this.data.name}`,
			"",
			"## Physical Description",
			this.data.physicalDesc || "_None provided._",
			"",
			"## Personality",
			this.data.personality || "_None provided._",
			"",
			"## Goals",
			this.data.goals || "_None provided._",
			"",
			"## Secrets",
			this.data.secrets || "_None provided._",
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
