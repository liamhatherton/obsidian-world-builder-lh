import {
	App,
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

// ─── Settings ────────────────────────────────────────────────────────────────

interface WorldBuilderSettings {
	worldFolder: string;
}
const DEFAULT_SETTINGS: WorldBuilderSettings = { worldFolder: "World" };

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
		result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
	}
	return result;
}

type WBTab = "characters" | "locations" | "factions" | "lore" | "timeline";

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
		header.createEl("h2", { text: "World Builder" });

		const tabBar = containerEl.createDiv("wb-tabs");
		const tabs: { id: WBTab; label: string }[] = [
			{ id: "characters", label: "Characters" },
			{ id: "locations", label: "Locations" },
			{ id: "factions", label: "Factions" },
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
				meta: `${fm.role ?? ""} ${fm.faction ? `· ${fm.faction}` : ""}`.trim(),
				badge: fm.role ?? "",
			})
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
			contents.factions!,
			`${folder}/Factions`,
			"Factions",
			() => new FactionModal(this.app, this.plugin, () => this.render()).open(),
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

	async renderSection(
		container: HTMLElement,
		folderPath: string,
		label: string,
		onCreate: () => void,
		getCard: (fm: Record<string, string>) => { title: string; meta: string; badge: string }
	) {
		const hdr = container.createDiv("wb-section-header");
		hdr.createEl("span", { text: label });
		const btn = hdr.createEl("button", { text: "+ New", cls: "wb-btn-primary" });
		btn.onclick = onCreate;

		const files = this.app.vault.getMarkdownFiles().filter((f) =>
			f.path.startsWith(folderPath + "/")
		);

		const list = container.createDiv("wb-list");
		if (files.length === 0) {
			list.createDiv({ cls: "wb-empty", text: `No ${label.toLowerCase()} yet.` });
			return;
		}

		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			const fm = readFrontmatter(content);
			const { title, meta, badge } = getCard(fm);

			const card = list.createDiv("wb-card");
			const titleEl = card.createDiv("wb-card-title");
			titleEl.setText(title);
			if (badge) {
				const b = titleEl.createSpan({ cls: `wb-badge wb-badge-${badge.toLowerCase()}` });
				b.setText(badge);
			}
			if (meta) card.createDiv({ cls: "wb-card-meta", text: meta });
			card.onclick = () => this.app.workspace.getLeaf().openFile(file);
		}
	}
}

// ─── Modals ──────────────────────────────────────────────────────────────────

class CharacterModal extends Modal {
	plugin: WorldBuilderPlugin;
	onDone: () => void;
	data = {
		name: "", role: "protagonist", age: "", faction: "",
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
		new Setting(contentEl).setName("Faction").addText((t) => {
			t.setPlaceholder("Faction name").onChange((v) => (this.data.faction = v));
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
			`faction: "${this.data.faction}"`,
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

class FactionModal extends Modal {
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
		contentEl.createEl("h2", { text: "New Faction" });

		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("Faction name").onChange((v) => (this.data.name = v));
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
		const folder = `${this.plugin.settings.worldFolder}/Factions`;
		const enemyLinks = this.data.enemies.split(",").filter(Boolean).map((e) => `[[${e.trim()}]]`).join(", ");
		const allyLinks = this.data.allies.split(",").filter(Boolean).map((a) => `[[${a.trim()}]]`).join(", ");
		const lines = [
			"---",
			`name: "${this.data.name}"`,
			`alignment: ${this.data.alignment}`,
			`goals: "${this.data.goals.replace(/"/g, "'")}"`,
			`entry_type: faction`,
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
		new Notice(`Faction "${this.data.name}" created.`);
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
			["history", "magic", "religion", "culture", "other"].forEach((o) =>
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
			id: "new-faction",
			name: "New Faction",
			callback: () => new FactionModal(this.app, this, () => this.refreshSidebar()).open(),
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}
