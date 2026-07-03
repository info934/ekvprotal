
import { supabase } from '@/lib/customSupabaseClient';
import { calculateCrmLineTotal } from '@/lib/crmItemPayloads';

const fallbackRuleSet = {
  id: 'fallback-fve-standard',
  name: 'FVE standard',
  description: 'Lokální výchozí pravidla pro jednoduchou FVE nabídku.',
  items: [
    { item_role: 'panel', code: 'FVE-PANEL', name: 'Fotovoltaické panely', unit: 'ks', quantity_mode: 'panel_count', quantity_value: 1, unit_price_override: 2600, unit_cost_override: 2100, vat_rate: 21, sort_order: 10 },
    { item_role: 'inverter', code: 'FVE-INV', name: 'Střídač FVE', unit: 'ks', quantity_mode: 'fixed', quantity_value: 1, unit_price_override: 39000, unit_cost_override: 30000, vat_rate: 21, sort_order: 20 },
    { item_role: 'battery', code: 'FVE-BAT', name: 'Bateriové úložiště', unit: 'kWh', quantity_mode: 'per_battery_kwh', quantity_value: 1, unit_price_override: 8500, unit_cost_override: 6900, vat_rate: 21, sort_order: 30 },
    { item_role: 'mounting', code: 'FVE-MNT', name: 'Montážní konstrukce a kabeláž', unit: 'kWp', quantity_mode: 'per_kwp', quantity_value: 1, unit_price_override: 4200, unit_cost_override: 2800, vat_rate: 21, sort_order: 40 },
    { item_role: 'service', code: 'FVE-INST', name: 'Instalace a uvedení do provozu', unit: 'kWp', quantity_mode: 'per_kwp', quantity_value: 1, unit_price_override: 6900, unit_cost_override: 4200, vat_rate: 21, sort_order: 50 },
    { item_role: 'documentation', code: 'FVE-DOC', name: 'Projektová dokumentace a administrativa', unit: 'ks', quantity_mode: 'fixed', quantity_value: 1, unit_price_override: 12500, unit_cost_override: 6500, vat_rate: 21, sort_order: 60 },
  ],
};

export const loadFveOfferRuleSets = async () => {
  const { data, error } = await supabase
    .from('fve_offer_rule_sets')
    .select('*, items:fve_offer_rule_items(*)')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.warn('[loadFveOfferRuleSets] Falling back to local defaults:', error.message);
    return [fallbackRuleSet];
  }

  return (data || []).length ? data.map((set) => ({
    ...set,
    items: [...(set.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
  })) : [fallbackRuleSet];
};

export const chooseFveRuleSet = (ruleSets = [], inputs = {}) => {
  const power = Number(inputs.power_kwp || 0);
  const battery = Number(inputs.battery_kwh || 0);
  return ruleSets.find((set) => (
    (!set.min_power_kwp || power >= Number(set.min_power_kwp)) &&
    (!set.max_power_kwp || power <= Number(set.max_power_kwp)) &&
    (!set.min_battery_kwh || battery >= Number(set.min_battery_kwh)) &&
    (!set.max_battery_kwh || battery <= Number(set.max_battery_kwh)) &&
    (!set.roof_type || set.roof_type === inputs.roof_type) &&
    (!set.customer_type || set.customer_type === inputs.customer_type)
  )) || ruleSets[0] || fallbackRuleSet;
};

const getRuleQuantity = (rule, inputs) => {
  const power = Number(inputs.power_kwp || 0);
  const battery = Number(inputs.battery_kwh || 0);
  const multiplier = Number(rule.quantity_value || 1);
  switch (rule.quantity_mode) {
    case 'per_kwp':
      return Math.max(0, power * multiplier);
    case 'per_battery_kwh':
      return Math.max(0, battery * multiplier);
    case 'panel_count':
      return Math.max(1, Math.ceil((power * 1000) / 450) * multiplier);
    case 'fixed':
    default:
      return multiplier;
  }
};

export const buildFveOfferItems = (ruleSet, inputs = {}) => {
  const includeBattery = Number(inputs.battery_kwh || 0) > 0;
  const includeWallbox = Boolean(inputs.include_wallbox);
  const rows = (ruleSet?.items || fallbackRuleSet.items)
    .filter((rule) => includeBattery || rule.item_role !== 'battery')
    .filter((rule) => includeWallbox || rule.item_role !== 'wallbox')
    .map((rule, index) => {
      const item = {
        catalog_item_id: rule.catalog_item_id || null,
        code: rule.code || null,
        name: rule.name,
        description: rule.description || null,
        quantity: getRuleQuantity(rule, inputs),
        unit: rule.unit || 'ks',
        unit_price: Number(rule.unit_price_override || 0),
        unit_cost: Number(rule.unit_cost_override || 0),
        purchase_price_snapshot: Number(rule.unit_cost_override || 0),
        discount_percent: Number(rule.discount_percent || 0),
        vat_rate: Number(inputs.vat_rate || rule.vat_rate || 21),
        product_type: rule.item_role,
        sort_order: (index + 1) * 10,
      };
      return {
        ...item,
        line_total: calculateCrmLineTotal(item),
      };
    });

  return rows.map((row, index) => ({
    ...row,
    id: `fve-${Date.now()}-${index}`,
    sort_order: (index + 1) * 10,
  }));
};
