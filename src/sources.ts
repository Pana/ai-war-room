/** 可随手调整的数据源名单。 */

/** 官方博客（RSS）。Anthropic 没有 RSS，单独抓网页，见 collectors/official.ts。 */
export const OFFICIAL_FEEDS = [
  { source: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { source: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { source: 'Google AI', url: 'https://blog.google/technology/ai/rss/' },
];

/** 以太坊客户端（取 GitHub 发布页）。 */
export const ETH_CLIENTS = [
  { name: 'Geth', repo: 'ethereum/go-ethereum', layer: '执行层' },
  { name: 'Nethermind', repo: 'NethermindEth/nethermind', layer: '执行层' },
  { name: 'Reth', repo: 'paradigmxyz/reth', layer: '执行层' },
  { name: 'Besu', repo: 'hyperledger/besu', layer: '执行层' },
  { name: 'Erigon', repo: 'erigontech/erigon', layer: '执行层' },
  { name: 'Lighthouse', repo: 'sigp/lighthouse', layer: '共识层' },
  { name: 'Prysm', repo: 'OffchainLabs/prysm', layer: '共识层' },
  { name: 'Teku', repo: 'Consensys/teku', layer: '共识层' },
  { name: 'Lodestar', repo: 'ChainSafe/lodestar', layer: '共识层' },
  { name: 'Nimbus', repo: 'status-im/nimbus-eth2', layer: '共识层' },
];

/** 以太坊生态新闻。always = 这个来源只讲以太坊，不需要再判断相关性。 */
export const ETH_NEWS_FEEDS = [
  { source: 'EF Blog', url: 'https://blog.ethereum.org/feed.xml', always: true },
  { source: 'Ethereal news', url: 'https://ethereal.news/rss.xml', always: true },
  { source: 'The Defiant', url: 'https://thedefiant.io/feed', always: false },
  { source: 'Decrypt', url: 'https://decrypt.co/feed', always: false },
];

/** 用来找"新项目"的 GitHub topic。 */
export const GITHUB_TOPICS = ['llm', 'ai', 'ai-agents', 'mcp', 'agent', 'machine-learning'];

/** 一定要跟踪的 AI 播客（即使没上榜）。名字用于在 Apple Podcasts 里搜索。 */
export const PODCAST_SEEDS = [
  'Dwarkesh Podcast',
  'Lex Fridman Podcast',
  'Latent Space: The AI Engineer Podcast',
  'No Priors: Artificial Intelligence',
  'The Cognitive Revolution',
  'The AI Daily Brief',
  'Hard Fork',
  'Machine Learning Street Talk',
  'The TWIML AI Podcast',
  'Practical AI',
  'Unsupervised Learning Redpoint',
];

/**
 * 节目 → YouTube 频道 handle，用来取单集观看数。
 * 左边是归一化节目名的前缀（小写、去标点，见 lib/text.ts 的 normName）。
 */
export const PODCAST_YOUTUBE: [prefix: string, handle: string][] = [
  ['lexfridman', 'lexfridman'],
  ['dwarkesh', 'DwarkeshPatel'],
  ['latentspace', 'LatentSpacePod'],
  ['nopriors', 'NoPriorsPodcast'],
  ['thecognitiverevolution', 'CognitiveRevolutionPodcast'],
  ['allin', 'allin'],
  ['thea16z', 'a16z'],
  ['a16z', 'a16z'],
  ['machinelearningstreettalk', 'MachineLearningStreetTalk'],
  ['theaidailybrief', 'AIDailyBrief'],
  ['hardfork', 'hardfork'],
  ['thetwimlai', 'twimlai'],
  ['unsupervisedlearning', 'RedpointAI'],
];
