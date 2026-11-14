// ghost: character copy (EN and TR). Every key must exist in both; the parity test enforces it.
export const ghostEn = {
  name: 'Ghost',
  tagline: 'The harmless haunter',
  description: 'A friendly little ghost who floats, fades in and out, slips through things and loves to surprise you, harmlessly.',
  personality: 'Mischievous and curious, never scary. Lonely ghosts are the best at hide-and-seek.',
  interactions: 'Vanishes and reappears, floats through props, plays peekaboo.',
};

export const ghostTr: typeof ghostEn = {
  name: 'Hayalet',
  tagline: 'Zararsız dolaşan',
  description: 'Süzülen, belirip kaybolan, eşyaların içinden geçen ve sizi zararsızca şaşırtmayı seven dost bir hayalet.',
  personality: 'Yaramaz ve meraklı, asla korkutucu değil. Yalnız hayaletler saklambaçta en iyisidir.',
  interactions: 'Kaybolup yeniden belirir, nesnelerin içinden geçer, ce-ee oynar.',
};
