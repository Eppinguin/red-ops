import {
  addChild,
  addInventoryItem,
  cloneItem,
  containsAnyUniqueTag,
  copyInventoryNode,
  copyItem,
  createInventoryNode,
  createItem,
  createNpc,
  defaultPriceForCategory,
  distributionValue,
  findInventoryEntry,
  getAllItems,
  getAllTags,
  getSkillTotalValue,
  getStatOrSkillValue,
  hydrateRole,
  itemEqualityKey,
  normalisedContainerSelection,
  priceCategoryValue,
  pythonStringCompare,
  qualityOptions,
  resetItemSequence,
  resolveRank,
  setInventoryItem,
  traverseInventory,
} from './domain';
import type { CatalogEntry } from '../content/types';
import { PYTHON_FAKER_LOCALES } from './catalog';
import { POCKET_MONEY_ITEM_DATA } from './generatedItems';
import { generateAiDescription, generateIdentity } from './identity';
import { chooseExponentialRandomElement, clamp, getAllowedItems, NumpyRandom, pythonRound } from './random';
import type {
  Catalog,
  GenerateOptions,
  GenerationProgress,
  InventoryNode,
  Item,
  Npc,
  Rank,
  Role,
} from './types';
import { STAT_NAMES } from './types';

const RANDOM_GENERATING_NUM_ATTEMPTS = 200;
const MAX_UNIQUE_DRUG_ITEMS = 1;

interface Template {
  rank: Rank;
  role: Role;
  rules: GenerateOptions;
  nationality: string;
}

interface CyberwareState {
  lastAdded: InventoryNode | null;
  root: InventoryNode;
  moneyBudget: number;
  humanityBudget: number;
}

export interface GeneratedCore {
  npc: Npc;
  rank: Rank;
  role: Role;
  options: GenerateOptions;
  seed: number;
  warning: string | null;
}

function progress(callback: ((progress: GenerationProgress) => void) | undefined, stage: string, value: number): void {
  callback?.({ stage, value });
}

function resolveSeed(seed: number): number {
  if (seed !== 0) return seed >>> 0;
  return Number(BigInt(Date.now()) * 1_000_000n % 1_000_000_000n);
}

function chooseNationality(random: NumpyRandom, catalog: Catalog): string {
  const locales = [...PYTHON_FAKER_LOCALES];
  const counts = new Map<string, number>();
  for (const locale of locales) {
    const country = locale.slice(locale.lastIndexOf('_') + 1);
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  const weighted = locales.map((locale) => {
    const country = locale.slice(locale.lastIndexOf('_') + 1);
    return {
      locale,
      weight: (catalog.nationalityWeights.populations[country] ?? 0) / (counts.get(country) ?? 1),
    };
  }).filter(({ weight }) => weight > 0)
    .sort((left, right) => right.weight - left.weight);
  return random.choice(
    weighted.map(({ locale }) => locale),
    weighted.map(({ weight }) => weight),
  );
}

function distributePoints(
  weights: readonly number[],
  numPoints: number,
  minimum: number,
  maximum: number,
): number[] {
  const sum = weights.reduce((total, value) => total + value, 0);
  const rounded = weights.map((weight) => pythonRound((weight / sum) * numPoints));
  let clampError = 0;
  const clamped = rounded.map((value) => {
    const next = clamp(value, 2, 8);
    clampError += value - next;
    return next;
  });

  const indexed = clamped.map((value, index) => ({ index, value }));
  indexed.sort((a, b) => b.value - a.value);
  while (clampError !== 0) {
    let changed = false;
    for (const entry of indexed) {
      if (clampError > 0 && entry.value < maximum) {
        clampError -= 1;
        entry.value += 1;
        changed = true;
      } else if (clampError < 0 && entry.value > minimum) {
        clampError += 1;
        entry.value -= 1;
        changed = true;
      }
      if (clampError === 0) break;
    }
    if (!changed) break;
  }

  const result = Array<number>(weights.length).fill(0);
  for (const entry of indexed) result[entry.index] = entry.value;
  return result;
}

function generateStatsAndSkills(npc: Npc, template: Template, catalog: Catalog, random: NumpyRandom): void {
  const tables = catalog.stats.streetrat_stats[template.role.name];
  if (!tables) throw new Error(`Missing streetrat stats for ${template.role.name}`);
  const selected = random.choice(tables);
  const stats = distributePoints(
    selected,
    distributionValue(random, template.rank.stats_budget),
    2,
    8,
  );
  for (let index = 0; index < stats.length; index += 1) npc.stats.set(STAT_NAMES[index]!, stats[index]!);

  const forbidden = new Set(template.rules.forbidden_skills);
  const placeholderNames = new Set(Object.keys(catalog.skillSpecializations));
  const specializationNames = new Set(Object.values(catalog.skillSpecializations).flat());
  for (const [name, data] of Object.entries(catalog.skills)) {
    if (forbidden.has(name) || placeholderNames.has(name) || specializationNames.has(name)) continue;
    npc.skills.set(name, { skill: { name, link: data.link, type: data.type }, level: 0 });
  }
  const roleSkillEntries = Object.entries(template.role.skills)
    .filter(([name]) => !forbidden.has(name))
    .filter(([name]) => catalog.skills[name] || catalog.skillSpecializations[name]);
  const distributed = distributePoints(
    roleSkillEntries.map(([, value]) => value),
    distributionValue(random, template.rank.skills_budget),
    2,
    10,
  );
  roleSkillEntries.forEach(([configuredName], index) => {
    const specializations = catalog.skillSpecializations[configuredName]
      ?.filter((name) => !forbidden.has(name)) ?? [];
    const name = specializations.length ? random.choice(specializations) : configuredName;
    const skillData = catalog.skills[name];
    if (!skillData) return;
    const entry = npc.skills.get(name) ?? {
      skill: { name, link: skillData.link, type: skillData.type },
      level: 0,
    };
    entry.level += distributed[index]!;
    npc.skills.set(name, entry);
  });

  if (template.rules.allow_martial_arts && random.uniform(0, 1) < template.role.martial_arts_probability) {
    const brawling = npc.skills.get('Brawling');
    const forms = forbidden.has('MartialArts')
      ? []
      : (catalog.skillSpecializations.MartialArts ?? []).filter((name) => !forbidden.has(name));
    if (brawling && forms.length) {
      const name = random.choice(forms);
      const data = catalog.skills[name];
      const level = Math.ceil(brawling.level / 2);
      if (data && level > 0) {
        brawling.level = 0;
        npc.skills.set(name, { skill: { name, link: data.link, type: data.type }, level });
      }
    }
  }
}

function makePairedItem(item: Item): Item {
  return cloneItem(item, { max_equipped_items: 0 });
}

function addToContainer(
  item: Item,
  container: InventoryNode,
  normalizedIndex: number,
  npc: Npc,
  firstPairingContainer: InventoryNode | null,
): InventoryNode | null {
  if (firstPairingContainer?.item.id === container.item.id) return null;
  if (firstPairingContainer && container.item.paired_container) return null;
  return addChild(container, item, npc, normalizedIndex);
}

function addCyberware(
  item: Item,
  initialState: CyberwareState,
  template: Template,
  allCyberware: readonly Item[],
  npc: Npc,
  random: NumpyRandom,
  firstPairingContainer: InventoryNode | null = null,
): CyberwareState | null {
  let state = initialState;
  if (!template.rules.allow_drugs && getAllTags(item).includes('Airhypo')) return null;
  if (item.max_humanity_loss >= 4 && !template.rules.allow_borgware) return null;

  if (item.max_equipped_items !== 0) {
    const count = traverseInventory(state.root).filter((node) => itemEqualityKey(node.item) === itemEqualityKey(item)).length;
    if (count >= item.max_equipped_items) return null;
  }
  for (const node of traverseInventory(state.root)) {
    if (node.item.name !== item.name && containsAnyUniqueTag(node.item, item)) return null;
  }

  const currentCounts = new Map<string, number>();
  for (const node of traverseInventory(state.root)) currentCounts.set(node.item.name, (currentCounts.get(node.item.name) ?? 0) + 1);
  const requiredCounts = new Map<string, number>();
  for (const required of item.required_cyberware) requiredCounts.set(required, (requiredCounts.get(required) ?? 0) + 1);

  for (const [requiredName, requiredCount] of requiredCounts) {
    const missing = requiredCount - (currentCounts.get(requiredName) ?? 0);
    for (let count = 0; count < missing; count += 1) {
      const requiredTemplate = allCyberware.find((entry) => entry.name === requiredName);
      if (!requiredTemplate) throw new Error(`Missing required cyberware: ${requiredName}`);
      const result = addCyberware(
        cloneItem(requiredTemplate),
        { ...state, root: copyInventoryNode(state.root) },
        template,
        allCyberware,
        npc,
        random,
      );
      if (!result) return null;
      state = result;
    }
  }

  const normalizedIndex = normalisedContainerSelection(random, template.rank);
  let containerWhereAdded: InventoryNode | null = null;
  let addedItem: InventoryNode | null = null;
  for (const container of traverseInventory(state.root)) {
    addedItem = addToContainer(item, container, normalizedIndex, npc, firstPairingContainer);
    if (addedItem) {
      containerWhereAdded = container;
      break;
    }
  }

  if (!containerWhereAdded) {
    for (const containerName of getAllowedItems(item.required_containers, normalizedIndex)) {
      const containerTemplate = allCyberware.find((entry) => entry.name === containerName);
      if (!containerTemplate) throw new Error(`Missing cyberware container: ${containerName}`);
      const result = addCyberware(
        cloneItem(containerTemplate),
        { ...state, root: copyInventoryNode(state.root) },
        template,
        allCyberware,
        npc,
        random,
      );
      if (!result?.lastAdded) continue;
      const candidate = addToContainer(item, result.lastAdded, normalizedIndex, npc, firstPairingContainer);
      if (candidate) {
        state = result;
        addedItem = candidate;
        containerWhereAdded = result.lastAdded;
        break;
      }
    }
  }
  if (!containerWhereAdded || !addedItem) return null;

  if (item.must_be_paired && !containerWhereAdded.item.paired_container && !firstPairingContainer) {
    const paired = addCyberware(
      makePairedItem(item),
      { ...state, root: copyInventoryNode(state.root) },
      template,
      allCyberware,
      npc,
      random,
      containerWhereAdded,
    );
    if (!paired) return null;
    state = paired;
  }

  if (item.price > 0 && state.moneyBudget < item.price) return null;
  state.moneyBudget -= item.price;
  if (item.max_humanity_loss > 0 && state.humanityBudget < item.max_humanity_loss) return null;
  state.humanityBudget -= item.max_humanity_loss;
  state.lastAdded = addedItem;
  return state;
}

function generateCyberware(npc: Npc, template: Template, catalog: Catalog, random: NumpyRandom): void {
  const allCyberware = catalog.cyberware.map(createItem);
  const meatbody = allCyberware.find((item) => item.name === 'Meatbody');
  if (!meatbody) throw new Error('Meatbody cyberware container is missing');
  npc.cyberware = createInventoryNode(meatbody);

  const moneyBudget = pythonRound(distributionValue(random, template.rank.items_budget.cyberware));
  const humanityBudget = Math.max((npc.stats.get('EMP')! - template.role.min_empathy), 0) * 10;
  if (!template.rules.allow_cyberware) return;

  let state: CyberwareState = { lastAdded: null, root: npc.cyberware, moneyBudget, humanityBudget };
  for (let attempt = 0; attempt < RANDOM_GENERATING_NUM_ATTEMPTS; attempt += 1) {
    const selectedName = chooseExponentialRandomElement(random, template.role.preferred_cyberware);
    const selected = allCyberware.find((item) => item.name === selectedName);
    if (!selected) throw new Error(`Unknown preferred cyberware: ${selectedName}`);
    const result = addCyberware(
      selected,
      { ...state, root: copyInventoryNode(state.root) },
      template,
      allCyberware,
      npc,
      random,
    );
    if (result) state = result;
  }
  npc.cyberware = state.root;
  const humanitySpent = humanityBudget - state.humanityBudget;
  npc.stats.set('EMP', Math.floor((npc.stats.get('EMP')! * 10 - humanitySpent) / 10));
}

function addUniqueItem(target: Item[], item: Item, sort: (a: Item, b: Item) => number): void {
  if (target.some((entry) => itemEqualityKey(entry) === itemEqualityKey(item))) return;
  target.push(item);
  target.sort(sort);
}

function weaponSort(a: Item, b: Item): number {
  const damage = (item: Item) => {
    if (!item.damage || !item.rate_of_fire) return 0;
    const match = item.damage.match(/(\d+)d(\d+)/);
    return match ? Number(match[1]) * Number(match[2]) * item.rate_of_fire : 0;
  };
  return damage(b) - damage(a) || pythonStringCompare(a.name, b.name);
}

function armorSort(a: Item, b: Item): number {
  const category = (item: Item) => {
    const locations = new Set(item.armor_locations);
    if (locations.has('Head') && locations.has('Body')) return 0;
    if (locations.has('Head') || item.name.endsWith('(Head)')) return 1;
    if (locations.has('Body') || item.name.endsWith('(Body)')) return 2;
    return item.name.includes('Shield') ? 3 : 4;
  };
  return category(a) - category(b) || pythonStringCompare(a.name, b.name);
}

function pickWeapon(
  budget: number,
  preferredWeapons: readonly string[],
  template: Template,
  allWeapons: readonly Item[],
  npc: Npc,
  random: NumpyRandom,
): [Item | null, number] {
  if (preferredWeapons.length === 0) return [null, 0];
  const qualities = qualityOptions(template.rank.min_items_quality);
  for (let attempt = 0; attempt < RANDOM_GENERATING_NUM_ATTEMPTS; attempt += 1) {
    const preferred = random.choice(preferredWeapons);
    const weaponTemplate = allWeapons.find((weapon) => weapon.unique_tags.includes(preferred));
    if (!weaponTemplate) throw new Error(`Unknown preferred weapon tag: ${preferred}`);
    if (!template.rules.allow_melee_weapon && getAllTags(weaponTemplate).includes('MeleeWeapon')) return [null, 0];
    if (!template.rules.allow_ranged_weapon && getAllTags(weaponTemplate).includes('RangedWeapon')) return [null, 0];
    if (getAllItems(npc).some((item) => !item.tags.includes('AuxiliaryWeapon') && containsAnyUniqueTag(weaponTemplate, item))) {
      return [null, 0];
    }

    const quality = random.choice(qualities);
    const category = priceCategoryValue(weaponTemplate.price);
    let price = weaponTemplate.price;
    if (quality === 'poor') price = category - 1 >= 0 ? defaultPriceForCategory(category - 1) : category / 2;
    if (quality === 'excellent') price = category + 1 <= 7 ? defaultPriceForCategory(category + 1) : category * 2;
    if (price > budget) continue;

    const weapon = copyItem(weaponTemplate);
    weapon.price = price;
    weapon.quality = quality;
    weapon.name = weapon.possible_names.length ? random.choice(weapon.possible_names) : weapon.name;
    weapon.beautiful_name = weapon.beautiful_names_by_quality[quality] ?? null;
    return [weapon, price];
  }
  return [null, 0];
}

function brawlingWeapon(
  npc: Npc,
  allWeapons: readonly Item[],
  martialArtsForms: readonly string[],
): Item {
  const body = getStatOrSkillValue(npc, 'BODY');
  const totalBody = body.value + body.totalModifier;
  const damage = totalBody <= 4 ? '1d6' : totalBody <= 6 ? '2d6' : totalBody <= 10 ? '3d6' : '4d6';
  const martialArtsNames = new Set(martialArtsForms);
  const martialArts = [...npc.skills.values()].find((entry) =>
    martialArtsNames.has(entry.skill.name) && entry.level > 0,
  );
  if (martialArts) {
    const template = allWeapons.find((item) => item.name === 'Martial Arts');
    if (!template) throw new Error('Martial Arts weapon is missing');
    const item = copyItem(template);
    item.name = martialArts.skill.name;
    item.skill = martialArts.skill.name;
    item.damage = damage;
    return item;
  }
  return createItem({
    type: 'weapon',
    unique_tags: ['Brawling', 'MeleeWeapon'],
    damage,
    rate_of_fire: 2,
    name: 'Unarmed',
  });
}

function generateWeapons(npc: Npc, template: Template, catalog: Catalog, random: NumpyRandom): void {
  const allWeapons = catalog.weapons.map(createItem);
  const totalBudget = pythonRound(distributionValue(random, template.rank.items_budget.weapon));
  for (const node of traverseInventory(npc.cyberware)) {
    if (node.item.damage) addUniqueItem(npc.weapons, node.item, weaponSort);
  }

  let [primary, spent] = pickWeapon(
    pythonRound(totalBudget * 0.8),
    template.role.preferred_primary_weapons,
    template,
    allWeapons,
    npc,
    random,
  );
  if (!primary) [primary, spent] = pickWeapon(totalBudget, template.role.preferred_primary_weapons, template, allWeapons, npc, random);
  if (primary) addUniqueItem(npc.weapons, primary, weaponSort);
  const [secondary] = pickWeapon(totalBudget - spent, template.role.preferred_secondary_weapons, template, allWeapons, npc, random);
  if (secondary) addUniqueItem(npc.weapons, secondary, weaponSort);
  addUniqueItem(
    npc.weapons,
    brawlingWeapon(npc, allWeapons, catalog.skillSpecializations.MartialArts ?? []),
    weaponSort,
  );
}

function generateAmmo(npc: Npc, template: Template, catalog: Catalog, random: NumpyRandom): void {
  type Requirement = { magazineSize: number; total: number };
  const roundToMagazine = (amount: number, magazine: number) => Math.ceil(amount / magazine) * magazine;
  const requirements = new Map<string, Requirement>();
  if (template.rules.allow_grenades) requirements.set('Grenade', { magazineSize: 1, total: 1 });
  const canAutofire = (npc.skills.get('Autofire')?.level ?? 0) > 0;

  for (const weapon of npc.weapons) {
    if (weapon.ammo_types.length === 0) continue;
    const magazineSize = Math.max(1, weapon.magazine ?? 1);
    const tags = getAllTags(weapon);
    const total = tags.includes('LimitedAmmoWeapon')
      ? 2
      : canAutofire && tags.includes('AutofireWeapon')
        ? roundToMagazine(60, magazineSize)
        : roundToMagazine((weapon.rate_of_fire ?? 1) * 12, magazineSize);
    const amountPerType = roundToMagazine(Math.ceil(total / weapon.ammo_types.length), magazineSize);
    for (const ammoType of weapon.ammo_types) {
      const next = { magazineSize, total: amountPerType };
      const current = requirements.get(ammoType);
      if (!current || next.total > current.total
        || (next.total === current.total && next.magazineSize > current.magazineSize)) {
        requirements.set(ammoType, next);
      }
    }
  }

  const makeAmmo = (ammoType: string, modification: string): Item => {
    const data = catalog.ammo[modification];
    if (!data) throw new Error(`Unknown ammo modification: ${modification}`);
    const price = ['Grenade', 'Rocket'].includes(ammoType) ? data.price * 10 : data.price;
    return createItem({
      name: data.name ?? `${ammoType} (${modification})`,
      type: 'ammo',
      price,
    });
  };

  const amountsAdded = new Map([...requirements.keys()].map((type) => [type, 0]));
  if (template.rules.allow_non_basic_ammo) {
    let budget = pythonRound(distributionValue(random, template.rank.items_budget.ammo));
    while (true) {
      const candidates = [...requirements].flatMap(([ammoType, requirement]) => {
        const amount = requirement.magazineSize;
        if ((amountsAdded.get(ammoType) ?? 0) + amount > requirement.total) return [];
        const affordable = template.role.preferred_ammo
          .filter((modification) => modification !== 'Basic')
          .filter((modification) => catalog.ammo[modification]?.types.includes(ammoType))
          .map((modification) => ({
            modification,
            cost: makeAmmo(ammoType, modification).price * amount,
          }))
          .filter(({ cost }) => cost <= budget);
        return affordable.length ? [{ ammoType, amount, affordable }] : [];
      });
      if (!candidates.length) break;
      const candidate = random.choice(candidates);
      const modification = chooseExponentialRandomElement(
        random,
        candidate.affordable.map((entry) => entry.modification),
      );
      const cost = candidate.affordable.find((entry) => entry.modification === modification)!.cost;
      addInventoryItem(npc, makeAmmo(candidate.ammoType, modification), candidate.amount);
      amountsAdded.set(candidate.ammoType, (amountsAdded.get(candidate.ammoType) ?? 0) + candidate.amount);
      budget -= cost;
    }
  }

  for (const [ammoType, requirement] of requirements) {
    const amount = requirement.total - (amountsAdded.get(ammoType) ?? 0);
    if (amount <= 0) continue;
    const basic = catalog.ammo.Basic?.types.includes(ammoType)
      ? 'Basic'
      : Object.keys(catalog.ammo).find((name) => catalog.ammo[name]!.types.includes(ammoType));
    if (!basic) throw new Error(`No ammo configuration supports ${ammoType}`);
    addInventoryItem(npc, makeAmmo(ammoType, basic), amount);
  }
}

function generateEquipment(npc: Npc, template: Template, catalog: Catalog, random: NumpyRandom): void {
  if (template.rules.allow_equipment) {
    const equipment = catalog.equipment.map(createItem);
    const equipmentByName = new Map(equipment.map((item) => [item.name, item]));
    const preferred = template.role.preferred_equipment.filter((name) => equipmentByName.has(name));
    const trained = [...npc.skills.values()].filter((entry) => entry.level > 0);
    const preferredTags = new Set(trained.flatMap((entry) =>
      catalog.skills[entry.skill.name]?.preferred_equipment_tags ?? [],
    ));
    const skillPreferred = equipment
      .filter((item) => getAllTags(item).some((tag) => preferredTags.has(tag))
        || trained.some((entry) => item.beautiful_names_by_skill[entry.skill.name]))
      .map((item) => item.name);
    let budget = pythonRound(distributionValue(random, template.rank.items_budget.equipment));
    const maximum = Math.max(pythonRound(distributionValue(random, template.rank.items_num_budget.equipment)), 0);
    let count = 0;
    for (let attempt = 0; attempt < RANDOM_GENERATING_NUM_ATTEMPTS; attempt += 1) {
      if (count === maximum) break;
      const pool = skillPreferred.length ? skillPreferred : preferred;
      if (!pool.length) break;
      const name = chooseExponentialRandomElement(random, pool);
      const sourceItem = equipmentByName.get(name);
      if (!sourceItem) continue;
      const item = copyItem(sourceItem);
      const beautifulName = trained
        .filter((entry) => item.beautiful_names_by_skill[entry.skill.name])
        .sort((left, right) =>
          right.level - left.level || pythonStringCompare(right.skill.name, left.skill.name),
        )[0];
      if (beautifulName) item.beautiful_name = item.beautiful_names_by_skill[beautifulName.skill.name]!;
      if (!template.rules.allow_drugs && getAllTags(item).includes('Airhypo')) continue;
      if (findInventoryEntry(npc, item)) continue;
      const similarInventory = [...npc.inventory.values()]
        .some((entry) => containsAnyUniqueTag(item, entry.item));
      if (similarInventory) {
        const skillIndex = skillPreferred.indexOf(name);
        if (skillIndex >= 0) skillPreferred.splice(skillIndex, 1);
        const preferredIndex = preferred.indexOf(name);
        if (preferredIndex >= 0) preferred.splice(preferredIndex, 1);
        continue;
      }
      if (traverseInventory(npc.cyberware).some((node) => containsAnyUniqueTag(item, node.item))) continue;
      if (item.price > budget) continue;
      budget -= item.price;
      setInventoryItem(npc, item, 1);
      const skillIndex = skillPreferred.indexOf(name);
      if (skillIndex >= 0) skillPreferred.splice(skillIndex, 1);
      const preferredIndex = preferred.indexOf(name);
      if (preferredIndex >= 0) preferred.splice(preferredIndex, 1);
      count += 1;
    }
  }

  if (template.rules.allow_money) {
    const money = Math.max(pythonRound(distributionValue(random, template.rank.pocket_money)), 0);
    if (money > 0) setInventoryItem(npc, createItem(POCKET_MONEY_ITEM_DATA), money);
  }
}

function pickArmor(budget: number, preferredNames: readonly string[], armor: readonly Item[]): [Item | null, number] {
  const byName = new Map(armor.map((item) => [item.name, item]));
  for (const name of preferredNames) {
    const item = byName.get(name);
    if (!item || item.price > budget) continue;
    return [item, item.price];
  }
  return [null, 0];
}

function generateArmor(npc: Npc, template: Template, catalog: Catalog, random: NumpyRandom): void {
  const armorCyberware = traverseInventory(npc.cyberware).find((node) => node.item.tags.includes('Armor'))?.item;
  if (armorCyberware) {
    addUniqueItem(npc.armor, cloneItem(armorCyberware, {
      price: 0,
      armor_locations: ['Head', 'Body'],
    }), armorSort);
  } else if (template.rules.allow_armor) {
    const armor = catalog.armor.map(createItem);
    const bodyOptions = armor.filter((item) => item.armor_locations.includes('Body'));
    const headOptions = armor.filter((item) => item.armor_locations.includes('Head'));
    const budget = pythonRound(distributionValue(random, template.rank.items_budget.armor));
    let [body, spent] = pickArmor(
      pythonRound(budget * 0.8),
      template.role.preferred_armor.body,
      bodyOptions,
    );
    if (!body) [body, spent] = pickArmor(budget, template.role.preferred_armor.body, bodyOptions);
    if (body) addUniqueItem(npc.armor, cloneItem(body), armorSort);
    if (body && !body.armor_locations.includes('Head')) {
      const compatibleHead = headOptions.filter((item) => (item.armor_class ?? 0) <= (body.armor_class ?? 0));
      const [head] = pickArmor(
        budget - spent,
        template.role.preferred_armor.head,
        compatibleHead,
      );
      if (head) addUniqueItem(npc.armor, cloneItem(head), armorSort);
    }
  }

  for (const shield of getAllItems(npc).filter((item) => item.unique_tags.includes('Shield'))) {
    addUniqueItem(npc.armor, shield, armorSort);
  }

  if (npc.armor.length) {
    const negatives = new Map<string, number>();
    let selected: Item | null = null;
    const transformed: Item[] = [];
    for (const armor of npc.armor) {
      for (const modifier of armor.modifiers) {
        if ((modifier.simple ?? 0) < 0) {
          const current = negatives.get(modifier.name) ?? 0;
          if ((modifier.simple ?? 0) < current) {
            negatives.set(modifier.name, modifier.simple ?? 0);
            selected = armor;
          }
        }
      }
      const copy = copyItem(armor);
      copy.modifiers = copy.modifiers.filter((modifier) => (modifier.simple ?? 0) > 0);
      transformed.push(copy);
    }
    if (selected) {
      const target = transformed.find((item) => itemEqualityKey(item) === itemEqualityKey(selected));
      if (target) target.modifiers.push(...[...negatives].map(([name, simple]) => ({ name, simple, complicated: [] })));
    }
    npc.armor = [];
    for (const armor of transformed) addUniqueItem(npc.armor, armor, armorSort);
  }
}

function generateDrugs(npc: Npc, template: Template, catalog: Catalog, random: NumpyRandom): void {
  if (!template.rules.allow_drugs) return;
  if (!getAllItems(npc).some((item) => item.unique_tags.includes('Airhypo'))) return;
  const drugs = catalog.drugs.map(createItem);
  let budget = pythonRound(distributionValue(random, template.rank.items_budget.drug));
  const maximum = Math.max(pythonRound(distributionValue(random, template.rank.items_num_budget.drug)), 0);
  let count = 0;
  for (let attempt = 0; attempt < RANDOM_GENERATING_NUM_ATTEMPTS; attempt += 1) {
    if (count === maximum) break;
    const name = chooseExponentialRandomElement(random, template.role.preferred_drugs);
    const item = drugs.find((entry) => entry.name === name);
    if (!item) throw new Error(`Unknown preferred drug: ${name}`);
    const existing = findInventoryEntry(npc, item)?.amount ?? 0;
    if (existing >= MAX_UNIQUE_DRUG_ITEMS || item.price > budget) continue;
    budget -= item.price;
    addInventoryItem(npc, item, 1);
    count += 1;
  }
}

function generateJunk(npc: Npc, template: Template, catalog: Catalog, random: NumpyRandom): void {
  if (!template.rules.allow_junk) return;
  const junk = catalog.junk.map(createItem).sort((a, b) => b.price - a.price);
  let budget = pythonRound(distributionValue(random, template.rank.items_budget.junk));
  const maximum = Math.max(pythonRound(distributionValue(random, template.rank.items_num_budget.junk)), 0);
  let count = 0;
  for (let attempt = 0; attempt < RANDOM_GENERATING_NUM_ATTEMPTS; attempt += 1) {
    if (count === maximum) break;
    const item = chooseExponentialRandomElement(random, junk);
    if (findInventoryEntry(npc, item) || item.price > budget) continue;
    budget -= item.price;
    setInventoryItem(npc, item, 1);
    count += 1;
  }
}

function generateTraumaTeam(npc: Npc, template: Template, random: NumpyRandom): void {
  const weights = template.rank.trauma_team_status_weights;
  if (weights.length === 0) return;
  const statuses = ['NONE', 'SILVER', 'EXECUTIVE'] as const;
  npc.traumaTeamStatus = random.choice(statuses, weights);
}

function generateLifepath(catalog: Catalog, nationality: string | null, random: NumpyRandom): Npc['lifepath'] {
  const pick = <T>(values: readonly T[]): T => random.choice(values);
  const count = () => Math.max(0, random.randint(1, 11) - 7);
  let culturalOrigin: string;
  let language: string | undefined;

  try {
    const locale = new Intl.Locale((nationality ?? '').replace('_', '-'));
    const region = locale.region;
    const languageCode = locale.language;
    if (!region || !languageCode) throw new Error('Locale has no territory or language');
    culturalOrigin = new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? region;
    language = new Intl.DisplayNames(['en'], { type: 'language' }).of(languageCode) ?? languageCode;
  } catch {
    if (nationality) {
      culturalOrigin = nationality;
    } else {
      const origin = pick(catalog.lifepath.cultural_origins);
      culturalOrigin = origin.region;
      language = random.choice(origin.languages);
    }
  }

  const friends = Array.from({ length: count() }, () => pick(catalog.lifepath.friend_relationship));
  const enemies = Array.from({ length: count() }, () => ({
    enemy: pick(catalog.lifepath.enemy),
    cause: pick(catalog.lifepath.enemy_cause),
    wronged_party: random.choice(['You', 'They']),
    resources: pick(catalog.lifepath.enemy_resources),
    reaction: pick(catalog.lifepath.sweet_revenge),
  }));
  const tragicLoveAffairs = Array.from(
    { length: count() },
    () => pick(catalog.lifepath.tragic_love_affair),
  );

  return {
    cultural_origin: culturalOrigin,
    ...(language ? { language } : {}),
    personality: pick(catalog.lifepath.personality),
    clothing_style: pick(catalog.lifepath.clothing_style),
    hairstyle: pick(catalog.lifepath.hairstyle),
    affectation: pick(catalog.lifepath.affectation),
    value_most: pick(catalog.lifepath.value_most),
    feel_about_people: pick(catalog.lifepath.feel_about_people),
    valued_person: pick(catalog.lifepath.valued_person),
    valued_possession: pick(catalog.lifepath.valued_possession),
    family_background: pick(catalog.lifepath.family_background),
    childhood_environment: pick(catalog.lifepath.childhood_environment),
    family_crisis: pick(catalog.lifepath.family_crisis),
    friends,
    enemies,
    tragic_love_affairs: tragicLoveAffairs,
    life_goal: pick(catalog.lifepath.life_goal),
  };
}

export async function generateNpc(
  catalog: Catalog,
  inputOptions: GenerateOptions,
  onProgress?: (progress: GenerationProgress) => void,
  referenceEntries: readonly CatalogEntry[] = [],
): Promise<GeneratedCore> {
  resetItemSequence();
  const seed = resolveSeed(inputOptions.seed);
  const random = new NumpyRandom(seed);
  const nationality = inputOptions.nationality || chooseNationality(random, catalog);
  const rank = resolveRank(catalog, inputOptions.rank);
  const roleData = catalog.roles.find((entry) => entry.name === inputOptions.role);
  if (!roleData) throw new Error(`Unknown role: ${inputOptions.role}`);
  const role = hydrateRole(roleData);
  const options = { ...inputOptions, nationality };
  const template: Template = { rank, role, rules: options, nationality };
  const meatbody = createItem(catalog.cyberware.find((entry) => entry.name === 'Meatbody'));
  const npc = createNpc(meatbody);
  npc.role = role.name;

  progress(onProgress, 'Allocating stats and skills', 0.08);
  generateStatsAndSkills(npc, template, catalog, random);
  progress(onProgress, 'Installing cyberware', 0.22);
  generateCyberware(npc, template, catalog, random);
  progress(onProgress, 'Selecting weapons', 0.38);
  generateWeapons(npc, template, catalog, random);
  progress(onProgress, 'Packing ammunition', 0.50);
  generateAmmo(npc, template, catalog, random);
  progress(onProgress, 'Buying equipment', 0.60);
  generateEquipment(npc, template, catalog, random);
  progress(onProgress, 'Fitting armor', 0.70);
  generateArmor(npc, template, catalog, random);
  progress(onProgress, 'Adding drugs and pocket junk', 0.80);
  generateDrugs(npc, template, catalog, random);
  generateJunk(npc, template, catalog, random);
  generateTraumaTeam(npc, template, random);
  progress(onProgress, 'Generating identity', 0.90);
  generateIdentity(npc, rank, nationality, random, seed);
  if (options.allow_lifepath) npc.lifepath = generateLifepath(catalog, nationality, random);

  let warning: string | null = null;
  try {
    if (!options.allow_description) {
      progress(onProgress, 'Operative ready', 1);
      return { npc, rank, role, options, seed, warning };
    }
    const description = await generateAiDescription(npc, rank, role, nationality, catalog, options, seed, referenceEntries);
    npc.description = description;
  } catch (error) {
    warning = `AI description was not generated: ${error instanceof Error ? error.message : String(error)}`;
  }
  progress(onProgress, 'Operative ready', 1);
  return { npc, rank, role, options, seed, warning };
}

export function weaponSkillName(item: Item, catalog: Catalog): string | null {
  if (item.skill) return item.skill;
  if (catalog.weaponSkills[item.name]) return catalog.weaponSkills[item.name]!;
  for (const tag of getAllTags(item)) {
    if (catalog.weaponSkills[tag]) return catalog.weaponSkills[tag]!;
  }
  return null;
}

export function weaponAttackValues(npc: Npc, item: Item, catalog: Catalog): { skill: number | null; autofire: number | null } {
  const name = weaponSkillName(item, catalog);
  let skill = name ? getSkillTotalValue(npc, name) : null;
  if (skill !== null && item.quality === 'excellent') skill += 1;
  const tags = getAllTags(item);
  const autofire = tags.some((tag) => ['SMG', 'HeavySMG', 'AssaultRifle'].includes(tag))
    ? getSkillTotalValue(npc, 'Autofire')
    : null;
  return { skill, autofire };
}
