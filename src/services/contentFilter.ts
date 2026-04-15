/**
 * Content filtering service - sensitive word blacklist + validation
 */

// Chinese political
const POLITICAL_KEYWORDS = [
  '天安门', '六四', '法轮功', '达赖喇嘛', '西藏独立', '台湾独立',
  '香港抗议', '反送中', '新疆集中营', '文化大革命',
  'tiananmen', 'falun gong', 'dalai lama', 'tibet independence',
  'taiwan independence', 'hong kong protest', 'uyghur',
];

// Illegal content
const ILLEGAL_KEYWORDS = [
  '毒品', '大麻', '海洛因', '甲基苯丙胺', '冰毒', '可卡因',
  '赌博', '诈骗', '洗钱',
  'heroin', 'cocaine', 'methamphetamine', 'gambling fraud',
];

// Violence
const VIOLENCE_KEYWORDS = [
  '恐怖袭击', '枪击', '屠杀', '自杀', '炸弹',
  'terrorist attack', 'mass shooting', 'massacre', 'bomb making',
];

// Adult content
const ADULT_KEYWORDS = [
  '色情', '低俗', '性交易', '卖淫',
  'pornography', 'prostitution', 'sex trafficking',
];

const ALL_BLOCKED_KEYWORDS = [
  ...POLITICAL_KEYWORDS,
  ...ILLEGAL_KEYWORDS,
  ...VIOLENCE_KEYWORDS,
  ...ADULT_KEYWORDS,
];

/**
 * Check if text contains sensitive/blocked content
 */
export function containsSensitiveContent(text: string): boolean {
  const lower = text.toLowerCase();
  return ALL_BLOCKED_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Validate a theme input for sensitive content
 * Returns { valid, suggestion }
 */
export function validateTheme(theme: string): { valid: boolean; suggestion: string | null } {
  if (!theme || theme.trim().length === 0) {
    return { valid: false, suggestion: '请输入主题' };
  }

  if (theme.trim().length > 50) {
    return { valid: false, suggestion: '主题不能超过50个字符' };
  }

  if (containsSensitiveContent(theme)) {
    return { valid: false, suggestion: '请修改为您感兴趣的其他主题' };
  }

  return { valid: true, suggestion: null };
}

/**
 * Check AI-generated article content for safety
 */
export function isArticleSafe(content: string): boolean {
  return !containsSensitiveContent(content);
}
