// cat: character copy (EN and TR). Every key must exist in both; the parity test enforces it.
export const catEn = {
  name: 'Cat',
  tagline: 'The original companion',
  description: 'A curious, independent cat who naps in sunny spots, chases the occasional butterfly and keeps you company on the desktop.',
  personality: 'Moody in a gentle way: cuddly when it wants to be, aloof when it does not.',
  interactions: 'Pet it, call it, play with yarn and butterflies, shine the laser.',
};

export const catTr: typeof catEn = {
  name: 'Kedi',
  tagline: 'İlk yol arkadaşı',
  description: 'Güneşli köşelerde uyuklayan, ara sıra kelebek kovalayan ve masaüstünde size eşlik eden meraklı, bağımsız bir kedi.',
  personality: 'Yumuşak huylu ama kendi keyfinde: canı isteyince sokulgan, istemeyince mesafeli.',
  interactions: 'Sevin, çağırın, yumakla ve kelebeklerle oynayın, lazeri tutun.',
};
