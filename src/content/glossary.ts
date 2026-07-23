export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  HP: { term: 'HP', definition: 'Hit Points. At half HP an NPC is Seriously Wounded unless an effect says otherwise.' },
  SP: { term: 'SP', definition: 'Stopping Power. Armor reduces incoming damage by its current SP before ablation.' },
  ROF: { term: 'ROF', definition: 'Rate of Fire. The maximum number of attacks this weapon normally makes in one Action.' },
  DV: { term: 'DV', definition: 'Difficulty Value. A check succeeds when the roll total meets or exceeds the applicable DV.' },
  REF: { term: 'REF', definition: 'Reflexes. Used by several ranged attacks, initiative, and some defensive rules.' },
  BODY: { term: 'BODY', definition: 'Body. Contributes to HP, Death Saves, and unarmed or melee damage.' },
  Humanity: { term: 'Humanity Loss', definition: 'Cyberware installation can reduce Humanity and therefore effective Empathy.' },
  Foundational: { term: 'Foundational Cyberware', definition: 'A base implant that provides capacity for compatible cyberware options.' },
  Electronic: { term: 'Electronic', definition: 'Structured item flag used to identify gear that can interact with EMP-related effects.' },
  Quality: { term: 'Quality', definition: 'Weapon quality can modify attack checks. The generator supports poor, standard, and excellent variants.' },
};
