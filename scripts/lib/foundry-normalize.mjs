function get(source, ...paths) {
  for (const candidate of paths) {
    const segments = candidate.split('.');
    let value = source;
    for (const segment of segments) {
      if (value == null || typeof value !== 'object' || !(segment in value)) {
        value = undefined;
        break;
      }
      value = value[segment];
    }
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry !== undefined && entry !== null).map(String);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const formula = get(value, 'formula', 'value', 'number', 'roll');
    if (formula !== undefined) return String(formula);
  }
  return undefined;
}

export function stripHtml(value = '') {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'entry';
}

function normalizeType(type) {
  return ({ gear: 'equipment', itemUpgrade: 'upgrade' })[type] || type;
}

function qualityFrom(document) {
  const direct = String(get(document, 'system.quality', 'system.quality.value', 'system.qualityOption') || '').toLowerCase();
  if (['poor', 'standard', 'excellent'].includes(direct)) return direct;
  const match = String(document.name || '').match(/\((Poor|Standard|Excellent)\)$/i);
  return match ? match[1].toLowerCase() : null;
}

function cleanName(name) {
  return String(name || 'Unnamed item').replace(/\s+\((Poor|Standard|Excellent)\)$/i, '').trim();
}

function sourceReference(document) {
  const book = get(document, 'system.source.book', 'system.sourceBook', 'system.source');
  const page = get(document, 'system.source.page', 'system.sourcePage');
  if (!book && !page) return undefined;
  return {
    ...(book ? { book: String(book) } : {}),
    ...(page ? { page: String(page) } : {}),
  };
}

function installation(document) {
  return {
    capacity: asNumber(get(document, 'system.installedItems.slots', 'system.installedItems.capacity', 'system.optionSlots')),
    size: asNumber(get(document, 'system.installedItems.size', 'system.size', 'system.optionSlotSize')),
    allowedTypes: asArray(get(document, 'system.installedItems.allowedTypes')),
    requiredContainers: asArray(get(document, 'system.installationType', 'system.requiredContainers')),
    requiredItems: asArray(get(document, 'system.requiredItems', 'system.requiredCyberware')),
  };
}

function concealability(document) {
  const booleanValue = asBoolean(get(document, 'system.concealable.concealable', 'system.concealable'));
  if (booleanValue !== undefined) return booleanValue ? 'Concealable' : 'Not concealable';
  return asText(get(document, 'system.concealability'));
}

function weaponMechanics(document) {
  return {
    kind: 'weapon',
    damage: asText(get(document, 'system.damage', 'system.damage.value', 'system.damage.formula')),
    rateOfFire: asNumber(get(document, 'system.rof', 'system.rateOfFire', 'system.rof.value')),
    magazine: asNumber(get(document, 'system.magazine.max', 'system.ammo.max', 'system.magazine.value', 'system.magazine')),
    skill: asText(get(document, 'system.weaponSkill', 'system.skill.name', 'system.skill')),
    ammoTypes: asArray(get(document, 'system.ammoVariety', 'system.ammoTypes', 'system.ammo.variety')),
    quality: qualityFrom(document),
    concealability: concealability(document),
    hands: asNumber(get(document, 'system.handsReq', 'system.handsRequired', 'system.hands')),
  };
}

function armorMechanics(document) {
  const stoppingPowerValues = [
    get(document, 'system.headLocation.sp'),
    get(document, 'system.bodyLocation.sp'),
    get(document, 'system.shieldLocation.sp'),
    get(document, 'system.sp'),
    get(document, 'system.stoppingPower'),
  ].map(asNumber).filter((value) => value !== undefined);
  return {
    kind: 'armor',
    stoppingPower: stoppingPowerValues.length ? Math.max(...stoppingPowerValues) : undefined,
    penalty: asNumber(get(document, 'system.penalty', 'system.armorPenalty')),
    locations: [
      asBoolean(get(document, 'system.headLocation.hasArmor')) ? 'head' : null,
      asBoolean(get(document, 'system.bodyLocation.hasArmor')) ? 'body' : null,
      asBoolean(get(document, 'system.shieldLocation.hasArmor')) ? 'shield' : null,
    ].filter(Boolean),
  };
}

function mechanics(document, type) {
  if (type === 'weapon') return weaponMechanics(document);
  if (type === 'armor') return armorMechanics(document);
  if (type === 'cyberware') {
    const isWeapon = asBoolean(get(document, 'system.isWeapon', 'system.weapon.isWeapon')) || Boolean(get(document, 'system.damage'));
    return {
      kind: 'cyberware',
      humanityLoss: asText(get(document, 'system.humanityLoss', 'system.humanityLoss.maximum', 'system.humanityLoss.value')),
      foundational: asBoolean(get(document, 'system.isFoundational', 'system.foundational')),
      ...(isWeapon ? { weapon: weaponMechanics(document) } : {}),
      installation: installation(document),
    };
  }
  if (type === 'skill') {
    return {
      kind: 'skill',
      linkedStat: asText(get(document, 'system.stat', 'system.linkedStat', 'system.stat.value'))?.toUpperCase(),
      skillType: asText(get(document, 'system.skillType', 'system.category')),
      multiplier: asNumber(get(document, 'system.multiplier', 'system.difficulty')),
    };
  }
  return {
    kind: 'generic',
    electronic: asBoolean(get(document, 'system.isElectronic')),
    brand: asText(get(document, 'system.brand')),
    quantity: asNumber(get(document, 'system.amount', 'system.quantity')),
    installation: installation(document),
  };
}

export function normalizeFoundryDocument({ document, repositoryPath, config, ref }) {
  if (!document || typeof document !== 'object') return null;
  const rawType = String(document.type || 'gear');
  if (!config.includedDocumentTypes.includes(rawType)) return null;
  const type = normalizeType(rawType);
  const quality = qualityFrom(document);
  const name = cleanName(document.name);
  const pack = repositoryPath.split('/').slice(0, -1).join('/').replace(/^src\/packs\//, '');
  const description = stripHtml(get(document, 'system.description.value', 'system.description', 'description'));
  const priceAmount = asNumber(get(document, 'system.price.market', 'system.price.value', 'system.price', 'system.cost'));
  const priceCategory = asText(get(document, 'system.price.category', 'system.priceCategory'));
  const image = asText(document.img);
  const brand = asText(get(document, 'system.brand'));
  const tags = [
    ...asArray(get(document, 'system.tags')),
    ...asArray(get(document, 'system.ammoVariety')),
    ...(brand ? [brand] : []),
    pack,
    rawType,
  ].filter(Boolean);
  const source = sourceReference(document);
  return {
    id: `${type}.${slug(name)}${quality ? `.${quality}` : ''}`,
    type,
    name,
    aliases: document.name && document.name !== name ? [String(document.name)] : [],
    summary: description || `${name} is a ${type} entry from the Cyberpunk RED Foundry compendium.`,
    mechanics: mechanics(document, type),
    ...(priceAmount !== undefined || priceCategory ? {
      price: {
        ...(priceAmount !== undefined ? { amount: priceAmount } : {}),
        ...(priceCategory ? { category: priceCategory } : {}),
      },
    } : {}),
    ...(source ? { source } : {}),
    tags: [...new Set(tags)].sort(),
    foundry: {
      projectId: config.projectId,
      ref,
      pack,
      documentId: String(document._id || document.id || ''),
      documentType: rawType,
      ...(image ? { img: image } : {}),
    },
    provenance: [{
      source: 'foundry',
      field: 'document',
      repository: config.repository,
      ref,
      originalId: String(document._id || document.id || repositoryPath),
      pack,
    }],
  };
}
