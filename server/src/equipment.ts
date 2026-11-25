import type { Equipment } from './postgres.ts';

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function findEquipment(equipment: Equipment[], query?: string, site?: string, type?: string): Equipment[] {
  const siteKey = normalizeText(site ?? '');
  const typeKey = normalizeText(type ?? '');
  const scoped = equipment.filter(
    (item) => normalizeText(item.site).includes(siteKey) && (!typeKey || normalizeText(item.eqp_type ?? '') === typeKey)
  );
  const key = normalizeText(query ?? '');
  if (!key) {
    return scoped;
  }

  const searchKeys = (item: Equipment) =>
    [item.equipment_id, item.equipment, item.eqp_serial_no ?? '', ...(item.aliases ?? [])].map(normalizeText);
  const exact = scoped.filter((item) => searchKeys(item).includes(key));
  if (exact.length) {
    return exact;
  }

  return scoped.filter((item) =>
    [...searchKeys(item), normalizeText(item.site + item.equipment)].some((name) => name.includes(key))
  );
}
