/**
 * TimeZones — the time zones a group can choose for its 9 pm summary: a few
 * common ones as buttons, and any city or IANA name typed with
 * /summary time (e.g. "Nairobi", "Asia/Dubai", "dubai", "UK").
 */
export interface ZoneChoice {
  label: string;
  zone: string;
}

export class TimeZones {
  static readonly DEFAULT = 'Asia/Kolkata';

  static readonly COMMON: readonly ZoneChoice[] = [
    { label: 'India', zone: 'Asia/Kolkata' },
    { label: 'Kenya', zone: 'Africa/Nairobi' },
    { label: 'Tanzania', zone: 'Africa/Dar_es_Salaam' },
    { label: 'UAE', zone: 'Asia/Dubai' },
    { label: 'Saudi Arabia', zone: 'Asia/Riyadh' },
    { label: 'Pakistan', zone: 'Asia/Karachi' },
    { label: 'UK', zone: 'Europe/London' },
    { label: 'US East', zone: 'America/New_York' },
  ];

  /** Country names and short forms people type. */
  static readonly #ALIASES: Record<string, string> = {
    india: 'Asia/Kolkata', ist: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', bombay: 'Asia/Kolkata', delhi: 'Asia/Kolkata', calcutta: 'Asia/Kolkata',
    kenya: 'Africa/Nairobi', mombasa: 'Africa/Nairobi', tanzania: 'Africa/Dar_es_Salaam', uganda: 'Africa/Kampala',
    uae: 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', sharjah: 'Asia/Dubai', saudi: 'Asia/Riyadh', 'saudi arabia': 'Asia/Riyadh',
    mecca: 'Asia/Riyadh', makkah: 'Asia/Riyadh', jeddah: 'Asia/Riyadh', madina: 'Asia/Riyadh', medina: 'Asia/Riyadh',
    yemen: 'Asia/Aden', oman: 'Asia/Muscat', kuwait: 'Asia/Kuwait', qatar: 'Asia/Qatar', bahrain: 'Asia/Bahrain',
    pakistan: 'Asia/Karachi', egypt: 'Africa/Cairo', uk: 'Europe/London', england: 'Europe/London', britain: 'Europe/London',
    usa: 'America/New_York', 'us east': 'America/New_York', 'new york': 'America/New_York', canada: 'America/Toronto',
    'us west': 'America/Los_Angeles', australia: 'Australia/Sydney', singapore: 'Asia/Singapore', 'sri lanka': 'Asia/Colombo',
  };

  /** A zone this runtime can use, or false. */
  static isValid(zone: string): boolean {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: zone });
      return true;
    } catch (_) {
      return false;
    }
  }

  /** "Nairobi", "asia/dubai", "UAE" → an IANA zone; null when nothing matches. */
  static resolve(typed: string): string | null {
    const key = typed.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return null;
    if (TimeZones.#ALIASES[key]) return TimeZones.#ALIASES[key];
    const all = TimeZones.#all();
    const exact = all.find((z) => z.toLowerCase() === key.replace(/ /g, '_'));
    if (exact) return exact;
    const city = key.replace(/ /g, '_');
    const byCity = all.filter((z) => z.toLowerCase().split('/').pop() === city);
    return byCity.length === 1 ? byCity[0] : null;
  }

  /** "India (Asia/Kolkata)" for a common zone, otherwise the zone itself. */
  static label(zone: string): string {
    const common = TimeZones.COMMON.find((c) => c.zone === zone);
    return common ? `${common.label} (${zone})` : zone.replace(/_/g, ' ');
  }

  static #all(): string[] {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const list = intl.supportedValuesOf?.('timeZone') ?? [];
    return [...new Set([...list, ...TimeZones.COMMON.map((c) => c.zone), 'Asia/Kolkata', 'Asia/Calcutta'])];
  }
}
