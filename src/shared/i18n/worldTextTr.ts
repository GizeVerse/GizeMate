// Turkish world-event text: same ids and the same outcome tokens as EVENT_TEXT in ../worldText.ts (a test
// compares the key sets). Warm and quiet like the English: no exclamation marks, no guilt, no streaks.
// The companion is simply "kedi" (Turkish has no grammatical gender, so no pronoun choice is implied).
import type { AnyEventId } from '../companion';

export interface EventTextTr {
  name: string;
  description: string;
  fallback: string;
  outcomes: Readonly<Record<string, string>>;
}

export const EVENT_TEXT_TR: Readonly<Record<AnyEventId, EventTextTr>> = {
  mouseEncounter: {
    name: 'Küçük Fare',
    description: 'Minik bir fare yerde koşuşturur ve hep kaçmayı başarır.',
    fallback: 'Küçük bir fare yerde koştu ve sıvışıp gitti.',
    outcomes: {
      watched: 'Küçük bir fare yerde koştu. Kedi gidişini izledi.',
      sneaked: 'Küçük bir fare çıktı. Kedi yavaşça ve alçaktan peşinden süzüldü, fare ise sıvışıp gitti.',
      chased: 'Küçük bir fare yerde fırladı. Kedi güzel bir kovalamaca verdi, fare deliğine ulaşmayı başardı.',
      approached: 'Küçük bir fare belirdi. Kedi merhaba demeye yanına gitti, fare koşarak kaçtı.',
    },
  },
  miniTsunami: {
    name: 'Mini Tsunami',
    description: 'Küçük, zararsız bir dalga yerde ilerler.',
    fallback: 'Küçük bir dalga yerde yuvarlandı ve kayboldu.',
    outcomes: {
      hopped: 'Küçük bir dalga geldi. Kedi tam üstünden atladı.',
      moved: 'Küçük bir dalga geldi. Kedi yolundan çekildi ve geçişini izledi.',
      climbed: 'Küçük bir dalga geldi. Kedi patileri ıslanmasın diye yukarı tırmandı.',
      wet: 'Küçük bir dalga geldi ve kedi biraz ıslandı. Silkinip kurudu ve yoluna devam etti.',
    },
  },
  butterflyEncounter: {
    name: 'Kelebek',
    description: 'Bir kelebek kanat çırparak geçer, yaklaşılınca uçup gider.',
    fallback: 'Bir kelebek kanat çırparak geçti ve uçup gitti.',
    outcomes: {
      watched: 'Bir kelebek kanat çırparak geçti. Kedi onu bir süre izledi.',
      followed: 'Bir kelebek kanat çırparak geçti. Kedi uçup gidene kadar yavaşça peşinden gitti.',
      chased: 'Bir kelebek kanat çırparak geçti. Kedi onu çevrede kovaladı, kelebek ise elinden kaçtı.',
    },
  },
  fallingLeaf: {
    name: 'Düşen Yaprak',
    description: 'Yukarıdan bir yaprak süzülerek iner.',
    fallback: 'Bir yaprak süzülerek indi ve yere kondu.',
    outcomes: {
      followed: 'Bir yaprak süzülerek indi. Kedi yere varana kadar gözleriyle onu izledi.',
      tapped: 'Bir yaprak süzülerek indi. Yere konunca kedi ona bir pati attı.',
      inspected: 'Bir yaprak süzülerek indi. Kedi onu koklamaya yanına geldi.',
    },
  },
  yarnTrouble: {
    name: 'Yumak Belası',
    description: 'Bir yün yumağı yuvarlanıp gelir ve biraz oyuna davet eder.',
    fallback: 'Bir yün yumağı yuvarlanıp geldi ve kedi onunla bir süre oynadı.',
    outcomes: {
      played: 'Bir yün yumağı yuvarlanıp geldi. Kedi onunla bir süre oynadı.',
      tangled: 'Bir yün yumağı yuvarlanıp geldi. Kedi kısa bir süre dolandı, sonra kurtuldu ve tüylerini düzeltti.',
      rolled: 'Bir yün yumağı yuvarlanıp geldi. Kedi onu yerde tekmeledi ve peşinden koştu.',
    },
  },
  littleGhost: {
    name: 'Küçük Hayalet',
    description: 'Minik, dost canlısı bir hayalet süzülüp geçer ve kaybolur.',
    fallback: 'Minik bir hayalet süzülüp geçti ve iz bırakmadan kayboldu.',
    outcomes: {
      startled: 'Minik bir hayalet süzülüp geçti. Kedi sıçradı, bir an saklandı, sonra başını çıkarıp baktı.',
      hid: 'Minik bir hayalet süzülüp geçti. Kedi gidene kadar saklı kaldı.',
      investigated: 'Minik bir hayalet süzülüp geçti. Kedi incelemek için yanına süzüldü, hayalet silinip gitti.',
      approached: 'Minik bir hayalet süzülüp geçti. Kedi ona eski bir dostuymuş gibi yürüyerek yaklaştı.',
    },
  },
  boxAppears: {
    name: 'Karton Kutu',
    description: 'Bir karton kutu belirir. Bundan ilginç bir şey yoktur.',
    fallback: 'Bir karton kutu bir süreliğine belirdi.',
    outcomes: {
      investigated: 'Bir karton kutu belirdi. Kedi onu iyice kokladı.',
      entered: 'Bir karton kutu belirdi. Kedi içine girip oturdu, son derece memnundu.',
      rested_beside: 'Bir karton kutu belirdi. Kedi dinlenmek için yanına yerleşti.',
    },
  },
  mysteriousBall: {
    name: 'Gizemli Top',
    description: 'Bir top nereden geldiği belli olmadan yuvarlanıp gelir.',
    fallback: 'Bir top nereden geldiği belli olmadan yuvarlanıp geldi ve durdu.',
    outcomes: {
      watched: 'Bir top nereden geldiği belli olmadan yuvarlanıp geldi. Kedi durmasını izledi.',
      tapped: 'Bir top nereden geldiği belli olmadan yuvarlanıp geldi. Kedi ona bir pati attı ve yuvarlanmasını sağladı.',
      chased: 'Bir top nereden geldiği belli olmadan yuvarlanıp geldi. Kedi peşinden yerde koştu.',
    },
  },
  thunderstorm: {
    name: 'Küçük Fırtına',
    description: 'Küçük bir bulut kedinin yakınında yağmur yağdırır ve gürler.',
    fallback: 'Küçük bir fırtına bulutu üstünden geçti, biraz yağmur yağdırdı ve gürleyerek uzaklaştı.',
    outcomes: {
      hid: 'Küçük bir fırtına bulutu tepede gürledi. Kedi yağmur geçene kadar saklandı.',
      calm: 'Küçük bir fırtına bulutu tepede gürledi. Kedi sakince oturup bekledi.',
      startled: 'Küçük bir fırtına bulutu tepede gürledi. Kedi gök gürültüsüyle ürperdi, sonra yatıştı.',
    },
  },
  flyingFish: {
    name: 'Uçan Balık',
    description: 'Küçük bir balık uzun bir yay çizerek sıçrar ve suya şapırdar.',
    fallback: 'Küçük bir balık ekranın üstünden sıçradı ve şapırtıyla indi.',
    outcomes: {
      startled: 'Küçük bir balık tam kedinin üstünden sıçradı ve kedi epey ürktü.',
      watched: 'Küçük bir balık uzun bir yay çizerek sıçradı. Kedi şapırtıyla inişini izledi.',
      hopped: 'Küçük bir balık sıçradı. Kedi onu karşılamaya zıpladı ama balık çok hızlıydı.',
    },
  },
  tinyUfo: {
    name: 'Minik UFO',
    description: 'Çok küçük bir uçan daire gökyüzünden geçer.',
    fallback: 'Minik bir uçan daire gökyüzünden geçti ve hızla uzaklaştı.',
    outcomes: {
      watched: 'Minik bir uçan daire gökyüzünden geçti. Kedi gidişini izledi.',
      followed: 'Minik bir uçan daire gökyüzünden geçti. Kedi onu yerden takip etti.',
      startled: 'Minik bir uçan daire tepede belirdi. Kedi ürktü, sonra sakinleşti.',
    },
  },
  windGust: {
    name: 'Rüzgâr Esintisi',
    description: 'Bir rüzgâr esintisi yaprakları ve kâğıtları savurur.',
    fallback: 'Bir rüzgâr esintisi geçti ve birkaç hafif şeyi savurdu.',
    outcomes: {
      braced: 'Bir rüzgâr esintisi geçti. Kedi geçene kadar alçakta çömeldi.',
      reacted: 'Bir rüzgâr esintisi geçti. Kedi ürktü, sonra dağılan tüylerini düzeltti.',
      followed: 'Bir rüzgâr esintisi geçti. Kedi rüzgârın taşıdığı bir yaprağın peşinden tırısla gitti.',
    },
  },
  paperPlane: {
    name: 'Kâğıt Uçak',
    description: 'Bir kâğıt uçak süzülerek geçer ve yumuşakça konar.',
    fallback: 'Bir kâğıt uçak süzülerek geçti ve yere kondu.',
    outcomes: {
      watched: 'Bir kâğıt uçak süzülerek geçti. Kedi inişini izledi.',
      chased: 'Bir kâğıt uçak süzülerek geçti. Kedi konana kadar peşinden koştu.',
      inspected: 'Bir kâğıt uçak süzülerek geçti. Konunca kedi onu incelemeye yanına geldi.',
    },
  },
  magicSparkles: {
    name: 'Sihirli Parıltılar',
    description: 'Zeminin yakınında birkaç parıltı göz kırpar.',
    fallback: 'Zeminin yakınında birkaç parıltı göz kırptı ve söndü.',
    outcomes: {
      reached: 'Zeminin yakınında birkaç parıltı göz kırptı. Kedi onlara dokunmak için uzandı.',
      watched: 'Zeminin yakınında birkaç parıltı göz kırptı. Kedi sönüşlerini izledi.',
      sniffed: 'Zeminin yakınında birkaç parıltı göz kırptı. Kedi onları koklamak için eğildi.',
    },
  },
  shadowVisitor: {
    name: 'Gölge Ziyaretçi',
    description: 'Zararsız, koyu bir şekil kayıp geçer ve silinir.',
    fallback: 'Zararsız bir gölge kayıp geçti ve silindi.',
    outcomes: {
      investigated: 'Zararsız bir gölge kayıp geçti. Kedi incelemek için yaklaştı, gölge silindi.',
      cautious: 'Zararsız bir gölge kayıp geçti. Kedi gidene kadar dikkatli bir mesafe korudu.',
      startled: 'Zararsız bir gölge kayıp geçti. Kedi ürktü ve bir an saklandı.',
    },
  },
  toySpring: {
    name: 'Yaylı Oyuncak',
    description: 'Yaylı bir oyuncak zıplayarak dolaşır.',
    fallback: 'Yaylı bir oyuncak bir süre zıplayarak geçti.',
    outcomes: {
      played: 'Yaylı bir oyuncak zıplayarak geldi. Kedi onu bir süre oradan oraya tekmeledi.',
      watched: 'Yaylı bir oyuncak zıplayarak geldi. Kedi onun boing diye zıplamasını izledi.',
      hopped: 'Yaylı bir oyuncak zıplayarak geldi. Kedi onunla birlikte zıpladı.',
    },
  },
  bubbleParty: {
    name: 'Balon Şenliği',
    description: 'Küçük baloncuklar yükselir ve patlar.',
    fallback: 'Birkaç küçük baloncuk yükseldi ve patladı.',
    outcomes: {
      watched: 'Küçük baloncuklar yükseldi. Kedi onların süzülüp patlamasını izledi.',
      popped: 'Küçük baloncuklar yükseldi. Kedi birkaçını patlattı.',
      hopped: 'Küçük baloncuklar yükseldi. Kedi zıplayıp tek tek patilerini uzattı.',
    },
  },
  curiousBird: {
    name: 'Meraklı Kuş',
    description: 'Küçük bir kuş konar, etrafta sekip uçup gider.',
    fallback: 'Küçük bir kuş kondu, etrafta sekti ve uçup gitti.',
    outcomes: {
      watched: 'Küçük bir kuş yakına kondu. Kedi uçup gidene kadar sekişini izledi.',
      followed: 'Küçük bir kuş yakına kondu. Kedi peşinden süzüldü, kuş uçup gitti.',
      chattered: 'Küçük bir kuş yakına kondu. Kedi ona dişlerini takırdattı, kuş uçup gitti.',
    },
  },
  fallingStar: {
    name: 'Kayan Yıldız',
    description: 'Bir yıldız yukarıdaki gökyüzünden geçer.',
    fallback: 'Bir yıldız gökyüzünden çizgi çekti ve kayboldu.',
    outcomes: {
      watched: 'Bir yıldız gökyüzünden çizgi çekti. Kedi gidişini izledi.',
      wished: 'Bir yıldız gökyüzünden çizgi çekti. Kedi sanki dilek tutuyormuş gibi sessizce oturdu.',
      amazed: 'Bir yıldız gökyüzünden çizgi çekti. Kedi hayranlıkla küçük bir miyavladı.',
    },
  },
  tinyTreasure: {
    name: 'Minik Hazine',
    description: 'Zeminde minik bir hazine ortaya çıkar.',
    fallback: 'Kedi zeminde minik bir hazine buldu.',
    outcomes: {
      coin: 'Kedi zeminde parlak küçük bir bozuk para buldu ve ona uzun uzun baktı.',
      gem: 'Kedi zeminde küçük, ışıldayan bir değerli taş buldu ve onunla bir süre oturdu.',
      shell: 'Kedi zeminde minik bir deniz kabuğu buldu ve onu dikkatle kokladı.',
      button: 'Kedi zeminde yuvarlak küçük bir düğme buldu ve onu yakından inceledi.',
    },
  },
  goldenButterfly: {
    name: 'Altın Kelebek',
    description: 'Nadir bir altın kelebek oyalanır ve ardında parıltı izi bırakır.',
    fallback: 'Altın bir kelebek ardında parıltı izi bırakarak süzülüp geçti.',
    outcomes: {
      watched: 'Nadir bir altın kelebek süzülüp geçti. Kedi gidene kadar kıpırdamadan onu izledi.',
      followed: 'Nadir bir altın kelebek süzülüp geçti. Kedi parıltı izi ve her şeyiyle onu usulca takip etti.',
      danced: 'Nadir bir altın kelebek süzülüp geçti. Kedi ve kelebek bir süre dans etti.',
    },
  },
  treasureDiscovery: {
    name: 'Hazine Keşfi',
    description: 'Nadir bir küçük sandık belirir ve parıltılara boğulur.',
    fallback: 'Küçük bir sandık belirdi ve parıltılara boğuldu.',
    outcomes: {
      opened: 'Küçük bir hazine sandığı belirdi. Kedi burnuyla onu açtı ve bir parıltı seli yükseldi.',
      sniffed: 'Küçük bir hazine sandığı belirdi. Kedi onu kokladı ve parıltılar süzülerek çıktı.',
      pawed: 'Küçük bir hazine sandığı belirdi. Kedi ona patisiyle dokundu ve parıltılar saçıldı.',
    },
  },
  friendlyGhost: {
    name: 'Dost Hayalet',
    description: 'Nadir, usulca parlayan bir hayalet kediye bir an arkadaşlık eder.',
    fallback: 'Usulca parlayan bir hayalet kediye bir an arkadaşlık etti.',
    outcomes: {
      befriended: 'Usulca parlayan bir hayalet yanına süzüldü ve kediye arkadaşlık etti. Bir süre birlikte oturdular.',
      watched: 'Usulca parlayan bir hayalet süzülüp geçti. Kedi onun eşlik edişini izledi, sonra silindi.',
      played: 'Usulca parlayan bir hayalet yanına süzüldü. Kedi silinip gidene kadar onunla oynadı.',
    },
  },
  meteorShower: {
    name: 'Meteor Yağmuru',
    description: 'Nadir bir küçük meteor yağmuru yukarıdaki gökyüzünden geçer.',
    fallback: 'Küçük bir meteor yağmuru gökyüzünden çizgiler çekti.',
    outcomes: {
      watched: 'Küçük bir meteor yağmuru gökyüzünden çizgiler çekti. Kedi hepsini izledi.',
      wished: 'Küçük bir meteor yağmuru gökyüzünden çizgiler çekti. Kedi altında sessizce dilek tutarak oturdu.',
      amazed: 'Küçük bir meteor yağmuru gökyüzünden çizgiler çekti. Kedi ışıklara yumuşakça miyavladı.',
    },
  },
  tinyDragon: {
    name: 'Minik Ejderha',
    description: 'Nadir bir minik ejderha havada durur ve küçük parıltılar üfler.',
    fallback: 'Minik bir ejderha yakında durup küçük parıltılar üfledi.',
    outcomes: {
      watched: 'Minik, dost canlısı bir ejderha yakında durup parıltılar üfledi. Kedi gözleri kocaman açılmış izledi.',
      played: 'Minik, dost canlısı bir ejderha yakında durup parıltılar üfledi. Kedi oyuna katıldı.',
      startled: 'Minik, dost canlısı bir ejderha aniden süzüldü. Kedi önce ürktü, sonra rahatladı.',
    },
  },
  midnightVisitor: {
    name: 'Gece Yarısı Ziyaretçisi',
    description: 'Nadir, sessiz bir siluet gece geç saatte uğrar.',
    fallback: 'Sessiz bir siluet gece yarısı uğradı ve yine gitti.',
    outcomes: {
      watched: 'Sessiz bir siluet karanlıkta uğradı. Kedi gelişini ve gidişini izledi.',
      greeted: 'Sessiz bir siluet karanlıkta uğradı. Kedi onu yumuşak bir miyavlamayla karşılamaya gitti.',
      hid: 'Sessiz bir siluet karanlıkta uğradı. Kedi gidene kadar gözden uzak durdu.',
    },
  },
};

export const GENERIC_TR = 'Küçük ve beklenmedik bir şey oldu.';
