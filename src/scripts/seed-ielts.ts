/**
 * IELTS Vocabulary Seeding Script
 * Downloads Oxford 5000 word list and inserts into database as 'ielts' type.
 * 
 * Oxford 5000 is from Oxford Learner's Dictionaries - the most authoritative
 * English vocabulary list, covering A1-C2 CEFR levels.
 * 
 * Source: https://github.com/tyypgzl/Oxford-5000-words
 * 
 * Usage: tsx src/scripts/seed-ielts.ts
 *   (Or: curl the JSON to /tmp/oxford5000.json first, then set USE_LOCAL_FILE=true)
 */

import 'dotenv/config';
import { Pool } from 'pg';
import * as fs from 'fs';

const GITHUB_API_URL = 'https://api.github.com/repos/tyypgzl/Oxford-5000-words/contents/full-word.json';
const LOCAL_JSON_PATH = '/tmp/oxford5000.json';
const USE_LOCAL_FILE = fs.existsSync(LOCAL_JSON_PATH);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

interface OxfordWord {
  id: number;
  value: {
    word: string;
    type: string;
    level: string;
    phonetics?: { us?: string; uk?: string };
    examples: string[];
  };
}

interface InsertWord {
  word: string;
  phonetic_us: string;
  phonetic_uk: string;
  definitions: { pos: string; meaning: string }[];
  examples: { sentence: string; translation: string }[];
  word_list_type: string;
}

function posMapping(type: string): string {
  const map: Record<string, string> = {
    'verb': 'v.',
    'noun': 'n.',
    'adjective': 'adj.',
    'adverb': 'adv.',
    'preposition': 'prep.',
    'conjunction': 'conj.',
    'exclamation': 'interj.',
    'determiner': 'det.',
    'pronoun': 'pron.',
    'auxiliary verb': 'aux. v.',
    'modal verb': 'modal v.',
    'ordinal number': 'num.',
    'number': 'num.',
    'linking verb': 'v.',
    'definite article': 'art.',
    'indefinite article': 'art.',
    'infinitive marker': 'inf. marker',
  };
  return map[type.toLowerCase()] || type;
}

function transformWord(raw: OxfordWord): InsertWord {
  const { word, type, phonetics, examples } = raw.value;

  const level = raw.value.level?.trim();
  const pos = posMapping(type);
  const meaning = level ? `[${type} ${level}]` : `[${type}]`;

  const definitions = [{ pos, meaning }];

  const exampleList = (examples || []).map((sentence: string) => ({
    sentence: sentence.trim(),
    translation: '',
  }));

  return {
    word: word.toLowerCase().trim(),
    phonetic_us: phonetics?.us || '',
    phonetic_uk: phonetics?.uk || '',
    definitions,
    examples: exampleList,
    word_list_type: 'ielts',
  };
}

async function fetchOxfordWords(): Promise<OxfordWord[]> {
  console.log('Fetching Oxford 5000 word list...');
  
  let data: OxfordWord[];
  
  if (USE_LOCAL_FILE) {
    console.log(`Reading from local file: ${LOCAL_JSON_PATH}`);
    const fileContent = fs.readFileSync(LOCAL_JSON_PATH, 'utf-8');
    data = JSON.parse(fileContent);
  } else {
    console.log('Using GitHub API...');
    const response = await fetch(GITHUB_API_URL, {
      headers: { 'Accept': 'application/vnd.github.v3.raw' },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    data = await response.json() as OxfordWord[];
  }
  
  console.log(`Fetched ${data.length} words`);
  return data;
}

async function seed() {
  const client = await pool.connect();
  let insertedCount = 0;
  let skippedCount = 0;
  const batchSize = 100;

  try {
    const words = await fetchOxfordWords();

    console.log('Starting seed...');
    
    // IELTS-relevant words: B1 and above (B1, B2, C1, C2)
    // Also include unleveled words
    const relevantLevels = ['B1', 'B2', 'C1', 'C2', ''];
    const filteredWords = words.filter(w => relevantLevels.includes(w.value.level?.trim() || ''));

    console.log(`Filtered to ${filteredWords.length} IELTS-relevant words (B1-C2 + unleveled)`);
    
    const levelCounts: Record<string, number> = {};
    for (const w of filteredWords) {
      const l = w.value.level?.trim() || 'unleveled';
      levelCounts[l] = (levelCounts[l] || 0) + 1;
    }
    console.log('Level breakdown:');
    for (const [level, count] of Object.entries(levelCounts)) {
      console.log(`  ${level}: ${count}`);
    }

    for (let i = 0; i < filteredWords.length; i += batchSize) {
      const batch = filteredWords.slice(i, i + batchSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const rawWord of batch) {
        const w = transformWord(rawWord);
        placeholders.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        values.push(
          w.word,
          w.phonetic_us,
          w.phonetic_uk,
          JSON.stringify(w.definitions),
          JSON.stringify(w.examples),
          w.word_list_type
        );
      }

      const query = `
        INSERT INTO words (word, phonetic_us, phonetic_uk, definitions, examples, word_list_type)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (word, word_list_type) DO NOTHING
        RETURNING id
      `;

      const result = await client.query(query, values);
      insertedCount += result.rowCount ?? 0;
      skippedCount += batch.length - (result.rowCount ?? 0);

      if (i % 500 === 0) {
        console.log(`Progress: ${i}/${filteredWords.length} (inserted: ${insertedCount}, skipped: ${skippedCount})`);
      }
    }

    console.log(`\n✅ Seeding complete!`);
    console.log(`   Inserted: ${insertedCount}`);
    console.log(`   Skipped (duplicates): ${skippedCount}`);

    const totalResult = await client.query(
      "SELECT word_list_type, COUNT(*) FROM words GROUP BY word_list_type"
    );
    console.log(`\nCurrent word counts by type:`);
    for (const row of totalResult.rows) {
      console.log(`   ${row.word_list_type}: ${row.count}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
