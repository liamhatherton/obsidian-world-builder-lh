import { getLanguage } from "obsidian";

/**
 * Translations for everything the plugin shows: sidebar, forms, notices, dialogs, commands and
 * settings. English is the source text; every other language must translate every key (the
 * compiler enforces it through the `Translations` type).
 *
 * What is deliberately NOT translated, so switching language never breaks a vault:
 *   - folder names (Characters, Locations, Groups, Lore, Timeline, Images, UniverseBuilder, World),
 *   - frontmatter keys and stored values (role: protagonist, type: ship, alignment: lawful, ...),
 *   - developer-console messages.
 * Known stored values are only translated where they are shown (badges, dropdowns, note text).
 *
 * Each language lives in its own file in `src/locales/`. To add one: copy `locales/en.ts`,
 * translate the values (keep the keys and every `{placeholder}`), then list it in `LOCALES`,
 * `LANGUAGE_NAMES` and `DICTIONARIES` below. Placeholders are filled in by `t()`.
 */
import { en } from "./locales/en";
import type { TranslationKey, Translations } from "./locales/en";
import { es } from "./locales/es";
import { pt } from "./locales/pt";
import { ptBR } from "./locales/pt-BR";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { ru } from "./locales/ru";
import { uk } from "./locales/uk";
import { zh } from "./locales/zh";
import { ja } from "./locales/ja";

export type { TranslationKey };

/**
 * Languages the plugin is translated into, as Obsidian names them (see
 * github.com/obsidianmd/obsidian-translations): "zh" is Simplified Chinese.
 */
export const LOCALES = ["en", "es", "pt", "pt-BR", "fr", "de", "ru", "uk", "zh", "ja"] as const;
export type Locale = (typeof LOCALES)[number];
/** The Language setting: follow Obsidian ("auto") or a fixed locale. */
export type LanguageSetting = "auto" | Locale;

/** Each language's name, written in that language (how it appears in the Language dropdown). */
export const LANGUAGE_NAMES: Record<Locale, string> = {
	en: "English",
	es: "Español",
	pt: "Português",
	"pt-BR": "Português (Brasil)",
	fr: "Français",
	de: "Deutsch",
	ru: "Русский",
	uk: "Українська",
	zh: "简体中文",
	ja: "日本語",
};

const DICTIONARIES: Record<Locale, Translations> = { en, es, pt, "pt-BR": ptBR, fr, de, ru, uk, zh, ja };

let current: Locale = "en";

/**
 * Obsidian's app language mapped to a supported locale: an exact match first ("pt-BR"), then the
 * base language ("es-419" -> "es", "fr-CA" -> "fr"); English if the plugin doesn't have it.
 */
export function detectLocale(): Locale {
	let code = "en";
	try {
		code = getLanguage() || "en";
	} catch {
		// getLanguage() missing (very old Obsidian): stay on English.
	}
	const lower = code.toLowerCase().replace(/_/g, "-");
	const exact = LOCALES.find((l) => l.toLowerCase() === lower);
	if (exact) return exact;
	const base = LOCALES.find((l) => l === lower.split("-")[0]);
	return base ?? "en";
}

/** Picks the language everything is shown in, from the plugin's Language setting. */
export function setLanguage(setting: LanguageSetting): void {
	current = setting === "auto" ? detectLocale() : setting;
}

export function currentLocale(): Locale {
	return current;
}

/** The text for `key` in the current language, with each `{placeholder}` filled in from `vars`. */
export function t(key: TranslationKey, vars: Record<string, string | number> = {}): string {
	const text = DICTIONARIES[current][key] ?? en[key] ?? key;
	return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Like t(), choosing between `<key>.one` and `<key>.other` by `count` (also passed as {count}). */
export function tn(key: "migrate.scope" | "migrate.moved", count: number, vars: Record<string, string | number> = {}): string {
	return t(`${key}.${count === 1 ? "one" : "other"}` as TranslationKey, { count, ...vars });
}

/**
 * How a stored frontmatter value is shown (e.g. on a card's badge). Known values are translated,
 * in lower case where the language allows ("protagonist" -> "protagonista"); anything else, and every value in English,
 * is shown exactly as written in the note.
 */
export function displayValue(prefix: "role" | "locationType" | "groupType" | "alignment" | "loreCategory", value: string): string {
	if (current === "en" || !value) return value;
	const key = `${prefix}.${value.trim().toLowerCase()}` as TranslationKey;
	if (!(key in en)) return value;
	// Lower case like the stored value, except in German, which capitalizes nouns ("Zwergplanet").
	return current === "de" ? t(key) : t(key).toLocaleLowerCase(current);
}

/** The capitalised label for a stored value in a dropdown ("dwarf planet" -> "Dwarf planet"). */
export function optionLabel(prefix: "role" | "locationType" | "groupType" | "alignment" | "loreCategory", value: string): string {
	const key = `${prefix}.${value}` as TranslationKey;
	return key in en ? t(key) : value;
}
