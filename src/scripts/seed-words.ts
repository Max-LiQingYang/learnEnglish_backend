/**
 * Word seeding script.
 * In production, replace SAMPLE_WORDS with real vocabulary data
 * from open-source word lists (e.g. CET4 公开词库, TOEFL word list).
 *
 * Usage: tsx src/scripts/seed-words.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Sample data — replace with full vocabulary lists
const SAMPLE_WORDS = [
  {
    word: 'abandon',
    phonetic_us: '/əˈbændən/',
    phonetic_uk: '/əˈbændən/',
    definitions: [{ pos: 'v.', meaning: 'to leave completely and finally; forsake' }],
    examples: [{ sentence: 'He abandoned his car on the motorway.', translation: '他把车丢在了高速公路上。' }],
    word_list_type: 'cet4',
  },
  {
    word: 'abstract',
    phonetic_us: '/ˈæbstrækt/',
    phonetic_uk: '/ˈæbstrækt/',
    definitions: [
      { pos: 'adj.', meaning: 'existing in thought or as an idea but not having a physical reality' },
      { pos: 'n.', meaning: 'a summary of the contents of a book, article, or speech' },
    ],
    examples: [{ sentence: 'Abstract concepts are difficult for children to grasp.', translation: '抽象概念对孩子来说很难理解。' }],
    word_list_type: 'cet4',
  },
  {
    word: 'accomplish',
    phonetic_us: '/əˈkɑːmplɪʃ/',
    phonetic_uk: '/əˈkʌmplɪʃ/',
    definitions: [{ pos: 'v.', meaning: 'to succeed in doing something' }],
    examples: [{ sentence: 'We accomplished more than we expected.', translation: '我们完成的比预期的更多。' }],
    word_list_type: 'cet4',
  },
  {
    word: 'ambiguous',
    phonetic_us: '/æmˈbɪɡjuəs/',
    phonetic_uk: '/æmˈbɪɡjuəs/',
    definitions: [{ pos: 'adj.', meaning: 'open to more than one interpretation; having a double meaning' }],
    examples: [{ sentence: 'The meaning of the poem is ambiguous.', translation: '这首诗的含义模糊不清。' }],
    word_list_type: 'cet6',
  },
  {
    word: 'eloquent',
    phonetic_us: '/ˈeləkwənt/',
    phonetic_uk: '/ˈeləkwənt/',
    definitions: [{ pos: 'adj.', meaning: 'fluent or persuasive in speaking or writing' }],
    examples: [{ sentence: 'He gave an eloquent speech at the ceremony.', translation: '他在典礼上发表了雄辩的演讲。' }],
    word_list_type: 'toefl',
  },
  {
    word: 'perseverance',
    phonetic_us: '/ˌpɜːrsɪˈvɪrəns/',
    phonetic_uk: '/ˌpɜːsɪˈvɪərəns/',
    definitions: [{ pos: 'n.', meaning: 'continued effort to do or achieve something despite difficulty' }],
    examples: [{ sentence: 'Success requires perseverance and hard work.', translation: '成功需要坚持不懈和努力工作。' }],
    word_list_type: 'toefl',
  },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding words...');
    for (const w of SAMPLE_WORDS) {
      await client.query(
        `INSERT INTO words (word, phonetic_us, phonetic_uk, definitions, examples, word_list_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (word, word_list_type) DO NOTHING`,
        [w.word, w.phonetic_us, w.phonetic_uk, JSON.stringify(w.definitions), JSON.stringify(w.examples), w.word_list_type]
      );
    }
    console.log(`✓ Seeded ${SAMPLE_WORDS.length} sample words`);
    console.log('Note: Replace SAMPLE_WORDS with full vocabulary lists for production use.');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(console.error);
